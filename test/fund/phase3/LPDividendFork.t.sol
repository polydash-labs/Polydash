// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolydashTwapFeed} from "src/fund/growth/PolydashTwapFeed.sol";
import {UniswapV4RouterAdapter} from "src/fund/growth/UniswapV4RouterAdapter.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";

/// @title LPDividendForkTest (not reviewed, not deployed)
/// @notice Fork test for Template #6 (LP-Dividend) against Robinhood Chain mainnet
///         state at a pinned block via dRPC. Nothing is deployed to mainnet.
///
///         Real legs: the V3 factory + liquidity facet + V3 vault are deployed on the
///         fork and wired to the LIVE allowlist, LIVE StrategyTemplate, and WETH. The
///         V3 contracts deploy from compiled artifacts (`deployCode`, not imported):
///         they compile under the `src/fund/phase3/**` paris restriction while the
///         growth feeds compile under cancun-min, and one test file cannot import both
///         groups — the same reason the Proposals fork test uses inline interfaces.
///
///         Flow: deploy V3 factory + fresh POLYDASH feed + V4 adapter -> prime the
///         feed -> allowlist POLYDASH + adapter (prank the allowlist owner, warp the
///         2-day timelock) -> publish the LP template [POLYDASH] -> create a V3 fund
///         -> mint skin + public -> enable investing -> buy POLYDASH -> wrap WETH ->
///         propose the POLYDASH/WETH LP (2-day wait) -> execute -> add REAL liquidity
///         to the REAL V4 pool via `modifyLiquidity` -> generate pool fees with a real
///         swap -> warp a week -> harvest real fees -> remove half the liquidity ->
///         holder exits during a second LP proposal wait -> safety checks proving the
///         live V2 factory, the live Phase 3 factory, and a live fund vault are
///         untouched.
///
///         Pinned block: 110620400 (same block the Proposals fork test uses; dRPC serves it).
///         Run: `forge test --match-path test/fund/phase3/LPDividendFork.t.sol -j 1 -vvv`
interface IFactoryPhase3V3 {
    struct Params {
        uint256 templateId;
        string name;
        string symbol;
        string imageUri;
        string baseURI;
        uint256 mintPrice;
        uint256 raiseCap;
        uint256 entryFeeBps;
        uint256 minSkinBps;
        uint256 raiseDuration;
    }

    function createFund(Params calldata p) external returns (address fund);
    function isFund(address fund) external view returns (bool);
    function allFundsLength() external view returns (uint256);
    function liquidityFacet() external view returns (address);
    function stakeFacet() external view returns (address);
    function poolManager() external view returns (address);
}

interface ITemplates {
    function publish(
        bytes32 mandateHash,
        string calldata mandateUri,
        address[] calldata assets,
        uint256 maxPositionBps,
        uint256 maxTradeBps,
        uint256 maxDeviationBps,
        uint256 hwmFeeBps,
        uint256 maxDrawdownBps,
        uint64 skinLock
    ) external returns (uint256 id);
    function owner() external view returns (address);
    function templateCount() external view returns (uint256);
}

interface IAllowlist {
    function proposeAsset(address asset, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)
        external
        returns (uint256 id);
    function propose(address target, bool isRouter, bool allowed) external returns (uint256 id);
    function execute(uint256 id) external;
    function assetAllowed(address asset) external view returns (bool);
    function routerAllowed(address router) external view returns (bool);
    function delay() external view returns (uint256);
    function owner() external view returns (address);
}

struct LpKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

interface IVaultPhase3V3 {
    function status() external view returns (uint8);
    function nft() external view returns (address);
    function enableInvesting() external;
    function swap(
        address router,
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external;
    function navPerNft() external view returns (uint256);
    function nav() external view returns (uint256);
    function lpValue() external view returns (uint256);
    function lpPoolId(LpKey calldata key) external view returns (bytes32);
    function lpApproved(bytes32 poolId) external view returns (bool);
    function lpCap(bytes32 poolId) external view returns (uint256);
    function lpPositions(bytes32 poolId)
        external
        view
        returns (
            address currency0,
            address currency1,
            uint24 fee,
            int24 tickSpacing,
            address hooks,
            int24 tickLower,
            int24 tickUpper,
            uint256 liquidity,
            uint256 amount0,
            uint256 amount1,
            uint256 feesHarvested0,
            uint256 feesHarvested1,
            uint64 lastHarvestAt,
            bool active
        );
    function stakeFacet() external view returns (address);
    function liquidityFacet() external view returns (address);
    function lpPoolManager() external view returns (address);
    function proposeLiquidity(
        LpKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint256 maxLpBps,
        string calldata reason,
        string calldata thesisUri
    ) external returns (uint256 id);
    function executeLiquidity(uint256 id) external;
    function addLiquidity(
        LpKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint256 liquidity,
        uint256 amount0Max,
        uint256 amount1Max
    ) external;
    function removeLiquidity(LpKey calldata key, uint256 liquidity, uint256 amount0Min, uint256 amount1Min) external;
    function harvestFees(LpKey calldata key) external returns (uint256 got0, uint256 got1);
    function distribute(uint256 amount) external returns (uint256 roundId);
    function claim(uint256[] calldata ids) external returns (uint256 paid);
}

interface INFTPhase3 {
    function mint(uint256 qty) external payable;
    function exit(uint256[] calldata ids) external;
    function vault() external view returns (address);
    function totalMinted() external view returns (uint256);
    function managerMinted() external view returns (uint256);
    function skinRequired() external view returns (uint256);
    function publicOpen() external view returns (bool);
    function outstanding() external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
}

interface IPoolManagerExtsload {
    function extsload(bytes32 slot) external view returns (bytes32);
}

interface IPhase5 {
    function factory() external view returns (address);
}

error NotManager();
error TooEarly();
error LpNotApproved();

contract LPDividendForkTest is Test {
    // Pinned fork block, Nov 14, 2026: every live contract the test reads must
    // already exist here. The old pin (110_620_400, Nov 10 ~03:25 PST) predates
    // the V2 factory deployment (Nov 10 ~07:15 PST), so the factory had no code
    // at that block and the safety baseline reverted. Current head at the time
    // of the pin: 114_878_942 (Nov 15 ~01:40 PST).
    uint256 constant FORK_BLOCK = 114_400_000;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant STAKING_FACTORY = 0x4C87aff7009DE1c58E052FEe202349a10b28Be9c;
    address constant LEGACY_STAKING_FACTORY = 0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0;
    address constant HOOK = 0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc;
    address constant TEMPLATES = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address constant OWNER = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    address constant PHASE5 = 0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81;
    address constant LIVE_FEED = 0x5FDE0DB5AAFa8E20E76ca0D763C2c3eD49Af84fC;
    address constant LIVE_FACTORY_P3 = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;
    address constant LIVE_FACTORY_V2 = 0xe50Da719947E83f316977d9c425DF95672E7B27e;
    // First live fund (Polycat Growth Fund, Phase 3 factory): WETH-only Template #1,
    // so its NAV is balance-based and stable across the test's warps.
    address constant LIVE_VAULT = 0x7d8d3308f54777f5b56FC3eFb2aFEfFE925DfDD2;

    uint64 constant MAX_STALE = 3600;
    uint256 constant MIN_PRICE_X18 = 60_000_000;
    uint256 constant MAX_PRICE_X18 = 260_000_000;

    PolydashTwapFeed feed;
    UniswapV4RouterAdapter adapter;
    address factoryV3;

    address manager = makeAddr("manager");
    address investor = makeAddr("investor");

    function setUp() public {
        vm.createSelectFork("https://robinhood.drpc.org", FORK_BLOCK);
        feed = new PolydashTwapFeed(POOL_MANAGER, POLYDASH, WETH, HOOK, 0x800000, 200, 1800, 1800);
        adapter = new UniswapV4RouterAdapter(POOL_MANAGER, WETH, POLYDASH, HOOK, 0x800000, 200);
        address facetV2 = deployCode("src/fund/phase3/FundSwapFacetPhase3V2.sol:FundSwapFacetPhase3V2");
        address facetLp = deployCode("src/fund/phase3/FundLiquidityFacetPhase3.sol:FundLiquidityFacetPhase3");
        factoryV3 = deployCode(
            "src/fund/phase3/FundFactoryPhase3V3.sol:FundFactoryPhase3V3",
            abi.encode(
                OWNER, ALLOWLIST, WETH, facetV2, facetLp, TEMPLATES, address(0), STAKING_FACTORY, LEGACY_STAKING_FACTORY, POLYDASH, POOL_MANAGER
            )
        );
        vm.deal(manager, 10 ether);
        vm.deal(investor, 10 ether);
        vm.deal(address(this), 10 ether);
    }

    function _pokeThrice() internal {
        // Poke BOTH feeds: the test's fresh `feed` (used by the step-1 TWAP
        // asserts) AND the live feed. The live allowlist reads the LIVE feed
        // for POLYDASH, so the vault's buy (via `checkPrice`) reverts
        // `PriceUnavailable` after the +2-day warps unless the live feed is
        // poked too — the fresh feed alone does not keep it fresh.
        feed.poke();
        PolydashTwapFeed(LIVE_FEED).poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
        PolydashTwapFeed(LIVE_FEED).poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
        PolydashTwapFeed(LIVE_FEED).poke();
    }

    function _slot0(bytes32 poolId)
        internal
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        // This PoolManager has no getSlot0/getLiquidity (verified on-chain);
        // read slot0 via extsload. The pools mapping is at slot 6; slot0 packs
        // sqrtPriceX96 (low 160 bits), tick (next 24, signed), protocolFee
        // (next 24), lpFee (next 24). Layout confirmed against the live pool:
        // tick 228816, lpFee 10000 (1.0%) at the pinned block.
        bytes32 raw = IPoolManagerExtsload(POOL_MANAGER).extsload(keccak256(abi.encode(poolId, uint256(6))));
        uint256 v = uint256(raw);
        sqrtPriceX96 = uint160(v);
        tick = int24(uint24(v >> 160));
        protocolFee = uint24(v >> 184);
        lpFee = uint24(v >> 208);
    }

    function _lpKey() internal pure returns (LpKey memory) {
        // WETH (0x0Bd7...) sorts below POLYDASH (0x3195...): currency0 is WETH.
        return LpKey({currency0: WETH, currency1: POLYDASH, fee: 0x800000, tickSpacing: 200, hooks: HOOK});
    }

    function _poolId(LpKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function test_fullLpLoop() public {
        // 0. Safety baseline: live factories and a live vault, before the V3 build touches anything.
        uint256 liveV2FundsBefore = IFactoryPhase3V3(LIVE_FACTORY_V2).allFundsLength();
        uint256 liveV3FundsBefore = IFactoryPhase3V3(LIVE_FACTORY_P3).allFundsLength();
        uint256 liveVaultNavBefore = IVaultPhase3V3(LIVE_VAULT).nav();
        uint256 liveVaultEthBefore = address(LIVE_VAULT).balance;
        assertTrue(IFactoryPhase3V3(factoryV3).liquidityFacet() != address(0));
        assertEq(IFactoryPhase3V3(factoryV3).stakeFacet(), address(0)); // no stake facet yet
        assertEq(IFactoryPhase3V3(factoryV3).poolManager(), POOL_MANAGER);

        // 1. Prime the POLYDASH TWAP feed (3 pokes, 15 minutes apart).
        _pokeThrice();
        (uint256 twapPrice,) = feed.latestPrice(POLYDASH);
        assertGt(twapPrice, MIN_PRICE_X18);
        assertLt(twapPrice, MAX_PRICE_X18);

        // 2. Allowlist POLYDASH + the V4 adapter (prank the owner, warp the timelock).
        assertEq(IAllowlist(ALLOWLIST).owner(), OWNER);
        vm.startPrank(OWNER);
        uint256 idPolydash;
        if (!IAllowlist(ALLOWLIST).assetAllowed(POLYDASH)) {
            idPolydash = IAllowlist(ALLOWLIST).proposeAsset(POLYDASH, address(feed), MAX_STALE, MIN_PRICE_X18, MAX_PRICE_X18);
        }
        uint256 idV4Router = IAllowlist(ALLOWLIST).propose(address(adapter), true, true);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + IAllowlist(ALLOWLIST).delay() + 1);
        if (idPolydash != 0) IAllowlist(ALLOWLIST).execute(idPolydash);
        IAllowlist(ALLOWLIST).execute(idV4Router);
        assertTrue(IAllowlist(ALLOWLIST).assetAllowed(POLYDASH));
        assertTrue(IAllowlist(ALLOWLIST).routerAllowed(address(adapter)));

        // 3. Publish the LP template: [POLYDASH], 80% max position, 10% max trade,
        //    5% deviation, 5% HWM fee, 20% drawdown brake, 30-day skin lock.
        address[] memory assets = new address[](1);
        assets[0] = POLYDASH;
        vm.prank(OWNER);
        uint256 templateId = ITemplates(TEMPLATES).publish(
            keccak256("lp-dividend-fork-mandate"), "ipfs://lp-dividend-fork", assets, 8000, 1000, 500, 500, 2000, 30 days
        );
        assertGt(templateId, 0);

        // 4. Create a V3 fund: 0.01 ETH mint, 0.1 ETH cap, 5% skin, 1h raise.
        vm.prank(manager);
        address nftAddr = IFactoryPhase3V3(factoryV3).createFund(
            IFactoryPhase3V3.Params({
                templateId: templateId,
                name: "LP Dividend Fund",
                symbol: "LPDIV",
                imageUri: "",
                baseURI: "",
                mintPrice: 0.01 ether,
                raiseCap: 0.1 ether,
                entryFeeBps: 0,
                minSkinBps: 500,
                raiseDuration: 1 hours
            })
        );
        address vaultAddr = INFTPhase3(nftAddr).vault();
        assertTrue(IFactoryPhase3V3(factoryV3).isFund(nftAddr));
        assertEq(INFTPhase3(nftAddr).skinRequired(), 1);
        assertEq(IVaultPhase3V3(vaultAddr).status(), 0); // Raising
        assertEq(IVaultPhase3V3(vaultAddr).stakeFacet(), address(0));

        // 5. Manager mints the 1 skin share; investor takes the rest.
        vm.prank(manager);
        INFTPhase3(nftAddr).mint{value: 0.01 ether}(1);
        assertTrue(INFTPhase3(nftAddr).publicOpen());
        vm.prank(investor);
        INFTPhase3(nftAddr).mint{value: 0.09 ether}(9);
        assertEq(INFTPhase3(nftAddr).totalMinted(), 10);
        assertEq(IVaultPhase3V3(vaultAddr).status(), 1); // RaisingClosed

        // 6. Manager enables investing.
        vm.prank(manager);
        IVaultPhase3V3(vaultAddr).enableInvesting();
        assertEq(IVaultPhase3V3(vaultAddr).status(), 2); // Investing

        // 7. The timelock warp staled the feed; refresh it, then buy POLYDASH
        //    (0.005 ETH) and wrap 0.005 WETH for the LP half.
        _pokeThrice();
        vm.prank(manager);
        IVaultPhase3V3(vaultAddr).swap(address(adapter), address(0), POLYDASH, 0.005 ether, 35_000e18, "");
        uint256 polydashBal = IERC20(POLYDASH).balanceOf(vaultAddr);
        assertGe(polydashBal, 35_000e18);
        vm.prank(manager);
        IVaultPhase3V3(vaultAddr).swap(address(0), address(0), WETH, 0.005 ether, 0.005 ether, "");
        assertEq(IERC20(WETH).balanceOf(vaultAddr), 0.005 ether);
        uint256 navBeforeLp = IVaultPhase3V3(vaultAddr).nav();
        assertGt(navBeforeLp, 0.09 ether);

        // 8. Read the pool's current tick and propose the LP around it (±5 ticks of
        //    spacing 200 = ±1000 ticks, a wide range).
        LpKey memory key = _lpKey();
        bytes32 poolId = _poolId(key);
        (, int24 tick,, uint24 lpFee) = _slot0(poolId);
        emit log_named_uint("pool lpFee", lpFee);
        int24 tickLower = ((tick / 200) - 5) * 200;
        int24 tickUpper = ((tick / 200) + 5) * 200;
        vm.prank(manager);
        uint256 lpId = IVaultPhase3V3(vaultAddr).proposeLiquidity(
            key, tickLower, tickUpper, 0, "POLYDASH/WETH earns trading fees", "ipfs://thesis-lp"
        );
        assertEq(lpId, 1);
        assertFalse(IVaultPhase3V3(vaultAddr).lpApproved(poolId));
        vm.prank(manager);
        vm.expectRevert(TooEarly.selector);
        IVaultPhase3V3(vaultAddr).executeLiquidity(lpId);

        // 9. Warp 2 days, execute, refresh the feed (the warp staled it).
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        IVaultPhase3V3(vaultAddr).executeLiquidity(lpId);
        assertTrue(IVaultPhase3V3(vaultAddr).lpApproved(poolId));
        assertEq(IVaultPhase3V3(vaultAddr).lpCap(poolId), 5000);
        _pokeThrice();

        // 10. Size the liquidity from the real pool price, using half the
        //     vault's WETH and the POLYDASH it holds. POLYDASH trades at
        //     ~8.65e9 per WETH, so the POLYDASH leg must be ~1e25 — the old
        //     20,000-POLYDASH (2e22) headroom was ~2e-6 ETH of dust and the
        //     position came out worth 4e12 wei, below the 0.001 ETH floor
        //     below. Size from the vault's real balances instead.
        (uint160 sqrtPriceX96,,,) = _slot0(poolId);
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        uint256 wethBal = IERC20(WETH).balanceOf(vaultAddr);
        uint256 pdBal = IERC20(POLYDASH).balanceOf(vaultAddr);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtA, sqrtB, wethBal / 2, pdBal
        );
        (uint256 amt0, uint256 amt1) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liquidity);
        assertGt(amt0, 0);
        assertGt(amt1, 0);
        assertLe(amt0, wethBal);
        assertLe(amt1, pdBal);
        emit log_named_uint("lp liquidity", liquidity);
        emit log_named_uint("lp amount0 WETH", amt0);
        emit log_named_uint("lp amount1 POLYDASH", amt1);
        vm.prank(manager);
        IVaultPhase3V3(vaultAddr).addLiquidity(
            key, tickLower, tickUpper, liquidity, (amt0 * 105) / 100, (amt1 * 105) / 100
        );
        (,,,,,,, uint256 liq, uint256 a0, uint256 a1,,,, bool active) =
            IVaultPhase3V3(vaultAddr).lpPositions(poolId);
        assertTrue(active);
        assertEq(liq, liquidity);
        assertGt(a0, 0);
        assertGt(a1, 0);
        uint256 lpVal = IVaultPhase3V3(vaultAddr).lpValue();
        assertGt(lpVal, 0.001 ether);
        emit log_named_uint("lp value after add", lpVal);
        // NAV barely moves on the add (tokens moved into the pool, not lost).
        uint256 navAfterAdd = IVaultPhase3V3(vaultAddr).nav();
        assertGe(navAfterAdd, (navBeforeLp * 99) / 100);

        // 11. Generate pool fees with a real swap, warp a week, harvest real fees.
        vm.prank(manager);
        IVaultPhase3V3(vaultAddr).swap(address(adapter), address(0), POLYDASH, 0.002 ether, 1, "");
        vm.warp(vm.getBlockTimestamp() + 7 days);
        _pokeThrice();
        vm.prank(manager);
        (uint256 got0, uint256 got1) = IVaultPhase3V3(vaultAddr).harvestFees(key);
        emit log_named_uint("harvested WETH", got0);
        emit log_named_uint("harvested POLYDASH", got1);
        // The swap in step 11 paid fees to our position — but only if the pool
        // charges a fee right now (dynamic-fee hook). When lpFee is 0 the harvest
        // is correctly zero; the end-to-end path is what this step proves.
        if (lpFee > 0) assertGt(got0 + got1, 0);

        // 12. Remove half the liquidity: principal comes back to the vault.
        (,,,,,,, uint256 liqBefore,,,,,,) = IVaultPhase3V3(vaultAddr).lpPositions(poolId);
        uint256 wethBefore = IERC20(WETH).balanceOf(vaultAddr);
        uint256 pdBefore = IERC20(POLYDASH).balanceOf(vaultAddr);
        vm.prank(manager);
        IVaultPhase3V3(vaultAddr).removeLiquidity(key, liqBefore / 2, 0, 0);
        (,,,,,,, uint256 liqAfter,,,,,,) = IVaultPhase3V3(vaultAddr).lpPositions(poolId);
        assertEq(liqAfter, liqBefore - liqBefore / 2);
        assertGt(IERC20(WETH).balanceOf(vaultAddr), wethBefore);
        assertGt(IERC20(POLYDASH).balanceOf(vaultAddr), pdBefore);

        // 13. A second LP proposal waits in public; the investor exits mid-wait.
        vm.prank(manager);
        uint256 lpId2 = IVaultPhase3V3(vaultAddr).proposeLiquidity(
            key, tickLower, tickUpper, 0, "Re-range the position", "ipfs://thesis-lp-2"
        );
        assertEq(lpId2, 2);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 2; // investor's first share (manager holds 1, investor holds 2..10)
        vm.prank(investor);
        INFTPhase3(nftAddr).exit(ids);
        assertEq(INFTPhase3(nftAddr).balanceOf(investor), 8);

        // 14. Safety: the live factories, the live vault, and the live fund set are untouched.
        assertEq(IFactoryPhase3V3(LIVE_FACTORY_V2).allFundsLength(), liveV2FundsBefore);
        assertEq(IFactoryPhase3V3(LIVE_FACTORY_P3).allFundsLength(), liveV3FundsBefore);
        assertEq(IVaultPhase3V3(LIVE_VAULT).nav(), liveVaultNavBefore);
        assertEq(address(LIVE_VAULT).balance, liveVaultEthBefore);
        assertFalse(IFactoryPhase3V3(LIVE_FACTORY_V2).isFund(nftAddr));
        assertFalse(IFactoryPhase3V3(LIVE_FACTORY_P3).isFund(nftAddr));
        assertEq(IPhase5(PHASE5).factory(), LIVE_FACTORY_P3);
        emit log_named_address("v3 factory", factoryV3);
        emit log_named_address("v3 fund nft", nftAddr);
        emit log_named_address("v3 vault", vaultAddr);
    }
}
