// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title TwapPriceMath (not reviewed, not deployed)
/// @notice Shared tick-to-`priceX18` conversion for the growth feeds. `priceX18` is
///         the quote, in the quote's raw units, per 1e18 raw units of the asset.
///         For the usual 18-decimal quote (WETH) one raw quote is one wei, so this
///         is ETH wei per 1e18 raw asset; for a 6-decimal quote (USDG) it is raw
///         USDG per 1e18 raw asset, and the calling feed must convert it to WETH
///         before returning it (see `GenericV4TwapFeed`'s reference conversion).
///
///         Let P be the pool price of the asset in quote terms: P = quote-tokens per
///         one asset-token. Then
///             priceX18 = 1e18 * 10^(quoteDecimals - assetDecimals) * P.
///         The 10^(quoteDecimals - assetDecimals) factor converts between raw units:
///         1e18 raw asset = 1e18 / 10^assetDecimals asset-tokens, each worth P
///         quote-tokens, each worth 10^quoteDecimals raw quote.
///
///         The pool's sqrt price gives the raw-unit price, so `base` below already
///         implements that formula exactly: the raw price P_raw = P *
///         10^(quoteDecimals - assetDecimals), and base = 1e18 * P_raw. There is
///         NO further decimal scaling to apply. (An earlier version multiplied
///         `base` by 10^(quoteDecimals - assetDecimals) a second time, which
///         returned 0 for an 18-decimal asset in a 6-decimal quote — the ORBIO
///         pool priced at 0 — and inflated a 6-decimal asset in WETH by 1e12.
///         Both directions are covered by `TwapPriceMathDecimals.t.sol`.)
///
///         The pool's sqrt price gives P = sqrtPriceX96^2 / 2^192, i.e. currency1
///         per currency0. So when the asset is currency1, P = 1 / (sqrtP^2 / 2^192)
///         (the quote-per-asset price is the reciprocal); when the asset is currency0,
///         P = sqrtP^2 / 2^192 directly. The square is taken in `mulDiv` steps so no
///         intermediate overflows for any tick in range, mirroring `PolydashTwapFeed`.
///
///         The function never reverts: when it cannot produce a positive price (tick
///         out of range, the squared price underflowing to zero at an extreme tick,
///         or a zero result) it returns 0, and the calling feed turns that into its
///         own `PriceUnavailable` revert, so each feed keeps a single error type.
library TwapPriceMath {
    /// @notice Quote raw units per 1e18 raw units of the asset at `avgTick`, or 0
    ///         when no positive price can be produced at that tick. For an 18-decimal
    ///         quote (WETH) this is ETH wei per 1e18 raw asset.
    /// @param avgTick Time-weighted average tick over the TWAP window.
    /// @param assetIsCurrency0 True when the asset sorts below the quote (asset is
    ///        currency0 / token0); false when it sorts above (currency1 / token1).
    /// @dev The decimals play no role here: the pool price is in raw units, so the
    ///      raw-unit price already carries the decimal scaling. Callers that need a
    ///      WETH-denominated price for a non-WETH quote convert with a reference feed.
    function priceX18FromTick(int256 avgTick, bool assetIsCurrency0) internal pure returns (uint256 priceX18) {
        if (avgTick < TickMath.MIN_TICK || avgTick > TickMath.MAX_TICK) return 0;
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(int24(avgTick));
        uint256 s2 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
        if (s2 == 0) return 0;
        if (assetIsCurrency0) {
            // P = quote per asset = s2 / 2^96.
            priceX18 = Math.mulDiv(1e18, s2, 1 << 96);
        } else {
            // P = quote per asset = 2^96 / s2.
            priceX18 = Math.mulDiv(1e18, 1 << 96, s2);
        }
    }
}
