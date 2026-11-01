// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Boost settings fixed at pool creation.
/// tierAfter[i]: seconds of continuous staking needed for tier i (tierAfter[0] must be 0).
/// tierBps[i]:   weight of one NFT in tier i, in bps (10000 = 1.0x). tierBps[0] must be 10000.
/// setMin:       NFTs a user must have staked for the set bonus (0 = set bonus off).
/// setBonusBps:  extra weight on the user's whole stake when setMin is reached (1000 = +10%).
struct BoostConfig {
    uint32[] tierAfter;
    uint16[] tierBps;
    uint16 setMin;
    uint16 setBonusBps;
}

/// @title NftStakingPool (DRAFT - not reviewed, not deployed)
/// @notice Stake NFTs of one ERC-721 collection, earn one ERC-20 reward token, pro rata by weight.
///         - Fixed reward window [startTime, endTime) set at creation; funding streams over the time left.
///         - Weighted MasterChef accumulator (1e36 precision, carried division remainder).
///         - Loyalty boost: each NFT's weight steps up through fixed tiers by how long it has been
///           continuously staked. A tier upgrade takes effect from the moment it is CHECKPOINTED via
///           `poke(ids)` / `pokeAndClaim(ids)` (anyone may poke any staked ids), never retroactively.
///           Withdrawing resets the NFT's timer; re-staking starts at tier 0.
///         - Set bonus: if a user has >= setMin NFTs staked, their total weight gets +setBonusBps,
///           recalculated on every stake / withdraw / poke.
///         - Rewards accrued while nobody is staked, forfeited by emergency withdrawals, and rate dust
///           are "unallocated" and go to the pool creator after endTime.
///         - Staked NFTs are held by this contract (cannot be burned / sold / listed until withdrawn).
contract NftStakingPool is ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    uint256 private constant ACC = 1e36;
    uint256 private constant BPS = 10_000;
    uint256 public constant MAX_BATCH = 100;
    uint256 public constant MAX_TIERS = 4;
    uint256 public constant MAX_TIER_BPS = 30_000; // 3.0x cap
    uint256 public constant MAX_SET_BONUS_BPS = 5_000; // +50% cap

    address public immutable factory;
    address public immutable creator;
    IERC721 public immutable collection;
    IERC20 public immutable rewardToken;
    uint256 public immutable startTime;
    uint256 public immutable endTime;
    uint256 public immutable setMin;
    uint256 public immutable setBonusBps;

    uint32[] internal _tierAfter;
    uint16[] internal _tierBps;

    struct TokenInfo {
        address staker;
        uint64 since; // continuous-stake start
        uint8 tier; // checkpointed tier
    }

    struct UserInfo {
        uint128 count; // NFTs staked
        uint128 baseWeight; // sum of checkpointed tier bps
        uint256 weight; // effective weight incl. set bonus
    }

    uint256 public totalStaked; // NFTs
    uint256 public totalWeight;
    uint256 public totalFunded;
    uint256 public rewardRateScaled; // reward * ACC per second
    uint256 public lastUpdateTime;
    uint256 public accPerWeight; // reward * ACC per weight unit
    uint256 public accRemainder;
    uint256 public unallocatedScaled;
    uint256 public owedScaledTotal;
    uint256 public sumWPaid; // sum(weight[u] * userAccPaid[u])

    mapping(uint256 => TokenInfo) internal _tok;
    mapping(address => UserInfo) internal _usr;
    mapping(address => uint256) public userAccPaid;
    mapping(address => uint256) public rewardsScaled;

    bool private _pulling;
    bool private _initFunded;

    event Funded(address indexed funder, uint256 received, uint256 newRateScaled);
    event Staked(address indexed user, uint256[] tokenIds);
    event Withdrawn(address indexed user, uint256[] tokenIds);
    event EmergencyWithdrawn(address indexed user, uint256[] tokenIds);
    event RewardPaid(address indexed user, uint256 amount);
    event UnallocatedRecovered(address indexed creator, uint256 amount);
    event TierUpgraded(address indexed user, uint256 indexed tokenId, uint256 tier);
    event WeightChanged(address indexed user, uint256 count, uint256 weight);

    error ZeroAmount();
    error PoolEnded();
    error PoolNotEnded();
    error NotStaker();
    error NotCreator();
    error WrongCollection();
    error BatchTooLarge();
    error AmountTooLarge();
    error ZeroAddress();
    error AlreadyStaked();
    error TransferNotReceived();
    error InvalidBoost();

    constructor(
        address _creator,
        address _collection,
        address _rewardToken,
        uint256 _startTime,
        uint256 _endTime,
        BoostConfig memory b
    ) {
        if (_creator == address(0) || _collection == address(0) || _rewardToken == address(0)) revert ZeroAddress();
        validateBoost(b);
        factory = msg.sender;
        creator = _creator;
        collection = IERC721(_collection);
        rewardToken = IERC20(_rewardToken);
        startTime = _startTime;
        endTime = _endTime;
        lastUpdateTime = _startTime;
        setMin = b.setMin;
        setBonusBps = b.setMin == 0 ? 0 : b.setBonusBps;
        _tierAfter = b.tierAfter;
        _tierBps = b.tierBps;
    }

    /// @notice Reverts unless: 1-4 tiers, tierAfter[0]==0 and strictly increasing, tierBps[0]==10000,
    ///         non-decreasing, each <= 3x; setBonusBps <= +50% (setMin 0 = off; setMin 1 allowed).
    function validateBoost(BoostConfig memory b) public pure {
        uint256 n = b.tierAfter.length;
        if (n == 0 || n > MAX_TIERS || b.tierBps.length != n) revert InvalidBoost();
        if (b.tierAfter[0] != 0 || b.tierBps[0] != BPS) revert InvalidBoost();
        for (uint256 i = 1; i < n; ++i) {
            if (b.tierAfter[i] <= b.tierAfter[i - 1]) revert InvalidBoost();
            if (b.tierBps[i] < b.tierBps[i - 1] || b.tierBps[i] > MAX_TIER_BPS) revert InvalidBoost();
        }
        if (b.setBonusBps > MAX_SET_BONUS_BPS) revert InvalidBoost();
        if (b.setMin > MAX_BATCH) revert InvalidBoost();
    }

    // ---------------- views ----------------

    function tiers() external view returns (uint32[] memory tierAfter, uint16[] memory tierBps) {
        return (_tierAfter, _tierBps);
    }

    function stakerOf(uint256 id) external view returns (address) {
        return _tok[id].staker;
    }

    function stakedSince(uint256 id) external view returns (uint256) {
        return _tok[id].since;
    }

    /// @notice NFTs staked by a user.
    function balanceOf(address u) external view returns (uint256) {
        return _usr[u].count;
    }

    function userWeight(address u) external view returns (uint256) {
        return _usr[u].weight;
    }

    function userBaseWeight(address u) external view returns (uint256) {
        return _usr[u].baseWeight;
    }

    function hasSetBonus(address u) public view returns (bool) {
        return setMin != 0 && _usr[u].count >= setMin;
    }

    /// @notice Tier currently counted for rewards (last checkpoint).
    function tierOf(uint256 id) external view returns (uint256) {
        return _tok[id].tier;
    }

    /// @notice Tier the NFT qualifies for now (poke to make it count).
    function eligibleTierOf(uint256 id) public view returns (uint256) {
        TokenInfo memory t = _tok[id];
        if (t.staker == address(0)) return 0;
        return block.timestamp > t.since ? _tierFor(block.timestamp - t.since) : 0;
    }

    /// @notice Seconds until the next tier is reached (0 if at max tier or not staked).
    function timeToNextTier(uint256 id) external view returns (uint256) {
        TokenInfo memory t = _tok[id];
        if (t.staker == address(0) || _tierAfter.length < 2) return 0;
        uint256 el = block.timestamp > t.since ? block.timestamp - t.since : 0;
        if (block.timestamp < t.since) return t.since - block.timestamp + _tierAfter[1];
        uint256 i = _tierFor(el);
        if (i + 1 >= _tierAfter.length) return 0;
        return _tierAfter[i + 1] - el;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        if (block.timestamp < startTime) return startTime;
        return block.timestamp < endTime ? block.timestamp : endTime;
    }

    function _pending() internal view returns (uint256 acc, uint256 rem, uint256 unalloc) {
        acc = accPerWeight;
        rem = accRemainder;
        unalloc = unallocatedScaled;
        uint256 t = lastTimeRewardApplicable();
        if (t <= lastUpdateTime) return (acc, rem, unalloc);
        uint256 accrued = (t - lastUpdateTime) * rewardRateScaled;
        if (totalWeight == 0) {
            unalloc += accrued;
        } else {
            uint256 num = accrued + rem;
            acc += num / totalWeight;
            rem = num % totalWeight;
        }
    }

    /// @notice Pending rewards at the user's current (checkpointed) weight.
    function earned(address user) public view returns (uint256) {
        (uint256 acc,,) = _pending();
        return (_usr[user].weight * (acc - userAccPaid[user]) + rewardsScaled[user]) / ACC;
    }

    /// @notice Reward tokens per day the user earns at current weights and rate (0 outside the window).
    function rewardsPerDay(address user) external view returns (uint256) {
        if (totalWeight == 0 || block.timestamp >= endTime) return 0;
        return rewardRateScaled * 1 days * _usr[user].weight / totalWeight / ACC;
    }

    function isActive() external view returns (bool) {
        return block.timestamp < endTime && rewardRateScaled > 0;
    }

    function pendingUnallocated() external view returns (uint256) {
        (,, uint256 u) = _pending();
        return u / ACC;
    }

    function rewardRate() external view returns (uint256) {
        return rewardRateScaled / ACC;
    }

    // ---------------- funding ----------------

    function fund(uint256 amount) external nonReentrant returns (uint256 received) {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= endTime) revert PoolEnded();
        uint256 before = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        received = rewardToken.balanceOf(address(this)) - before;
        _credit(msg.sender, received);
    }

    function initialFunding(address funder) external nonReentrant returns (uint256 received) {
        if (msg.sender != factory || _initFunded) revert NotCreator();
        _initFunded = true;
        received = rewardToken.balanceOf(address(this));
        _credit(funder, received);
    }

    function _credit(address funder, uint256 received) internal {
        if (received == 0) revert ZeroAmount();
        if (block.timestamp >= endTime) revert PoolEnded();
        _update(address(0));
        if (totalFunded + received > type(uint96).max) revert AmountTooLarge();
        totalFunded += received;
        uint256 from = block.timestamp > startTime ? block.timestamp : startTime;
        uint256 remaining = endTime - from;
        uint256 scaled = received * ACC;
        rewardRateScaled += scaled / remaining;
        unallocatedScaled += scaled % remaining;
        emit Funded(funder, received, rewardRateScaled);
    }

    // ---------------- staking ----------------

    function stake(uint256[] calldata tokenIds) external nonReentrant {
        uint256 n = tokenIds.length;
        if (n == 0) revert ZeroAmount();
        if (n > MAX_BATCH) revert BatchTooLarge();
        if (block.timestamp >= endTime) revert PoolEnded();
        _update(msg.sender);
        _pulling = true;
        for (uint256 i; i < n; ++i) {
            uint256 id = tokenIds[i];
            if (_tok[id].staker != address(0)) revert AlreadyStaked();
            collection.transferFrom(msg.sender, address(this), id);
            if (collection.ownerOf(id) != address(this)) revert TransferNotReceived();
            _tok[id] = TokenInfo(msg.sender, uint64(_now()), 0);
        }
        _pulling = false;
        UserInfo storage u = _usr[msg.sender];
        _setWeight(msg.sender, u.count + n, u.baseWeight + n * BPS);
        totalStaked += n;
        emit Staked(msg.sender, tokenIds);
    }

    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external
        override
        returns (bytes4)
    {
        if (msg.sender != address(collection)) revert WrongCollection();
        if (!_pulling) {
            if (_reentrancyGuardEntered()) revert ReentrancyGuardReentrantCall();
            if (block.timestamp >= endTime) revert PoolEnded();
            if (from == address(0)) revert ZeroAddress();
            if (_tok[tokenId].staker != address(0)) revert AlreadyStaked();
            if (collection.ownerOf(tokenId) != address(this)) revert TransferNotReceived();
            _update(from);
            _tok[tokenId] = TokenInfo(from, uint64(_now()), 0);
            UserInfo storage u = _usr[from];
            _setWeight(from, u.count + 1, u.baseWeight + BPS);
            totalStaked += 1;
            uint256[] memory ids = new uint256[](1);
            ids[0] = tokenId;
            emit Staked(from, ids);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Checkpoint loyalty tiers for any staked ids (anyone can call, for any staker).
    ///         Upgrades count from this call onward. Rewards are settled first at the old weight.
    function poke(uint256[] calldata tokenIds) external nonReentrant {
        _poke(tokenIds);
    }

    /// @notice Checkpoint tiers for the given ids, then claim the caller's rewards.
    function pokeAndClaim(uint256[] calldata tokenIds) external nonReentrant {
        _poke(tokenIds);
        _update(msg.sender);
        _pay(msg.sender);
    }

    function withdraw(uint256[] calldata tokenIds) external nonReentrant {
        _update(msg.sender);
        _removeAndReturn(msg.sender, tokenIds);
        emit Withdrawn(msg.sender, tokenIds);
        _pay(msg.sender);
    }

    function claim() external nonReentrant {
        _update(msg.sender);
        _pay(msg.sender);
    }

    /// @notice Get NFTs back without touching rewards (forfeited). Makes no reward-token call.
    function emergencyWithdraw(uint256[] calldata tokenIds) external nonReentrant {
        address u = msg.sender;
        _update(u);
        uint256 forfeited = rewardsScaled[u];
        unallocatedScaled += forfeited;
        owedScaledTotal -= forfeited;
        rewardsScaled[u] = 0;
        _removeAndReturn(u, tokenIds);
        emit EmergencyWithdrawn(u, tokenIds);
    }

    function recoverUnallocated() external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (block.timestamp < endTime) revert PoolNotEnded();
        _update(address(0));
        uint256 amount = unallocatedScaled / ACC;
        uint256 bal = rewardToken.balanceOf(address(this));
        uint256 owedAll = owedScaledTotal + _unsettledScaled();
        uint256 reserved = (owedAll + ACC - 1) / ACC;
        uint256 free = bal > reserved ? bal - reserved : 0;
        if (amount > free) amount = free;
        if (amount == 0) revert ZeroAmount();
        unallocatedScaled -= amount * ACC;
        emit UnallocatedRecovered(creator, amount);
        rewardToken.safeTransfer(creator, amount);
    }

    // ---------------- internal ----------------

    /// @dev Loyalty timers start no earlier than the reward window.
    function _now() internal view returns (uint256) {
        return block.timestamp > startTime ? block.timestamp : startTime;
    }

    function _tierFor(uint256 elapsed) internal view returns (uint256 i) {
        uint256 n = _tierAfter.length;
        while (i + 1 < n && elapsed >= _tierAfter[i + 1]) ++i;
    }

    function _unsettledScaled() internal view returns (uint256) {
        return accPerWeight * totalWeight - sumWPaid + accRemainder;
    }

    function _effective(uint256 count, uint256 base) internal view returns (uint256) {
        if (setMin != 0 && count >= setMin) return base * (BPS + setBonusBps) / BPS;
        return base;
    }

    /// @dev Caller must have run _update(user) so userAccPaid[user] == accPerWeight.
    function _setWeight(address user, uint256 count, uint256 base) internal {
        UserInfo storage u = _usr[user];
        uint256 oldW = u.weight;
        uint256 newW = _effective(count, base);
        u.count = uint128(count);
        u.baseWeight = uint128(base);
        u.weight = newW;
        totalWeight = totalWeight - oldW + newW;
        sumWPaid = sumWPaid - oldW * accPerWeight + newW * accPerWeight;
        emit WeightChanged(user, count, newW);
    }

    function _poke(uint256[] calldata tokenIds) internal {
        uint256 n = tokenIds.length;
        if (n == 0) revert ZeroAmount();
        if (n > MAX_BATCH) revert BatchTooLarge();
        if (block.timestamp >= endTime) return; // no rewards left to boost
        for (uint256 i; i < n; ++i) {
            uint256 id = tokenIds[i];
            TokenInfo storage t = _tok[id];
            address s = t.staker;
            if (s == address(0)) continue;
            if (block.timestamp <= t.since) continue;
            uint256 nt = _tierFor(block.timestamp - t.since);
            if (nt <= t.tier) continue;
            _update(s);
            UserInfo storage u = _usr[s];
            uint256 base = u.baseWeight + _tierBps[nt] - _tierBps[t.tier];
            t.tier = uint8(nt);
            _setWeight(s, u.count, base);
            emit TierUpgraded(s, id, nt);
        }
    }

    function _update(address user) internal {
        (uint256 acc, uint256 rem, uint256 unalloc) = _pending();
        accPerWeight = acc;
        accRemainder = rem;
        unallocatedScaled = unalloc;
        uint256 t = lastTimeRewardApplicable();
        if (t > lastUpdateTime) lastUpdateTime = t;
        if (user != address(0)) {
            uint256 w = _usr[user].weight;
            uint256 add = w * (acc - userAccPaid[user]);
            rewardsScaled[user] += add;
            owedScaledTotal += add;
            sumWPaid += add;
            userAccPaid[user] = acc;
        }
    }

    function _removeAndReturn(address u, uint256[] calldata tokenIds) internal {
        uint256 n = tokenIds.length;
        if (n == 0) revert ZeroAmount();
        if (n > MAX_BATCH) revert BatchTooLarge();
        uint256 removedBase;
        for (uint256 i; i < n; ++i) {
            TokenInfo memory t = _tok[tokenIds[i]];
            if (t.staker != u) revert NotStaker();
            removedBase += _tierBps[t.tier];
            delete _tok[tokenIds[i]]; // timer and tier reset
        }
        UserInfo storage info = _usr[u];
        _setWeight(u, info.count - n, info.baseWeight - removedBase);
        totalStaked -= n;
        for (uint256 i; i < n; ++i) {
            collection.transferFrom(address(this), u, tokenIds[i]);
        }
    }

    function _pay(address u) internal {
        uint256 owed = rewardsScaled[u] / ACC;
        uint256 bal = rewardToken.balanceOf(address(this));
        if (owed > bal) owed = bal;
        if (owed == 0) return;
        rewardsScaled[u] -= owed * ACC;
        owedScaledTotal -= owed * ACC;
        emit RewardPaid(u, owed);
        rewardToken.safeTransfer(u, owed);
    }
}
