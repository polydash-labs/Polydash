// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFundUnit} from "../phase2/Interfaces.sol";
import {NAVReader} from "../phase2/NAVReader.sol";
import {FundVaultStore} from "../phase2/FundVaultStore.sol";
import {FundPhase3Store} from "./FundPhase3Store.sol";
import {FundProposalStore} from "./FundProposalStore.sol";
import {FundLiquidityStore} from "./FundLiquidityStore.sol";

/// @notice Minimal Uniswap V4 PoolManager surface the facet uses. Declared locally on
///         purpose: this file compiles under the `src/fund/phase3/**` paris restriction
///         and must not import v4-core. The ABI matches v4-core's `IPoolManager` for
///         these functions (`PoolKey` is ABI-identical to `LpPoolKey`).
interface IPoolManagerMinimal {
    function unlock(bytes calldata data) external returns (bytes memory);
    function modifyLiquidity(LpPoolKeyMinimal calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external
        returns (int256 callerDelta, int256 feesAccrued);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

/// @notice ABI-identical to v4-core's `PoolKey` (same field order and types).
struct LpPoolKeyMinimal {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// @notice ABI-identical to v4-core's `ModifyLiquidityParams`.
struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

/// @title FundLiquidityFacetPhase3 (not reviewed, not deployed)
/// @notice LP body for a Phase 3 V3 vault. Runs by delegatecall from the vault, so it
///         shares the vault's storage (same four stores, same order) and its balances.
///
///         Flow (Option 3, same as token buys): the manager proposes an LP position
///         (`proposeLiquidity`, thesis + up to 3 lines of reason), waits `PROPOSAL_DELAY`
///         (2 days, public), executes it (`executeLiquidity`), then adds liquidity.
///         The non-WETH token must already be in the mandate (for Template #6 that is
///         POLYDASH, a template asset, so no separate asset proposal is needed); the
///         allowlist side is checked at execution (both pool tokens allowlisted).
///
///         Checks on `addLiquidity`: manager/executor only, Investing only, buys not
///         paused (vault or allowlist), drawdown brake, pool approved with the approved
///         tick range, settled amounts within the manager's maxima, per-asset cap
///         (min of template `maxPositionBps` and the proposal `assetCap`, counting spot
///         holdings + LP principal) AND the LP cap (per-pool `lpCap`, at most 50% of
///         NAV, counting all LP principal). The trade cap does NOT apply to LP adds:
///         a 50%-of-NAV add would always breach Template #6's 10% trade cap, so LP
///         adds are sized by the LP cap and the per-asset cap instead.
///
///         `removeLiquidity` and `harvestFees` are NEVER blocked by a pause or the
///         drawdown brake: taking liquidity out of a pool (or collecting fees) must
///         always be possible, even when buys are paused. Harvests are weekly per
///         position (`HARVEST_INTERVAL`); a zero-fee harvest does not start the clock.
///
///         The pool interaction is real Uniswap V4: `unlock` -> `modifyLiquidity`
///         (add: positive `liquidityDelta`; remove: negative; harvest: zero, which
///         returns the accrued fees as the caller delta) -> settle what the vault
///         owes / take what the pool owes. Both pool currencies are ERC20s in v1
///         (POLYDASH + WETH); no native ETH flows through the pool calls.
///
///         Dividends: `harvestFees` leaves the fee tokens in the vault. The manager
///         then sells them for ETH through the existing swap facet and calls the
///         vault's `distribute(amount)`; holders pull their pro-rata share with
///         `claim(ids)` — the existing FundPhase5 pull-distribution rails. The facet
///         does not distribute by itself.
///
///         Exits pay the liquid share only (see `FundLiquidityStore`): LP principal
///         stays in the pool for the remaining holders until the manager removes it.
///         This contract is not deployed. Not a review. Not financial advice.
contract FundLiquidityFacetPhase3 is
    ReentrancyGuard,
    FundVaultStore,
    FundPhase3Store,
    FundProposalStore,
    FundLiquidityStore
{
    using SafeERC20 for IERC20;

    address public immutable self;

    uint8 internal constant ACTION_ADD = 0;
    uint8 internal constant ACTION_REMOVE = 1;
    uint8 internal constant ACTION_HARVEST = 2;

    constructor() {
        self = address(this);
    }

    // --- LP proposals (Option 3) ---

    /// @notice Propose an LP position: pool key, tick range, per-pool LP cap, reason,
    ///         thesis link. Manager only. The non-WETH token must already be in the
    ///         mandate; the allowlist side is checked at execution. `maxLpBps` of 0
    ///         means "use the default": `MAX_LP_BPS` (50%); it may not exceed 50%.
    function proposeLiquidity(
        LpPoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint256 maxLpBps,
        string calldata reason,
        string calldata thesisUri
    ) external returns (uint256 id) {
        if (address(this) == self) revert DirectFacetCall();
        if (msg.sender != manager) revert NotManager();
        _checkPoolKey(key);
        _checkTicks(key.tickSpacing, tickLower, tickUpper);
        if (maxLpBps > MAX_LP_BPS) revert BadValue();
        if (maxLpBps == 0) maxLpBps = MAX_LP_BPS;
        if (bytes(reason).length > MAX_REASON_BYTES) revert BadUri();
        if (bytes(thesisUri).length == 0 || bytes(thesisUri).length > MAX_THESIS_URI_BYTES) revert BadUri();
        address asset = _lpAsset(key);
        if (!inMandate[asset]) revert NotInMandate();
        uint64 readyAt = uint64(block.timestamp + PROPOSAL_DELAY);
        id = ++lpProposalCount;
        lpProposals[id] = LpProposal({
            key: key,
            tickLower: tickLower,
            tickUpper: tickUpper,
            maxLpBps: maxLpBps,
            reason: reason,
            thesisUri: thesisUri,
            readyAt: readyAt,
            status: LpProposalStatus.Pending
        });
        emit LpProposed(id, lpPoolId(key), key.currency0, key.currency1, maxLpBps, reason, thesisUri, readyAt);
    }

    /// @notice Approve a proposed LP position after the public wait. Manager only.
    ///         Requires both pool tokens allowlisted (the allowlist side must be live).
    function executeLiquidity(uint256 id) external {
        if (address(this) == self) revert DirectFacetCall();
        if (msg.sender != manager) revert NotManager();
        if (id == 0 || id > lpProposalCount) revert BadProposal();
        LpProposal storage p = lpProposals[id];
        if (p.status != LpProposalStatus.Pending) revert NotPending();
        if (block.timestamp < p.readyAt) revert TooEarly();
        if (!allowlist.assetAllowed(p.key.currency0) || !allowlist.assetAllowed(p.key.currency1)) {
            revert NotAllowlisted();
        }
        p.status = LpProposalStatus.Executed;
        bytes32 poolId = lpPoolId(p.key);
        lpApproved[poolId] = true;
        lpCap[poolId] = p.maxLpBps;
        lpTickLower[poolId] = p.tickLower;
        lpTickUpper[poolId] = p.tickUpper;
        emit LpProposalExecuted(id, poolId, p.maxLpBps);
    }

    /// @notice Cancel a pending LP proposal. Manager only, any time before execution.
    function cancelLiquidityProposal(uint256 id) external {
        if (address(this) == self) revert DirectFacetCall();
        if (msg.sender != manager) revert NotManager();
        if (id == 0 || id > lpProposalCount) revert BadProposal();
        LpProposal storage p = lpProposals[id];
        if (p.status != LpProposalStatus.Pending) revert NotPending();
        p.status = LpProposalStatus.Cancelled;
        emit LpProposalCancelled(id, lpPoolId(p.key));
    }

    // --- LP actions ---

    /// @notice Add liquidity to an approved pool. `liquidity` is V4 liquidity units;
    ///         `amount0Max` / `amount1Max` bound what the vault may settle (the pool
    ///         prices the liquidity, the manager caps the spend). The settled amounts
    ///         are checked against the maxima AND both caps after the pool call.
    function addLiquidity(
        LpPoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint256 liquidity,
        uint256 amount0Max,
        uint256 amount1Max
    ) external {
        if (address(this) == self) revert DirectFacetCall();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        if (status != Status.Investing) revert NotInvesting();
        if (swapsPaused || allowlist.paused()) revert Paused();
        if (liquidity == 0 || amount0Max == 0 || amount1Max == 0) revert BadAmount();
        _checkPoolKey(key);
        bytes32 poolId = lpPoolId(key);
        if (!lpApproved[poolId]) revert LpNotApproved();
        if (tickLower != lpTickLower[poolId] || tickUpper != lpTickUpper[poolId]) revert LpRangeMismatch();
        // Buys pause on a drawdown; LP adds are buys.
        uint256 drop = _drawdownBps();
        if (maxDrawdownBps != 0 && drop >= maxDrawdownBps) {
            emit DrawdownBrake(drop);
            revert DrawdownBrakeActive();
        }

        (uint256 paid0, uint256 paid1) = _unlock(
            ACTION_ADD, key, tickLower, tickUpper, int256(liquidity)
        );
        if (paid0 > amount0Max || paid1 > amount1Max) revert Slippage();
        if (address(this).balance < _claimableFees()) revert FeesShort();

        uint256 value0 = _lpTokenValue(key.currency0, paid0);
        uint256 value1 = _lpTokenValue(key.currency1, paid1);
        uint256 navAfter = navTotalWithLp() + value0 + value1;
        uint256 lpAfter = lpValue() + value0 + value1;
        uint256 cap = lpCap[poolId] == 0 ? MAX_LP_BPS : lpCap[poolId];
        if (lpAfter > (navAfter * cap) / BPS) revert LpCapExceeded();
        _checkAssetCap(key.currency0, paid0, navAfter);
        _checkAssetCap(key.currency1, paid1, navAfter);

        LpPosition storage pos = lpPositions[poolId];
        // `currency0` is set on the first add and never cleared, so a re-add after
        // a full removal must NOT push the pool id a second time (that would
        // double-count the position in `lpValue()`). The range is re-synced on
        // every add: a new proposal can approve a new range for the same pool.
        if (pos.currency0 == address(0)) {
            _lpPoolIds.push(poolId);
            pos.currency0 = key.currency0;
            pos.currency1 = key.currency1;
            pos.fee = key.fee;
            pos.tickSpacing = key.tickSpacing;
            pos.hooks = key.hooks;
        }
        pos.tickLower = tickLower;
        pos.tickUpper = tickUpper;
        pos.active = true;
        pos.liquidity += liquidity;
        pos.amount0 += paid0;
        pos.amount1 += paid1;
        emit LiquidityAdded(poolId, liquidity, paid0, paid1, lpAfter);
    }

    /// @notice Remove liquidity from a position. NEVER blocked by a pause or the
    ///         drawdown brake: exiting a pool must always be possible. `liquidity` is
    ///         V4 liquidity units to remove; `amount0Min` / `amount1Min` floor what
    ///         the vault receives (principal share + accrued fees).
    function removeLiquidity(
        LpPoolKey calldata key,
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) external {
        if (address(this) == self) revert DirectFacetCall();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        if (status != Status.Investing && status != Status.RaisingClosed) revert NotInvesting();
        if (liquidity == 0) revert BadAmount();
        bytes32 poolId = lpPoolId(key);
        LpPosition storage pos = lpPositions[poolId];
        if (!pos.active || pos.liquidity == 0) revert LpNoPosition();
        if (liquidity > pos.liquidity) revert BadAmount();

        uint256 liqBefore = pos.liquidity;
        uint256 amt0Before = pos.amount0;
        uint256 amt1Before = pos.amount1;
        (uint256 got0, uint256 got1) =
            _unlock(ACTION_REMOVE, key, pos.tickLower, pos.tickUpper, -int256(liquidity));
        if (got0 < amount0Min || got1 < amount1Min) revert Slippage();

        uint256 principal0 = (amt0Before * liquidity) / liqBefore;
        uint256 principal1 = (amt1Before * liquidity) / liqBefore;
        pos.liquidity -= liquidity;
        pos.amount0 = amt0Before - principal0;
        pos.amount1 = amt1Before - principal1;
        if (got0 > principal0) pos.feesHarvested0 += got0 - principal0;
        if (got1 > principal1) pos.feesHarvested1 += got1 - principal1;
        if (pos.liquidity == 0) pos.active = false;
        emit LiquidityRemoved(poolId, liquidity, got0, got1, lpValue());
    }

    /// @notice Collect accrued trading fees from a position without removing
    ///         liquidity (a zero-delta `modifyLiquidity`). Weekly per position; a
    ///         zero-fee harvest does not start the clock. Never blocked by a pause.
    function harvestFees(LpPoolKey calldata key) external returns (uint256 got0, uint256 got1) {
        if (address(this) == self) revert DirectFacetCall();
        if (msg.sender != manager && !isExecutor[msg.sender]) revert NotAuthorized();
        if (status != Status.Investing && status != Status.RaisingClosed) revert NotInvesting();
        bytes32 poolId = lpPoolId(key);
        LpPosition storage pos = lpPositions[poolId];
        if (!pos.active || pos.liquidity == 0) revert LpNoPosition();
        if (pos.lastHarvestAt != 0 && block.timestamp < uint256(pos.lastHarvestAt) + HARVEST_INTERVAL) {
            revert LpHarvestTooSoon();
        }
        (got0, got1) = _unlock(ACTION_HARVEST, key, pos.tickLower, pos.tickUpper, 0);
        if (got0 > 0 || got1 > 0) {
            pos.feesHarvested0 += got0;
            pos.feesHarvested1 += got1;
            pos.lastHarvestAt = uint64(block.timestamp);
        }
        emit FeesHarvested(poolId, got0, got1);
    }

    /// @notice Called by the PoolManager during `unlock`. Only the PoolManager may call
    ///         it. Runs `modifyLiquidity` for the requested action, settles what the
    ///         vault owes (sync -> transfer -> settle) and takes what the pool owes.
    ///         Returns `(paid0, paid1, received0, received1)` to the unlock caller.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != lpPoolManager) revert LpBadPoolManager();
        (
            uint8 action,
            LpPoolKey memory key,
            int24 tickLower,
            int24 tickUpper,
            int256 liquidityDelta,
        ) = abi.decode(data, (uint8, LpPoolKey, int24, int24, int256, bytes32));
        (int256 callerDelta,) = IPoolManagerMinimal(lpPoolManager).modifyLiquidity(
            LpPoolKeyMinimal({
                currency0: key.currency0,
                currency1: key.currency1,
                fee: key.fee,
                tickSpacing: key.tickSpacing,
                hooks: key.hooks
            }),
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );
        (uint256 paid0, uint256 paid1, uint256 got0, uint256 got1) = _settleDelta(key, callerDelta);
        action; // the delta already encodes the action's economics
        return abi.encode(paid0, paid1, got0, got1);
    }

    // --- Internal ---

    /// @notice Unlock the pool for one LP action and return `(paid0, paid1)` for adds
    ///         or `(received0, received1)` for removals/harvests, as `(a, b)` where the
    ///         caller reads the pair it needs. Add returns paid, remove/harvest return
    ///         received; the other pair is zero.
    function _unlock(uint8 action, LpPoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidityDelta)
        internal
        returns (uint256 a, uint256 b)
    {
        bytes memory ret = IPoolManagerMinimal(lpPoolManager).unlock(
            abi.encode(action, key, tickLower, tickUpper, liquidityDelta, bytes32(0))
        );
        (uint256 paid0, uint256 paid1, uint256 got0, uint256 got1) =
            abi.decode(ret, (uint256, uint256, uint256, uint256));
        if (action == ACTION_ADD) return (paid0, paid1);
        return (got0, got1);
    }

    /// @notice Settle a `modifyLiquidity` caller delta: negative components are paid
    ///         to the pool (sync -> transfer -> settle), positive components are taken
    ///         to the vault. Returns `(paid0, paid1, received0, received1)`.
    /// @dev V4 BalanceDelta packing (v4-core `BalanceDelta.sol`): amount0 is the
    ///      UPPER 128 bits (`sar(128, delta)`), amount1 the LOWER 128 bits
    ///      (`signextend(15, delta)`). This was previously decoded backwards
    ///      (low = amount0), and the mock packed it backwards the same way, so
    ///      the two errors cancelled in unit tests — the real PoolManager
    ///      exposed it (fork test paid the POLYDASH amount in WETH).
    function _settleDelta(LpPoolKey memory key, int256 callerDelta)
        internal
        returns (uint256 paid0, uint256 paid1, uint256 got0, uint256 got1)
    {
        int128 d0 = int128(callerDelta >> 128);
        int128 d1 = int128(callerDelta);
        if (d0 < 0) {
            paid0 = uint256(uint128(-d0));
            _payToPool(key.currency0, paid0);
        } else if (d0 > 0) {
            got0 = uint256(uint128(d0));
            IPoolManagerMinimal(lpPoolManager).take(key.currency0, address(this), got0);
        }
        if (d1 < 0) {
            paid1 = uint256(uint128(-d1));
            _payToPool(key.currency1, paid1);
        } else if (d1 > 0) {
            got1 = uint256(uint128(d1));
            IPoolManagerMinimal(lpPoolManager).take(key.currency1, address(this), got1);
        }
    }

    function _payToPool(address token, uint256 amount) internal {
        IPoolManagerMinimal pool = IPoolManagerMinimal(lpPoolManager);
        pool.sync(token);
        IERC20(token).safeTransfer(lpPoolManager, amount);
        pool.settle();
    }

    /// @notice The pool key must be canonical (sorted currencies), WETH on one side,
    ///         a fee the pool can carry, and a positive tick spacing.
    function _checkPoolKey(LpPoolKey calldata key) internal view {
        if (key.currency0 >= key.currency1) revert LpBadPool();
        if (key.currency0 == address(0) || key.currency1 == address(0)) revert LpBadPool();
        if (key.tickSpacing <= 0) revert LpBadPool();
        if (key.fee != 0x800000 && key.fee > 1_000_000) revert LpBadPool();
        bool wethSide = key.currency0 == weth || key.currency1 == weth;
        if (!wethSide) revert LpBadPool();
    }

    /// @notice The non-WETH side of the pool: the risk asset the mandate governs.
    function _lpAsset(LpPoolKey calldata key) internal view returns (address) {
        return key.currency0 == weth ? key.currency1 : key.currency0;
    }

    function _checkTicks(int24 tickSpacing, int24 tickLower, int24 tickUpper) internal pure {
        if (tickLower >= tickUpper) revert LpBadTicks();
        if (tickLower % tickSpacing != 0 || tickUpper % tickSpacing != 0) revert LpBadTicks();
        if (tickUpper - tickLower < MIN_RANGE_TICKS) revert LpBadTicks();
    }

    /// @notice Per-asset cap for one token's LP principal: spot value + LP value for
    ///         that token must stay under `min(template maxPositionBps, assetCap)`.
    ///         WETH is the quote asset and has no cap.
    function _checkAssetCap(address token, uint256 addedAmount, uint256 navAfter) internal view {
        if (token == weth || addedAmount == 0) return;
        uint256 cap = maxPositionBps;
        uint256 proposed = assetCap[token];
        if (proposed != 0 && proposed < cap) cap = proposed;
        // Spot balance is post-settle (the paid amounts already left the vault) and
        // `_lpTokenTotal` is pre-add (the new amounts are not recorded yet), so the
        // just-added amount is counted explicitly.
        uint256 positionValue =
            _lpTokenValue(token, IERC20(token).balanceOf(address(this)) + _lpTokenTotal(token) + addedAmount);
        if (positionValue > (navAfter * cap) / BPS) revert PositionCap();
    }

    /// @notice Total LP principal of one token across all positions.
    function _lpTokenTotal(address token) internal view returns (uint256 total) {
        uint256 n = _lpPoolIds.length;
        for (uint256 i; i < n; ++i) {
            LpPosition storage p = lpPositions[_lpPoolIds[i]];
            if (p.liquidity == 0) continue;
            if (p.currency0 == token) total += p.amount0;
            if (p.currency1 == token) total += p.amount1;
        }
    }

    function _claimableFees() internal view returns (uint256) {
        return (entryFeeAccrued - entryFeeClaimed) + (protocolFeeAccrued - protocolFeeClaimed)
            + (performanceFeeAccrued - performanceFeeClaimed) + distributionReserved;
    }

    function _drawdownBps() internal view returns (uint256) {
        if (peakNavPerNft == 0) return 0;
        uint256 per = NAVReader.perNft(navTotalWithLp(), nft == address(0) ? 0 : IFundUnit(nft).outstanding());
        if (per >= peakNavPerNft) return 0;
        return ((peakNavPerNft - per) * BPS) / peakNavPerNft;
    }
}
