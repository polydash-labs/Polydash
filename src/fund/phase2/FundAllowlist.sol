// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FundAllowlist (not reviewed, not deployed)
/// @notice Global allowlist of swap routers and assets for Phase 2 funds.
///         The constructor set is live immediately. Later additions and removals wait `delay`.
///         Pause takes effect immediately and blocks swaps. It does not move vault balances.
///         The universe is the addresses passed here: ETH is the native quote, WETH is allowlisted as the wrapped quote,
///         and any other asset is whatever the owner adds. There is no price feed.
contract FundAllowlist {
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

    /// @param initialRouters Routers that may be called immediately. Later routers go through `propose`.
    /// @param initialAssets Assets that may be held immediately, including WETH.
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

    /// @notice Queue an allow or a removal. `readyAt` is `block.timestamp + delay`.
    function propose(address target, bool isRouter, bool allowed) external onlyOwner returns (uint256 id) {
        if (target == address(0)) revert ZeroAddress();
        id = ++proposalCount;
        uint64 readyAt = uint64(block.timestamp + delay);
        proposals[id] = Proposal({
            target: target, isRouter: isRouter, allowed: allowed, readyAt: readyAt, executed: false, canceled: false
        });
        emit Proposed(id, target, isRouter, allowed, readyAt);
    }

    /// @notice Apply a proposal after `readyAt`. Anyone may call this.
    function execute(uint256 id) external {
        Proposal storage proposal = proposals[id];
        if (proposal.readyAt == 0 || proposal.executed || proposal.canceled) revert BadProposal();
        if (block.timestamp < proposal.readyAt) revert Timelock();
        proposal.executed = true;
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
