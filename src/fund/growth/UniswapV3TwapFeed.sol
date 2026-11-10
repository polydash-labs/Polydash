// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IFundPriceFeed} from "../phase2/Interfaces.sol";
import {TwapPriceMath} from "./TwapPriceMath.sol";

/// @notice Minimal ERC20 metadata read used only to pin the price math's decimal scaling.
interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @notice The part of a Uniswap V3 pool this feed uses: identity, slot0, the native
///         TWAP oracle (`observe`), and the observation ring it reads through.
///         There is no v3-core dependency in this repo, so the interface is declared
///         here rather than imported.
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
    function observations(uint256 index)
        external
        view
        returns (
            uint32 blockTimestamp,
            int56 tickCumulative,
            uint160 secondsPerLiquidityCumulativeX128,
            bool initialized
        );
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @title UniswapV3TwapFeed (not reviewed, not deployed)
/// @notice IFundPriceFeed for any asset with a Uniswap V3 pool against WETH on Robinhood Chain.
///         Unlike the V4 feeds, this one needs no keeper and no self-observation: V3 pools
///         keep TWAP history natively, so `latestPrice` reads the pool's own `observe` over
///         the trailing `twapWindow` (30 minutes recommended, the same window as the V4
///         feeds) and converts the average tick with the same currency-ordering and decimal
///         handling as `GenericV4TwapFeed` (see `TwapPriceMath`).
///
///         `priceX18` is ETH wei per 1e18 raw units of the asset. `updatedAt` is
///         `block.timestamp`: the TWAP is always computed as of now, so a read is never
///         stale by construction. The feed reverts for any asset other than its own.
///
///         Fail closed, everywhere:
///         - Pool uninitialized (`sqrtPriceX96 == 0`) at deploy or at read: revert.
///         - No/insufficient observation history: `observe` reverts (`OLD`) when the
///           window start predates the oldest observation, and this feed turns that
///           into `PriceUnavailable` rather than returning a short-window average.
///           A pool whose observation cardinality was never grown past 1 keeps only
///           its newest observation, so a 30-minute TWAP on it reverts whenever the
///           pool was last touched less than 30 minutes ago — that is the correct
///           answer for such a pool, not a reason to shorten the window silently.
///           (Anyone may call the pool's `increaseObservationCardinalityNext` to grow
///           the ring; this feed does not do it, so deployment never writes to the pool.)
///         - Newest observation older than `maxObservationAge`: revert. `observe` with
///           `secondsAgos = [window, 0]` extrapolates the last recorded tick forward to
///           now, so without this check a quiet pool would report a stale tick as a
///           fresh TWAP. The newest observation's timestamp is read from the pool's
///           observation ring via `slot0`'s `observationIndex`.
///         - A flash spike in the current block contributes nothing until the pool's
///           oracle records it, and then only for the time the moved tick actually
///           persists — the same manipulation analysis as the V4 feeds applies.
///
///         Liveness depends on pool activity, not on a keeper: every swap, mint, and
///         burn writes an observation, so an active pool stays fresh on its own. A
///         pool with no activity for longer than `maxObservationAge` reports nothing
///         until it trades again; pick `maxObservationAge` (<= `twapWindow`) with the
///         pool's real cadence in mind.
contract UniswapV3TwapFeed is IFundPriceFeed {
    /// @notice Shortest TWAP window accepted at deploy (5 minutes).
    uint32 public constant MIN_WINDOW = 5 minutes;
    /// @notice Longest TWAP window accepted at deploy (24 hours).
    uint32 public constant MAX_WINDOW = 24 hours;
    /// @notice Shortest observation age accepted at deploy (1 minute).
    uint32 public constant MIN_OBSERVATION_AGE = 1 minutes;
    /// @notice Largest `decimals()` accepted at deploy for either token.
    uint8 public constant MAX_DECIMALS = 24;

    IUniswapV3Pool public immutable v3Pool;
    address public immutable asset;
    address public immutable quote;
    /// @notice True when the asset sorts below the quote, i.e. the asset is token0.
    bool public immutable assetIsToken0;
    /// @notice `decimals()` of the asset, read at deploy.
    uint8 public immutable assetDecimals;
    /// @notice `decimals()` of the quote, read at deploy.
    uint8 public immutable quoteDecimals;
    /// @notice TWAP window in seconds (30 minutes recommended).
    uint32 public immutable twapWindow;
    /// @notice Newest pool observation may be at most this old, in seconds (30 minutes
    ///         recommended for an active pool). Must not exceed `twapWindow`.
    uint32 public immutable maxObservationAge;

    error InvalidParams();
    error WrongAsset();
    error PriceUnavailable();

    /// @param _v3Pool Uniswap V3 pool for the asset/quote pair (Robinhood Chain).
    /// @param _asset The feed's asset (either token of the pool).
    /// @param _quote The quote token, WETH (the other token of the pool).
    /// @param _twapWindow TWAP window in seconds, 5 minutes to 24 hours.
    /// @param _maxObservationAge Newest-observation age bound in seconds, 1 minute to `_twapWindow`.
    /// @dev The constructor validates the pool is the asset/quote pair and is initialized
    ///      (`sqrtPriceX96 != 0`), so a wrong pool address cannot deploy. It also reads
    ///      both tokens' decimals for the price scaling. It does NOT check the pool's
    ///      observation history: history grows with pool activity, and `latestPrice`
    ///      fails closed until the window is covered.
    constructor(address _v3Pool, address _asset, address _quote, uint32 _twapWindow, uint32 _maxObservationAge) {
        if (_v3Pool == address(0) || _asset == address(0) || _quote == address(0)) revert InvalidParams();
        if (_asset == _quote) revert InvalidParams();
        if (_twapWindow < MIN_WINDOW || _twapWindow > MAX_WINDOW) revert InvalidParams();
        if (_maxObservationAge < MIN_OBSERVATION_AGE || _maxObservationAge > _twapWindow) revert InvalidParams();
        if (_v3Pool.code.length == 0) revert InvalidParams();
        v3Pool = IUniswapV3Pool(_v3Pool);
        asset = _asset;
        quote = _quote;
        twapWindow = _twapWindow;
        maxObservationAge = _maxObservationAge;
        address t0 = v3Pool.token0();
        address t1 = v3Pool.token1();
        if (_asset == t0 && _quote == t1) {
            assetIsToken0 = true;
        } else if (_asset == t1 && _quote == t0) {
            assetIsToken0 = false;
        } else {
            revert InvalidParams();
        }
        uint8 ad = IERC20Decimals(_asset).decimals();
        uint8 qd = IERC20Decimals(_quote).decimals();
        if (ad > MAX_DECIMALS || qd > MAX_DECIMALS) revert InvalidParams();
        assetDecimals = ad;
        quoteDecimals = qd;
        (uint160 sqrtPriceX96,,,,,,) = v3Pool.slot0();
        if (sqrtPriceX96 == 0) revert PriceUnavailable();
    }

    /// @notice The pool's fee tier, for monitoring.
    function poolFee() external view returns (uint24) {
        return v3Pool.fee();
    }

    /// @notice Current pool tick (spot), for monitoring. Not used by `latestPrice`.
    function spotTick() external view returns (int24 tick) {
        (, tick,,,,,) = v3Pool.slot0();
    }

    /// @notice TWAP tick over the trailing window, for monitoring.
    function twapTick() external view returns (int256 avgTick) {
        return _twapTick();
    }

    /// @notice Timestamp of the pool's newest observation, for monitoring.
    function newestObservationTime() external view returns (uint32) {
        (,, uint16 observationIndex,,,,) = v3Pool.slot0();
        (uint32 blockTimestamp,,,) = v3Pool.observations(observationIndex);
        return blockTimestamp;
    }

    /// @inheritdoc IFundPriceFeed
    function latestPrice(address asset_) external view returns (uint256 priceX18, uint64 updatedAt) {
        if (asset_ != asset) revert WrongAsset();
        priceX18 = _twapPrice();
        updatedAt = uint64(block.timestamp);
    }

    /// @notice ETH wei per 1e18 raw asset at the TWAP tick.
    function _twapPrice() internal view returns (uint256 priceX18) {
        int256 avgTick = _twapTick();
        priceX18 = TwapPriceMath.priceX18FromTick(avgTick, assetIsToken0, assetDecimals, quoteDecimals);
        if (priceX18 == 0) revert PriceUnavailable();
    }

    /// @notice Time-weighted average tick over the trailing `twapWindow`, from the pool's
    ///         own oracle. Tick division truncates toward zero; the bias is under one
    ///         tick (~0.01% of price) and is documented, not hidden.
    function _twapTick() internal view returns (int256 avgTick) {
        (uint160 sqrtPriceX96,, uint16 observationIndex,,,,) = v3Pool.slot0();
        if (sqrtPriceX96 == 0) revert PriceUnavailable();
        (uint32 newestTime,,,) = v3Pool.observations(observationIndex);
        if (newestTime == 0 || block.timestamp < newestTime || block.timestamp - newestTime > maxObservationAge) {
            revert PriceUnavailable();
        }
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;
        try v3Pool.observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
            if (tickCumulatives.length != 2) revert PriceUnavailable();
            avgTick =
                (int256(tickCumulatives[1]) - int256(tickCumulatives[0])) / int256(uint256(twapWindow));
        } catch {
            revert PriceUnavailable();
        }
    }
}
