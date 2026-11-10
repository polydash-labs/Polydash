// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolydashTwapFeed} from "src/fund/growth/PolydashTwapFeed.sol";
import {UniswapV4RouterAdapter} from "src/fund/growth/UniswapV4RouterAdapter.sol";
import {UniswapV3TwapFeed} from "src/fund/growth/UniswapV3TwapFeed.sol";

/// @title ManagerProposedAssetsForkTest (not reviewed, not deployed)
/// @notice Full-loop fork test for the Option 3 proposal mechanism, against Robinhood Chain
///         mainnet state at a pinned block via dRPC. Nothing is deployed to mainnet.
///
///         Real legs, both of them: the V2 factory + V2 facet + V2 vault are deployed on the
///         fork and wired to the LIVE allowlist, LIVE StrategyTemplate, and WETH. The V2
///         contracts are deployed with `deployCode` (not imported) on purpose: the V2
///         contracts compile under the `src/fund/phase3/**` paris restriction while the
///         growth feeds compile under cancun-min, and one test file cannot import both
///         groups — the same reason the Season 1 fork test uses inline interfaces.
///         - POLYDASH (V4 pool) is bought and sold through the real V4 pool, the real
///           `PolydashTwapFeed` (Season 1), and the real `UniswapV4RouterAdapter`.
///         - RNJ (V3 pool, fee 500 — the largest WETH V3 pool on the chain, found by WS1's
///           pool survey) is the proposed second asset: its feed is WS1's generic
///           `UniswapV3TwapFeed` and its router is the existing `UniswapV3RouterAdapter`
///           pointed at the live SwapRouter02. No stand-in feed or mock router remains.
///
///         The V3 pool's observation ring starts at cardinality 1, so the feed fails closed
///         until history is grown: the test grows it once (`increaseObservationCardinalityNext`)
///         and writes real observations with real 0.001 ETH swaps through the V3 adapter,
///         15 minutes apart. After every 2-day warp the newest observation is stale, so one
///         priming swap is done before trading resumes (the ring keeps the older observations,
///         so one fresh observation re-anchors the 30-minute window). The POLYDASH feed is
///         re-poked the same way. All priming is fork state only.
///
///         Flow: deploy V2 factory + feeds + adapters -> prime the RNJ feed, read its price,
///         allowlist POLYDASH + V4 adapter + RNJ + V3 adapter (prank the allowlist owner,
///         warp the 2-day timelock) -> publish Template #2 [POLYDASH] -> create a V2 fund ->
///         mint skin + public -> enable investing -> buy POLYDASH -> propose RNJ (cap 20%)
///         -> warp -> execute -> buy it (per-asset cap bites on the third buy) -> sell half
///         of each -> remove it -> buy reverts, sell of the removed asset SUCCEEDS -> re-add
///         it (cap 90%, so the template cap binds) -> buy to the 80% template cap (reverts)
///         -> sell it all -> remove it from the allowlist -> buy/sell revert NotAllowlisted
///         -> Phase 5 limitation is recorded.
///
///         Pinned block: 110526500 (same block the Season 1 fork tests use; dRPC serves it).
///         Run: `forge test --match-path test/fund/proposals/ProposalsFork.t.sol -j 1 -vvv`
interface IFactoryPhase3V2 {
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

interface IVaultPhase3V2 {
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
    function inMandate(address asset) external view returns (bool);
    function sellable(address asset) external view returns (bool);
    function assetCap(address asset) external view returns (uint256);
    function mandateAssetCount() external view returns (uint256);
    function mandateAssets(uint256 index) external view returns (address);
    function proposalCount() external view returns (uint256);
    function proposals(uint256 id)
        external
        view
        returns (
            address asset,
            uint256 maxPositionBps,
            string memory reason,
            string memory thesisUri,
            uint64 readyAt,
            uint8 status,
            uint8 kind
        );
    function proposeAsset(address asset, uint256 maxPositionBps, string calldata reason, string calldata thesisUri)
        external
        returns (uint256 id);
    function executeAsset(uint256 id) external;
    function cancelProposal(uint256 id) external;
    function proposeRemoval(address asset) external returns (uint256 id);
    function executeRemoval(uint256 id) external;
}

interface INFTPhase3 {
    function mint(uint256 qty) external payable;
    function vault() external view returns (address);
    function totalMinted() external view returns (uint256);
    function managerMinted() external view returns (uint256);
    function skinRequired() external view returns (uint256);
    function publicOpen() external view returns (bool);
    function outstanding() external view returns (uint256);
}

interface IPhase5 {
    function factory() external view returns (address);
}

/// @notice The one V3 pool function this test needs: growing the observation ring.
interface ISwapPool {
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

/// @notice The one V3 adapter function this test calls directly (priming swaps).
interface IAdapterSwap {
    function swap(address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)
        external
        payable
        returns (uint256 amountOut);
}

/// @notice Error selectors copied from the V2 vault/facet (declared here so this file does
///         not import the paris-restricted phase3 sources; selectors match by signature).
error NotManager();
error TooEarly();
error NotInMandate();
error NotAllowlisted();
error PositionCap();

contract ManagerProposedAssetsForkTest is Test {
    // Pinned just after the Phase 5 deployment (block 110620386) so the deployed
    // Phase 5 modules exist in the fork for step 18's factory-binding check.
    uint256 constant FORK_BLOCK = 110_620_400;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POLYDASH = 0x319525528f42167eF7fC18b77b889958080568e4;
    address constant HOOK = 0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc;
    address constant TEMPLATES = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address constant ALLOWLIST = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address constant OWNER = 0x9a21c75aC263cC43125E70200636f6397f8776d0;
    address constant PHASE5 = 0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81;
    address constant LIVE_FACTORY = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;
    // Second asset (WS1's V3 pool survey): WETH/RNJ V3 pool, fee 500, ~13.9 WETH +
    // ~2.27e8 RNJ at the pin. RNJ is token1 (sorts above WETH), 18 decimals.
    address constant RNJ_POOL = 0x4d59CFd33331A4d9611274b5997099b57DDd445c;
    address constant RNJ = 0x66e3F409c0bf871b26977a85f7287839748699dD;
    address constant SWAP_ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    uint24 constant RNJ_FEE = 500;

    uint64 constant MAX_STALE = 3600;
    uint256 constant MIN_PRICE_X18 = 60_000_000;
    uint256 constant MAX_PRICE_X18 = 260_000_000;

    PolydashTwapFeed feed;
    UniswapV4RouterAdapter adapter;
    UniswapV3TwapFeed rnjFeed;
    address v3Adapter;
    address factoryV2;

    address manager = makeAddr("manager");
    address investor = makeAddr("investor");

    function setUp() public {
        vm.createSelectFork("https://robinhood.drpc.org", FORK_BLOCK);
        feed = new PolydashTwapFeed(POOL_MANAGER, POLYDASH, WETH, HOOK, 0x800000, 200, 1800, 1800);
        adapter = new UniswapV4RouterAdapter(POOL_MANAGER, WETH, POLYDASH, HOOK, 0x800000, 200);
        rnjFeed = new UniswapV3TwapFeed(RNJ_POOL, RNJ, WETH, 30 minutes, 30 minutes);
        // V2 contracts deploy from their compiled artifacts (see the file header):
        // the V3 adapter, the V2 facet, then the V2 factory wired to the live
        // allowlist / templates / WETH with the live fee recipient.
        v3Adapter = deployCode(
            "src/fund/phase2/UniswapV3RouterAdapter.sol:UniswapV3RouterAdapter", abi.encode(SWAP_ROUTER02, WETH)
        );
        address facetV2 = deployCode("src/fund/phase3/FundSwapFacetPhase3V2.sol:FundSwapFacetPhase3V2");
        factoryV2 = deployCode(
            "src/fund/phase3/FundFactoryPhase3V2.sol:FundFactoryPhase3V2",
            abi.encode(OWNER, ALLOWLIST, WETH, facetV2, TEMPLATES)
        );
        vm.deal(manager, 10 ether);
        vm.deal(investor, 10 ether);
        vm.deal(address(this), 10 ether);
    }

    /// @notice Three pokes 15 minutes apart, so observations span the 30-minute TWAP window.
    function _pokeThrice() internal {
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
        vm.warp(vm.getBlockTimestamp() + 900);
        feed.poke();
    }

    /// @notice One real 0.001 ETH swap through the V3 adapter. Every V3 swap writes a pool
    ///         observation, so this re-anchors the RNJ feed's 30-minute window after a warp
    ///         (the ring keeps the older observations, so one fresh one suffices). The
    ///         0.001 ETH is ~0.007% of the pool: price impact is negligible.
    function _primeRnj() internal {
        IAdapterSwap(v3Adapter).swap{value: 0.001 ether}(address(0), RNJ, 0.001 ether, 1, abi.encode(RNJ_FEE));
    }

    /// @notice Grow the observation ring once, then write three observations 15 minutes
    ///         apart so the 30-minute TWAP window is covered for the first time.
    function _primeRnjThrice() internal {
        ISwapPool(RNJ_POOL).increaseObservationCardinalityNext(7200);
        _primeRnj();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        _primeRnj();
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        _primeRnj();
    }

    /// @notice After a warp, both feeds are stale: re-poke the POLYDASH feed and re-prime
    ///         the RNJ feed (one swap) before trading resumes.
    function _refreshFeeds() internal {
        _pokeThrice();
        _primeRnj();
    }

    /// @notice RNJ the feed implies for `ethIn` ETH, at 90% (minAmountOut slack for the
    ///         adapter's exactInputSingle). The pool is deep vs these sizes, so execution
    ///         lands well inside the 10% slack and the fund's 5% deviation check.
    function _rnjForEth(uint256 ethIn) internal view returns (uint256) {
        (uint256 priceX18,) = rnjFeed.latestPrice(RNJ);
        return ((ethIn * 1e18) / priceX18 * 90) / 100;
    }

    /// @notice ETH the feed implies for `rnjIn` RNJ, at 90%.
    function _ethForRnj(uint256 rnjIn) internal view returns (uint256) {
        (uint256 priceX18,) = rnjFeed.latestPrice(RNJ);
        return ((rnjIn * priceX18) / 1e18 * 90) / 100;
    }

    function test_fullLoop() public {
        // 1. Both feeds need a full window of observations before the allowlist takes them.
        _pokeThrice();
        (uint256 twapPrice,) = feed.latestPrice(POLYDASH);
        assertGt(twapPrice, MIN_PRICE_X18);
        assertLt(twapPrice, MAX_PRICE_X18);
        _primeRnjThrice();
        (uint256 rnjPrice,) = rnjFeed.latestPrice(RNJ);
        assertGt(rnjPrice, 0);
        emit log_named_uint("rnj priceX18", rnjPrice);

        // 2. Allowlist, all four proposals at once (fund wait and allowlist wait run in parallel):
        //    POLYDASH + V4 adapter, and RNJ + V3 adapter. The RNJ band is 2x around the
        //    live TWAP price, read above.
        assertEq(IAllowlist(ALLOWLIST).owner(), OWNER);
        assertEq(ITemplates(TEMPLATES).owner(), OWNER);
        vm.startPrank(OWNER);
        uint256 idPolydash =
            IAllowlist(ALLOWLIST).proposeAsset(POLYDASH, address(feed), MAX_STALE, MIN_PRICE_X18, MAX_PRICE_X18);
        uint256 idV4Router = IAllowlist(ALLOWLIST).propose(address(adapter), true, true);
        uint256 idRnj = IAllowlist(ALLOWLIST).proposeAsset(RNJ, address(rnjFeed), MAX_STALE, rnjPrice / 2, rnjPrice * 2);
        uint256 idV3Router = IAllowlist(ALLOWLIST).propose(v3Adapter, true, true);
        vm.stopPrank();

        // 3. Warp past the 2-day timelock and execute all four.
        vm.warp(vm.getBlockTimestamp() + IAllowlist(ALLOWLIST).delay() + 1);
        IAllowlist(ALLOWLIST).execute(idPolydash);
        IAllowlist(ALLOWLIST).execute(idV4Router);
        IAllowlist(ALLOWLIST).execute(idRnj);
        IAllowlist(ALLOWLIST).execute(idV3Router);
        assertTrue(IAllowlist(ALLOWLIST).assetAllowed(POLYDASH));
        assertTrue(IAllowlist(ALLOWLIST).routerAllowed(address(adapter)));
        assertTrue(IAllowlist(ALLOWLIST).assetAllowed(RNJ));
        assertTrue(IAllowlist(ALLOWLIST).routerAllowed(v3Adapter));

        // 4. Publish Template #2: [POLYDASH] only. 80% max position, 10% max trade,
        //    5% deviation, 5% HWM fee, 20% drawdown brake, 30-day skin lock.
        address[] memory assets = new address[](1);
        assets[0] = POLYDASH;
        vm.prank(OWNER);
        uint256 templateId = ITemplates(TEMPLATES)
            .publish(
                keccak256("manager-proposed-assets-fork-mandate"),
                "ipfs://manager-proposed-assets-fork",
                assets,
                8000,
                1000,
                500,
                500,
                2000,
                30 days
            );
        assertEq(templateId, 2);

        // 5. Create a fund from the NEW factory: 0.01 ETH mint, 0.1 ETH cap, 5% skin, 1h raise.
        vm.prank(manager);
        address nftAddr = IFactoryPhase3V2(factoryV2)
            .createFund(
                IFactoryPhase3V2.Params({
                    templateId: templateId,
                    name: "Proposals Fund",
                    symbol: "PROP",
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
        assertTrue(IFactoryPhase3V2(factoryV2).isFund(nftAddr));
        assertEq(INFTPhase3(nftAddr).skinRequired(), 1);
        assertEq(IVaultPhase3V2(vaultAddr).status(), 0); // Raising

        // 6. Manager mints the 1 skin share; public mint opens; investor takes the rest.
        vm.prank(manager);
        INFTPhase3(nftAddr).mint{value: 0.01 ether}(1);
        assertTrue(INFTPhase3(nftAddr).publicOpen());
        vm.prank(investor);
        INFTPhase3(nftAddr).mint{value: 0.09 ether}(9);
        assertEq(INFTPhase3(nftAddr).totalMinted(), 10);
        assertEq(IVaultPhase3V2(vaultAddr).status(), 1); // RaisingClosed

        // 7. Manager enables investing.
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).enableInvesting();
        assertEq(IVaultPhase3V2(vaultAddr).status(), 2); // Investing

        // 8. The timelock warp staled both feeds; refresh them.
        _refreshFeeds();

        // 9. Buy POLYDASH with 0.005 ETH through the real V4 pool (same size as the
        //    Season 1 fork test: ~39,494 POLYDASH expected; floor at 35,000).
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).swap(address(adapter), address(0), POLYDASH, 0.005 ether, 35_000e18, "");
        uint256 polydashBal = IERC20(POLYDASH).balanceOf(vaultAddr);
        assertGe(polydashBal, 35_000e18);
        emit log_named_uint("vault POLYDASH after buy", polydashBal);

        // 10. Propose RNJ at a 20% per-asset cap. A non-manager cannot propose, and
        //     executing before the 2-day wait reverts.
        vm.prank(investor);
        vm.expectRevert(NotManager.selector);
        IVaultPhase3V2(vaultAddr).proposeAsset(RNJ, 2000, "RNJ is the deepest V3 pool", "ipfs://thesis-rnj");
        vm.prank(manager);
        uint256 proposalId =
            IVaultPhase3V2(vaultAddr).proposeAsset(RNJ, 2000, "RNJ is the deepest V3 pool", "ipfs://thesis-rnj");
        assertEq(proposalId, 1);
        (
            address pAsset,
            uint256 pCap,
            string memory pReason,
            string memory pThesis,
            uint64 pReady,
            uint8 pStatus,
            uint8 pKind
        ) = IVaultPhase3V2(vaultAddr).proposals(proposalId);
        assertEq(pAsset, RNJ);
        assertEq(pCap, 2000);
        assertEq(pReason, "RNJ is the deepest V3 pool");
        assertEq(pThesis, "ipfs://thesis-rnj");
        assertEq(pReady, uint64(vm.getBlockTimestamp() + 2 days));
        assertEq(pStatus, uint8(0)); // Pending
        assertEq(pKind, uint8(0)); // Add
        assertFalse(IVaultPhase3V2(vaultAddr).inMandate(RNJ));
        vm.prank(manager);
        vm.expectRevert(TooEarly.selector);
        IVaultPhase3V2(vaultAddr).executeAsset(proposalId);

        // 11. Warp 2 days, execute, refresh the feeds (the warp staled them), then buy
        //     RNJ. NAV is ~0.0998 ETH, so 0.005 ETH is ~5% and 0.008 ETH is ~8%.
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).executeAsset(proposalId);
        assertTrue(IVaultPhase3V2(vaultAddr).inMandate(RNJ));
        assertTrue(IVaultPhase3V2(vaultAddr).sellable(RNJ));
        assertEq(IVaultPhase3V2(vaultAddr).assetCap(RNJ), 2000);
        _refreshFeeds();
        bytes memory rnjData = abi.encode(RNJ_FEE);
        uint256 minOutRnj1 = _rnjForEth(0.005 ether);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, address(0), RNJ, 0.005 ether, minOutRnj1, rnjData);
        uint256 minOutRnj2 = _rnjForEth(0.008 ether);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, address(0), RNJ, 0.008 ether, minOutRnj2, rnjData);
        uint256 rnjBal = IERC20(RNJ).balanceOf(vaultAddr);
        assertGe(rnjBal, _rnjForEth(0.013 ether));
        emit log_named_uint("vault RNJ after buys", rnjBal);

        // 12. Per-asset cap bites: a third buy would take the position to ~22%, over the
        //     20% proposal cap but under the 80% template cap.
        uint256 minOutRnj3 = _rnjForEth(0.009 ether);
        vm.prank(manager);
        vm.expectRevert(PositionCap.selector);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, address(0), RNJ, 0.009 ether, minOutRnj3, rnjData);
        assertEq(IERC20(RNJ).balanceOf(vaultAddr), rnjBal);

        // 13. Sell half of each asset: the round trips work at fund level.
        uint256 minEthRnj1 = _ethForRnj(rnjBal / 2);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, RNJ, address(0), rnjBal / 2, minEthRnj1, rnjData);
        assertEq(IERC20(RNJ).balanceOf(vaultAddr), rnjBal - rnjBal / 2);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).swap(address(adapter), POLYDASH, address(0), polydashBal / 2, 0.002 ether, "");
        assertLt(IERC20(POLYDASH).balanceOf(vaultAddr), polydashBal);

        // 14. Remove RNJ: propose -> warp -> execute. Buys now revert, the holding stays
        //     valued, and selling the removed asset MUST succeed.
        vm.prank(manager);
        uint256 removalId = IVaultPhase3V2(vaultAddr).proposeRemoval(RNJ);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).executeRemoval(removalId);
        assertFalse(IVaultPhase3V2(vaultAddr).inMandate(RNJ));
        assertTrue(IVaultPhase3V2(vaultAddr).sellable(RNJ));
        assertEq(IVaultPhase3V2(vaultAddr).mandateAssetCount(), 2);
        assertEq(IVaultPhase3V2(vaultAddr).mandateAssets(1), RNJ);
        _refreshFeeds(); // the 2-day warp staled the self-observing V4 feed; refresh before reading nav
        assertGt(IVaultPhase3V2(vaultAddr).nav(), 0);
        uint256 minOutRnj4 = _rnjForEth(0.001 ether);
        vm.prank(manager);
        vm.expectRevert(NotInMandate.selector);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, address(0), RNJ, 0.001 ether, minOutRnj4, rnjData);
        uint256 removedHeld = IERC20(RNJ).balanceOf(vaultAddr);
        assertGt(removedHeld, 0);
        uint256 minEthRnj2 = _ethForRnj(removedHeld);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, RNJ, address(0), removedHeld, minEthRnj2, rnjData);
        assertEq(IERC20(RNJ).balanceOf(vaultAddr), 0);

        // 15. Cancel works: propose removing POLYDASH, then cancel instead of executing.
        vm.prank(manager);
        uint256 cancelId = IVaultPhase3V2(vaultAddr).proposeRemoval(POLYDASH);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).cancelProposal(cancelId);
        (,,,,, uint8 cancelStatus,) = IVaultPhase3V2(vaultAddr).proposals(cancelId);
        assertEq(cancelStatus, uint8(2)); // Cancelled
        assertTrue(IVaultPhase3V2(vaultAddr).inMandate(POLYDASH));

        // 16. Re-add RNJ with a 90% cap, so the 80% template cap binds instead. Nine
        //     0.008 ETH buys reach ~72%; a 0.0095 ETH buy would reach ~81%.
        vm.prank(manager);
        uint256 readdId =
            IVaultPhase3V2(vaultAddr).proposeAsset(RNJ, 9000, "RNJ is the deepest V3 pool", "ipfs://thesis-rnj-v2");
        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).executeAsset(readdId);
        assertEq(IVaultPhase3V2(vaultAddr).mandateAssetCount(), 2); // no duplicate listing
        assertEq(IVaultPhase3V2(vaultAddr).assetCap(RNJ), 9000);
        _refreshFeeds();
        for (uint256 i; i < 9; ++i) {
            uint256 minOutLoop = _rnjForEth(0.008 ether);
            vm.prank(manager);
            IVaultPhase3V2(vaultAddr).swap(v3Adapter, address(0), RNJ, 0.008 ether, minOutLoop, rnjData);
        }
        uint256 rnjHeld = IERC20(RNJ).balanceOf(vaultAddr);
        assertGe(rnjHeld, _rnjForEth(0.072 ether));
        uint256 minOutRnj5 = _rnjForEth(0.0095 ether);
        vm.prank(manager);
        vm.expectRevert(PositionCap.selector);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, address(0), RNJ, 0.0095 ether, minOutRnj5, rnjData);

        // 17. Unallowlisted buys revert: sell RNJ down to zero, remove it from the
        //     allowlist (owner proposal + warp + execute), then buy and sell both
        //     revert on the allowlist check. The position is ~77% of NAV, so the
        //     sell-down goes in 10%-of-NAV-sized chunks under the template trade cap.
        uint256 sellChunk = rnjHeld / 10;
        for (uint256 i; i < 9; ++i) {
            uint256 minEthChunk = _ethForRnj(sellChunk);
            vm.prank(manager);
            IVaultPhase3V2(vaultAddr).swap(v3Adapter, RNJ, address(0), sellChunk, minEthChunk, rnjData);
        }
        uint256 sellRest = IERC20(RNJ).balanceOf(vaultAddr);
        uint256 minEthRest = _ethForRnj(sellRest);
        vm.prank(manager);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, RNJ, address(0), sellRest, minEthRest, rnjData);
        assertEq(IERC20(RNJ).balanceOf(vaultAddr), 0);
        vm.prank(OWNER);
        uint256 allowRemoval = IAllowlist(ALLOWLIST).propose(RNJ, false, false);
        vm.warp(vm.getBlockTimestamp() + IAllowlist(ALLOWLIST).delay() + 1);
        IAllowlist(ALLOWLIST).execute(allowRemoval);
        assertFalse(IAllowlist(ALLOWLIST).assetAllowed(RNJ));
        _refreshFeeds();
        uint256 minOutRnj6 = _rnjForEth(0.001 ether);
        vm.prank(manager);
        vm.expectRevert(NotAllowlisted.selector);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, address(0), RNJ, 0.001 ether, minOutRnj6, rnjData);
        uint256 minEthRnj4 = _ethForRnj(0.001 ether);
        vm.prank(manager);
        vm.expectRevert(NotAllowlisted.selector);
        IVaultPhase3V2(vaultAddr).swap(v3Adapter, RNJ, address(0), 0.001 ether, minEthRnj4, rnjData);

        // 18. Phase 5 limitation, recorded not proved by deployment: the DEPLOYED Phase 5
        //     modules point at the live factory, so they do not recognize this V2 fund.
        //     A second FundPhase5 deployment with the V2 factory as constructor arg is the
        //     deployment follow-up (same code, new addresses).
        assertEq(IPhase5(PHASE5).factory(), LIVE_FACTORY);
        assertFalse(IFactoryPhase3V2(LIVE_FACTORY).isFund(nftAddr));
        emit log_named_address("v2 factory", factoryV2);
        emit log_named_address("v2 fund nft", nftAddr);
        emit log_named_address("v2 vault", vaultAddr);
    }
}
