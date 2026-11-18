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

contract PolydashTwapFeedTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ---- live Robinhood Chain values (fork tests) ----
    address constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant HOOK = 0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc;
    bytes32 constant POOL_ID = 0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5;
    /// @notice Fork tests pin this block (observed 2026-11-09 ~17:56 PST via dRPC).
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

    function _feed(uint32 window, uint32 maxAge) internal returns (PolydashTwapFeed) {
        return new PolydashTwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, window, maxAge);
    }

    function _feedDefault() internal returns (PolydashTwapFeed) {
        // 30-minute window, 30-minute max observation age (keeper pokes every 15 min).
        return _feed(30 minutes, 30 minutes);
    }

    /// @dev Same two-step conversion as the feed, from a tick (independent of the feed contract).
    function _priceFromTick(int24 tick) internal pure returns (uint256) {
        return _priceFromSqrt(TickMath.getSqrtPriceAtTick(tick));
    }

    /// @dev ETH wei per 1e18 raw POLYDASH from a sqrt price: 1e18 * 2^192 / sqrtP^2.
    function _priceFromSqrt(uint160 sqrtPriceX96) internal pure returns (uint256) {
        uint256 s2 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
        return Math.mulDiv(1e18, 1 << 96, s2);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_reverts_zero_addresses() public {
        vm.expectRevert(PolydashTwapFeed.InvalidParams.selector);
        new PolydashTwapFeed(address(0), polydash, weth, address(0), 0x800000, 200, 30 minutes, 10 minutes);
        vm.expectRevert(PolydashTwapFeed.InvalidParams.selector);
        new PolydashTwapFeed(address(pm), address(0), weth, address(0), 0x800000, 200, 30 minutes, 10 minutes);
    }

    function test_constructor_reverts_wrong_currency_order() public {
        vm.expectRevert(PolydashTwapFeed.InvalidParams.selector);
        new PolydashTwapFeed(address(pm), weth, polydash, address(0), 0x800000, 200, 30 minutes, 10 minutes);
    }

    function test_constructor_reverts_bad_window_and_age() public {
        vm.expectRevert(PolydashTwapFeed.InvalidParams.selector);
        new PolydashTwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, 4 minutes, 4 minutes);
        vm.expectRevert(PolydashTwapFeed.InvalidParams.selector);
        new PolydashTwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, 30 minutes, 31 minutes);
        vm.expectRevert(PolydashTwapFeed.InvalidParams.selector);
        new PolydashTwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, 30 minutes, 30 seconds);
    }

    function test_constructor_reverts_uninitialized_pool() public {
        pm.clearSlot0();
        vm.expectRevert(PolydashTwapFeed.PriceUnavailable.selector);
        new PolydashTwapFeed(address(pm), polydash, weth, address(0), 0x800000, 200, 30 minutes, 10 minutes);
    }

    function test_constructor_reverts_non_18_decimals() public {
        // One side reports 6 decimals; whichever side it lands on, deploy reverts.
        address w = address(new MockToken(18));
        address p = address(new MockToken(6));
        address low;
        address high;
        (low, high) = w < p ? (w, p) : (p, w);
        vm.expectRevert(PolydashTwapFeed.InvalidParams.selector);
        new PolydashTwapFeed(address(pm), high, low, address(0), 0x800000, 200, 30 minutes, 10 minutes);
    }

    // ------------------------------------------------------------------ latestPrice gating

    function test_latestPrice_reverts_wrong_asset() public {
        PolydashTwapFeed feed = _feedDefault();
        vm.expectRevert(PolydashTwapFeed.WrongAsset.selector);
        feed.latestPrice(weth);
        vm.expectRevert(PolydashTwapFeed.WrongAsset.selector);
        feed.latestPrice(address(0x1234));
    }

    function test_latestPrice_reverts_before_any_poke() public {
        PolydashTwapFeed feed = _feedDefault();
        vm.expectRevert(PolydashTwapFeed.PriceUnavailable.selector);
        feed.latestPrice(polydash);
    }

    function test_latestPrice_reverts_insufficient_history() public {
        PolydashTwapFeed feed = _feedDefault();
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 10 minutes);
        // Observations span 10 minutes; the 30-minute window needs 30.
        vm.expectRevert(PolydashTwapFeed.PriceUnavailable.selector);
        feed.latestPrice(polydash);
    }

    function test_latestPrice_reverts_stale_observation() public {
        PolydashTwapFeed feed = _feed(30 minutes, 10 minutes); // maxObservationAge 10 minutes
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        // History spans the window, but the newest observation is 11 minutes old.
        vm.expectRevert(PolydashTwapFeed.PriceUnavailable.selector);
        feed.latestPrice(polydash);
    }

    // ------------------------------------------------------------------ TWAP math

    function test_constant_tick_twap_equals_spot() public {
        PolydashTwapFeed feed = _feedDefault();
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        (uint256 px, uint64 at) = feed.latestPrice(polydash);
        assertEq(at, vm.getBlockTimestamp());
        assertEq(px, _priceFromTick(228_076));
        // Independent anchor: on-chain spot at the pinned block was 124,530,932.
        assertApproxEqRel(px, SPOT_PRICEX18_AT_PINNED_BLOCK, 0.001e18);
        assertEq(feed.twapTick(), 228_076);
    }

    function test_weighted_twap_interpolates_between_pokes() public {
        PolydashTwapFeed feed = _feedDefault();
        int24 a = 200_000;
        int24 b = 210_000;
        pm.setTick(a);
        feed.poke(); // t0, tick a
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        pm.setTick(b);
        feed.poke(); // t0+20m, cumulative a*1200, tick b
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        // Window [t0+10m, t0+40m]: cumThen interpolates to a*600, cumNow = a*1200 + b*1200.
        // avgTick = (600a + 1200b) / 1800 = (a + 2b) / 3 = 206666 (truncated).
        (uint256 px,) = feed.latestPrice(polydash);
        assertEq(feed.twapTick(), (int256(a) + 2 * int256(b)) / 3);
        assertEq(px, _priceFromTick(206_666));
    }

    function test_negative_tick_twap() public {
        PolydashTwapFeed feed = _feedDefault();
        pm.setTick(-100_000);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 30 minutes);
        feed.poke();
        (uint256 px,) = feed.latestPrice(polydash);
        assertEq(px, _priceFromTick(-100_000));
        assertEq(feed.twapTick(), -100_000);
    }

    function test_spike_without_poke_is_ignored() public {
        PolydashTwapFeed feed = _feedDefault();
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        (uint256 before,) = feed.latestPrice(polydash);
        // 10x price spike (~23,026 ticks) with no poke: TWAP does not move at all.
        pm.setTick(228_076 + 23_026);
        (uint256 afterSpike,) = feed.latestPrice(polydash);
        assertEq(afterSpike, before);
        assertEq(feed.twapTick(), 228_076);
    }

    function test_spike_poked_once_moves_twap_only_slightly() public {
        PolydashTwapFeed feed = _feedDefault();
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        (uint256 before,) = feed.latestPrice(polydash);
        // Same 10x spike (tick up = POLYDASH cheaper in ETH), now poked, then read
        // 1 minute later: the spike occupies ~1/30 of the window, so the TWAP
        // moves down ~7-8%, not 10x.
        pm.setTick(228_076 + 23_026);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 1 minutes);
        (uint256 afterSpike,) = feed.latestPrice(polydash);
        assertLt(afterSpike, before);
        assertApproxEqRel(afterSpike, before, 0.1e18);
    }

    // ------------------------------------------------------------------ poke behaviour

    function test_poke_same_block_is_noop() public {
        PolydashTwapFeed feed = _feedDefault();
        feed.poke();
        feed.poke();
        assertEq(feed.observationCount(), 1);
        feed.poke();
        assertEq(feed.observationCount(), 1);
    }

    function test_poke_records_cumulative_and_tick() public {
        PolydashTwapFeed feed = _feedDefault();
        (uint64 t0, int256 c0, int24 tick0) = feed.poke();
        assertEq(t0, vm.getBlockTimestamp());
        assertEq(c0, 0);
        assertEq(tick0, 228_076);
        vm.warp(vm.getBlockTimestamp() + 10 minutes);
        pm.setTick(229_076);
        (uint64 t1, int256 c1, int24 tick1) = feed.poke();
        assertEq(t1, vm.getBlockTimestamp());
        assertEq(c1, int256(228_076) * 600); // prior tick accrued for 600s
        assertEq(tick1, 229_076);
        assertEq(feed.observationCount(), 2);
        PolydashTwapFeed.Observation memory o = feed.observationAt(0);
        assertEq(o.timestamp, t0);
        assertEq(o.tickCumulative, 0);
    }

    function test_poke_reverts_uninitialized_pool() public {
        PolydashTwapFeed feed = _feedDefault();
        feed.poke();
        pm.clearSlot0();
        vm.expectRevert(PolydashTwapFeed.PriceUnavailable.selector);
        feed.poke();
    }

    function test_ring_buffer_wraps_after_32_observations() public {
        PolydashTwapFeed feed = _feedDefault();
        uint256 t0 = vm.getBlockTimestamp();
        for (uint256 i; i < 40; ++i) {
            feed.poke();
            vm.warp(vm.getBlockTimestamp() + 1 minutes);
        }
        assertEq(feed.observationCount(), 40);
        // 40 pokes, ring holds 32: oldest held is the 9th poke (index 8), at t0 + 8 minutes.
        PolydashTwapFeed.Observation memory oldest = feed.observationAt(0);
        assertEq(oldest.timestamp, t0 + 8 minutes);
        // Window [now-30m, now] is fully covered by the 32 held observations.
        (uint256 px,) = feed.latestPrice(polydash);
        assertEq(px, _priceFromTick(228_076));
    }

    // ------------------------------------------------------------------ fork tests

    function _skipUnlessFork() internal {
        if (block.chainid != 4663) {
            vm.skip(true);
        }
    }

    function _forkFeed() internal returns (PolydashTwapFeed) {
        // Recommended deploy values: 30-minute window, 30-minute max observation age
        // (keeper pokes every 15 minutes, as the buyback keeper does).
        return new PolydashTwapFeed(PM, POLYDASH, WETH, HOOK, 0x800000, 200, 30 minutes, 30 minutes);
    }

    function test_fork_twap_matches_spot_and_market() public {
        _skipUnlessFork();
        // No block-number assertion here: on this Foundry version neither
        // `block.number` nor `vm.getBlockNumber()` reflects --fork-block-number
        // inside the test (both read 26,381,357 while the runner reports the fork
        // at 110,526,007). The pin is enforced by the CLI flags, and the spot
        // tick / spot price assertions below anchor the test to this block's
        // pool state: they fail loudly on any other block where the tick moved.
        PolydashTwapFeed feed = _forkFeed();
        assertEq(feed.poolId(), POOL_ID);
        assertEq(feed.twapWindow(), 30 minutes);
        assertEq(feed.maxObservationAge(), 30 minutes);

        vm.expectRevert(PolydashTwapFeed.PriceUnavailable.selector);
        feed.latestPrice(POLYDASH);

        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        (uint256 px, uint64 at) = feed.latestPrice(POLYDASH);
        assertEq(at, vm.getBlockTimestamp());

        // Spot from slot0 at the pinned block, converted independently of the feed.
        PoolKey memory key = PoolKey(Currency.wrap(WETH), Currency.wrap(POLYDASH), 0x800000, 200, IHooks(HOOK));
        (uint160 sqrtP, int24 spotTick,,) = IPoolManager(PM).getSlot0(key.toId());
        uint256 spotPx = _priceFromSqrt(sqrtP);
        console2.log("spot tick", spotTick);
        console2.log("spot priceX18", spotPx);
        console2.log("twap priceX18", px);
        console2.log("twap USD x 1e18 at ETH $2130", px * 2130); // ~2.65e11 = $0.000000265

        assertEq(spotTick, 228_076);
        assertEq(spotPx, SPOT_PRICEX18_AT_PINNED_BLOCK);
        assertApproxEqRel(px, spotPx, 0.02e18); // TWAP within 2% of spot
        assertApproxEqRel(px, MARKET_REF_PRICEX18, 0.05e18); // within 5% of market ref

        vm.expectRevert(PolydashTwapFeed.WrongAsset.selector);
        feed.latestPrice(WETH);
    }

    function test_fork_allowlist_accepts_feed() public {
        _skipUnlessFork();
        PolydashTwapFeed feed = _forkFeed();

        // Deployed via deployCode: importing FundAllowlist.sol (paris) into this
        // cancun test file's import graph is rejected by foundry's settings
        // restrictions, so the allowlist is deployed from its artifact and driven
        // through IFundAllowlist (unrestricted, in Interfaces.sol).
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

        // No observations yet: the allowlist treats the feed as price-unavailable.
        vm.expectRevert(IFundAllowlist.PriceUnavailable.selector);
        allow.checkPrice(POLYDASH);

        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);

        allow.checkPrice(POLYDASH);
        (uint256 px,) = feed.latestPrice(POLYDASH);
        assertEq(allow.quote(POLYDASH, 1e18), px);
        assertApproxEqRel(px, SPOT_PRICEX18_AT_PINNED_BLOCK, 0.02e18);
    }
}
