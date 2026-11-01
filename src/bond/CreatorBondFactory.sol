// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CreatorBond} from "./CreatorBond.sol";
import {IPolydashFactoryInfo, IPolydashLaunchInfo} from "./IPolydashLaunchInfo.sol";

/// @title CreatorBondFactory (DRAFT - not reviewed, not deployed)
/// @notice Ownerless, permissionless. Only the on-chain `creator()` of a PolydashFactory launch can bond its token.
contract CreatorBondFactory is ReentrancyGuard {
    uint256 public constant MIN_BOND = 0.01 ether;
    uint256 public constant MIN_DURATION = 7 days;
    uint256 public constant MAX_DURATION = 730 days;
    uint256 public constant MAX_ALLOWANCE_BPS = 2_000; // creator may sell/move at most 20% of committed
    uint256 public constant MAX_WALLETS = 10;

    address public immutable launchFactoryA; // current PolydashFactory 0xfDfD...08c2
    address public immutable launchFactoryB; // earlier PolydashFactory 0x2C84...5dB2 (or 0)

    address[] public allBonds;
    mapping(address => bool) public isBond;
    mapping(address => address[]) internal _byToken;

    event BondCreated(
        address indexed bond,
        address indexed token,
        address indexed creator,
        uint256 amount,
        uint256 committed,
        uint256 allowanceBps,
        uint256 duration,
        address[] wallets
    );

    error ZeroAddress();
    error NotPolydashToken();
    error NotCreator();
    error BondTooSmall();
    error BadDuration();
    error BadAllowance();
    error BadWallets();
    error ZeroCommitted();
    error InsufficientBalance();

    constructor(address _launchFactoryA, address _launchFactoryB) {
        if (_launchFactoryA == address(0)) revert ZeroAddress();
        launchFactoryA = _launchFactoryA;
        launchFactoryB = _launchFactoryB;
    }

    /// @notice Launch contract for `token` on factory A, else factory B, else address(0).
    function launchOf(address token) public view returns (address launch) {
        launch = IPolydashFactoryInfo(launchFactoryA).launchOfToken(token);
        if (launch == address(0) && launchFactoryB != address(0)) {
            launch = IPolydashFactoryInfo(launchFactoryB).launchOfToken(token);
        }
    }

    /// @param wallets   Registered wallets. Must include msg.sender (the launch creator); no duplicates; max 10.
    ///                  Bound forever, cannot be removed. Non-creator wallets must call confirmWallet() on the bond.
    /// @param committed Aggregate token amount the wallets commit to hold (must be held now).
    function createBond(
        address token,
        address[] calldata wallets,
        uint256 committed,
        uint256 allowanceBps,
        uint256 duration
    ) external payable nonReentrant returns (address bond) {
        address launch = launchOf(token);
        if (launch == address(0) || IPolydashLaunchInfo(launch).token() != token) revert NotPolydashToken();
        if (IPolydashLaunchInfo(launch).creator() != msg.sender) revert NotCreator();
        if (msg.value < MIN_BOND) revert BondTooSmall();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadDuration();
        if (allowanceBps > MAX_ALLOWANCE_BPS) revert BadAllowance();
        if (committed == 0) revert ZeroCommitted();
        uint256 n = wallets.length;
        if (n == 0 || n > MAX_WALLETS) revert BadWallets();
        bool hasCreator;
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            address w = wallets[i];
            if (w == address(0) || w == launch || w == token) revert BadWallets();
            for (uint256 j; j < i; ++j) {
                if (wallets[j] == w) revert BadWallets();
            }
            if (w == msg.sender) hasCreator = true;
            sum += IERC20(token).balanceOf(w);
        }
        if (!hasCreator) revert BadWallets();
        if (sum < committed) revert InsufficientBalance();

        bond = address(
            new CreatorBond{value: msg.value}(token, msg.sender, wallets, committed, allowanceBps, duration)
        );
        allBonds.push(bond);
        isBond[bond] = true;
        _byToken[token].push(bond);
        emit BondCreated(bond, token, msg.sender, msg.value, committed, allowanceBps, duration, wallets);
    }

    function allBondsLength() external view returns (uint256) {
        return allBonds.length;
    }

    function bondsByToken(address token) external view returns (address[] memory) {
        return _byToken[token];
    }
}
