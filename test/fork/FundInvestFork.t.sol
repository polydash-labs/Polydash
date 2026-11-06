// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundFactory} from "../../src/fund/FundFactory.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, RateRouter} from "../fund/InvestMocks.sol";
import {ChainlinkNavFeed} from "../../src/fund/phase2/ChainlinkNavFeed.sol";

/// @notice Fork coverage for the Phase 2 invest path. Nothing is broadcast.
///         The live Phase 1a factory is read and then checked again so this test cannot rewrite it.
///         Run with FORK_RPC set. Without it, the test returns before any fork.
contract FundInvestForkTest is Test {
    address constant LIVE_FACTORY = 0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878;
    /// @dev Recorded from Uniswap's Robinhood Chain V3 deployment list. Not allowlisted. Not called.
    address constant SWAP_ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    /// @dev Shared SVR proxies from the public Robinhood mainnet feed dataset. Not allowlisted. Secondary proxies are not read.
    address constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address constant USDC_USD = 0x9e6f4605992a899eE2999999F3Ec80C41F452546;
    address constant USDT_USD = 0xbf3550B6fAe1671da7C238Af12e03Ac586BEf3B1;
    address constant WBTC_USD = 0x62107b0d3adA75fc1697fD342d99eed947a3aA5E;
    address constant BUYBACK = 0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193;
    address constant FEE_RECIPIENT = 0x9a21c75aC263cC43125E70200636f6397f8776d0;

    bool internal on;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
    }

    function test_fork_invest_path_leaves_the_live_factory() public {
        if (!on) return;
        if (block.chainid != 4663) return;

        FundFactory live = FundFactory(LIVE_FACTORY);
        bytes32 codehash = LIVE_FACTORY.codehash;
        assertGt(LIVE_FACTORY.code.length, 0);
        assertEq(live.PROTOCOL_FEE_BPS(), 20);
        assertEq(live.feeRecipient(), FEE_RECIPIENT);

        (bool ok, bytes memory data) = BUYBACK.staticcall(abi.encodeWithSignature("weth()"));
        assertTrue(ok);
        address realWeth = abi.decode(data, (address));
        assertGt(realWeth.code.length, 0);

        MockERC20 alpha = new MockERC20("Alpha", "ALP", 0);
        MockERC20 beta = new MockERC20("Beta", "BET", 0);
        RateRouter router = new RateRouter(1e18, 1e18);
        alpha.transfer(address(router), 100 ether);
        vm.deal(address(router), 100 ether);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        MockFeed feed = new MockFeed();
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](2);
        seeded[0] = FundAllowlist.AssetInit({
            asset: realWeth, quote: true, feed: address(0), maxStale: 0, minPriceX18: 0, maxPriceX18: 0
        });
        seeded[1] = FundAllowlist.AssetInit({
            asset: address(alpha),
            quote: false,
            feed: address(feed),
            maxStale: 1 hours,
            minPriceX18: 0.5 ether,
            maxPriceX18: 1.5 ether
        });
        FundAllowlist allowlist = new FundAllowlist(address(this), 1 days, routers, seeded);
        FundFactoryInvest factory =
            new FundFactoryInvest(FEE_RECIPIENT, address(allowlist), realWeth, address(new FundSwapFacet()));

        address manager = makeAddr("manager");
        vm.deal(manager, 10 ether);
        address[] memory universe = new address[](1);
        universe[0] = address(alpha);
        vm.prank(manager);
        FundNFTInvest nft = FundNFTInvest(
            factory.createFund(
                FundFactoryInvest.Params({
                    name: "Fork Fund",
                    symbol: "FF",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 0.1 ether,
                    raiseCap: 0.1 ether,
                    entryFeeBps: 0,
                    minSkinBps: 10_000,
                    raiseDuration: 1 hours,
                    mandateHash: keccak256("fork-mandate"),
                    assets: universe
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 0.1 ether}(1);
        FundVaultInvest vault = nft.vault();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.RaisingClosed));
        vm.prank(manager);
        vault.enableInvesting();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.Investing));

        uint256 navBefore = vault.nav();
        vm.prank(manager);
        vault.swap(address(0), address(0), realWeth, 0.01 ether, 0.01 ether, "");
        assertEq(IERC20(realWeth).balanceOf(address(vault)), 0.01 ether);
        assertEq(vault.nav(), navBefore);

        vm.prank(manager);
        vault.swap(address(0), realWeth, address(0), 0.01 ether, 0.01 ether, "");
        assertEq(IERC20(realWeth).balanceOf(address(vault)), 0);
        assertEq(vault.nav(), navBefore);

        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 0.02 ether, 0.02 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 0.02 ether);
        assertEq(vault.nav(), navBefore);
        assertEq(vault.tradeCount(), 3);
        assertEq(nft.navPerNft(), vault.navPerNft());

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.swap(address(router), address(0), address(beta), 0.01 ether, 1, "");

        uint256 blocked = allowlist.propose(address(router), true, false);
        vm.expectRevert(FundAllowlist.Timelock.selector);
        allowlist.execute(blocked);

        assertEq(LIVE_FACTORY.codehash, codehash);
        assertEq(live.feeRecipient(), FEE_RECIPIENT);
        assertEq(factory.allFundsLength(), 1);
        assertFalse(live.isFund(address(nft)));
    }

    /// @notice Code size only. These addresses are not called and are not put on an allowlist.
    ///         QuoterV2 is on Uniswap's list and is not checked here; its code was not part of the size report.
    function test_fork_recorded_v3_venues_have_code() public view {
        if (!on) return;
        if (block.chainid != 4663) return;
        assertEq(SWAP_ROUTER02.code.length, 24_497);
        assertEq(UNIVERSAL_ROUTER.code.length, 24_546);
        assertEq(V3_FACTORY.code.length, 24_535);
    }

    /// @notice Read-only health of the four primary Shared SVR proxies. Does not allowlist them or compute a mandate NAV.
    function test_fork_primary_svr_proxies_answer() public {
        if (!on) return;
        if (block.chainid != 4663) return;
        _proxy(ETH_USD);
        _proxy(USDC_USD);
        _proxy(USDT_USD);
        _proxy(WBTC_USD);
        ChainlinkNavFeed feed = new ChainlinkNavFeed(ETH_USD, 18, ETH_USD, ETH_USD, false, address(0), 0);
        (uint256 one,) = feed.latestPrice(ETH_USD);
        assertEq(one, 1e18);
        vm.expectRevert(ChainlinkNavFeed.OutageGuardMissing.selector);
        new ChainlinkNavFeed(ETH_USD, 18, ETH_USD, ETH_USD, true, address(0), 1 hours);
    }

    function _proxy(address feed) internal view {
        assertEq(feed.code.length, 9571);
        (bool decOk, bytes memory decData) = feed.staticcall(abi.encodeWithSignature("decimals()"));
        assertTrue(decOk);
        assertEq(abi.decode(decData, (uint8)), 8);
        (bool ok, bytes memory data) = feed.staticcall(abi.encodeWithSignature("latestRoundData()"));
        assertTrue(ok);
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        assertGt(answer, 0);
        assertGt(updatedAt, 0);
        assertEq(answeredInRound, roundId);
    }
}
