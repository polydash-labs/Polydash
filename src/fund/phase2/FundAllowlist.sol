// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFundPriceFeed} from "./Interfaces.sol";

/// @title FundAllowlist (not reviewed, not deployed)
/// @notice Global allowlist of swap routers and assets for Phase 2 funds.
///         The constructor set is live immediately. Later additions and removals wait `delay`.
///         Pause takes effect immediately and blocks swaps. It does not move vault balances.
///         One asset is the quote (WETH) and has no feed. Every other asset needs a feed
///         before it can be enabled. This contract does not ship a feed address.
///         No per-asset Chainlink proxy, heartbeat, or denomination is recorded here.
///         That is not a finding that feeds do not exist. This allowlist does not set one.
contract FundAllowlist {
    uint256 public constant MIN_DELAY = 1 days;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant MIN_STALE = 1 minutes;
    /// @notice Trading freshness ceiling. The Chainlink dataset heartbeat on Robinhood Chain is
    ///         86400 seconds for the stablecoin feeds, so a 1-hour ceiling would reject every
    ///         stablecoin feed as read, permanently. The ceiling is the heartbeat, not a trading
    ///         bound: each asset still gets its own `maxStale` (1 day for USDG, tighter for an
    ///         asset whose feed updates hourly), and the min/max price band plus the vault's
    ///         execution-deviation check are the guards that catch a bad price.
    uint256 public constant MAX_STALE = 1 days;
    uint256 public constant MAX_LIST = 64;

    struct Feed {
        address feed;
        uint64 maxStale;
        uint256 minPriceX18;
        uint256 maxPriceX18;
    }

    struct AssetInit {
        address asset;
        bool quote;
        address feed;
        uint64 maxStale;
        uint256 minPriceX18;
        uint256 maxPriceX18;
    }

    struct Proposal {
        address target;
        bool isRouter;
        bool allowed;
        uint64 readyAt;
        bool executed;
        bool canceled;
        address feed;
        uint64 maxStale;
        uint256 minPriceX18;
        uint256 maxPriceX18;
    }

    address public owner;
    address public pendingOwner;
    address public quoteAsset;
    uint256 public delay;
    bool public paused;

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    mapping(address => bool) public routerAllowed;
    mapping(address => bool) public assetAllowed;
    mapping(address => Feed) public feeds;
    mapping(address => bool) private _routerSeen;
    mapping(address => bool) private _assetSeen;
    address[] private _routers;
    address[] private _assets;

    event Proposed(uint256 indexed id, address indexed target, bool isRouter, bool allowed, uint64 readyAt);
    event Executed(uint256 indexed id, address indexed target, bool isRouter, bool allowed);
    event Canceled(uint256 indexed id);
    event Paused(bool paused);
    event DelaySet(uint256 delay);
    event FeedSet(address indexed asset, address indexed feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error BadDelay();
    error BadProposal();
    error Timelock();
    error TooMany();
    error Duplicate();
    error PriceUnavailable();
    error PriceStale();
    error PriceRejected();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param initialRouters Routers that may be called immediately. Later routers go through `propose`.
    /// @param initialAssets Quote asset, plus any asset that already has a feed. No feed address is implied.
    constructor(address _owner, uint256 _delay, address[] memory initialRouters, AssetInit[] memory initialAssets) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_delay < MIN_DELAY || _delay > MAX_DELAY) revert BadDelay();
        owner = _owner;
        delay = _delay;
        _seedRouters(initialRouters);
        _seedAssets(initialAssets);
        emit OwnershipTransferred(address(0), _owner);
        emit DelaySet(_delay);
    }

    function routerCount() external view returns (uint256) {
        return _routers.length;
    }

    function routers(uint256 index) external view returns (address) {
        return _routers[index];
    }

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function assets(uint256 index) external view returns (address) {
        return _assets[index];
    }

    function feedOf(address asset)
        external
        view
        returns (address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
    {
        Feed storage stored = feeds[asset];
        return (stored.feed, stored.maxStale, stored.minPriceX18, stored.maxPriceX18);
    }

    /// @notice Revert unless `asset` has a fresh in-bounds feed. The quote asset has no feed and reverts here.
    function checkPrice(address asset) external view {
        _price(asset);
    }

    /// @notice ETH wei for `amount` of `asset` at the current feed.
    function quote(address asset, uint256 amount) external view returns (uint256) {
        return Math.mulDiv(amount, _price(asset), 1e18);
    }

    /// @notice Queue a router change, or removal of an asset. Enabling an asset with no stored feed reverts on execute.
    function propose(address target, bool isRouter, bool allowed) external onlyOwner returns (uint256 id) {
        if (target == address(0)) revert ZeroAddress();
        id = _queue(target, isRouter, allowed, address(0), 0, 0, 0);
    }

    /// @notice Queue an asset enable together with its feed. The feed must already have code.
    function proposeAsset(
        address asset,
        address feed,
        uint64 maxStale,
        uint256 minPriceX18,
        uint256 maxPriceX18
    ) external onlyOwner returns (uint256 id) {
        if (asset == address(0) || asset == quoteAsset) revert ZeroAddress();
        _checkFeed(feed, maxStale, minPriceX18, maxPriceX18);
        id = _queue(asset, false, true, feed, maxStale, minPriceX18, maxPriceX18);
    }

    /// @notice Apply a proposal after `readyAt`. Anyone may call this.
    function execute(uint256 id) external {
        Proposal storage proposal = proposals[id];
        if (proposal.readyAt == 0 || proposal.executed || proposal.canceled) revert BadProposal();
        if (block.timestamp < proposal.readyAt) revert Timelock();
        proposal.executed = true;
        if (!proposal.isRouter && proposal.allowed && proposal.feed != address(0)) {
            _storeFeed(proposal.target, proposal.feed, proposal.maxStale, proposal.minPriceX18, proposal.maxPriceX18);
        }
        _apply(proposal.target, proposal.isRouter, proposal.allowed);
        emit Executed(id, proposal.target, proposal.isRouter, proposal.allowed);
    }

    function cancel(uint256 id) external onlyOwner {
        Proposal storage proposal = proposals[id];
        if (proposal.readyAt == 0 || proposal.executed || proposal.canceled) revert BadProposal();
        proposal.canceled = true;
        emit Canceled(id);
    }

    /// @notice Immediate. Blocks new swaps while set. Does not withdraw balances.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /// @notice The delay can be lengthened, up to 30 days. It cannot be shortened.
    function setDelay(uint256 next) external onlyOwner {
        if (next <= delay || next > MAX_DELAY) revert BadDelay();
        delay = next;
        emit DelaySet(next);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function _queue(
        address target,
        bool isRouter,
        bool allowed,
        address feed,
        uint64 maxStale,
        uint256 minPriceX18,
        uint256 maxPriceX18
    ) internal returns (uint256 id) {
        id = ++proposalCount;
        uint64 readyAt = uint64(block.timestamp + delay);
        proposals[id] = Proposal({
            target: target,
            isRouter: isRouter,
            allowed: allowed,
            readyAt: readyAt,
            executed: false,
            canceled: false,
            feed: feed,
            maxStale: maxStale,
            minPriceX18: minPriceX18,
            maxPriceX18: maxPriceX18
        });
        emit Proposed(id, target, isRouter, allowed, readyAt);
    }

    function _seedRouters(address[] memory list) internal {
        if (list.length > MAX_LIST) revert TooMany();
        for (uint256 i; i < list.length; ++i) {
            if (_routerSeen[list[i]]) revert Duplicate();
            _apply(list[i], true, true);
        }
    }

    function _seedAssets(AssetInit[] memory list) internal {
        if (list.length > MAX_LIST) revert TooMany();
        for (uint256 i; i < list.length; ++i) {
            AssetInit memory item = list[i];
            if (item.asset == address(0)) revert ZeroAddress();
            if (_assetSeen[item.asset]) revert Duplicate();
            if (item.quote) {
                if (quoteAsset != address(0) || item.feed != address(0)) revert BadProposal();
                quoteAsset = item.asset;
            } else {
                _checkFeed(item.feed, item.maxStale, item.minPriceX18, item.maxPriceX18);
                _storeFeed(item.asset, item.feed, item.maxStale, item.minPriceX18, item.maxPriceX18);
            }
            _apply(item.asset, false, true);
        }
        if (quoteAsset == address(0)) revert ZeroAddress();
    }

    function _apply(address target, bool isRouter, bool allowed) internal {
        if (target == address(0)) revert ZeroAddress();
        if (isRouter) {
            if (routerAllowed[target] == allowed) return;
            routerAllowed[target] = allowed;
            if (allowed && !_routerSeen[target]) {
                if (_routers.length == MAX_LIST) revert TooMany();
                _routerSeen[target] = true;
                _routers.push(target);
            }
            return;
        }
        if (allowed && target != quoteAsset && feeds[target].feed == address(0)) revert PriceUnavailable();
        if (assetAllowed[target] == allowed) return;
        assetAllowed[target] = allowed;
        if (allowed && !_assetSeen[target]) {
            if (_assets.length == MAX_LIST) revert TooMany();
            _assetSeen[target] = true;
            _assets.push(target);
        }
    }

    function _checkFeed(address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18) internal view {
        if (feed == address(0) || feed.code.length == 0) revert PriceUnavailable();
        if (maxStale < MIN_STALE || maxStale > MAX_STALE) revert BadDelay();
        if (minPriceX18 == 0 || minPriceX18 > maxPriceX18) revert PriceRejected();
    }

    function _storeFeed(address asset, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
        internal
    {
        feeds[asset] = Feed({feed: feed, maxStale: maxStale, minPriceX18: minPriceX18, maxPriceX18: maxPriceX18});
        emit FeedSet(asset, feed, maxStale, minPriceX18, maxPriceX18);
    }

    function _price(address asset) internal view returns (uint256 priceX18) {
        Feed storage stored = feeds[asset];
        if (stored.feed == address(0)) revert PriceUnavailable();
        (bool ok, bytes memory data) = stored.feed.staticcall(
            abi.encodeWithSelector(IFundPriceFeed.latestPrice.selector, asset)
        );
        if (!ok || data.length < 64) revert PriceUnavailable();
        uint64 updatedAt;
        (priceX18, updatedAt) = abi.decode(data, (uint256, uint64));
        if (priceX18 == 0 || updatedAt == 0 || updatedAt > block.timestamp) revert PriceUnavailable();
        if (block.timestamp - updatedAt > stored.maxStale) revert PriceStale();
        if (priceX18 < stored.minPriceX18 || priceX18 > stored.maxPriceX18) revert PriceRejected();
    }
}
