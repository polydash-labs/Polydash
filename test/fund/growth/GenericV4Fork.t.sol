// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GenericV4TwapFeed} from "../../../src/fund/growth/GenericV4TwapFeed.sol";
import {GenericV4RouterAdapter} from "../../../src/fund/growth/GenericV4RouterAdapter.sol";
import {UniswapV3TwapFeed} from "../../../src/fund/growth/UniswapV3TwapFeed.sol";

/// @title GenericV4ForkTest (not reviewed, not deployed)
/// @notice Fork integration for the GENERAL V4 fix: the generic V4 TWAP feed and the
///         generic V4 router adapter, against Robinhood Chain mainnet state via dRPC.
///         Nothing is deployed to mainnet; everything below happens on the fork.
///         For each token (TIBBIR, TORCH, FOBO, HOOKR) the loop is:
///           1. Deploy the generic feed for the token's real V4 pool (no new feed
///              contract per token — the same GenericV4TwapFeed, new constructor args).
///           2. Poke it thrice (15 min apart) so it spans its 30-minute TWAP window;
///              read a live TWAP and check it sits in a sensible band for the pool.
///           3. Prank the allowlist owner: proposeAsset(token, feed, ...) + propose
///              the generic adapter as a router; warp past the 2-day timelock; execute.
///           4. Re-poke (the 2-day warp staled the observations), then buy and sell
///              through the generic adapter on the real pool; assert the output is
///              near the feed-implied amount, with the tax accounted for (TORCH ~2%
///              buy tax, FOBO ~2.5% hook tax).
///         HOOKR is the generality proof: a real V4 token that is NOT one of the four
///         blocked tokens. Onboarding it needs only a feed deploy + a proposeAsset
///         call — no new contracts — and the test additionally runs it through a
///         full fund (template + fund + vault buy/sell via the facet) to prove the
///         facet path.
///         ORBIO is the USDG-quote test case: its feed converts through the USDG/WETH
///         V3 reference pool so the returned price stays WETH-denominated. The
///         adapter cannot trade ORBIO from a WETH vault (it would need a USDG
///         holding or a two-hop), so ORBIO is feed + allowlist only here.
///         The feed also fails closed: after the observations go stale,
///         latestPrice reverts instead of returning a stale price.
///         Fork: dRPC at latest by default (dRPC serves no historical state).
///         Override with FORK_RPC / FORK_BLOCK (a very recent block on the official
///         RPC, which prunes fast). The pinned blocks in older fork tests
///         (110526500) are no longer served.
///         Run: `forge test --match-path test/fund/growth/GenericV4Fork.t.sol -j 1 -vvv`
interface IFactoryPhase3 {
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

interface IVaultPhase3 {
    function status() external view returns (uint8);
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
}

interface INFTPhase3 {
    function mint(uint256 qty) external payable;
    function vault() external view returns (address);
    function totalMinted() external view returns (uint256);
    function managerMinted() external view returns (uint256);
    function skinRequired() external view returns (uint256);
    function publicOpen() external view returns (bool);
}

contract GenericV4ForkTest is Test {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address constant TEMPLATES = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address constant FACTORY = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;
    address constant OWNER = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    // USDG/WETH V3 pool, fee 100 — deepest USDG/WETH reference (see report).
    address constant USDG_WETH_V3_POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;

    address constant TIBBIR = 0x4db7374E966097be94C6680d49156D580F097Bbf;
    address constant TORCH = 0x000050E18ffa3F8F7aD170Eb9CeF160eb3Ed1111;
    address constant FOBO = 0x000DE658153f47f23e92973C8EB1e89762703676;
    address constant ORBIO = 0xAa07A0e9209e16aC99708C3EC70159c6eF3128A3;
    address constant HOOKR = 0x18E674231A58c239Dc7DaeDcffE15Ec3A24cff5c;

    address constant TIBBIR_HOOK = 0x88e5d1cf9907acD48E7C81ff6eBC088aD358a5cc;
    address constant FOBO_HOOK = 0x0Af57F62982D03066ef917AcAd87F771c06528Ec;

    uint32 constant TWAP_WINDOW = 1800;
    uint32 constant MAX_OBS_AGE = 1800;
    uint64 constant MAX_STALE = 3600;

    GenericV4RouterAdapter adapter;
    address manager = makeAddr("manager");
    address investor = makeAddr("investor");

    // The test contract receives ETH from sells (adapter-direct and vault sells).
    receive() external payable {}

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string("https://robinhood.drpc.org"));
        uint256 blockNum = vm.envOr("FORK_BLOCK", uint256(0));
        if (blockNum == 0) {
            vm.createSelectFork(rpc);
        } else {
            vm.createSelectFork(rpc, blockNum);
        }
        adapter = new GenericV4RouterAdapter(POOL_MANAGER, WETH);
        vm.deal(address(this), 100 ether);
        vm.deal(manager, 10 ether);
        vm.deal(investor, 10 ether);
    }

    // ------------------------------------------------------------------ helpers

    /// @notice Three pokes 15 minutes apart, so observations span the 30-minute TWAP window.
    function _pokeThrice(GenericV4TwapFeed feed) internal {
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
    }

    /// @notice Deploy a generic feed for an ETH-quoted pool.
    function _ethFeed(address asset, address hook, uint24 fee, int24 tickSpacing)
        internal
        returns (GenericV4TwapFeed)
    {
        return new GenericV4TwapFeed(
            POOL_MANAGER, asset, address(0), hook, fee, tickSpacing, TWAP_WINDOW, MAX_OBS_AGE, WETH, address(0)
        );
    }

    /// @notice `data` for the generic adapter: the pool key for an ETH-quoted pool.
    function _ethData(uint24 fee, int24 tickSpacing, address hook) internal pure returns (bytes memory) {
        return abi.encode(address(0), fee, tickSpacing, hook, uint160(0));
    }

    /// @notice Queue + execute the asset + router proposals on the fork. The band is
    ///         set from the live feed price so it always brackets the TWAP.
    function _allowlist(address asset, address feed, uint256 priceX18) internal {
        uint256 minPx = priceX18 / 2;
        uint256 maxPx = priceX18 * 2;
        vm.startPrank(OWNER);
        uint256 idAsset = IAllowlist(ALLOWLIST).proposeAsset(asset, feed, MAX_STALE, minPx, maxPx);
        uint256 idRouter = IAllowlist(ALLOWLIST).propose(address(adapter), true, true);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + IAllowlist(ALLOWLIST).delay() + 1);
        IAllowlist(ALLOWLIST).execute(idAsset);
        IAllowlist(ALLOWLIST).execute(idRouter);
        assertTrue(IAllowlist(ALLOWLIST).assetAllowed(asset), "asset should be allowlisted");
        assertTrue(IAllowlist(ALLOWLIST).routerAllowed(address(adapter)), "adapter should be an allowed router");
    }

    /// @notice Buy `amountIn` ETH of `asset` through the generic adapter and sell half
    ///         back. `priceX18` is the feed TWAP (wei per 1e18 raw asset). Returns the
    ///         amount bought. `taxBps` is the expected output-side tax (0, 200, 250).
    function _buyAndSell(address asset, bytes memory data, uint256 priceX18, uint256 taxBps)
        internal
        returns (uint256 bought)
    {
        uint256 amountIn = 0.01 ether;
        uint256 expectedOut = (amountIn * 1e18) / priceX18;
        // Floor at 80% of the feed-implied output: covers slippage on these thin
        // pools plus the output-side tax. The adapter measures what arrived.
        uint256 minOut = (expectedOut * 80) / 100;
        bought = adapter.swap{value: amountIn}(address(0), asset, amountIn, minOut, data);
        assertGe(bought, minOut, "buy output below floor");
        assertLe(bought, (expectedOut * 105) / 100, "buy output above spot-implied");
        // The tax shows up as a shortfall vs the clean spot-implied amount.
        uint256 expectedAfterTax = (expectedOut * (10_000 - taxBps)) / 10_000;
        assertGe(bought, (expectedAfterTax * 90) / 100, "buy output below tax-adjusted floor");
        emit log_named_uint("bought (raw)", bought);
        emit log_named_uint("expectedOut (raw)", expectedOut);

        // Sell half back for ETH. Prefund the adapter (ERC20 inputs are pulled
        // from the adapter's own balance).
        uint256 sellAmount = bought / 2;
        IERC20(asset).transfer(address(adapter), sellAmount);
        uint256 expectedEth = (sellAmount * priceX18) / 1e18;
        uint256 minEth = (expectedEth * 80) / 100;
        uint256 ethBefore = address(this).balance;
        uint256 gotEth = adapter.swap(asset, address(0), sellAmount, minEth, data);
        assertGe(gotEth, minEth, "sell ETH below floor");
        assertLe(gotEth, (expectedEth * 105) / 100, "sell ETH above spot-implied");
        assertEq(address(this).balance, ethBefore + gotEth, "ETH should arrive");
        emit log_named_uint("sold for ETH (wei)", gotEth);
    }

    // ------------------------------------------------------------------ TIBBIR

    function test_tibbir_feed_and_adapter() public {
        GenericV4TwapFeed feed = _ethFeed(TIBBIR, TIBBIR_HOOK, 3000, 60);
        _pokeThrice(feed);
        (uint256 px,) = feed.latestPrice(TIBBIR);
        emit log_named_uint("TIBBIR TWAP priceX18", px);
        assertGt(px, 1e13);
        assertLt(px, 1e15);
        _allowlist(TIBBIR, address(feed), px);
        _pokeThrice(feed);
        (px,) = feed.latestPrice(TIBBIR);
        _buyAndSell(TIBBIR, _ethData(3000, 60, TIBBIR_HOOK), px, 0);
    }

    // ------------------------------------------------------------------ TORCH (2% buy tax)

    function test_torch_feed_and_adapter() public {
        GenericV4TwapFeed feed = _ethFeed(TORCH, address(0), 3000, 60);
        _pokeThrice(feed);
        (uint256 px,) = feed.latestPrice(TORCH);
        emit log_named_uint("TORCH TWAP priceX18", px);
        // Tick 132072 => ~545,000 TORCH per ETH => ~1.84e12 wei per 1e18 TORCH.
        // (An earlier probe mis-reported this as 1.84e9; the tick-implied price
        // and this feed agree at ~1.84e12.)
        assertGt(px, 1e11);
        assertLt(px, 1e13);
        _allowlist(TORCH, address(feed), px);
        _pokeThrice(feed);
        (px,) = feed.latestPrice(TORCH);
        // 200 bps: the buy tax. The adapter returns the measured (post-tax) amount.
        _buyAndSell(TORCH, _ethData(3000, 60, address(0)), px, 200);
    }

    // ------------------------------------------------------------------ FOBO (2.5% hook tax)

    function test_fobo_feed_and_adapter() public {
        GenericV4TwapFeed feed = _ethFeed(FOBO, FOBO_HOOK, 0, 60);
        _pokeThrice(feed);
        (uint256 px,) = feed.latestPrice(FOBO);
        emit log_named_uint("FOBO TWAP priceX18", px);
        // Tick 138181 => ~1,000,000 FOBO per ETH => ~9.8e11 wei per 1e18 FOBO.
        // (An earlier probe mis-reported this as 9.98e8; the tick-implied price
        // and this feed agree at ~9.8e11.)
        assertGt(px, 1e11);
        assertLt(px, 1e13);
        _allowlist(FOBO, address(feed), px);
        _pokeThrice(feed);
        (px,) = feed.latestPrice(FOBO);
        // 250 bps: the hook tax, already netted in the pool's BalanceDelta.
        _buyAndSell(FOBO, _ethData(0, 60, FOBO_HOOK), px, 250);
    }

    // ------------------------------------------------------------------ HOOKR (generality proof)

    function test_hookr_generality_proof() public {
        // A real V4 token that is NOT one of the four: onboarding it needs only
        // a feed deploy + a proposeAsset call. No new contracts.
        GenericV4TwapFeed feed = _ethFeed(HOOKR, address(0), 2500, 25);
        _pokeThrice(feed);
        (uint256 px,) = feed.latestPrice(HOOKR);
        emit log_named_uint("HOOKR TWAP priceX18", px);
        assertGt(px, 1e12);
        assertLt(px, 1e14);
        _allowlist(HOOKR, address(feed), px);
        _pokeThrice(feed);
        (px,) = feed.latestPrice(HOOKR);
        _buyAndSell(HOOKR, _ethData(2500, 25, address(0)), px, 0);
    }

    /// @notice The same HOOKR onboarding, run through a full fund: template + fund +
    ///         vault buy/sell via the facet and the generic adapter. Proves the facet
    ///         path (data passed verbatim) end to end.
    function test_hookr_full_fund_loop() public {
        GenericV4TwapFeed feed = _ethFeed(HOOKR, address(0), 2500, 25);
        _pokeThrice(feed);
        (uint256 px,) = feed.latestPrice(HOOKR);
        assertGt(px, 1e12);
        assertLt(px, 1e14);
        _allowlist(HOOKR, address(feed), px);

        // Publish a template with [HOOKR]. The factory requires the asset to be
        // allowlisted with a feed first (done above).
        address[] memory assets = new address[](1);
        assets[0] = HOOKR;
        vm.prank(OWNER);
        uint256 templateId = ITemplates(TEMPLATES).publish(
            keccak256("generic-v4-hookr-mandate"), "ipfs://generic-v4-hookr", assets, 8000, 1000, 500, 500, 2000, 30 days
        );

        // Create a small fund and fund it.
        vm.prank(manager);
        address nftAddr = IFactoryPhase3(FACTORY).createFund(
            IFactoryPhase3.Params({
                templateId: templateId,
                name: "HOOKR Test Fund",
                symbol: "HKRT",
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
        vm.prank(manager);
        INFTPhase3(nftAddr).mint{value: 0.01 ether}(1);
        vm.prank(investor);
        INFTPhase3(nftAddr).mint{value: 0.09 ether}(9);
        vm.prank(manager);
        IVaultPhase3(vaultAddr).enableInvesting();
        assertEq(IVaultPhase3(vaultAddr).status(), 2); // Investing

        // The timelock warp staled the feed; re-poke for a fresh TWAP.
        _pokeThrice(feed);
        (px,) = feed.latestPrice(HOOKR);

        // Buy HOOKR with 0.005 ETH through the vault + facet + generic adapter.
        uint256 amountIn = 0.005 ether;
        uint256 expectedOut = (amountIn * 1e18) / px;
        uint256 minOut = (expectedOut * 80) / 100;
        vm.prank(manager);
        IVaultPhase3(vaultAddr).swap(
            address(adapter), address(0), HOOKR, amountIn, minOut, _ethData(2500, 25, address(0))
        );
        uint256 hookrBal = IERC20(HOOKR).balanceOf(vaultAddr);
        assertGe(hookrBal, minOut, "vault should hold HOOKR after the buy");
        emit log_named_uint("vault HOOKR after buy", hookrBal);
        emit log_named_uint("vault navPerNft after buy", IVaultPhase3(vaultAddr).navPerNft());

        // Sell half back for ETH.
        uint256 sellAmount = hookrBal / 2;
        uint256 expectedEth = (sellAmount * px) / 1e18;
        uint256 minEth = (expectedEth * 80) / 100;
        uint256 ethBefore = address(vaultAddr).balance;
        vm.prank(manager);
        IVaultPhase3(vaultAddr).swap(
            address(adapter), HOOKR, address(0), sellAmount, minEth, _ethData(2500, 25, address(0))
        );
        assertLt(IERC20(HOOKR).balanceOf(vaultAddr), hookrBal, "vault HOOKR should fall after the sell");
        assertGt(address(vaultAddr).balance, ethBefore, "vault ETH should rise after the sell");
        emit log_named_uint("vault HOOKR after sell", IERC20(HOOKR).balanceOf(vaultAddr));
    }

    // ------------------------------------------------------------------ ORBIO (USDG quote)

    function test_orbio_usdg_feed() public {
        // Reference: USDG/WETH V3 feed on the fee-100 pool. The V3 feed reads the
        // pool's own observations, so it needs no poking — but its staleness check
        // is against the pool's newest observation, which does NOT advance during
        // this test's artificial time warps (no real trading happens in warped
        // time). The ORBIO feed's TWAP needs 30 minutes of pokes (an 1800s warp),
        // which alone would stale a 30-minute reference. So the reference here
        // uses a 6-hour TWAP window and 6-hour max observation age — long enough
        // to survive the poke warp, short enough that the 2-day timelock warp
        // still stales it (proving fail-closed below). The 6-hour window does not
        // change the conversion math under test: USDG/WETH is a stable pair, and
        // the reference price is the same to within a basis point either way.
        // In production the reference uses a 30-minute window and stays fresh
        // because the USDG/WETH pool trades continuously.
        UniswapV3TwapFeed ref =
            new UniswapV3TwapFeed(USDG_WETH_V3_POOL, USDG, WETH, 21_600, 21_600);
        (uint256 refPx,) = ref.latestPrice(USDG);
        emit log_named_uint("USDG/WETH reference priceX18 (wei per 1e18 raw USDG)", refPx);
        assertGt(refPx, 0);

        // Generic V4 feed for the USDG-quoted ORBIO pool, converting through the reference.
        GenericV4TwapFeed feed = new GenericV4TwapFeed(
            POOL_MANAGER, ORBIO, USDG, address(0), 8000, 80, TWAP_WINDOW, MAX_OBS_AGE, WETH, address(ref)
        );
        _pokeThrice(feed);
        (uint256 px,) = feed.latestPrice(ORBIO);
        emit log_named_uint("ORBIO TWAP priceX18 (WETH wei per 1e18 ORBIO)", px);
        // ~0.03 USDG per ORBIO at ~$2,000/WETH => ~1.4e13 wei per 1e18 ORBIO.
        // The conversion is proven here, while the reference is fresh.
        assertGt(px, 1e11);
        assertLt(px, 1e14);
        _allowlist(ORBIO, address(feed), px);

        // After the 2-day timelock warp the reference is stale: the USDG/WETH
        // pool's newest observation is 2 days old (no real trading happens in
        // this test's warped time), so the reference reverts and the ORBIO feed
        // fails closed rather than converting with a stale rate. That is the
        // intended behavior, not a bug — in production the USDG/WETH pool trades
        // continuously, so the reference stays fresh with a 30-minute bound, and
        // the ORBIO feed only goes stale if that pool ever goes quiet for >30 min.
        // Re-poking the ORBIO feed itself still works (poke reads the V4 pool's
        // slot0, not the reference); only the price read fails closed.
        _pokeThrice(feed);
        vm.expectRevert(GenericV4TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(ORBIO);
        // No adapter trade here: the ORBIO pool is USDG-quoted and the vault holds
        // only ETH/WETH, so a buy would need a USDG holding or a two-hop. The
        // feed + allowlist path is the USDG-quote proof.
    }

    // ------------------------------------------------------------------ fail closed

    function test_feed_fails_closed_on_stale_observations() public {
        GenericV4TwapFeed feed = _ethFeed(TIBBIR, TIBBIR_HOOK, 3000, 60);
        _pokeThrice(feed);
        (uint256 px,) = feed.latestPrice(TIBBIR);
        assertGt(px, 0);
        // Warp past maxObservationAge (30 min) with no new poke: the feed must
        // revert rather than return a stale price.
        vm.warp(vm.getBlockTimestamp() + MAX_OBS_AGE + 1);
        vm.expectRevert(GenericV4TwapFeed.PriceUnavailable.selector);
        feed.latestPrice(TIBBIR);
        // A fresh poke restores it.
        feed.poke();
        (px,) = feed.latestPrice(TIBBIR);
        assertGt(px, 0);
    }
}
