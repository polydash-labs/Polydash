// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title StrategyTemplate
/// @notice A published template cannot be edited. A Phase 3 fund copies it at creation and does not
///         take a looser cap, fee, lock, or asset list from the manager.
///         This contract is not deployed. Not a review. Not financial advice.
contract StrategyTemplate {
    uint256 public constant BPS = 10_000;

    struct Template {
        bytes32 mandateHash;
        string mandateUri;
        uint256 maxPositionBps;
        uint256 maxTradeBps;
        uint256 maxDeviationBps;
        uint256 hwmFeeBps;
        uint256 maxDrawdownBps;
        uint64 skinLock;
        bool exists;
    }

    address public owner;
    address public pendingOwner;
    uint256 public templateCount;
    mapping(uint256 => Template) internal _templates;
    mapping(uint256 => address[]) internal _assets;

    event Published(uint256 indexed id, bytes32 indexed mandateHash, uint64 skinLock);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error BadTemplate();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        if (_owner == address(0)) revert BadTemplate();
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

        /// @notice Publish one template. There is no edit function. `assets` is the only universe a fund
        ///         from this template can hold. An empty list is a quote-only mandate. `skinLock` is the
        ///         number of seconds the manager's skin units cannot be transferred. `maxDrawdownBps` of 0
        ///         leaves the buy brake off.
    function publish(
        bytes32 mandateHash,
        string calldata mandateUri,
        address[] calldata assets,
        uint256 maxPositionBps,
        uint256 maxTradeBps,
        uint256 maxDeviationBps,
        uint256 hwmFeeBps,
        uint256 maxDrawdownBps,
        uint64 skinLock
    ) external onlyOwner returns (uint256 id) {
        if (mandateHash == bytes32(0) || bytes(mandateUri).length == 0 || bytes(mandateUri).length > 512) {
            revert BadTemplate();
        }
        if (assets.length > 16) revert BadTemplate();
        if (maxPositionBps == 0 || maxPositionBps > BPS || maxTradeBps == 0 || maxTradeBps > BPS) revert BadTemplate();
        if (maxDeviationBps > BPS || hwmFeeBps > BPS || maxDrawdownBps > BPS) revert BadTemplate();
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i] == address(0)) revert BadTemplate();
            for (uint256 j; j < i; ++j) {
                if (assets[j] == assets[i]) revert BadTemplate();
            }
        }
        id = ++templateCount;
        _templates[id] = Template({
            mandateHash: mandateHash,
            mandateUri: mandateUri,
            maxPositionBps: maxPositionBps,
            maxTradeBps: maxTradeBps,
            maxDeviationBps: maxDeviationBps,
            hwmFeeBps: hwmFeeBps,
            maxDrawdownBps: maxDrawdownBps,
            skinLock: skinLock,
            exists: true
        });
        for (uint256 i; i < assets.length; ++i) {
            _assets[id].push(assets[i]);
        }
        emit Published(id, mandateHash, skinLock);
    }

    function getTemplate(uint256 id)
        external
        view
        returns (
            bytes32 mandateHash,
            string memory mandateUri,
            uint256 maxPositionBps,
            uint256 maxTradeBps,
            uint256 maxDeviationBps,
            uint256 hwmFeeBps,
            uint256 maxDrawdownBps,
            uint64 skinLock
        )
    {
        Template storage t = _templates[id];
        if (!t.exists) revert BadTemplate();
        return (
            t.mandateHash,
            t.mandateUri,
            t.maxPositionBps,
            t.maxTradeBps,
            t.maxDeviationBps,
            t.hwmFeeBps,
            t.maxDrawdownBps,
            t.skinLock
        );
    }

    function assetsOf(uint256 id) external view returns (address[] memory) {
        if (!_templates[id].exists) revert BadTemplate();
        return _assets[id];
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert BadTemplate();
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
