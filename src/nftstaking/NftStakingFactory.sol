// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {NftStakingPool, BoostConfig} from "./NftStakingPool.sol";

interface IPolypadCollectionFactory {
    function isCollection(address c) external view returns (bool);
}

/// @title NftStakingFactory (DRAFT - not reviewed, not deployed)
/// @notice Permissionless, ownerless. If `restricted`, only collections registered in the Polypad
///         fixed-price or bonding-curve NFT factory (`isCollection`) can get pools.
contract NftStakingFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MIN_DURATION = 1 days;
    uint256 public constant MAX_DURATION = 3650 days;

    address public immutable fixedFactory;
    address public immutable curveFactory;
    bool public immutable restricted;

    address[] public allPools;
    mapping(address => bool) public isPool;
    mapping(address => address[]) internal _byCollection;
    mapping(address => address[]) internal _byCreator;
    mapping(address => address[]) internal _byRewardToken;

    event PoolCreated(
        address indexed pool,
        address indexed collection,
        address indexed rewardToken,
        address creator,
        uint256 initialRewards,
        uint256 startTime,
        uint256 endTime
    );

    error InvalidParams();
    error CollectionNotAllowed();

    constructor(address _fixedFactory, address _curveFactory, bool _restricted) {
        if (_restricted && _fixedFactory == address(0) && _curveFactory == address(0)) revert InvalidParams();
        fixedFactory = _fixedFactory;
        curveFactory = _curveFactory;
        restricted = _restricted;
    }

    function isAllowedCollection(address c) public view returns (bool) {
        if (!restricted) return _isErc721(c);
        if (fixedFactory != address(0) && IPolypadCollectionFactory(fixedFactory).isCollection(c)) return true;
        if (curveFactory != address(0) && IPolypadCollectionFactory(curveFactory).isCollection(c)) return true;
        return false;
    }

    /// @dev ERC165 check for ERC-721 (0x80ac58cd), gas-capped staticcall so a hostile contract
    ///      cannot grief the factory; must also not claim the invalid id 0xffffffff.
    function _isErc721(address c) internal view returns (bool) {
        if (c.code.length == 0) return false;
        return _supports(c, 0x80ac58cd) && !_supports(c, 0xffffffff);
    }

    function _supports(address c, bytes4 id) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            c.staticcall{gas: 30000}(abi.encodeWithSelector(0x01ffc9a7, id));
        return ok && ret.length >= 32 && abi.decode(ret, (bool));
    }

    /// @notice Pool without boosts (every NFT 1.0x, no set bonus).
    function createPool(
        address collection,
        address rewardToken,
        uint256 initialRewards,
        uint256 startTime,
        uint256 duration
    ) external nonReentrant returns (address pool) {
        uint32[] memory a = new uint32[](1);
        uint16[] memory b = new uint16[](1);
        b[0] = 10_000;
        pool = _create(collection, rewardToken, initialRewards, startTime, duration, BoostConfig(a, b, 0, 0));
    }

    /// @notice Pool with loyalty tiers and/or set bonus (see NftStakingPool.validateBoost).
    /// @param initialRewards may be 0 (anyone can fund later via pool.fund).
    function createBoostedPool(
        address collection,
        address rewardToken,
        uint256 initialRewards,
        uint256 startTime,
        uint256 duration,
        BoostConfig calldata boost
    ) external nonReentrant returns (address pool) {
        pool = _create(collection, rewardToken, initialRewards, startTime, duration, boost);
    }

    function _create(
        address collection,
        address rewardToken,
        uint256 initialRewards,
        uint256 startTime,
        uint256 duration,
        BoostConfig memory boost
    ) internal returns (address pool) {
        if (collection == address(0) || rewardToken == address(0)) revert InvalidParams();
        if (!isAllowedCollection(collection)) revert CollectionNotAllowed();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidParams();
        if (startTime < block.timestamp) startTime = block.timestamp;
        if (startTime > block.timestamp + 365 days) revert InvalidParams();
        uint256 endTime = startTime + duration;

        pool = address(new NftStakingPool(msg.sender, collection, rewardToken, startTime, endTime, boost));
        allPools.push(pool);
        isPool[pool] = true;
        _byCollection[collection].push(pool);
        _byCreator[msg.sender].push(pool);
        _byRewardToken[rewardToken].push(pool);

        uint256 received;
        if (initialRewards > 0) {
            IERC20(rewardToken).safeTransferFrom(msg.sender, pool, initialRewards);
            received = NftStakingPool(pool).initialFunding(msg.sender);
        }
        emit PoolCreated(pool, collection, rewardToken, msg.sender, received, startTime, endTime);
    }

    function poolsLength() external view returns (uint256) {
        return allPools.length;
    }

    function poolsByCollection(address c) external view returns (address[] memory) {
        return _byCollection[c];
    }

    function poolsByCreator(address c) external view returns (address[] memory) {
        return _byCreator[c];
    }

    /// @notice For the "Staking committed" flag: NFT pools paying a given token.
    function poolsByRewardToken(address t) external view returns (address[] memory) {
        return _byRewardToken[t];
    }
}
