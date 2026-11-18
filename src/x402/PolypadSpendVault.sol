// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title PolypadSpendVault
/// @notice Tab-model spending vault for the Polypad x402 layer. Money stays
///         in the vault; an agent gets a spending key with a policy
///         (per-payment cap, daily cap, payee allowlist, expiry). The
///         facilitator settles signed EIP-712 spend authorizations against
///         the vault. Keys are revocable, the owner can withdraw any time,
///         and no admin function moves user balances.
/// @dev New module for the x402 layer (v1). Does not touch any live contract.
///      Contracts are unaudited (Slither only).
///      Score-band limits (§5 of the x402 spec) are enforced by the
///      facilitator API at key creation and at settle time; this contract
///      enforces the key's own policy (caps, allowlist, expiry, nonce).
contract PolypadSpendVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice EIP-712 type for a spend authorization signed by the key.
    bytes32 public constant SPEND_TYPEHASH =
        keccak256("SpendAuthorization(address key,address token,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    /// @notice Spending key policy. `owner` is the depositor who created it.
    struct Key {
        address owner;
        address token;
        uint256 perPaymentCap;
        uint256 dailyCap;
        uint64 expiry;
        bool revoked;
        uint64 spentDay; // UTC day number of the current daily window
        uint256 spentToday;
        uint256 allowlistCount; // 0 = any payee allowed
    }

    /// @notice Admin (pause + facilitator). Set to the deployer.
    address public owner;
    /// @notice The facilitator that settles spends. Only it may call
    ///         spendWithAuthorization.
    address public facilitator;
    /// @notice True while spending is paused (deposits/withdraws unaffected).
    bool public paused;

    /// @notice Depositor balances: owner => token => amount.
    mapping(address => mapping(address => uint256)) public balances;
    /// @notice Spending keys by key address.
    mapping(address => Key) public keys;
    /// @notice Payee allowlist per key.
    mapping(address => mapping(address => bool)) public keyAllowlist;
    /// @notice Used authorization nonces per key.
    mapping(address => mapping(bytes32 => bool)) public usedNonces;

    event Deposited(address indexed owner, address indexed token, uint256 amount);
    event Withdrawn(address indexed owner, address indexed token, uint256 amount);
    event KeyCreated(
        address indexed owner, address indexed key, address indexed token, uint256 perPaymentCap, uint256 dailyCap, uint64 expiry
    );
    event KeyRevoked(address indexed owner, address indexed key);
    event Spent(
        address indexed key, address indexed token, address indexed to, uint256 value, bytes32 nonce
    );
    event FacilitatorSet(address indexed facilitator);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error NotOwner();
    error NotFacilitator();
    error PausedSpend();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroCap();
    error KeyExists();
    error KeyNotFound();
    error KeyIsRevoked();
    error KeyExpired();
    error TokenMismatch();
    error NotKeyOwner();
    error InvalidSignature();
    error NonceUsed();
    error NotYetValid();
    error ExpiredAuthorization();
    error OverPerPaymentCap();
    error OverDailyCap();
    error PayeeNotAllowlisted();
    error InsufficientBalance();

    constructor() EIP712("PolypadSpendVault", "1") {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Deposit ERC20 into the vault. Funds stay the depositor's.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraw the caller's own deposited balance, any time.
    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender][token] < amount) revert InsufficientBalance();
        balances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Create a spending key for `key`, bound to one token.
    /// @dev `allowlist` empty means any payee is allowed. `expiry` is a
    ///      unix timestamp; it must be in the future.
    function createKey(
        address key,
        address token,
        uint256 perPaymentCap,
        uint256 dailyCap,
        address[] calldata allowlist,
        uint64 expiry
    ) external {
        if (key == address(0) || token == address(0)) revert ZeroAddress();
        if (perPaymentCap == 0 || dailyCap == 0) revert ZeroCap();
        if (perPaymentCap > dailyCap) revert OverDailyCap();
        if (expiry <= block.timestamp) revert ExpiredAuthorization();
        if (keys[key].owner != address(0)) revert KeyExists();
        keys[key] = Key({
            owner: msg.sender,
            token: token,
            perPaymentCap: perPaymentCap,
            dailyCap: dailyCap,
            expiry: expiry,
            revoked: false,
            spentDay: 0,
            spentToday: 0,
            allowlistCount: allowlist.length
        });
        for (uint256 i = 0; i < allowlist.length; i++) {
            keyAllowlist[key][allowlist[i]] = true;
        }
        emit KeyCreated(msg.sender, key, token, perPaymentCap, dailyCap, expiry);
    }

    /// @notice Revoke a key created by the caller. One tx, immediate.
    function revokeKey(address key) external {
        Key storage k = keys[key];
        if (k.owner == address(0)) revert KeyNotFound();
        if (k.owner != msg.sender) revert NotKeyOwner();
        if (k.revoked) revert KeyIsRevoked();
        k.revoked = true;
        emit KeyRevoked(msg.sender, key);
    }

    /// @notice Point the vault at the facilitator that settles spends.
    function setFacilitator(address _facilitator) external onlyOwner {
        if (_facilitator == address(0)) revert ZeroAddress();
        facilitator = _facilitator;
        emit FacilitatorSet(_facilitator);
    }

    /// @notice Pause spending (deposits/withdraws keep working).
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume spending.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Settle a signed spend authorization. Facilitator-only.
    /// @dev Checks, in order: pause, key exists/active/unexpired, token
    ///      match, validity window, nonce fresh, signature recovers to the
    ///      key, value within per-payment cap, daily cap within the current
    ///      UTC day, payee allowlisted, owner balance sufficient.
    function spendWithAuthorization(
        address key,
        address token,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external nonReentrant {
        if (msg.sender != facilitator) revert NotFacilitator();
        if (paused) revert PausedSpend();
        Key storage k = keys[key];
        if (k.owner == address(0)) revert KeyNotFound();
        if (k.revoked) revert KeyIsRevoked();
        if (block.timestamp > k.expiry) revert KeyExpired();
        if (token != k.token) revert TokenMismatch();
        if (block.timestamp < validAfter) revert NotYetValid();
        if (block.timestamp > validBefore) revert ExpiredAuthorization();
        if (usedNonces[key][nonce]) revert NonceUsed();
        if (value == 0 || value > k.perPaymentCap) revert OverPerPaymentCap();
        if (k.allowlistCount > 0 && !keyAllowlist[key][to]) revert PayeeNotAllowlisted();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SPEND_TYPEHASH, key, token, to, value, validAfter, validBefore, nonce
                )
            )
        );
        if (ECDSA.recover(digest, signature) != key) revert InvalidSignature();

        uint64 today = uint64(block.timestamp / 1 days);
        uint256 spent = today == k.spentDay ? k.spentToday : 0;
        if (spent + value > k.dailyCap) revert OverDailyCap();

        usedNonces[key][nonce] = true;
        k.spentDay = today;
        k.spentToday = spent + value;
        if (balances[k.owner][token] < value) revert InsufficientBalance();
        balances[k.owner][token] -= value;
        IERC20(token).safeTransfer(to, value);
        emit Spent(key, token, to, value, nonce);
    }

    /// @notice EIP-712 domain separator (for clients building signatures).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
