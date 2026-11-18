// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {UniswapV3TwapFeed} from "../../../src/fund/growth/UniswapV3TwapFeed.sol";

/// @notice Minimal V3 pool stand-in with faithful oracle semantics: observations are
///         written explicitly (as a swap/mint/burn would write them), `observe`
///         interpolates between bracketing observations, extrapolates past the newest
///         one at the current tick, and reverts "OLD" when the target predates the
///         oldest observation — the three behaviours the feed depends on.
contract MockV3Pool {
    address public token0;
    address public token1;
    uint24 public fee;
    uint128 public liquidity = 1e24;

    int24 public currentTick;
    bool public initialized = true;

    struct Obs {
        uint32 timestamp;
        int56 tickCumulative;
    }

    Obs[] public obsList;
    int56 internal _lastCumulative;
    int24 internal _lastTick;
    uint32 internal _lastTime;

    constructor(address _token0, address _token1, uint24 _fee, int24 _tick) {
        token0 = _token0;
        token1 = _token1;
        fee = _fee;
        currentTick = _tick;
        _lastTick = _tick;
        _lastTime = uint32(block.timestamp);
        obsList.push(Obs(uint32(block.timestamp), 0));
    }

    function setTick(int24 t) external {
        currentTick = t;
    }

    function setUninitialized() external {
        initialized = false;
    }

    /// @notice Record an observation at `block.timestamp`, accruing the cumulative
    ///         at the previously recorded tick since the previous observation.
    function writeObservation() external {
        uint32 now_ = uint32(block.timestamp);
        _lastCumulative += int56(int256(_lastTick) * int256(uint256(now_ - _lastTime)));
        _lastTime = now_;
        _lastTick = currentTick;
        obsList.push(Obs(now_, _lastCumulative));
    }

    function observationCount() external view returns (uint256) {
        return obsList.length;
    }

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
        )
    {
        sqrtPriceX96 = initialized ? TickMath.getSqrtPriceAtTick(currentTick) : 0;
        tick = currentTick;
        observationIndex = uint16(obsList.length - 1);
        observationCardinality = uint16(obsList.length);
        observationCardinalityNext = uint16(obsList.length);
        feeProtocol = 0;
        unlocked = true;
    }

    function observations(uint256 index)
        external
        view
        returns (
            uint32 blockTimestamp,
            int56 tickCumulative,
            uint160 secondsPerLiquidityCumulativeX128,
            bool isInitialized
        )
    {
        Obs memory o = obsList[index];
        return (o.timestamp, o.tickCumulative, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            tickCumulatives[i] = _cumulativeAt(uint32(block.timestamp) - secondsAgos[i]);
        }
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
    }

    function _cumulativeAt(uint32 target) internal view returns (int56) {
        if (target < obsList[0].timestamp) revert("OLD");
        uint256 n = obsList.length;
        if (target >= obsList[n - 1].timestamp) {
            return obsList[n - 1].tickCumulative
                + int56(int256(currentTick) * int256(uint256(target - obsList[n - 1].timestamp)));
        }
        for (uint256 i = 1; i < n; ++i) {
            if (target <= obsList[i].timestamp) {
                if (target == obsList[i].timestamp) return obsList[i].tickCumulative;
                Obs memory prev = obsList[i - 1];
                Obs memory cur = obsList[i];
                uint256 dt = uint256(cur.timestamp - prev.timestamp);
                uint256 elapsed = uint256(target - prev.timestamp);
                return prev.tickCumulative
                    + int56((int256(cur.tickCumulative - prev.tickCumulative) * int256(elapsed)) / int256(dt));
            }
        }
        revert("OLD");
    }
}

contract MockToken {
    uint8 public immutable decimals;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }
}

/// @notice Swap + mint + cardinality surface of a real V3 pool, used only by the fork test.
interface ISwapPool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256 amount0, uint256 amount1);
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

contract UniswapV3TwapFeedTest is Test {
    // ---- live Robinhood Chain values (fork tests) ----
    /// @notice WETH/RNJ V3 pool, fee 500. The largest WETH V3 pool found on-chain
    ///         (see the pool survey in the report): ~13.9 WETH + ~2.27e8 RNJ at the
    ///         pinned block, actively trading, fee 500. Cardinality is 1, so the
    ///         fork test grows the ring with real mints (swaps do not write
    ///         observations on this pool — see `_growRing`).
    address constant RNJ_POOL = 0x4d59CFd33331A4d9611274b5997099b57DDd445c;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant RNJ = 0x66e3F409c0bf871b26977a85f7287839748699dD;
    /// @notice Fork tests pin this block — the SAME pin as the Season 1 V4 feed
    ///         tests, so one fork run covers both suites:
    ///         `forge test --match-path test/fund/growth/* --fork-url
    ///         https://robinhood.drpc.org --fork-block-number 110526007 -vvv`
    ///         (the official public RPC cannot serve historical state; dRPC can).
    ///         Verified via dRPC 2026-11-09: slot0 tick 164249, liquidity 6.32e22,
    ///         WETH ~13.9, RNJ ~2.27e8, cardinality 1. The pool was created at
    ///         block 110516944, ~17 minutes before the pin. NOTE: this pool's
    ///         factory (0x1f7d7550B1b028f7571E69A784071F0205FD2EfA) is NOT the
    ///         canonical Uniswap V3 factory, and its swap does NOT write oracle
    ///         observations — the fork tests grow the ring with mints (see
    ///         `_growRing`), which do write observations on this pool.
    uint256 constant PINNED_BLOCK = 110_526_007;
    /// @notice Spot tick at PINNED_BLOCK (anchors the pin: fails on any other block
    ///         where the tick moved).
    int24 constant SPOT_TICK_AT_PINNED_BLOCK = 164_249;

    MockV3Pool pool;
    address tokenA;
    address tokenB;

    function setUp() public {
        // Unit tests run on a local chain: warp to a fixed time. Fork tests run
        // against real mainnet state, where the pool's observations carry real
        // 2026 timestamps — warping to 1,000,000 there would put `block.timestamp`
        // before every observation and make the feed fail closed forever.
        if (block.chainid != 4663) vm.warp(1_000_000);
        address a = address(new MockToken(18));
        address b = address(new MockToken(18));
        (tokenA, tokenB) = a < b ? (a, b) : (b, a);
        pool = new MockV3Pool(tokenA, tokenB, 3000, 100_000);
    }

    function _feed(address asset, address quote, uint32 window, uint32 maxAge) internal returns (UniswapV3TwapFeed) {
        return new UniswapV3TwapFeed(address(pool), asset, quote, window, maxAge);
    }

    function _feedDefault() internal returns (UniswapV3TwapFeed) {
        // 30-minute window, 30-minute max observation age.
        return _feed(tokenB, tokenA, 30 minutes, 30 minutes);
    }

    /// @dev Independent conversion: ETH wei per 1e18 raw asset from a tick, for an
    ///      asset that is token1 (price inverted) with the given decimals.
    function _priceFromTickToken1(int24 tick, uint8 assetDec, uint8 quoteDec) internal pure returns (uint256) {
        uint256 s2 = Math.mulDiv(TickMath.getSqrtPriceAtTick(tick), TickMath.getSqrtPriceAtTick(tick), 1 << 96);
        uint256 base = Math.mulDiv(1e18, 1 << 96, s2);
        return _scale(base, assetDec, quoteDec);
    }

    /// @dev Independent conversion for an asset that is token0 (price direct).
    function _priceFromTickToken0(int24 tick, uint8 assetDec, uint8 quoteDec) internal pure returns (uint256) {
        uint256 s2 = Math.mulDiv(TickMath.getSqrtPriceAtTick(tick), TickMath.getSqrtPriceAtTick(tick), 1 << 96);
        uint256 base = Math.mulDiv(1e18, s2, 1 << 96);
        return _scale(base, assetDec, quoteDec);
    }

    /// @dev The raw-unit pool price already carries the decimals (see
    ///      TwapPriceMath.priceX18FromTick): `priceX18` is quote raw units
    ///      per 1e18 raw asset units, so no extra scaling is applied here.
    ///      (An earlier version of this helper multiplied by
    ///      10^(quoteDec - assetDec), double-applying the scaling and
    ///      returning 0 for an 18-dec asset in a 6-dec quote and 1e12x too
    ///      much for a 6-dec asset in an 18-dec quote.)
    function _scale(uint256 base, uint8, uint8) internal pure returns (uint256) {
        return base;
    }

    /// @dev Give the mock pool a full window of history at a constant tick.
    function _prime() internal {
        pool.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        pool.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_accepts_either_token_order() public {
        UniswapV3TwapFeed f1 = _feedDefault();
        assertFalse(f1.assetIsToken0());
        assertEq(f1.asset(), tokenB);
        UniswapV3TwapFeed f2 = _feed(tokenA, tokenB, 30 minutes, 30 minutes);
        assertTrue(f2.assetIsToken0());
        assertEq(f2.poolFee(), 3000);
    }

    function test_constructor_reverts_wrong_pair() public {
        address stranger = address(new MockToken(18));
        vm.expectRevert(UniswapV3TwapFeed.InvalidParams.selector);
        new UniswapV3TwapFeed(address(pool), stranger, tokenA, 30 minutes, 30 minutes);
        vm.expectRevert(UniswapV3TwapFeed.InvalidParams.selector);
        new UniswapV3TwapFeed(address(pool), tokenA, stranger, 30 minutes, 30 minutes);
    }

    function test_constructor_reverts_zero_addresses_and_bad_window() public {
        vm.expectRevert(UniswapV3TwapFeed.InvalidParams.selector);
        new UniswapV3TwapFeed(address(0), tokenB, tokenA, 30 minutes, 30 minutes);
        vm.expectRevert(UniswapV3TwapFeed.InvalidParams.selector);
        new UniswapV3TwapFeed(address(pool), tokenA, tokenA, 30 minutes, 30 minutes);
        vm.expectRevert(UniswapV3TwapFeed.InvalidParams.selector);
        new UniswapV3TwapFeed(address(pool), tokenB, tokenA, 4 minutes, 4 minutes);
        vm.expectRevert(UniswapV3TwapFeed.InvalidParams.selector);
        new UniswapV3TwapFeed(address(pool), tokenB, tokenA, 30 minutes, 31 minutes);
    }

    function test_constructor_reverts_uninitialized_pool() public {
        pool.setUninitialized();
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        new UniswapV3TwapFeed(address(pool), tokenB, tokenA, 30 minutes, 30 minutes);
    }

    function test_constructor_reverts_decimals_over_24() public {
        address weird = address(new MockToken(25));
        MockV3Pool badPool = new MockV3Pool(tokenA, weird, 3000, 100_000);
        vm.expectRevert(UniswapV3TwapFeed.InvalidParams.selector);
        new UniswapV3TwapFeed(address(badPool), weird, tokenA, 30 minutes, 30 minutes);
    }

    // ------------------------------------------------------------------ TWAP math

    function test_constant_tick_twap_equals_spot_token1() public {
        UniswapV3TwapFeed feed = _feedDefault();
        _prime();
        (uint256 px, uint64 at) = feed.latestPrice(tokenB);
        assertEq(at, vm.getBlockTimestamp());
        assertEq(px, _priceFromTickToken1(100_000, 18, 18));
        assertEq(feed.twapTick(), 100_000);
        assertEq(feed.spotTick(), 100_000);
    }

    function test_constant_tick_twap_token0_is_direct() public {
        UniswapV3TwapFeed feed = _feed(tokenA, tokenB, 30 minutes, 30 minutes);
        _prime();
        (uint256 px,) = feed.latestPrice(tokenA);
        assertEq(px, _priceFromTickToken0(100_000, 18, 18));
        // Reciprocal check against the token1 price at the same tick.
        uint256 other = _priceFromTickToken1(100_000, 18, 18);
        assertApproxEqRel(Math.mulDiv(px, other, 1e18), 1e18, 0.001e18);
    }

    function test_weighted_twap_interpolates_between_observations() public {
        UniswapV3TwapFeed feed = _feedDefault();
        int24 a = 200_000;
        int24 b = 210_000;
        pool.setTick(a);
        pool.writeObservation(); // t0, tick a
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        pool.setTick(b);
        pool.writeObservation(); // t0+20m, cumulative a*1200, tick b
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        // Window [t0+10m, t0+40m]: cumThen interpolates to a*600, cumNow = a*1200 + b*1200.
        // avgTick = (600a + 1200b) / 1800 = (a + 2b) / 3 = 206666 (truncated).
        (uint256 px,) = feed.latestPrice(tokenB);
        assertEq(feed.twapTick(), (int256(a) + 2 * int256(b)) / 3);
        assertEq(px, _priceFromTickToken1(206_666, 18, 18));
    }

    function test_negative_tick_twap() public {
        pool.setTick(-100_000);
        UniswapV3TwapFeed feed = _feedDefault();
        _prime();
        (uint256 px,) = feed.latestPrice(tokenB);
        assertEq(px, _priceFromTickToken1(-100_000, 18, 18));
        assertEq(feed.twapTick(), -100_000);
    }

    function test_decimals_6_asset_18_quote() public {
        address six = address(new MockToken(6));
        address eighteen = address(new MockToken(18));
        MockV3Pool p = new MockV3Pool(six, eighteen, 3000, 100_000);
        UniswapV3TwapFeed feed = new UniswapV3TwapFeed(address(p), six, eighteen, 30 minutes, 30 minutes);
        p.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        p.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        (uint256 px,) = feed.latestPrice(six);
        uint256 expected = six < eighteen ? _priceFromTickToken0(100_000, 6, 18) : _priceFromTickToken1(100_000, 6, 18);
        assertEq(px, expected);
        assertEq(feed.assetDecimals(), 6);
        assertEq(feed.quoteDecimals(), 18);
    }

    function test_decimals_18_asset_6_quote() public {
        address six = address(new MockToken(6));
        address eighteen = address(new MockToken(18));
        MockV3Pool p = new MockV3Pool(six, eighteen, 3000, 100_000);
        UniswapV3TwapFeed feed = new UniswapV3TwapFeed(address(p), eighteen, six, 30 minutes, 30 minutes);
        p.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        p.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        (uint256 px,) = feed.latestPrice(eighteen);
        uint256 expected = eighteen < six ? _priceFromTickToken0(100_000, 18, 6) : _priceFromTickToken1(100_000, 18, 6);
        assertEq(px, expected);
    }

    // ------------------------------------------------------------------ fail closed

    function test_latestPrice_reverts_wrong_asset() public {
        UniswapV3TwapFeed feed = _feedDefault();
        _prime();
        vm.expectRevert(UniswapV3TwapFeed.WrongAsset.selector);
        feed.latestPrice(tokenA);
    }

    function test_latestPrice_reverts_insufficient_history() public {
        UniswapV3TwapFeed feed = _feedDefault();
        // Only the init observation exists: the 30-minute window start predates it,
        // so the pool's observe reverts OLD and the feed fails closed.
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(tokenB);
        pool.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 10 minutes);
        pool.writeObservation();
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(tokenB); // history spans 10 of 30 minutes
    }

    function test_latestPrice_reverts_stale_newest_observation() public {
        UniswapV3TwapFeed feed = new UniswapV3TwapFeed(address(pool), tokenB, tokenA, 30 minutes, 10 minutes);
        // Observations at t0, t0+20m, t0+25m; read at t0+30m: history spans the
        // 30-minute window and the newest observation is 5 minutes old.
        pool.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        pool.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 5 minutes);
        pool.writeObservation();
        vm.warp(vm.getBlockTimestamp() + 5 minutes);
        (uint256 px,) = feed.latestPrice(tokenB);
        assertEq(px, _priceFromTickToken1(100_000, 18, 18));
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        // History still spans the window, but the newest observation is 16 minutes old.
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(tokenB);
    }

    function test_latestPrice_reverts_uninitialized_pool() public {
        UniswapV3TwapFeed feed = _feedDefault();
        _prime();
        pool.setUninitialized();
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(tokenB);
    }

    function test_long_window_reverts_when_history_is_shorter() public {
        UniswapV3TwapFeed feed = new UniswapV3TwapFeed(address(pool), tokenB, tokenA, 24 hours, 24 hours);
        _prime();
        // 30 minutes of history cannot serve a 24-hour TWAP.
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(tokenB);
    }

    // ------------------------------------------------------------------ fork tests

    function _skipUnlessFork() internal {
        if (block.chainid != 4663) {
            vm.skip(true);
        }
    }

    /// @notice The V3 pool's swap callback: pay whatever the pool is owed.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (amount0Delta > 0) {
            IERC20(WETH).transfer(msg.sender, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            IERC20(RNJ).transfer(msg.sender, uint256(amount1Delta));
        }
    }

    /// @notice The V3 pool's mint callback: pay whatever the pool is owed.
    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external {
        if (amount0Owed > 0) {
            IERC20(WETH).transfer(msg.sender, amount0Owed);
        }
        if (amount1Owed > 0) {
            IERC20(RNJ).transfer(msg.sender, amount1Owed);
        }
    }

    /// @notice Mint a small in-range position. On this pool (Pons V1 factory, NOT the
    ///         canonical Uniswap V3 factory) a swap does NOT write an oracle observation —
    ///         verified by direct test at the pin: three swaps left cardinality at 1,
    ///         while one mint grew it to 7200. So the ring is grown with mints, not swaps.
    ///         The mint does not move the price; it only stamps an observation at the
    ///         current tick.
    function _mintObservation() internal {
        (, int24 tick,,,,,) = _slot0();
        // Tick spacing is 10: round the current tick down to a usable lower bound.
        int24 lower = (tick / 10) * 10 - 10;
        ISwapPool(RNJ_POOL).mint(address(this), lower, lower + 20, 100_000_000_000, "");
    }

    /// @notice Grow the oracle ring to 7200 and stamp three observations 15 minutes
    ///         apart, so a 30-minute TWAP becomes servable. Funds the mints with one
    ///         WETH->RNJ swap first (swaps move tokens fine; they just do not write
    ///         observations on this pool).
    function _growRing() internal {
        ISwapPool(RNJ_POOL).increaseObservationCardinalityNext(7200);
        vm.deal(address(this), 1 ether);
        (bool ok,) = WETH.call{value: 0.01 ether}(abi.encodeWithSignature("deposit()"));
        require(ok, "WETH deposit failed");
        _swapWethForRnj(1 ether); // exact-output: 1 RNJ, pays ~7.3e-8 ETH; funds the mints
        _mintObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        _mintObservation();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        _mintObservation();
    }

    function _swapWethForRnj(uint256 wethIn) internal {
        ISwapPool(RNJ_POOL)
            .swap(
                address(this),
                true, // zeroForOne: WETH (token0) -> RNJ (token1)
                -int256(wethIn),
                TickMath.MIN_SQRT_PRICE + 1,
                ""
            );
    }

    function test_fork_twap_matches_spot_after_growing_history() public {
        _skipUnlessFork();
        UniswapV3TwapFeed feed = new UniswapV3TwapFeed(RNJ_POOL, RNJ, WETH, 30 minutes, 30 minutes);
        assertFalse(feed.assetIsToken0()); // RNJ sorts above WETH: token1
        assertEq(feed.assetDecimals(), 18);
        assertEq(feed.quoteDecimals(), 18);
        assertEq(feed.poolFee(), 500);
        assertEq(feed.spotTick(), SPOT_TICK_AT_PINNED_BLOCK);

        // Live state at the pin: cardinality 1, one observation. A 30-minute TWAP
        // cannot be served yet — the feed fails closed instead of extrapolating.
        uint32 newest = feed.newestObservationTime();
        console2.log("newest observation age at pin (s)", vm.getBlockTimestamp() - newest);
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(RNJ);

        // Grow the ring (permissionless) and write real observations with real
        // mints on the real pool, 15 minutes apart. Fork state only; no mainnet tx.
        // Mints, not swaps: this pool's swap does not write oracle observations.
        _growRing();

        (uint256 px, uint64 at) = feed.latestPrice(RNJ);
        assertEq(at, vm.getBlockTimestamp());

        // Spot from slot0 at the pinned block, converted independently of the feed.
        (, int24 spotTick,,,,,) = _slot0();
        uint256 spotPx = _priceFromTickToken1(spotTick, 18, 18);
        console2.log("spot tick", spotTick);
        console2.log("twap tick", feed.twapTick());
        console2.log("spot priceX18", spotPx);
        console2.log("twap priceX18", px);
        assertApproxEqRel(px, spotPx, 0.02e18); // TWAP within 2% of spot

        vm.expectRevert(UniswapV3TwapFeed.WrongAsset.selector);
        feed.latestPrice(WETH);
    }

    function test_fork_fails_closed_when_stale() public {
        _skipUnlessFork();
        UniswapV3TwapFeed feed = new UniswapV3TwapFeed(RNJ_POOL, RNJ, WETH, 30 minutes, 30 minutes);
        _growRing();
        feed.latestPrice(RNJ); // fresh: works

        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        // No pool activity for 31 minutes: newest observation is stale.
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(RNJ);
    }

    function test_fork_long_window_reverts() public {
        _skipUnlessFork();
        // The pool is ~17 minutes old at the pin: a 24-hour TWAP has no history.
        UniswapV3TwapFeed feed = new UniswapV3TwapFeed(RNJ_POOL, RNJ, WETH, 24 hours, 24 hours);
        vm.expectRevert(UniswapV3TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(RNJ);
    }

    function _slot0()
        internal
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        (bool ok, bytes memory data) = RNJ_POOL.staticcall(abi.encodeWithSignature("slot0()"));
        require(ok, "slot0 failed");
        (
            sqrtPriceX96,
            tick,
            observationIndex,
            observationCardinality,
            observationCardinalityNext,
            feeProtocol,
            unlocked
        ) = abi.decode(data, (uint160, int24, uint16, uint16, uint16, uint8, bool));
    }
}
