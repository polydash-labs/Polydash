// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title TwapPriceMath (not reviewed, not deployed)
/// @notice Shared tick-to-`priceX18` conversion for the growth feeds. `priceX18` is ETH
///         wei per 1e18 raw units of the asset, where the quote is WETH (1 raw WETH = 1 wei).
///
///         Let P be the pool price of the asset in quote terms: P = quote-tokens per
///         one asset-token. Then
///             priceX18 = 1e18 * 10^(quoteDecimals - assetDecimals) * P.
///         The 10^(quoteDecimals - assetDecimals) factor converts between raw units:
///         1e18 raw asset = 1e18 / 10^assetDecimals asset-tokens, each worth P
///         quote-tokens, each worth 10^quoteDecimals raw quote (wei).
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
    /// @notice ETH wei per 1e18 raw units of the asset at `avgTick`, or 0 when no
    ///         positive price can be produced at that tick.
    /// @param avgTick Time-weighted average tick over the TWAP window.
    /// @param assetIsCurrency0 True when the asset sorts below the quote (asset is
    ///        currency0 / token0); false when it sorts above (currency1 / token1).
    /// @param assetDecimals `decimals()` of the asset, as read at deploy.
    /// @param quoteDecimals `decimals()` of the quote, as read at deploy.
    function priceX18FromTick(int256 avgTick, bool assetIsCurrency0, uint8 assetDecimals, uint8 quoteDecimals)
        internal
        pure
        returns (uint256 priceX18)
    {
        if (avgTick < TickMath.MIN_TICK || avgTick > TickMath.MAX_TICK) return 0;
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(int24(avgTick));
        uint256 s2 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
        if (s2 == 0) return 0;
        uint256 base;
        if (assetIsCurrency0) {
            // P = quote per asset = s2 / 2^96.
            base = Math.mulDiv(1e18, s2, 1 << 96);
        } else {
            // P = quote per asset = 2^96 / s2.
            base = Math.mulDiv(1e18, 1 << 96, s2);
        }
        uint256 scaleNum = 1;
        uint256 scaleDen = 1;
        if (quoteDecimals >= assetDecimals) {
            scaleNum = 10 ** (quoteDecimals - assetDecimals);
        } else {
            scaleDen = 10 ** (assetDecimals - quoteDecimals);
        }
        priceX18 = Math.mulDiv(base, scaleNum, scaleDen);
    }
}
