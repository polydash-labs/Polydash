// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IFundPriceFeed} from "../phase2/Interfaces.sol";
import {TwapPriceMath} from "./TwapPriceMath.sol";

/// @notice Minimal ERC20 metadata read used only to pin the price math's decimal scaling.
interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title GenericV4TwapFeed (not reviewed, not deployed)
/// @notice IFundPriceFeed for any asset with a Uniswap V4 pool against WETH on Robinhood Chain.
///         Generalizes `PolydashTwapFeed` (same self-observing poke / ring / 30-minute window /
///         fail-closed design — see its NatSpec for the window choice and the manipulation
///         analysis, which apply unchanged here) with two generalizations:
///
///         1. Currency ordering. The asset may sort either side of the quote: when the asset
///            is currency1 the price is the reciprocal of the pool price, as in
///            `PolydashTwapFeed`; when the asset is currency0 (it sorts below WETH) the pool
///            price is used directly. `TwapPriceMath.priceX18FromTick` takes the ordering as
///            a flag, so the inversion is in exactly one place.
///         2. Decimals. Both tokens' `decimals()` are read at deploy and stored; the price
///            conversion scales by 10^(quoteDecimals - assetDecimals), so `priceX18` is
///            correct for any decimal combination (e.g. a 6-decimal stablecoin quoted in
///            18-decimal WETH). Tokens reporting more than 24 decimals are rejected at
///            deploy: the scaling factor is bounded and no real token needs more.
///
///         `priceX18` is ETH wei per 1e18 raw units of the asset. `updatedAt` is
///         `block.timestamp`: the TWAP is always computed as of now, so a read is never
///         stale by construction. The feed reverts for any asset other than its own.
///
///         Fail closed, everywhere (same rules as `PolydashTwapFeed`):
///         - No observations, or observations that do not yet span the window: revert.
///         - Newest observation older than `maxObservationAge`: revert. A feed that has
///           not been poked recently reports nothing rather than an extrapolated price.
///         - Pool uninitialized (`sqrtPriceX96 == 0`) at deploy or at poke: revert.
///         Liveness depends on pokes: a keeper (or anyone) must call `poke()` at least
///         every `maxObservationAge`. Poking is permissionless and only costs gas.
contract GenericV4TwapFeed is IFundPriceFeed {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Shortest TWAP window accepted at deploy (5 minutes).
    uint32 public constant MIN_WINDOW = 5 minutes;
    /// @notice Longest TWAP window accepted at deploy (24 hours).
    uint32 public constant MAX_WINDOW = 24 hours;
    /// @notice Shortest observation age accepted at deploy (1 minute).
    uint32 public constant MIN_OBSERVATION_AGE = 1 minutes;
    /// @notice Observations kept. At a 5-minute poke cadence this covers ~2.5 hours,
    ///         far more than any accepted window needs; older observations are overwritten.
    uint256 public constant RING_SIZE = 32;
    /// @notice Dynamic-fee flag in a V4 PoolKey.
    uint24 public constant DYNAMIC_FEE = 0x800000;
    /// @notice Largest `decimals()` accepted at deploy for either token.
    uint8 public constant MAX_DECIMALS = 24;

    struct Observation {
        uint64 timestamp;
        int256 tickCumulative;
        int24 tick;
    }

    IPoolManager public immutable poolManager;
    address public immutable asset;
    address public immutable quote;
    address public immutable hook;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    /// @notice True when the asset sorts below the quote, i.e. the asset is currency0.
    bool public immutable assetIsCurrency0;
    /// @notice `decimals()` of the asset, read at deploy.
    uint8 public immutable assetDecimals;
    /// @notice `decimals()` of the quote, read at deploy.
    uint8 public immutable quoteDecimals;
    /// @notice TWAP window in seconds (30 minutes recommended; see `PolydashTwapFeed`).
    uint32 public immutable twapWindow;
    /// @notice Newest observation may be at most this old, in seconds (30 minutes
    ///         recommended when the keeper pokes every 15 minutes, 10 minutes when it
    ///         pokes every 5 minutes). Must not exceed `twapWindow`.
    uint32 public immutable maxObservationAge;

    /// @notice Total observations ever recorded (monotonic). The ring holds the newest 32.
    uint256 public observationCount;
    Observation[RING_SIZE] private _observations;

    event Poked(uint64 indexed timestamp, int256 tickCumulative, int24 tick);

    error InvalidParams();
    error WrongAsset();
    error PriceUnavailable();

    /// @param _poolManager Uniswap V4 PoolManager (Robinhood Chain).
    /// @param _asset The feed's asset (either currency of the pool).
    /// @param _quote The quote token, WETH (the other currency of the pool).
    /// @param _hook Pool hook address (address(0) for a hookless pool).
    /// @param _poolFee PoolKey fee: 0x800000 for a dynamic-fee pool, else <= 1_000_000.
    /// @param _tickSpacing PoolKey tick spacing (> 0).
    /// @param _twapWindow TWAP window in seconds, 5 minutes to 24 hours.
    /// @param _maxObservationAge Newest-observation age bound in seconds, 1 minute to `_twapWindow`.
    /// @dev The constructor reads slot0 once: it reverts unless the key identifies an
    ///      initialized pool, so a wrong fee / tickSpacing / hook / currency pair cannot
    ///      deploy. It also reads both tokens' decimals for the price scaling.
    constructor(
        address _poolManager,
        address _asset,
        address _quote,
        address _hook,
        uint24 _poolFee,
        int24 _tickSpacing,
        uint32 _twapWindow,
        uint32 _maxObservationAge
    ) {
        if (_poolManager == address(0) || _asset == address(0) || _quote == address(0)) revert InvalidParams();
        if (_asset == _quote) revert InvalidParams();
        if (_poolFee != DYNAMIC_FEE && _poolFee > 1_000_000) revert InvalidParams();
        if (_tickSpacing <= 0 || _tickSpacing > type(int16).max) revert InvalidParams();
        if (_twapWindow < MIN_WINDOW || _twapWindow > MAX_WINDOW) revert InvalidParams();
        if (_maxObservationAge < MIN_OBSERVATION_AGE || _maxObservationAge > _twapWindow) revert InvalidParams();
        poolManager = IPoolManager(_poolManager);
        asset = _asset;
        quote = _quote;
        hook = _hook;
        poolFee = _poolFee;
        tickSpacing = _tickSpacing;
        twapWindow = _twapWindow;
        maxObservationAge = _maxObservationAge;
        assetIsCurrency0 = _asset < _quote;
        uint8 ad = IERC20Decimals(_asset).decimals();
        uint8 qd = IERC20Decimals(_quote).decimals();
        if (ad > MAX_DECIMALS || qd > MAX_DECIMALS) revert InvalidParams();
        assetDecimals = ad;
        quoteDecimals = qd;
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey().toId());
        if (sqrtPriceX96 == 0) revert PriceUnavailable();
    }

    /// @notice The pool this feed observes.
    function poolKey() public view returns (PoolKey memory) {
        address c0 = assetIsCurrency0 ? asset : quote;
        address c1 = assetIsCurrency0 ? quote : asset;
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), poolFee, tickSpacing, IHooks(hook));
    }

    /// @notice The pool id this feed observes.
    function poolId() external view returns (bytes32) {
        return PoolId.unwrap(poolKey().toId());
    }

    /// @notice Current pool tick (spot), for monitoring. Not used by `latestPrice`.
    function spotTick() external view returns (int24 tick) {
        (, tick,,) = poolManager.getSlot0(poolKey().toId());
    }

    /// @notice TWAP tick over the trailing window, for monitoring.
    function twapTick() external view returns (int256 avgTick) {
        return _twapTick();
    }

    /// @notice Stored observation by age order (0 = oldest still held, newest last).
    /// @dev Reverts when `index` is past the observations currently held.
    function observationAt(uint256 index) external view returns (Observation memory) {
        uint256 stored = _stored();
        if (index >= stored) revert PriceUnavailable();
        return _at(index);
    }

    /// @notice Record the pool's current tick and cumulative. Permissionless; call at
    ///         least every `maxObservationAge` (a keeper poking every 5-15 minutes is
    ///         ample). A second poke in the same block is a no-op. The cumulative
    ///         between pokes accrues at the previously recorded tick, which is the tick
    ///         that was actually in effect for that interval.
    function poke() external returns (uint64 timestamp, int256 tickCumulative, int24 tick) {
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolKey().toId());
        if (sqrtPriceX96 == 0) revert PriceUnavailable();
        uint64 now_ = uint64(block.timestamp);
        uint256 n = observationCount;
        if (n > 0) {
            Observation memory last = _latest();
            if (now_ <= last.timestamp) return (last.timestamp, last.tickCumulative, last.tick);
            int256 cum =
                last.tickCumulative + int256(last.tick) * int256(uint256(now_ - last.timestamp));
            _push(Observation(now_, cum, currentTick));
            emit Poked(now_, cum, currentTick);
            return (now_, cum, currentTick);
        }
        _push(Observation(now_, 0, currentTick));
        emit Poked(now_, 0, currentTick);
        return (now_, 0, currentTick);
    }

    /// @inheritdoc IFundPriceFeed
    function latestPrice(address asset_) external view returns (uint256 priceX18, uint64 updatedAt) {
        if (asset_ != asset) revert WrongAsset();
        priceX18 = _twapPrice();
        updatedAt = uint64(block.timestamp);
    }

    /// @notice ETH wei per 1e18 raw asset at the TWAP tick.
    /// @dev Currency ordering and decimals are handled by `TwapPriceMath`: when the
    ///      asset is currency1 the pool price is inverted, when it is currency0 it is
    ///      used directly, and the result is scaled by 10^(quoteDecimals - assetDecimals).
    function _twapPrice() internal view returns (uint256 priceX18) {
        int256 avgTick = _twapTick();
        priceX18 = TwapPriceMath.priceX18FromTick(avgTick, assetIsCurrency0, assetDecimals, quoteDecimals);
        if (priceX18 == 0) revert PriceUnavailable();
    }

    /// @notice Time-weighted average tick over the trailing `twapWindow`.
    /// @dev The newest observation anchors the present: the cumulative as of now is
    ///      extrapolated from it at its recorded tick, which is valid for at most
    ///      `maxObservationAge`. The window start is interpolated between the stored
    ///      observations bracketing it. Tick division truncates toward zero; the bias
    ///      is under one tick (~0.01% of price) and is documented, not hidden.
    function _twapTick() internal view returns (int256 avgTick) {
        uint256 n = observationCount;
        if (n == 0) revert PriceUnavailable();
        Observation memory last = _latest();
        uint256 now_ = block.timestamp;
        if (now_ < last.timestamp || now_ - last.timestamp > maxObservationAge) revert PriceUnavailable();
        uint256 target = now_ - twapWindow;
        if (_at(0).timestamp > target) revert PriceUnavailable();
        int256 cumNow = last.tickCumulative + int256(last.tick) * int256(now_ - last.timestamp);
        int256 cumThen = _cumulativeAt(uint64(target));
        avgTick = (cumNow - cumThen) / int256(uint256(twapWindow));
    }

    /// @notice Tick-time cumulative at `target`, interpolated between bracketing observations.
    /// @dev Caller guarantees an observation at or before `target` exists and the newest
    ///      observation is at or after it (newest is within `maxObservationAge` of now,
    ///      and `maxObservationAge <= twapWindow`).
    function _cumulativeAt(uint64 target) internal view returns (int256) {
        Observation memory prev = _at(0);
        if (target <= prev.timestamp) return prev.tickCumulative;
        uint256 stored = _stored();
        for (uint256 i = 1; i < stored; ++i) {
            Observation memory cur = _at(i);
            if (target <= cur.timestamp) {
                if (target == cur.timestamp) return cur.tickCumulative;
                uint256 dt = uint256(cur.timestamp - prev.timestamp);
                uint256 elapsed = uint256(target - prev.timestamp);
                return prev.tickCumulative + (cur.tickCumulative - prev.tickCumulative) * int256(elapsed) / int256(dt);
            }
            prev = cur;
        }
        revert PriceUnavailable();
    }

    function _stored() internal view returns (uint256) {
        return observationCount < RING_SIZE ? observationCount : RING_SIZE;
    }

    function _latest() internal view returns (Observation memory) {
        return _observations[(observationCount - 1) % RING_SIZE];
    }

    /// @dev Logical index 0 is the oldest observation still held.
    function _at(uint256 index) internal view returns (Observation memory) {
        uint256 stored = _stored();
        uint256 start = observationCount > stored ? observationCount - stored : 0;
        return _observations[(start + index) % RING_SIZE];
    }

    function _push(Observation memory obs) internal {
        _observations[observationCount % RING_SIZE] = obs;
        unchecked {
            ++observationCount;
        }
    }
}
