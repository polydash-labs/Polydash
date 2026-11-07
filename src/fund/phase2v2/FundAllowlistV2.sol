// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FundAllowlistV2 (not reviewed, not deployed)
/// @notice Routers and assets for one Phase 2 v2 factory. The constructor set is live immediately.
///         Later edits wait `delay`. Pause blocks swaps and does not move balances.
///         This list does not require a price feed. Crypto assets only. No stock tokens.
contract FundAllowlistV2 {
    uint256 public constant MIN_DELAY = 1 days;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant MAX_LIST = 64;

    struct Proposal {
        address target;
        bool isRouter;
        bool allowed;
        uint64 readyAt;
        bool executed;
        bool canceled;
    }

    address public owner;
    address public pendingOwner;
    uint256 public delay;
    bool public paused;
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => bool) public routerAllowed;
    mapping(address => bool) public assetAllowed;
    mapping(address => bool) private _routerSeen;
    mapping(address => bool) private _assetSeen;
    address[] private _routers;
    address[] private _assets;

    event Proposed(uint256 indexed id, address indexed target, bool isRouter, bool allowed, uint64 readyAt);
    event Executed(uint256 indexed id, address indexed target, bool isRouter, bool allowed);
    event Canceled(uint256 indexed id);
    event Paused(bool paused);
    event DelaySet(uint256 delay);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error BadDelay();
    error BadProposal();
    error Timelock();
    error TooMany();
    error Duplicate();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, uint256 _delay, address[] memory initialRouters, address[] memory initialAssets) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_delay < MIN_DELAY || _delay > MAX_DELAY) revert BadDelay();
        owner = _owner;
        delay = _delay;
        _seed(initialRouters, true);
        _seed(initialAssets, false);
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

    function propose(address target, bool isRouter, bool allowed) external onlyOwner returns (uint256 id) {
        if (target == address(0)) revert ZeroAddress();
        id = ++proposalCount;
        uint64 readyAt = uint64(block.timestamp + delay);
        proposals[id] = Proposal({
            target: target, isRouter: isRouter, allowed: allowed, readyAt: readyAt, executed: false, canceled: false
        });
        emit Proposed(id, target, isRouter, allowed, readyAt);
    }

    function execute(uint256 id) external {
        Proposal storage p = proposals[id];
        if (p.readyAt == 0 || p.executed || p.canceled) revert BadProposal();
        if (block.timestamp < p.readyAt) revert Timelock();
        p.executed = true;
        _apply(p.target, p.isRouter, p.allowed);
        emit Executed(id, p.target, p.isRouter, p.allowed);
    }

    function cancel(uint256 id) external onlyOwner {
        Proposal storage p = proposals[id];
        if (p.readyAt == 0 || p.executed || p.canceled) revert BadProposal();
        p.canceled = true;
        emit Canceled(id);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    function setDelay(uint256 next) external onlyOwner {
        if (next <= delay || next > MAX_DELAY) revert BadDelay();
        delay = next;
        emit DelaySet(next);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function _seed(address[] memory list, bool isRouter) internal {
        if (list.length > MAX_LIST) revert TooMany();
        for (uint256 i; i < list.length; ++i) {
            if (isRouter) {
                if (_routerSeen[list[i]]) revert Duplicate();
            } else if (_assetSeen[list[i]]) {
                revert Duplicate();
            }
            _apply(list[i], isRouter, true);
        }
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
        } else {
            if (assetAllowed[target] == allowed) return;
            assetAllowed[target] = allowed;
            if (allowed && !_assetSeen[target]) {
                if (_assets.length == MAX_LIST) revert TooMany();
                _assetSeen[target] = true;
                _assets.push(target);
            }
        }
    }
}
