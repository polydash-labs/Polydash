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

/// @notice Fork coverage for the Phase 2 invest path. Nothing is broadcast.
///         The live Phase 1a factory is read and then checked again so this test cannot rewrite it.
///         Run with FORK_RPC set. Without it, the test returns before any fork.
contract FundInvestForkTest is Test {
    address constant LIVE_FACTORY = 0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878;
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
}
