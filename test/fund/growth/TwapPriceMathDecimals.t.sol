// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {TwapPriceMath} from "src/fund/growth/TwapPriceMath.sol";

/// @notice Exposes the library for testing.
contract TwapPriceMathHarness {
    function priceX18FromTick(int256 avgTick, bool assetIsCurrency0)
        external
        pure
        returns (uint256)
    {
        return TwapPriceMath.priceX18FromTick(avgTick, assetIsCurrency0);
    }
}

/// @title TwapPriceMathDecimalsTest (diagnostic)
/// @notice Pins the decimal-scaling behaviour of `TwapPriceMath.priceX18FromTick`
///         for non-18-decimal quotes. The ORBIO V4 pool (tick 311593, asset
///         ORBIO 18 dec as currency1, quote USDG 6 dec) must price at ~29,700 raw
///         USDG per 1e18 raw ORBIO (the fork trade bought 3,370 ORBIO for 100 USDG,
///         i.e. 1 ORBIO = 0.0297 USDG). A 6-decimal asset in a WETH pool must price
///         at the same value before and after any fix (the 18/18 case is the
///         regression guard: POLYDASH tick 95112 is not used here; the guard is
///         that 18/18 is unchanged).
contract TwapPriceMathDecimalsTest is Test {
    TwapPriceMathHarness internal harness;

    function setUp() public {
        harness = new TwapPriceMathHarness();
    }

    function testOrbioTick() public view {
        uint256 p = harness.priceX18FromTick(311593, false);
        console2.log("ORBIO priceX18 (raw USDG per 1e18 ORBIO):", p);
        // 1 ORBIO = 0.0297 USDG = 29,700 raw USDG per 1e18 raw ORBIO.
        // Allow a wide band for the tick-vs-trade difference.
        assertGe(p, 25000, "ORBIO price far below trade-implied price");
        assertLe(p, 35000, "ORBIO price far above trade-implied price");
    }

    function testSixDecimalAssetInWeth() public view {
        // A 6-decimal asset at tick -69077: raw pool price 1.0001^-69077 ~ 0.001
        // raw WETH per raw asset, i.e. 1 token = 1e-9 WETH (the decimal gap
        // moves the token-unit price). priceX18 = 1e18 raw asset (= 1e12 tokens)
        // * 1e-9 WETH/token * 1e18 wei/WETH = 1e21 wei.
        uint256 p = harness.priceX18FromTick(-69077, false);
        console2.log("6-dec asset priceX18 (wei per 1e18 raw):", p);
        assertGe(p, 9e20, "6-dec asset price far below 1e21");
        assertLe(p, 11e20, "6-dec asset price far above 1e21");
    }

    function testEighteenEighteenUnchanged() public view {
        // POLYDASH-like: 18-dec asset, 18-dec quote, asset is currency1.
        // tick 95112 -> price ~7.4e13 wei per 1e18 raw asset (fork spot).
        uint256 p = harness.priceX18FromTick(95112, false);
        console2.log("18/18 priceX18:", p);
        assertGe(p, 7e13, "18/18 price far below fork spot");
        assertLe(p, 8e13, "18/18 price far above fork spot");
    }
}
