// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundAllowlist} from "../phase2/Interfaces.sol";
import {FundVaultStore} from "../phase2/FundVaultStore.sol";
import {FundPhase3Store} from "./FundPhase3Store.sol";
import {FundProposalStore} from "./FundProposalStore.sol";
import {FundLiquidityStore} from "./FundLiquidityStore.sol";

/// @notice Minimal surface of a `PolydashStakingPoolV2` the facet talks to. `claimAmount` only
///         exists on pools created by the current (FoT-fixed) factory; the facet probes for it
///         with try/catch and falls back to `claim()` on older pools (see `FundStakeFacetPhase3`
///         docs). Views are used for the outflow-aware claim sizing and for NAV.
interface IStakingPool {
    function stakeToken() external view returns (address);
    function rewardToken() external view returns (address);
    function stake(uint256 amount) external;
    function withdraw(uint256 shares) external;
    function claim() external;
    function claimAmount(uint256 grossAmount) external;
    function balanceOf(address account) external view returns (uint256);
    function earned(address account) external view returns (uint256);
    function sharesToAmount(uint256 shares) external view returns (uint256);
    function endTime() external view returns (uint256);
    function funded() external view returns (bool);
}

/// @notice Minimal surface of a `PolydashStakingFactoryV2`. `isPool` is the pool allowlist:
///         the factory deploys fixed pool bytecode, so a pool the factory created cannot steal
///         principal or run foreign code — provenance fully determines authenticity.
interface IStakingFactory {
    function isPool(address pool) external view returns (bool);
}

/// @title FundStakeStore (not reviewed, not deployed)
/// @notice Storage appended AFTER `FundLiquidityStore` for a Phase 3 V3 vault and its stake
///         facet. Both contracts inherit the stores in the same order — `FundVaultStore`, then
///         `FundPhase3Store`, then `FundProposalStore`, then `FundLiquidityStore`, then this
///         store — so a delegatecall sees one layout. The V3 vault MUST inherit this store in
///         that position (it does not yet — see the wiring spec in the build log; until it does,
///         this facet cannot plug into it, and `_requireLayout` will revert). New stake storage
///         goes at the end of this contract only, never in the middle, and never in the stores
///         above (they are shared with the V2 vault and the liquidity facet).
///         `stakeMagic` is the layout guard: the V3 vault constructor writes `STAKE_MAGIC` and
///         the facet reverts unless it reads it, so the facet can never run against a vault
///         whose slots after the liquidity store hold something else (today: the V3 vault's
///         `stakeFacet` address slot, which is NOT this store).
///         This contract is not deployed. Not a review. Not financial advice.
abstract contract FundStakeStore {
    /// @notice Written by the V3 vault constructor; the facet requires it before doing anything.
    bytes32 public constant STAKE_MAGIC = keccak256("FundStakeStore.v1");

    /// @notice Layout guard value, set by the V3 vault constructor. Must equal `STAKE_MAGIC`.
    bytes32 public stakeMagic;
    /// @notice Current staking factory (FoT-fixed pools). Set by the V3 vault constructor.
    address public stakingFactory;
    /// @notice Legacy staking factory (pre-fix pools). May be `address(0)` to disable legacy pools.
    address public legacyStakingFactory;
    /// @notice Token that is staked. POLYDASH on mainnet; set by the V3 vault constructor so
    ///         tests can point it at a mock.
    address public stakeToken;
    /// @notice Pool => staking shares the vault holds there (mirror of `pool.balanceOf(vault)`).
    mapping(address => uint256) public stakedShares;
    /// @notice Pools the vault has ever staked in and not yet fully exited, for NAV iteration.
    address[] internal _stakedPools;
    /// @dev Pool => already in `_stakedPools`.
    mapping(address => bool) internal _isStakedPool;

    event Staked(address indexed pool, uint256 amount, uint256 shares);
    event Unstaked(address indexed pool, uint256 shares, uint256 amount);
    event RewardsClaimed(address indexed pool, address indexed rewardToken, uint256 gross, uint256 received);

    error NotStakingPool();
    error UnsupportedReward();
    error StakeCap();
    error StakeLayout();
}

/// @title FundStakeFacetPhase3 (not reviewed, not deployed)
/// @notice Stake body for a Phase 3 V3 vault. A standalone facet the vault delegatecalls, mirroring
///         `FundSwapFacetPhase3V2`: same `self` direct-call guard, same auth (`manager` or executor),
///         same error style, same storage-prefix inheritance. It lets a fund vault stake its POLYDASH
///         in a Polypad staking pool and bring the rewards back into the vault.
///
///         Pool approval (decided, with reasoning): a pool is approved iff it was created by the
///         current staking factory OR the legacy staking factory (`isPool`). No separate allowlist
///         is needed or wanted: the factory is permissionless for pool CREATION, but every pool it
///         creates runs the same fixed, audited-by-reading pool bytecode — a pool cannot steal
///         principal, charge a principal fee, or run foreign code. What varies per pool is only
///         economics the manager chooses openly (reward size, duration, 1–5% claim fee), and the
///         facet additionally requires `stakeToken == POLYDASH` and `rewardToken` in
///         {POLYDASH, WETH}, so a pool paying out in a worthless or unvalued token can never be
///         staked in. The allowlist (`FundAllowlist`) governs tradeable assets and feeds, not pool
///         provenance; reusing it here would add an admin step without adding safety.
///
///         Mandate: staking is a per-fund-manager choice proposed like any other position through
///         the existing Option 3 proposal flow — the manager proposes POLYDASH (if it is not already
///         a strategy asset), waits `PROPOSAL_DELAY` in public, executes, and only then can stake.
///         No new proposal system is built. The facet enforces `inMandate[POLYDASH]` on every stake
///         and enforces the same effective position cap as a buy (min of the strategy cap and the
///         proposal cap) on the vault's total POLYDASH position (liquid + staked, valued at the feed).
///
///         Claims, outflow-aware (Nov 11 FoT fix): the LIVE current factory deploys the fixed pool
///         (commit 1373141), which sizes claims so the real outflow (net + any sender-side token fee)
///         fits the reward room and offers `claimAmount()` partial claims. The facet calls
///         `claimAmount(gross)` first; if the pool predates the fix and has no such selector, the
///         call reverts and the facet falls back to `claim()`. That fallback is safe for the only
///         reward tokens this facet accepts: POLYDASH is a plain ClankerToken ERC20 with no transfer
///         fee, and WETH likewise, so a naive full claim on a legacy pool cannot hit the FoT freeze
///         (the freeze needs a model-2 fee-on-transfer reward token). A FoT reward token can never
///         reach the fallback because the reward-token check rejects it at stake time.
///
///         Rewards and distribution: rewards land in the vault as tokens. The facet builds NO
///         distribution logic — the vault's existing `distribute()` distributes ETH only, so a
///         manager wanting an ETH dividend swaps the claimed rewards to ETH (swap facet) and then
///         calls `distribute()`; otherwise the rewards stay in the vault, count in NAV, and are paid
///         to holders in kind when they exit (`_settle` pays mandate assets pro rata).
///
///         Lockup / exits: `PolydashStakingPoolV2` imposes NO lockup or unbonding period —
///         `withdraw()` is immediate at any time, before or after `endTime` (only `stake()` stops
///         at `endTime`, and rewards stop accruing then). Unstaking and claiming are therefore
///         never blocked by the pool. The facet additionally never blocks them on pause or fund
///         status: `unstake`/`unstakeAll`/`claimRewards` run in any status, paused or not. The one
///         interaction holders must understand is the in-kind shortfall: `_settle()` pays exits
///         from vault balances only, and staked POLYDASH is NOT in the vault while staked. A holder
///         who exits while the fund is staked receives their share of the liquid balances only —
///         NOT their share of the staked position or its accrued rewards. The staked value stays in
///         the fund for the remaining holders and reaches them when the manager unstakes (or when
///         they exit after an unstake). The manager should unstake before a known exit wave if
///         holders are to be paid the staked value; nothing in the contracts forces that, and an
///         exit never reverts because of a stake. `emergencyWithdraw()` is deliberately NOT exposed:
///         it forfeits the vault's accrued rewards to the pool creator, which would give holders'
///         rewards away; `withdraw()` + `claimRewards()` always provide a working exit path.
///
///         This contract is not deployed. Not a review. Not financial advice.
contract FundStakeFacetPhase3 is
    ReentrancyGuard,
    FundVaultStore,
    FundPhase3Store,
    FundProposalStore,
    FundLiquidityStore,
    FundStakeStore
{
    using SafeERC20 for IERC20;

    address public immutable self;

    constructor() {
        self = address(this);
    }

    /// @notice Stake `amount` of the vault's POLYDASH into an approved pool. Manager or executor.
    ///         Requires `Investing` status and unpaused swaps (staking is an investment action, like
    ///         a buy). The pool must be factory-created, stake POLYDASH, and pay rewards in POLYDASH
    ///         or WETH. POLYDASH must be in the mandate, and the post-stake total POLYDASH position
    ///         (liquid + staked) must fit the effective position cap.
    function stake(address pool, uint256 amount) external {
        if (address(this) == self) revert DirectFacetCall();
        _requireLayout();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        if (status != Status.Investing) revert NotInvesting();
        if (swapsPaused) revert Paused();
        if (amount == 0) revert BadAmount();
        _requirePool(pool);
        if (!inMandate[stakeToken]) revert NotInMandate();
        if (IERC20(stakeToken).balanceOf(address(this)) < amount) revert BadAmount();

        uint256 sharesBefore = IStakingPool(pool).balanceOf(address(this));
        IERC20(stakeToken).safeIncreaseAllowance(pool, amount);
        IStakingPool(pool).stake(amount);
        uint256 sharesAfter = IStakingPool(pool).balanceOf(address(this));
        if (sharesAfter <= sharesBefore) revert BadAmount();
        uint256 shares = sharesAfter - sharesBefore;
        _trackStake(pool, shares);
        _checkStakeCap();
        emit Staked(pool, amount, shares);
    }

    /// @notice Withdraw `shares` of principal from a pool back into the vault. Manager or executor.
    ///         NEVER blocked by pause or fund status: unstaking must always be possible. Rewards are
    ///         NOT claimed here; call `claimRewards` (or `unstakeAll`) for those. Withdrawing leaves
    ///         accrued rewards claimable afterwards. Deliberately does NOT re-check factory
    ///         provenance: provenance was checked when the stake went in, and an exit must work even
    ///         if the factory addresses were later changed or disabled.
    function unstake(address pool, uint256 shares) external {
        if (address(this) == self) revert DirectFacetCall();
        _requireLayout();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        if (shares == 0 || shares > stakedShares[pool]) revert BadAmount();
        uint256 before = IERC20(stakeToken).balanceOf(address(this));
        IStakingPool(pool).withdraw(shares);
        uint256 received = IERC20(stakeToken).balanceOf(address(this)) - before;
        _untrackStake(pool, shares);
        emit Unstaked(pool, shares, received);
    }

    /// @notice Withdraw ALL principal from a pool and claim ALL earned rewards into the vault.
    ///         Manager or executor. Never blocked by pause or fund status. Implemented as
    ///         `withdraw(all)` + the outflow-aware `claimRewards` path, NOT `pool.exit()`, so a
    ///         claim problem can never trap the principal: the withdraw settles first.
    function unstakeAll(address pool) external {
        if (address(this) == self) revert DirectFacetCall();
        _requireLayout();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        uint256 shares = stakedShares[pool];
        if (shares == 0) revert BadAmount();
        uint256 before = IERC20(stakeToken).balanceOf(address(this));
        IStakingPool(pool).withdraw(shares);
        uint256 received = IERC20(stakeToken).balanceOf(address(this)) - before;
        _untrackStake(pool, shares);
        emit Unstaked(pool, shares, received);
        // No rewards may have accrued (e.g. immediate exit): claiming zero would revert,
        // and must never trap the principal that was just withdrawn.
        if (IStakingPool(pool).earned(address(this)) > 0) _claimRewards(pool, type(uint256).max);
    }

    /// @notice Claim up to `maxGross` (gross, before the pool's claim fee) of earned rewards into
    ///         the vault. `maxGross == 0` means "claim everything earned". Manager or executor.
    ///         Never blocked by pause or fund status. Outflow-aware: prefers the fixed pool's
    ///         `claimAmount()`; falls back to `claim()` on pre-fix pools (safe here because the
    ///         only accepted reward tokens, POLYDASH and WETH, are plain ERC20s with no transfer fee).
    ///         Does not re-check factory provenance (see `unstake`): a claim must work even if the
    ///         factory addresses were later changed. A pool the vault never staked in has zero
    ///         `earned`, so the call reverts `NothingToWithdraw` instead of moving anything.
    function claimRewards(address pool, uint256 maxGross) external {
        if (address(this) == self) revert DirectFacetCall();
        _requireLayout();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        _claimRewards(pool, maxGross);
    }

    // ---------- views the V3 vault needs for NAV ----------
    // NOTE (wiring): Solidity forbids `delegatecall` inside a `view` function, so the V3 vault's
    // `nav()` (a view) CANNOT call these through the facet — it must inline the same computation
    // (read `_stakedPools` / `stakedShares` from its own `FundStakeStore` storage, then
    // `pool.sharesToAmount(pool.balanceOf(vault))` and `allowlist.quote`). These facet views exist
    // for non-view callers and for tooling; the vault inlines them in `nav()`. See the build log.

    /// @notice Pools the vault currently has a stake in (or has rewards claimable from).
    function stakedPools() external view returns (address[] memory) {
        return _stakedPools;
    }

    /// @notice POLYDASH tokens `pool` currently redeems the vault's shares for.
    function stakedAmount(address pool) external view returns (uint256) {
        return IStakingPool(pool).sharesToAmount(IStakingPool(pool).balanceOf(address(this)));
    }

    /// @notice ETH value of the vault's stake in `pool` at the allowlist feed. Reverts fail-closed
    ///         when the feed cannot be used, same as `nav()`.
    function stakedValueEth(address pool) external view returns (uint256) {
        return allowlist.quote(stakeToken, IStakingPool(pool).sharesToAmount(IStakingPool(pool).balanceOf(address(this))));
    }

    /// @notice Gross rewards currently earned by the vault in `pool` (before the claim fee).
    function earnedRewards(address pool) external view returns (uint256) {
        return IStakingPool(pool).earned(address(this));
    }

    // ---------- internal ----------

    function _requireLayout() internal view {
        if (stakeMagic != STAKE_MAGIC) revert StakeLayout();
    }

    /// @notice Pool provenance + token checks. A pool the factory did not create is rejected even
    ///         if it implements the same interface — a lookalike pool could steal the stake.
    function _requirePool(address pool) internal view {
        if (pool == address(0) || pool.code.length == 0) revert NotStakingPool();
        bool fromCurrent = stakingFactory != address(0) && IStakingFactory(stakingFactory).isPool(pool);
        bool fromLegacy = legacyStakingFactory != address(0) && IStakingFactory(legacyStakingFactory).isPool(pool);
        if (!fromCurrent && !fromLegacy) revert NotStakingPool();
        if (IStakingPool(pool).stakeToken() != stakeToken) revert NotStakingPool();
        address reward = IStakingPool(pool).rewardToken();
        if (reward != stakeToken && reward != weth) revert UnsupportedReward();
    }

    /// @notice The vault's total POLYDASH position (liquid + staked across ALL pools) must fit the
    ///         effective cap — min(strategy `maxPositionBps`, proposal `assetCap` when nonzero) — of
    ///         NAV including LP principal and the staked value. Mirrors the swap facet's `_checkPositionCap`.
    function _checkStakeCap() internal view {
        uint256 cap = maxPositionBps;
        uint256 proposed = assetCap[stakeToken];
        if (proposed != 0 && proposed < cap) cap = proposed;
        uint256 liquid = IERC20(stakeToken).balanceOf(address(this));
        uint256 staked = 0;
        uint256 n = _stakedPools.length;
        for (uint256 i; i < n; ++i) {
            address p = _stakedPools[i];
            staked += IStakingPool(p).sharesToAmount(IStakingPool(p).balanceOf(address(this)));
        }
        // The pool just staked into is already in `_stakedPools` (tracked before this check).
        uint256 positionValue = allowlist.quote(stakeToken, liquid + staked);
        uint256 navAfter = _navTotalWithStaked();
        if (positionValue > (navAfter * cap) / BPS) revert PositionCap();
    }

    /// @notice Fee-excluded NAV total including LP principal (via `navTotalWithLp()`), PLUS the
    ///         value of every staked position (staked POLYDASH is not in the vault balance, so
    ///         `NAVReader` alone would undercount the fund while staked). The V3 vault's `nav()`
    ///         must use this same sum; see the wiring spec in the build log.
    function _navTotalWithStaked() internal view returns (uint256) {
        uint256 total = navTotalWithLp();
        uint256 n = _stakedPools.length;
        for (uint256 i; i < n; ++i) {
            address pool = _stakedPools[i];
            total += allowlist.quote(stakeToken, IStakingPool(pool).sharesToAmount(IStakingPool(pool).balanceOf(address(this))));
        }
        return total;
    }

    function _claimRewards(address pool, uint256 maxGross) internal {
        uint256 gross = IStakingPool(pool).earned(address(this));
        if (gross == 0) revert NothingToWithdraw();
        if (maxGross != 0 && maxGross < gross) gross = maxGross;
        address reward = IStakingPool(pool).rewardToken();
        uint256 before = IERC20(reward).balanceOf(address(this));
        // Fixed pools (current factory) size the payout outflow-aware and accept a partial
        // gross. Pre-fix pools (legacy factory) have no `claimAmount` selector: the call
        // reverts and we fall back to a full `claim()`, safe for POLYDASH/WETH rewards.
        try IStakingPool(pool).claimAmount(gross) {
            // claimed
        } catch {
            IStakingPool(pool).claim();
        }
        uint256 received = IERC20(reward).balanceOf(address(this)) - before;
        emit RewardsClaimed(pool, reward, gross, received);
    }

    function _trackStake(address pool, uint256 shares) internal {
        stakedShares[pool] += shares;
        if (!_isStakedPool[pool]) {
            _isStakedPool[pool] = true;
            _stakedPools.push(pool);
        }
    }

    function _untrackStake(address pool, uint256 shares) internal {
        uint256 held = stakedShares[pool];
        if (shares >= held) {
            stakedShares[pool] = 0;
            if (_isStakedPool[pool]) {
                _isStakedPool[pool] = false;
                uint256 n = _stakedPools.length;
                for (uint256 i; i < n; ++i) {
                    if (_stakedPools[i] == pool) {
                        _stakedPools[i] = _stakedPools[n - 1];
                        _stakedPools.pop();
                        break;
                    }
                }
            }
        } else {
            stakedShares[pool] = held - shares;
        }
    }
}
