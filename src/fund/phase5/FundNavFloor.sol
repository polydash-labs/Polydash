// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPhase5Lock, IPhase5Market, IPhase5Registry, IPhase5Share, IPhase5Vault, Phase5Fund} from "./IPhase5.sol";

/// @title FundNavFloor
/// @notice Queues one Phase 3 share, then calls the vault's existing `exit` or `refund`.
///         The cooldown is one day, the same minimum the vault's protection bits use for the allowlist timelock.
///         Assets are forwarded in kind. This contract does not call the swap facet: that call is limited to the
///         manager or an executor, and a trade would change the book for the shares that remain.
///         `spendableEth` already excludes entry, protocol, and performance fees. There is no further exit fee in the vault.
///         The Phase 3 `exit` on the share itself stays available to a holder who has not queued here.
///         Not audited. Not a review. Not financial advice.
contract FundNavFloor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant EXIT_COOLDOWN = 1 days;

    struct Queue {
        address holder;
        uint64 readyAt;
    }

    address public immutable factory;
    address public immutable registry;

    mapping(address nft => mapping(uint256 tokenId => Queue)) public queues;
    /// @dev Vault allowed to send ETH during the active `redeem` or `refund`.
    address private _acceptingFrom;

    event ExitQueued(address indexed nft, uint256 indexed tokenId, address indexed holder, uint64 readyAt);
    event ExitCancelled(address indexed nft, uint256 indexed tokenId, address indexed holder);
    event ExitRedeemed(address indexed nft, uint256 indexed tokenId, address indexed holder, uint256 ethOut);

    error ZeroAddress();
    error NotHolder();
    error NotQueued();
    error AlreadyQueued();
    error CoolingDown();
    error NotExitable();
    error ShareLocked();
    error Listed();
    error DirectEth();
    error PayFailed();
    error UnexpectedNft();

    constructor(address phase3Factory, address phase5Registry) {
        if (phase3Factory == address(0) || phase5Registry == address(0)) revert ZeroAddress();
        factory = phase3Factory;
        registry = phase5Registry;
    }

    receive() external payable {
        if (msg.sender != _acceptingFrom || msg.value == 0) revert DirectEth();
    }

    /// @dev Shares move with `transferFrom`. The receiver hook reverts so a pushed share is not left here.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert UnexpectedNft();
    }

    /// @notice One share of spendable ETH, using the vault's own division. The last outstanding share's
    ///         later `exit` receives the remainder. This view does not include mandate tokens.
    function quote(address nft, uint256 tokenId) external view returns (uint256 ethShare, uint256 supply, uint8 status) {
        address vault = Phase5Fund.vaultOf(factory, nft);
        if (IPhase5Share(nft).ownerOf(tokenId) == address(0)) revert NotHolder();
        supply = IPhase5Share(nft).outstanding();
        status = IPhase5Vault(vault).status();
        ethShare = _share(IPhase5Vault(vault).spendableEth(), supply);
    }

    /// @notice Pro-rata token amount for one share, after `tokenReserved`.
    function tokenShare(address nft, uint256 tokenId, address asset) external view returns (uint256) {
        address vault = Phase5Fund.vaultOf(factory, nft);
        if (IPhase5Share(nft).ownerOf(tokenId) == address(0)) revert NotHolder();
        uint256 supply = IPhase5Share(nft).outstanding();
        uint256 reserved = IPhase5Vault(vault).tokenReserved(asset);
        uint256 bal = IERC20(asset).balanceOf(vault);
        uint256 available = bal > reserved ? bal - reserved : 0;
        return _share(available, supply);
    }

    function queue(address nft, uint256 tokenId) external nonReentrant {
        address vault = Phase5Fund.vaultOf(factory, nft);
        uint8 status = IPhase5Vault(vault).status();
        if (
            status != Phase5Fund.STATUS_CLOSED && status != Phase5Fund.STATUS_INVESTING
                && status != Phase5Fund.STATUS_FAILED
        ) revert NotExitable();
        if (IPhase5Share(nft).ownerOf(tokenId) != msg.sender) revert NotHolder();
        if (queues[nft][tokenId].holder != address(0)) revert AlreadyQueued();
        if (IPhase5Lock(IPhase5Registry(registry).locks()).inCustody(nft, tokenId)) revert ShareLocked();
        address market = IPhase5Registry(registry).market();
        if (IPhase5Market(market).holds(nft, tokenId)) revert Listed();
        uint64 readyAt = uint64(block.timestamp + EXIT_COOLDOWN);
        queues[nft][tokenId] = Queue({holder: msg.sender, readyAt: readyAt});
        emit ExitQueued(nft, tokenId, msg.sender, readyAt);
        IPhase5Market(market).clearApprovalListing(nft, tokenId);
        IPhase5Share(nft).transferFrom(msg.sender, address(this), tokenId);
        if (IPhase5Share(nft).ownerOf(tokenId) != address(this)) revert NotHolder();
    }

    function cancel(address nft, uint256 tokenId) external nonReentrant {
        Queue memory row = queues[nft][tokenId];
        if (row.holder == address(0)) revert NotQueued();
        if (msg.sender != row.holder) revert NotHolder();
        delete queues[nft][tokenId];
        emit ExitCancelled(nft, tokenId, row.holder);
        IPhase5Share(nft).transferFrom(address(this), row.holder, tokenId);
    }

    /// @notice After the cooldown, burn the share through the vault and forward what it pays the caller.
    function redeem(address nft, uint256 tokenId) external nonReentrant returns (uint256 ethOut) {
        Queue memory row = queues[nft][tokenId];
        if (row.holder == address(0)) revert NotQueued();
        if (msg.sender != row.holder) revert NotHolder();
        if (block.timestamp < row.readyAt) revert CoolingDown();
        address vault = Phase5Fund.vaultOf(factory, nft);
        uint8 status = IPhase5Vault(vault).status();
        if (
            status != Phase5Fund.STATUS_CLOSED && status != Phase5Fund.STATUS_INVESTING
                && status != Phase5Fund.STATUS_FAILED
        ) revert NotExitable();
        address[] memory tokens = _assets(vault);
        uint256 n = tokens.length;
        uint256 supply = IPhase5Share(nft).outstanding();
        uint256[] memory due = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            if (i > 0 && tokens[i] == tokens[0]) continue;
            uint256 reserved = IPhase5Vault(vault).tokenReserved(tokens[i]);
            uint256 bal = IERC20(tokens[i]).balanceOf(vault);
            uint256 available = bal > reserved ? bal - reserved : 0;
            due[i] = _share(available, supply);
        }
        delete queues[nft][tokenId];
        _acceptingFrom = vault;
        uint256[] memory ids = new uint256[](1);
        ids[0] = tokenId;
        if (status == Phase5Fund.STATUS_FAILED) IPhase5Share(nft).refund(ids);
        else IPhase5Share(nft).exit(ids);
        ethOut = address(this).balance;
        emit ExitRedeemed(nft, tokenId, msg.sender, ethOut);
        if (ethOut > 0) {
            (bool ok,) = msg.sender.call{value: ethOut}("");
            if (!ok) revert PayFailed();
        }
        for (uint256 i; i < n; ++i) {
            if (due[i] < 1) continue;
            IERC20(tokens[i]).safeTransfer(msg.sender, due[i]);
        }
    }

    function _assets(address vault) internal view returns (address[] memory tokens) {
        uint256 n = IPhase5Vault(vault).mandateAssetCount();
        tokens = new address[](n + 1);
        tokens[0] = IPhase5Vault(vault).weth();
        for (uint256 i; i < n; ++i) {
            tokens[i + 1] = IPhase5Vault(vault).mandateAssets(i);
        }
    }

    function _share(uint256 pool, uint256 supply) internal pure returns (uint256) {
        if (pool < 1 || supply < 1) return 0;
        if (supply < 2) return pool;
        return pool / supply;
    }
}
