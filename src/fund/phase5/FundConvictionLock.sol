// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPhase5Market, IPhase5Registry, IPhase5Share, Phase5Fund} from "./IPhase5.sol";

/// @title FundConvictionLock
/// @notice A holder may place one Phase 3 share here for 30, 90, or 180 days.
///         Until `unlock`, the share stays in this contract, so the holder cannot transfer it,
///         list it, or call `exit`. `unlock` reverts before `expiry`. There is no payment for locking.
///         Not audited. Not a review. Not financial advice.
contract FundConvictionLock is ReentrancyGuard {
    uint256 public constant TIER_30 = 30;
    uint256 public constant TIER_90 = 90;
    uint256 public constant TIER_180 = 180;

    struct Position {
        address holder;
        uint64 expiry;
        uint64 tierDays;
    }

    address public immutable factory;
    address public immutable registry;

    mapping(address nft => mapping(uint256 tokenId => Position)) public positions;

    event Locked(address indexed nft, uint256 indexed tokenId, address indexed holder, uint256 tierDays, uint64 expiry);
    event Unlocked(address indexed nft, uint256 indexed tokenId, address indexed holder);

    error ZeroAddress();
    error BadTier();
    error NotHolder();
    error AlreadyLocked();
    error NotLocked();
    error TooEarly();
    error UnexpectedNft();

    constructor(address phase3Factory, address phase5Registry) {
        if (phase3Factory == address(0) || phase5Registry == address(0)) revert ZeroAddress();
        factory = phase3Factory;
        registry = phase5Registry;
    }

    /// @dev Shares move with `transferFrom`. The receiver hook reverts so a pushed share is not left here.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert UnexpectedNft();
    }

    /// @param tierDays 30, 90, or 180. The share is pulled in this call.
    function lock(address nft, uint256 tokenId, uint256 tierDays) external nonReentrant {
        if (tierDays != TIER_30 && tierDays != TIER_90 && tierDays != TIER_180) revert BadTier();
        address vault = Phase5Fund.vaultOf(factory, nft);
        if (vault == address(0)) revert Phase5Fund.NotFund();
        if (IPhase5Share(nft).ownerOf(tokenId) != msg.sender) revert NotHolder();
        if (positions[nft][tokenId].holder != address(0)) revert AlreadyLocked();
        uint64 expiry = uint64(block.timestamp + tierDays * 1 days);
        positions[nft][tokenId] = Position({holder: msg.sender, expiry: expiry, tierDays: uint64(tierDays)});
        emit Locked(nft, tokenId, msg.sender, tierDays, expiry);
        IPhase5Market(IPhase5Registry(registry).market()).clearApprovalListing(nft, tokenId);
        IPhase5Share(nft).transferFrom(msg.sender, address(this), tokenId);
        if (IPhase5Share(nft).ownerOf(tokenId) != address(this)) revert NotHolder();
    }

    /// @notice After `expiry`, the recorded holder receives the share back.
    function unlock(address nft, uint256 tokenId) external nonReentrant {
        Position memory row = positions[nft][tokenId];
        if (row.holder == address(0)) revert NotLocked();
        if (msg.sender != row.holder) revert NotHolder();
        if (block.timestamp < row.expiry) revert TooEarly();
        delete positions[nft][tokenId];
        emit Unlocked(nft, tokenId, row.holder);
        IPhase5Share(nft).transferFrom(address(this), row.holder, tokenId);
    }

    /// @notice True until `expiry`. After that the share remains here until `unlock`.
    function isLocked(address nft, uint256 tokenId) external view returns (bool) {
        Position memory row = positions[nft][tokenId];
        return row.holder != address(0) && block.timestamp < row.expiry;
    }

    /// @notice True from `lock` until `unlock`, including after `expiry`.
    function inCustody(address nft, uint256 tokenId) external view returns (bool) {
        return positions[nft][tokenId].holder != address(0);
    }

    /// @notice 30, 90, 180, or 0 when the share is not in this contract. Badge readers use this value.
    function tierOf(address nft, uint256 tokenId) external view returns (uint256) {
        return positions[nft][tokenId].tierDays;
    }
}
