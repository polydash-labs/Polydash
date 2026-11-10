// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {GenericV4TwapFeed} from "../../../src/fund/growth/GenericV4TwapFeed.sol";
import {PolydashTwapFeed} from "../../../src/fund/growth/PolydashTwapFeed.sol";
import {IFundAllowlist} from "../../../src/fund/phase2/Interfaces.sol";

/// @notice Minimal PoolManager stand-in: only `extsload` is ever called (via StateLibrary).
contract MockPoolManager {
    bytes32 public slot0Word;

    function setTick(int24 tick) external {
        this.setSlot0(TickMath.getSqrtPriceAtTick(tick), tick, 0, 0x800000);
    }

    function setSlot0(uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) external {
        uint256 word = uint256(sqrtPriceX96);
        word |= (uint256(uint24(uint256(int256(tick)) & 0xffffff)) << 160);
        word |= (uint256(protocolFee) << 184);
        word |= (uint256(lpFee) << 208);
        slot0Word = bytes32(word);
    }

    function clearSlot0() external {
        slot0Word = bytes32(0);
    }

    function extsload(bytes32) external view returns (bytes32) {
        return slot0Word;
    }
}

contract MockToken {
    uint8 public immutable decimals;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }
}

/// @notice ABI-identical stand-in for FundAllowlist.AssetInit, so the integration
///         test can deploy the allowlist via `deployCode` without importing its
///         paris-restricted source into this cancun test file's import graph.
struct AllowAssetInit {
    address asset;
    bool quote;
    address feed;
    uint64 maxStale;
    uint256 minPriceX18;
    uint256 maxPriceX18;
}

contract GenericV4TwapFeedTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ---- live Robinhood Chain values (fork tests) ----
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant HOOK = 0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc;
    bytes32 constant POOL_ID = 0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5;
    /// @notice Fork tests pin this block (same pin as the Season 1 feed tests).
    uint256 constant PINNED_BLOCK = 110_526_007;
    /// @notice Spot priceX18 at PINNED_BLOCK, computed off-chain from the pool's
    ///         extsload slot0 word (tick 228076): 124,530,932 wei per 1e18 POLYDASH.
    uint256 constant SPOT_PRICEX18_AT_PINNED_BLOCK = 124_530_932;
    /// @notice Market reference 2026-11-09: POLYDASH ~$0.0000002704 at ETH ~$2,130,
    ///         i.e. priceX18 ~1.27e8.
    uint256 constant MARKET_REF_PRICEX18 = 127_000_000;

    MockPoolManager pm;
    address weth;
    address polydash;

    function setUp() public {
        vm.warp(1_000_000);
        pm = new MockPoolManager();
        address a = address(new MockToken(18));
        address b = address(new MockToken(18));
        (weth, polydash) = a < b ? (a, b) : (b, a);
        pm.setTick(228_076);
    }

    function _feed(address asset, address quote, uint32 window, uint32 maxAge) internal returns (GenericV4TwapFeed) {
        return new GenericV4TwapFeed(address(pm), asset, quote, address(0), 0x800000, 200, window, maxAge);
    }

    function _feedDefault() internal returns (GenericV4TwapFeed) {
        // 30-minute window, 30-minute max observation age (keeper pokes every 15 min).
        return _feed(polydash, weth, 30 minutes, 30 minutes);
    }

    /// @dev Independent conversion: ETH wei per 1e18 raw asset from a tick, for an
    ///      asset that is currency1 (price inverted) with the given decimals.
    function _priceFromTickCurrency1(int24 tick, uint8 assetDec, uint8 quoteDec) internal pure returns (uint256) {
        uint256 s2 = Math.mulDiv(TickMath.getSqrtPriceAtTick(tick), TickMath.getSqrtPriceAtTick(tick), 1 << 96);
        uint256 base = Math.mulDiv(1e18, 1 << 96, s2);
        return _scale(base, assetDec, quoteDec);
    }

    /// @dev Independent conversion for an asset that is currency0 (price direct).
    function _priceFromTickCurrency0(int24 tick, uint8 assetDec, uint8 quoteDec) internal pure returns (uint256) {
        uint256 s2 = Math.mulDiv(TickMath.getSqrtPriceAtTick(tick), TickMath.getSqrtPriceAtTick(tick), 1 << 96);
        uint256 base = Math.mulDiv(1e18, s2, 1 << 96);
        return _scale(base, assetDec, quoteDec);
    }

    function _scale(uint256 base, uint8 assetDec, uint8 quoteDec) internal pure returns (uint256) {
        if (quoteDec >= assetDec) return Math.mulDiv(base, 10 ** (quoteDec - assetDec), 1);
        return Math.mulDiv(base, 1, 10 ** (assetDec - quoteDec));
    }

    /// @dev ETH wei per 1e18 raw asset from an actual sqrt price (not a tick
    ///      boundary): 1e18 * 2^192 / sqrtP^2. The on-chain pool's sqrt price sits
    ///      inside its tick's range, so this differs from the tick-derived price
    ///      by under one tick (~0.001%) — the Season 1 spot constant is this value.
    function _priceFromSqrt(uint160 sqrtPriceX96) internal pure returns (uint256) {
        uint256 s2 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
        return Math.mulDiv(1e18, 1 << 96, s2);
    }

    /// @dev Poke until the feed has a full window of history at a constant tick.
    function _prime(GenericV4TwapFeed feed) internal {
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_accepts_either_currency_order() public {
        GenericV4TwapFeed f1 = _feedDefault();
        assertFalse(f1.assetIsCurrency0());
        assertEq(f1.asset(), polydash);
        assertEq(f1.quote(), weth);
        // Same pool, roles swapped: the feed now treats `weth` as the asset.
        GenericV4TwapFeed f2 = _feed(weth, polydash, 30 minutes, 30 minutes);
        assertTrue(f2.assetIsCurrency0());
        assertEq(f2.asset(), weth);
        assertEq(f2.quote(), polydash);
        assertEq(f2.poolId(), f1.poolId());
    }

    function test_constructor_reverts_zero_addresses_and_same_asset() public {
        vm.expectRevert(GenericV4TwapFeed.InvalidParams.selector);
        new GenericV4TwapFeed(address(0), polydash, weth, address(0), 0x800000, 200, 30 minutes, 10 minutes);
        vm.expectRevert(GenericV4TwapFeed.InvalidParams.selector);
        new GenericV4TwapFeed(address(pm), polydash, polydash, address(0), 0x800000, 200, 30 minutes, 10 minutes);
    }

    function test_constructor_reverts_bad_window_and_age() public {
        vm.expectRevert(GenericV4TwapFeed.InvalidParams.selector);
        new GenericV4TwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, 4 minutes, 4 minutes);
        vm.expectRevert(GenericV4TwapFeed.InvalidParams.selector);
        new GenericV4TwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, 30 minutes, 31 minutes);
    }

    function test_constructor_reverts_uninitialized_pool() public {
        pm.clearSlot0();
        vm.expectRevert(GenericV4TwapFeed.PriceUnavailable.selector);
        new GenericV4TwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, 30 minutes, 10 minutes);
    }

    function test_constructor_reverts_decimals_over_24() public {
        address weird = address(new MockToken(25));
        vm.expectRevert(GenericV4TwapFeed.InvalidParams.selector);
        new GenericV4TwapFeed(address(pm), weird, weth, address(0), 0x800000, 200, 30 minutes, 10 minutes);
    }

    // ------------------------------------------------------------------ currency ordering

    function test_currency1_price_is_inverted() public {
        GenericV4TwapFeed feed = _feedDefault();
        _prime(feed);
        (uint256 px,) = feed.latestPrice(polydash);
        assertEq(px, _priceFromTickCurrency1(228_076, 18, 18));
        // The mock pool sits exactly at the tick boundary, while the on-chain pool's
        // sqrt price sits inside tick 228076's range, so the two agree only to
        // within a tick (~0.001%); the fork test pins the exact on-chain value.
        assertApproxEqRel(px, SPOT_PRICEX18_AT_PINNED_BLOCK, 0.001e18);
    }

    function test_currency0_price_is_direct_and_reciprocal() public {
        // Same pool, asset = WETH (currency0): price is WETH per 1e18 raw WETH,
        // i.e. the reciprocal of the POLYDASH price at the same tick, in raw units.
        GenericV4TwapFeed feed = _feed(weth, polydash, 30 minutes, 30 minutes);
        _prime(feed);
        (uint256 px,) = feed.latestPrice(weth);
        assertEq(px, _priceFromTickCurrency0(228_076, 18, 18));
        // Reciprocal check: px(WETH per POLYDASH) * px(POLYDASH per WETH) == 1e36.
        uint256 other = _priceFromTickCurrency1(228_076, 18, 18);
        assertApproxEqRel(Math.mulDiv(px, other, 1e18), 1e18, 0.001e18);
    }

    function test_negative_tick_both_orderings() public {
        pm.setTick(-100_000);
        GenericV4TwapFeed f1 = _feedDefault();
        _prime(f1);
        (uint256 px1,) = f1.latestPrice(polydash);
        assertEq(px1, _priceFromTickCurrency1(-100_000, 18, 18));
        GenericV4TwapFeed f2 = _feed(weth, polydash, 30 minutes, 30 minutes);
        _prime(f2);
        (uint256 px2,) = f2.latestPrice(weth);
        assertEq(px2, _priceFromTickCurrency0(-100_000, 18, 18));
    }

    // ------------------------------------------------------------------ decimals

    function test_decimals_6_asset_18_quote() public {
        // 6-decimal asset, 18-decimal quote: 1e18 raw asset = 1e12 asset-tokens,
        // so priceX18 is 1e12x the 18/18 price at the same tick.
        address six = address(new MockToken(6));
        address eighteen = address(new MockToken(18));
        // Feed the 6-decimal token as the asset whichever side it sorts on.
        GenericV4TwapFeed feed =
            new GenericV4TwapFeed(address(pm), six, eighteen, address(0), 0x800000, 200, 30 minutes, 30 minutes);
        _prime(feed);
        (uint256 px,) = feed.latestPrice(six);
        uint256 expected =
            six < eighteen ? _priceFromTickCurrency0(228_076, 6, 18) : _priceFromTickCurrency1(228_076, 6, 18);
        assertEq(px, expected);
        assertEq(feed.assetDecimals(), 6);
        assertEq(feed.quoteDecimals(), 18);
        // Cross-check against the 18/18 price at the same tick, scaled by 1e12.
        uint256 base18 =
            six < eighteen ? _priceFromTickCurrency0(228_076, 18, 18) : _priceFromTickCurrency1(228_076, 18, 18);
        assertEq(px, base18 * 1e12);
    }

    function test_decimals_18_asset_6_quote() public {
        // 18-decimal asset, 6-decimal quote: priceX18 is 1e-12x the 18/18 price.
        address six = address(new MockToken(6));
        address eighteen = address(new MockToken(18));
        GenericV4TwapFeed feed =
            new GenericV4TwapFeed(address(pm), eighteen, six, address(0), 0x800000, 200, 30 minutes, 30 minutes);
        _prime(feed);
        (uint256 px,) = feed.latestPrice(eighteen);
        uint256 expected =
            eighteen < six ? _priceFromTickCurrency0(228_076, 18, 6) : _priceFromTickCurrency1(228_076, 18, 6);
        assertEq(px, expected);
        uint256 base18 =
            eighteen < six ? _priceFromTickCurrency0(228_076, 18, 18) : _priceFromTickCurrency1(228_076, 18, 18);
        assertEq(px, base18 / 1e12);
    }

    function test_decimals_6_6_same_scale() public {
        address a = address(new MockToken(6));
        address b = address(new MockToken(6));
        (address asset, address quote) = a < b ? (b, a) : (a, b);
        GenericV4TwapFeed feed =
            new GenericV4TwapFeed(address(pm), asset, quote, address(0), 0x800000, 200, 30 minutes, 30 minutes);
        _prime(feed);
        (uint256 px,) = feed.latestPrice(asset);
        uint256 expected =
            asset < quote ? _priceFromTickCurrency0(228_076, 6, 6) : _priceFromTickCurrency1(228_076, 6, 6);
        assertEq(px, expected);
    }

    // ------------------------------------------------------------------ inherited fail-closed behaviour

    function test_latestPrice_reverts_wrong_asset_no_poke_stale() public {
        GenericV4TwapFeed feed = _feedDefault();
        vm.expectRevert(GenericV4TwapFeed.WrongAsset.selector);
        feed.latestPrice(weth);
        vm.expectRevert(GenericV4TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(polydash);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 10 minutes);
        vm.expectRevert(GenericV4TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(polydash); // history spans only 10 of 30 minutes
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        (uint256 px,) = feed.latestPrice(polydash);
        assertEq(px, _priceFromTickCurrency1(228_076, 18, 18));
        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        vm.expectRevert(GenericV4TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(polydash); // newest observation 31 minutes old
    }

    function test_weighted_twap_interpolates_between_pokes() public {
        GenericV4TwapFeed feed = _feedDefault();
        int24 a = 200_000;
        int24 b = 210_000;
        pm.setTick(a);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        pm.setTick(b);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        (uint256 px,) = feed.latestPrice(polydash);
        assertEq(feed.twapTick(), (int256(a) + 2 * int256(b)) / 3);
        assertEq(px, _priceFromTickCurrency1(206_666, 18, 18));
    }

    function test_ring_buffer_wraps_after_32_observations() public {
        GenericV4TwapFeed feed = _feedDefault();
        uint256 t0 = vm.getBlockTimestamp();
        for (uint256 i; i < 40; ++i) {
            feed.poke();
            vm.warp(vm.getBlockTimestamp() + 1 minutes);
        }
        assertEq(feed.observationCount(), 40);
        GenericV4TwapFeed.Observation memory oldest = feed.observationAt(0);
        assertEq(oldest.timestamp, t0 + 8 minutes);
        (uint256 px,) = feed.latestPrice(polydash);
        assertEq(px, _priceFromTickCurrency1(228_076, 18, 18));
    }

    // ------------------------------------------------------------------ fork tests

    function _skipUnlessFork() internal {
        if (block.chainid != 4663) {
            vm.skip(true);
        }
    }

    function _forkFeed() internal returns (GenericV4TwapFeed) {
        return new GenericV4TwapFeed(PM, POLYDASH, WETH, HOOK, 0x800000, 200, 30 minutes, 30 minutes);
    }

    function test_fork_twap_matches_spot_and_market() public {
        _skipUnlessFork();
        GenericV4TwapFeed feed = _forkFeed();
        assertEq(feed.poolId(), POOL_ID);
        assertFalse(feed.assetIsCurrency0());
        assertEq(feed.assetDecimals(), 18);
        assertEq(feed.quoteDecimals(), 18);

        vm.expectRevert(GenericV4TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(POLYDASH);

        _prime(feed);
        (uint256 px, uint64 at) = feed.latestPrice(POLYDASH);
        assertEq(at, vm.getBlockTimestamp());

        PoolKey memory key = PoolKey(Currency.wrap(WETH), Currency.wrap(POLYDASH), 0x800000, 200, IHooks(HOOK));
        (uint160 sqrtP, int24 spotTick,,) = IPoolManager(PM).getSlot0(key.toId());
        uint256 spotPx = _priceFromSqrt(sqrtP);
        console2.log("spot tick", spotTick);
        console2.log("spot priceX18", spotPx);
        console2.log("twap priceX18", px);
        console2.log("sqrtP", sqrtP);

        assertEq(spotTick, 228_076);
        assertEq(spotPx, SPOT_PRICEX18_AT_PINNED_BLOCK);
        assertApproxEqRel(px, spotPx, 0.02e18); // TWAP within 2% of spot
        assertApproxEqRel(px, MARKET_REF_PRICEX18, 0.05e18); // within 5% of market ref

        vm.expectRevert(GenericV4TwapFeed.WrongAsset.selector);
        feed.latestPrice(WETH);
    }

    function test_fork_matches_season1_feed_with_identical_pokes() public {
        _skipUnlessFork();
        GenericV4TwapFeed generic = _forkFeed();
        PolydashTwapFeed season1 = new PolydashTwapFeed(PM, POLYDASH, WETH, HOOK, 0x800000, 200, 30 minutes, 30 minutes);
        assertEq(generic.poolId(), season1.poolId());
        generic.poke();
        season1.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        generic.poke();
        season1.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        (uint256 pxGeneric,) = generic.latestPrice(POLYDASH);
        (uint256 pxSeason1,) = season1.latestPrice(POLYDASH);
        // Same pool, same pokes, same window: the generalization must not move the
        // Season 1 price by even 1 wei.
        assertEq(pxGeneric, pxSeason1);
        assertEq(generic.twapTick(), season1.twapTick());
    }

    function test_fork_allowlist_accepts_feed() public {
        _skipUnlessFork();
        GenericV4TwapFeed feed = _forkFeed();

        AllowAssetInit[] memory assets = new AllowAssetInit[](2);
        assets[0] =
            AllowAssetInit({asset: WETH, quote: true, feed: address(0), maxStale: 0, minPriceX18: 0, maxPriceX18: 0});
        assets[1] = AllowAssetInit({
            asset: POLYDASH,
            quote: false,
            feed: address(feed),
            maxStale: 3600,
            minPriceX18: 60_000_000,
            maxPriceX18: 260_000_000
        });
        address allowAddr = deployCode(
            "src/fund/phase2/FundAllowlist.sol:FundAllowlist",
            abi.encode(address(this), uint256(1 days), new address[](0), assets)
        );
        IFundAllowlist allow = IFundAllowlist(allowAddr);

        vm.expectRevert(IFundAllowlist.PriceUnavailable.selector);
        allow.checkPrice(POLYDASH);

        _prime(feed);
        allow.checkPrice(POLYDASH);
        (uint256 px,) = feed.latestPrice(POLYDASH);
        assertEq(allow.quote(POLYDASH, 1e18), px);
        assertApproxEqRel(px, SPOT_PRICEX18_AT_PINNED_BLOCK, 0.02e18);
    }
}
