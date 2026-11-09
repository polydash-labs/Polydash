// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChainlinkNavFeed} from "../../src/fund/phase2/ChainlinkNavFeed.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {UniswapV3RouterAdapter} from "../../src/fund/phase2/UniswapV3RouterAdapter.sol";

/// @notice Fork coverage for the real router path: the deployed Uniswap V3 SwapRouter02, reached
///         through UniswapV3RouterAdapter, swapping WETH for USDG in the real 500-fee pool, with
///         the real USDG/USD and ETH/USD Chainlink feeds pricing the position.
///         Nothing is broadcast. Run with FORK_RPC set. Without it, the test returns before any fork.
///         The USDG/USD feed heartbeat is 24 h, so the allowlist uses maxStale = 1 day; a 1 h bound
///         would reject every stablecoin feed on this chain as read (verified 2026-11-09: the
///         stablecoin feeds had not updated in ~14 h at check time).
contract UniswapV3RouterAdapterForkTest is Test {
    /// @dev Verified on-chain 2026-11-09 (chain 4663, public RPC): code present, WETH9() returns
    ///      WETH, factory() returns V3Factory. 38 selectors; 0x2506c018 (the vault's swap) absent.
    address constant SWAP_ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    /// @dev Verified on-chain 2026-11-09: Global Dollar / USDG / 6, 632,184,048 total supply,
    ///      natively issued on Robinhood Chain. Real V3 pools vs WETH at fees 500/3000/10000.
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    /// @dev Shared SVR proxy, verified on-chain 2026-11-09: 8 decimals, "USDG / USD", ~$0.99996.
    address constant USDG_USD = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    /// @dev Shared SVR proxy, verified on-chain 2026-11-09: 8 decimals, "ETH / USD".
    address constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    /// @dev Verified on-chain 2026-11-09: WETH / WETH / 18, 39,487.23 total supply, ERC-1967 proxy.
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant FEE_RECIPIENT = 0x9a21c75aC263cC43125E70200636f6397f8776d0;

    bool internal on;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
    }

    function test_fork_adapter_swaps_weth_for_usdg_in_the_real_pool() public {
        if (!on) return;
        if (block.chainid != 4663) return;

        UniswapV3RouterAdapter adapter = new UniswapV3RouterAdapter(SWAP_ROUTER02, WETH);
        ChainlinkNavFeed feed = new ChainlinkNavFeed(USDG, 6, USDG_USD, ETH_USD, false, address(0), 0);
        // priceX18 is ETH wei per 1e18 raw USDG units (~4.7e26 at $2,131/ETH). The band is set
        // around the live feed price: it catches a broken feed or a USDG depeg, not normal ETH moves.
        (uint256 livePrice,) = feed.latestPrice(USDG);
        uint256 minPrice = (livePrice * 80) / 100;
        uint256 maxPrice = (livePrice * 125) / 100;
        address[] memory routers = new address[](1);
        routers[0] = address(adapter);
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](2);
        assets[0] = FundAllowlist.AssetInit(WETH, true, address(0), 0, 0, 0);
        assets[1] = FundAllowlist.AssetInit(USDG, false, address(feed), 1 days, minPrice, maxPrice);
        FundAllowlist allowlist = new FundAllowlist(address(this), 2 days, routers, assets);
        FundFactoryInvest factory =
            new FundFactoryInvest(FEE_RECIPIENT, address(allowlist), WETH, address(new FundSwapFacet()));

        // The allowlist should price 1e18 raw USDG units near 1e12 USDG / ETH-price ETH.
        // Wide band: ETH between $1,000 and $5,000.
        uint256 quotePerUsdg = allowlist.quote(USDG, 1e18);
        assertGt(quotePerUsdg, 2e26);
        assertLt(quotePerUsdg, 1e27);

        address manager = makeAddr("manager");
        vm.deal(manager, 100 ether);
        address[] memory universe = new address[](1);
        universe[0] = USDG;
        vm.prank(manager);
        FundNFTInvest nft = FundNFTInvest(
            factory.createFund(
                FundFactoryInvest.Params({
                    name: "Fork USDG Fund",
                    symbol: "FUF",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 2 ether,
                    entryFeeBps: 0,
                    minSkinBps: 10_000,
                    raiseDuration: 7 days,
                    mandateHash: keccak256("fork-usdg"),
                    assets: universe,
                    mandateUri: "ipfs://fork-usdg",
                    maxPositionBps: 0,
                    maxTradeBps: 0,
                    maxDeviationBps: 0
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 2 ether}(2);
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
        uint256 navBefore = vault.nav();
        assertGt(navBefore, 0);

        // Buy 0.5 ETH of USDG through the adapter at the 500-fee pool (the deepest pool).
        // minAmountOut is 800 USDG: the facet rejects a zero minimum.
        vm.prank(manager);
        vault.swap(address(adapter), address(0), USDG, 0.5 ether, 800e6, abi.encode(uint24(500)));
        uint256 usdgHeld = IERC20(USDG).balanceOf(address(vault));
        // 0.5 ETH at ~$2,131/ETH is ~1,065 USDG. Wide band allows for price moves and fees.
        assertGt(usdgHeld, 800e6);
        assertLt(usdgHeld, 1400e6);
        assertEq(vault.tradeCount(), 1);
        // NAV stays whole: the feed values the USDG near what the ETH was worth.
        assertGt(vault.nav(), (navBefore * 90) / 100);
        assertLt(vault.nav(), (navBefore * 110) / 100);

        // Sell it back for ETH (0.4 ETH minimum; the facet rejects a zero minimum).
        vm.prank(manager);
        vault.swap(address(adapter), USDG, address(0), usdgHeld, 0.4 ether, abi.encode(uint24(500)));
        assertEq(IERC20(USDG).balanceOf(address(vault)), 0);
        assertEq(vault.tradeCount(), 2);
        assertGt(vault.nav(), (navBefore * 90) / 100);
        assertLt(vault.nav(), (navBefore * 110) / 100);
    }
}
