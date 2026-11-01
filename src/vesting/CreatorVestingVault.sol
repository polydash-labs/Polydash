// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPolydashStakingPoolV2, IPolydashStakingFactoryV2View} from "./IPolydashStakingV2.sol";

interface ICreatorVestingFactoryIndex {
    function onBeneficiaryChanged(address prev, address next) external;
}

/// @title CreatorVestingVault (DRAFT - not reviewed, not deployed)
/// @notice Holds one creator allocation of one token on a cliff + linear schedule. While locked,
///         the principal is staked in a PolydashStakingPoolV2 pool for the same token, with the
///         vault itself as the staker (pool.stake credits msg.sender).
///         - Principal vests: nothing before the cliff, then linear from `start` to `start + duration`.
///         - Pool rewards are NOT vested: anyone may call `claimRewards()` and they go straight to
///           the beneficiary (minus the pool's own 1-5% claim fee).
///         - No owner, no admin withdraw, no way to shorten the schedule. The beneficiary may only
///           extend the cliff/duration.
///         - V2 pools have no lock tiers or early-unstake penalty, so the vault can withdraw at any
///           time; it only withdraws what `release()` needs, or everything when the pool ended.
contract CreatorVestingVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable factory;
    IPolydashStakingFactoryV2View public immutable stakingFactory;
    IERC20 public immutable token;
    address public beneficiary; // transferable by the current beneficiary (two-step)
    address public pendingBeneficiary;
    uint64 public immutable start;

    uint256 public totalAllocation; // tokens actually received at creation (set once)
    uint64 public cliffDuration; // seconds after start; may only grow
    uint64 public duration; // seconds after start; may only grow; >= cliffDuration
    uint256 public released;
    uint256 public totalRewardsForwarded;
    IPolydashStakingPoolV2 public pool; // address(0) = unstaked lock
    bool private _initialized;

    event Initialized(uint256 allocation, address indexed pool);
    event Staked(address indexed pool, uint256 amount);
    event StakeSkipped(address indexed pool, uint256 amount);
    event Unstaked(address indexed pool, uint256 shares, uint256 received);
    event Released(address indexed beneficiary, uint256 amount);
    event RewardsForwarded(address indexed beneficiary, uint256 amount);
    event PoolMigrated(address indexed oldPool, address indexed newPool);
    event ScheduleExtended(uint64 cliffDuration, uint64 duration);
    event PoolEmergencyExited(address indexed pool, uint256 received);
    event BeneficiaryTransferProposed(address indexed current, address indexed pending);
    event BeneficiaryTransferred(address indexed previous, address indexed next);

    error NotBeneficiary();
    error NotFactory();
    error InvalidPool();
    error InvalidSchedule();
    error NothingToRelease();
    error PoolStillActive();
    error AlreadyInitialized();
    error NotPendingBeneficiary();
    error InvalidBeneficiary();

    uint64 public constant BADGE_MIN_CLIFF = 30 days;
    uint64 public constant BADGE_MIN_DURATION = 180 days;

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        _;
    }

    constructor(
        address _stakingFactory,
        address _token,
        address _beneficiary,
        uint64 _start,
        uint64 _cliffDuration,
        uint64 _duration
    ) {
        if (_token == address(0) || _beneficiary == address(0)) revert InvalidSchedule();
        if (_duration == 0 || _cliffDuration > _duration) revert InvalidSchedule();
        factory = msg.sender;
        stakingFactory = IPolydashStakingFactoryV2View(_stakingFactory);
        token = IERC20(_token);
        beneficiary = _beneficiary;
        start = _start;
        cliffDuration = _cliffDuration;
        duration = _duration;
    }

    /// @dev Called once by the factory after the allocation was transferred in.
    function initialize(address _pool) external nonReentrant {
        if (msg.sender != factory) revert NotFactory();
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) revert InvalidSchedule();
        totalAllocation = bal; // fee-on-transfer safe: what actually arrived
        if (_pool != address(0)) {
            _checkPool(_pool);
            pool = IPolydashStakingPoolV2(_pool);
            _stakeIdle();
        }
        emit Initialized(totalAllocation, _pool);
    }

    // ---------------- views (PolyCTO / Holder Protections badge) ----------------

    /// @notice True if the schedule meets the Holder Protections badge minimum
    ///         (cliff >= 30 days and duration >= 180 days). Contract floors are lower; this is a label only.
    function meetsBadgeMinimum() external view returns (bool) {
        return cliffDuration >= BADGE_MIN_CLIFF && duration >= BADGE_MIN_DURATION;
    }

    function cliffEnd() public view returns (uint256) {
        return uint256(start) + cliffDuration;
    }

    function endTime() public view returns (uint256) {
        return uint256(start) + duration;
    }

    /// @notice Schedule-vested amount at `t` (ignores pool losses).
    function vestedAmountAt(uint256 t) public view returns (uint256) {
        if (t < cliffEnd()) return 0;
        if (t >= endTime()) return totalAllocation;
        return Math.mulDiv(totalAllocation, t - start, duration);
    }

    function vestedAmount() external view returns (uint256) {
        return vestedAmountAt(block.timestamp);
    }

    /// @notice Schedule amount still locked (not yet vested).
    function lockedAmount() external view returns (uint256) {
        return totalAllocation - vestedAmountAt(block.timestamp);
    }

    function stakedShares() public view returns (uint256) {
        return address(pool) == address(0) ? 0 : pool.balanceOf(address(this));
    }

    /// @notice Principal currently in the pool, valued at the pool's share price.
    function stakedAmount() public view returns (uint256) {
        uint256 s = stakedShares();
        return s == 0 ? 0 : pool.sharesToAmount(s);
    }

    function idleAmount() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice All principal the vault controls (idle + staked).
    function holdings() public view returns (uint256) {
        return idleAmount() + stakedAmount();
    }

    function releasable() public view returns (uint256) {
        uint256 v = vestedAmountAt(block.timestamp);
        uint256 owed = v > released ? v - released : 0;
        uint256 h = holdings();
        if (block.timestamp >= endTime()) return h; // fully vested: everything left
        return owed < h ? owed : h;
    }

    function pendingRewards() external view returns (uint256) {
        return address(pool) == address(0) ? 0 : pool.claimable(address(this));
    }

    function isStaked() external view returns (bool) {
        return stakedShares() > 0;
    }

    // ---------------- actions ----------------

    /// @notice Sends all currently releasable principal to the beneficiary. Anyone may call.
    function release() external nonReentrant returns (uint256 amount) {
        amount = releasable();
        if (amount == 0) revert NothingToRelease();
        uint256 idle = idleAmount();
        if (idle < amount) {
            _withdrawFor(amount - idle);
            idle = idleAmount();
            if (idle < amount) amount = idle; // pool rounding / transfer fee shortfall
        }
        if (amount == 0) revert NothingToRelease();
        released += amount;
        emit Released(beneficiary, amount);
        token.safeTransfer(beneficiary, amount);
    }

    /// @notice Claims pool rewards and forwards them to the beneficiary. Anyone may call.
    function claimRewards() external nonReentrant returns (uint256) {
        return _claimAndForward();
    }

    /// @notice Stakes any idle locked principal (e.g. after pool cap freed up). Anyone may call.
    function stakeIdle() external nonReentrant {
        _stakeIdle();
    }

    /// @notice After the current pool ended, pulls principal back into the vault (still locked)
    ///         and forwards final rewards. Anyone may call.
    function exitEndedPool() external nonReentrant {
        if (address(pool) == address(0) || block.timestamp < pool.endTime()) revert PoolStillActive();
        _exitPool();
        pool = IPolydashStakingPoolV2(address(0));
        emit PoolMigrated(address(0), address(0));
    }

    /// @notice Moves locked principal to a new active V2 pool for the same token. Only allowed when
    ///         there is no pool or the current pool has ended. Never releases anything.
    function migrate(address newPool) external nonReentrant onlyBeneficiary {
        address old = address(pool);
        if (old != address(0)) {
            if (block.timestamp < pool.endTime()) revert PoolStillActive();
            _exitPool();
        }
        _checkPool(newPool);
        pool = IPolydashStakingPoolV2(newPool);
        emit PoolMigrated(old, newPool);
        _stakeIdle();
    }

    /// @notice Break-glass: if the pool's normal withdraw/claim is broken, pull principal via the
    ///         pool's emergencyWithdraw (rewards forfeited). Principal stays locked in the vault.
    function emergencyExitPool() external nonReentrant onlyBeneficiary {
        if (address(pool) == address(0)) revert InvalidPool();
        address p = address(pool);
        uint256 before = idleAmount();
        if (stakedShares() > 0) pool.emergencyWithdraw();
        pool = IPolydashStakingPoolV2(address(0));
        emit PoolEmergencyExited(p, idleAmount() - before);
    }

    /// @notice Beneficiary may lengthen (never shorten) the cliff and/or duration.
    function extendSchedule(uint64 newCliffDuration, uint64 newDuration) external onlyBeneficiary {
        if (newCliffDuration < cliffDuration || newDuration < duration || newCliffDuration > newDuration) {
            revert InvalidSchedule();
        }
        cliffDuration = newCliffDuration;
        duration = newDuration;
        emit ScheduleExtended(newCliffDuration, newDuration);
    }

    /// @notice Step 1: current beneficiary proposes a new one. address(0) cancels; a new call overwrites.
    function proposeBeneficiary(address next) external onlyBeneficiary {
        if (next == beneficiary) revert InvalidBeneficiary();
        pendingBeneficiary = next;
        emit BeneficiaryTransferProposed(msg.sender, next);
    }

    /// @notice Step 2: the proposed address accepts. Updates the factory's beneficiary index.
    function acceptBeneficiary() external nonReentrant {
        address next = pendingBeneficiary;
        if (next == address(0) || msg.sender != next) revert NotPendingBeneficiary();
        address prev = beneficiary;
        beneficiary = next;
        pendingBeneficiary = address(0);
        ICreatorVestingFactoryIndex(factory).onBeneficiaryChanged(prev, next);
        emit BeneficiaryTransferred(prev, next);
    }

    // ---------------- internal ----------------

    function _checkPool(address p) internal view {
        if (!stakingFactory.isPool(p)) revert InvalidPool();
        IPolydashStakingPoolV2 ip = IPolydashStakingPoolV2(p);
        if (ip.stakeToken() != address(token) || !ip.funded() || block.timestamp >= ip.endTime()) {
            revert InvalidPool();
        }
    }

    /// @dev Stakes idle principal that is not yet releasable. Stake failures (cap reached, etc.)
    ///      leave tokens as an unstaked lock instead of reverting.
    function _stakeIdle() internal {
        if (address(pool) == address(0) || block.timestamp >= pool.endTime()) return;
        uint256 idle = idleAmount();
        uint256 rel = releasable();
        uint256 amt = idle > rel ? idle - rel : 0;
        if (amt == 0) return;
        token.forceApprove(address(pool), amt);
        try pool.stake(amt) {
            emit Staked(address(pool), amt);
        } catch {
            emit StakeSkipped(address(pool), amt);
        }
        token.forceApprove(address(pool), 0);
    }

    /// @dev Withdraws enough shares to cover `needed` tokens (rounded up, capped at all shares).
    function _withdrawFor(uint256 needed) internal {
        uint256 s = stakedShares();
        if (s == 0) return;
        uint256 value = pool.sharesToAmount(s);
        uint256 shares = value == 0 ? s : Math.mulDiv(needed, s, value, Math.Rounding.Ceil);
        if (shares > s) shares = s;
        _withdrawShares(shares);
    }

    function _withdrawShares(uint256 shares) internal {
        if (shares == 0) return;
        bool same = pool.rewardToken() == address(token);
        if (same) _claimAndForward(); // keep reward and principal flows separate for same-token pools
        uint256 before = idleAmount();
        pool.withdraw(shares);
        emit Unstaked(address(pool), shares, idleAmount() - before);
    }

    function _exitPool() internal {
        _claimAndForward();
        uint256 s = stakedShares();
        if (s > 0) _withdrawShares(s);
    }

    /// @dev Measures the actual reward received (works for same-token pools too) and forwards it.
    function _claimAndForward() internal returns (uint256 got) {
        if (address(pool) == address(0)) return 0;
        IERC20 rt = IERC20(pool.rewardToken());
        uint256 before = rt.balanceOf(address(this));
        pool.claim();
        got = rt.balanceOf(address(this)) - before;
        if (got == 0) return 0;
        totalRewardsForwarded += got;
        emit RewardsForwarded(beneficiary, got);
        rt.safeTransfer(beneficiary, got);
    }
}
