// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {GateToken, MockFeed, MockWETH, RateRouter} from "./InvestMocks.sol";

contract FundExitTest is Test {
    FundAllowlist allowlist;
    FundFactoryInvest factory;
    MockFeed feed;
    MockWETH weth;
    MockERC20 alpha;
    RateRouter router;

    address manager = makeAddr("manager");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address feeTo = makeAddr("fee");

    function setUp() public {
        weth = new MockWETH();
        alpha = new MockERC20("Alpha", "ALP", 0);
        router = new RateRouter(1e18, 1e18);
        feed = new MockFeed();
        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](2);
        assets[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        assets[1] = FundAllowlist.AssetInit(address(alpha), false, address(feed), 1 hours, 0.5 ether, 1.5 ether);
        allowlist = new FundAllowlist(address(this), 1 days, routers, assets);
        factory = new FundFactoryInvest(feeTo, address(allowlist), address(weth), address(new FundSwapFacet()));
        vm.deal(manager, 1000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        alpha.transfer(address(router), 1_000_000 ether);
        vm.deal(address(router), 1000 ether);
    }

    function _params(uint256 supply, uint256 entryBps) internal view returns (FundFactoryInvest.Params memory p) {
        p.name = "Exit Fund";
        p.symbol = "EX";
        p.mintPrice = 1 ether;
        p.raiseCap = 1 ether * supply;
        p.entryFeeBps = entryBps;
        p.minSkinBps = 10_000;
        p.raiseDuration = 1 hours;
        p.mandateHash = keccak256("exit");
        p.assets = new address[](1);
        p.assets[0] = address(alpha);
    }

    function _create(uint256 supply, uint256 entryBps) internal returns (FundNFTInvest nft) {
        vm.prank(manager);
        nft = FundNFTInvest(factory.createFund(_params(supply, entryBps)));
    }

    function _one(uint256 id) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = id;
    }

    function test_deadline_success_cannot_fail_and_miss_cannot_invest() public {
        FundNFTInvest nft = _create(2, 0);
        FundVaultInvest vault = nft.vault();
        assertEq(vault.raiseDeadline(), block.timestamp + 1 hours);

        vm.warp(vault.raiseDeadline());
        vm.expectRevert(FundVaultStore.TooEarly.selector);
        vault.failRaise();
        vm.warp(vault.raiseDeadline() + 1);
        vm.prank(manager);
        vm.expectRevert(FundNFTInvest.RaiseEnded.selector);
        nft.mint{value: 2 ether}(2);
        vault.failRaise();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.Failed));
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotClosed.selector);
        vault.enableInvesting();

        FundNFTInvest filled = _create(1, 0);
        vm.prank(manager);
        filled.mint{value: 1 ether}(1);
        assertEq(uint8(filled.vault().status()), uint8(FundVaultStore.Status.RaisingClosed));
        FundVaultInvest filledVault = filled.vault();
        vm.warp(filledVault.raiseDeadline() + 1 days);
        vm.expectRevert(FundVaultStore.NotRaising.selector);
        filledVault.failRaise();
    }

    function test_failed_raise_refunds_current_holder_and_keeps_fees() public {
        FundNFTInvest nft = _create(2, 500);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(manager);
        nft.transferFrom(manager, alice, 1);
        FundVaultInvest vault = nft.vault();
        uint256 principal = vault.principal();
        uint256 fees = vault.claimableFees();
        assertGt(fees, 0);
        assertEq(principal + fees, 1 ether);

        vm.warp(vault.raiseDeadline() + 1);
        vault.failRaise();
        uint256 before = alice.balance;
        vm.prank(alice);
        nft.refund(_one(1));
        assertLt(principal, 1 ether);
        assertEq(principal + fees, 1 ether);
        assertEq(alice.balance, before + principal);
        assertEq(nft.outstanding(), 0);
        assertEq(vault.spendableEth(), 0);
        assertEq(vault.claimableFees(), fees);
        vm.prank(manager);
        vm.expectRevert(FundNFTInvest.BadQuantity.selector);
        nft.refund(_one(1));

        uint256 feeBefore = feeTo.balance;
        vault.withdrawProtocolFee();
        vm.prank(manager);
        vault.withdrawEntryFee();
        assertEq(feeTo.balance, feeBefore + vault.protocolFeeAccrued());
        assertEq(address(vault).balance, 0);
    }

    function test_refund_dust_goes_to_the_last_holder() public {
        FundFactoryInvest.Params memory open = _params(3, 0);
        open.minSkinBps = 0;
        open.mintPrice = 1 ether + 1;
        open.raiseCap = open.mintPrice * 4;
        vm.prank(manager);
        FundNFTInvest nft = FundNFTInvest(factory.createFund(open));
        vm.prank(manager);
        nft.mint{value: open.mintPrice}(1);
        vm.prank(alice);
        nft.mint{value: open.mintPrice}(1);
        vm.prank(bob);
        nft.mint{value: open.mintPrice}(1);
        FundVaultInvest vault = nft.vault();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.Raising));
        uint256 pool = vault.spendableEth();
        vm.warp(vault.raiseDeadline() + 1);
        vault.failRaise();

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        uint256 managerBefore = manager.balance;
        vm.prank(alice);
        nft.refund(_one(2));
        vm.prank(bob);
        nft.refund(_one(3));
        vm.prank(manager);
        nft.refund(_one(1));
        uint256 paid = (alice.balance - aliceBefore) + (bob.balance - bobBefore) + (manager.balance - managerBefore);
        assertEq(paid, pool);
        assertEq(vault.spendableEth(), 0);
        assertGe(manager.balance - managerBefore, pool / 3);
    }

    function test_exit_pays_inventory_while_paused_and_rejects_a_short_token() public {
        FundNFTInvest nft = _create(2, 0);
        vm.prank(manager);
        nft.mint{value: 2 ether}(2);
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 1 ether, 1 ether, "");
        vm.prank(manager);
        nft.transferFrom(manager, alice, 1);
        vm.prank(manager);
        nft.transferFrom(manager, bob, 2);

        vm.prank(manager);
        vault.setSwapsPaused(true);
        uint256 pool = vault.spendableEth();
        uint256 aliceEth = alice.balance;
        vm.prank(alice);
        nft.exit(_one(1));
        assertEq(alice.balance - aliceEth, pool / 2);
        assertEq(alpha.balanceOf(alice), 0.5 ether);
        assertEq(nft.outstanding(), 1);
        assertGt(vault.spendableEth(), 0);

        GateToken gated = new GateToken();
        uint256 id = allowlist.proposeAsset(address(gated), address(feed), 1 hours, 0.5 ether, 1.5 ether);
        vm.warp(block.timestamp + 1 days);
        allowlist.execute(id);
        gated.transfer(address(router), 100 ether);
        FundFactoryInvest.Params memory p = _params(1, 0);
        p.assets[0] = address(gated);
        p.raiseDuration = 2 hours;
        vm.prank(manager);
        FundNFTInvest gatedNft = FundNFTInvest(factory.createFund(p));
        vm.prank(manager);
        gatedNft.mint{value: 1 ether}(1);
        FundVaultInvest gatedVault = gatedNft.vault();
        vm.prank(manager);
        gatedVault.enableInvesting();
        vm.prank(manager);
        gatedVault.swap(address(router), address(0), address(gated), 0.2 ether, 0.2 ether, "");
        gated.lock();
        uint256 ethBefore = manager.balance;
        uint256 spendable = gatedVault.spendableEth();
        vm.prank(manager);
        gatedNft.exit(_one(1));
        assertEq(manager.balance - ethBefore, spendable);
        assertEq(gatedNft.outstanding(), 0);
        assertEq(gatedVault.tokenOwed(manager, address(gated)), 0.2 ether);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.TransferFailed.selector);
        gatedVault.claimOwed(address(gated));
        assertEq(gatedVault.tokenOwed(manager, address(gated)), 0.2 ether);
        assertEq(gated.balanceOf(address(gatedVault)), 0.2 ether);
    }

    function test_market_nav_fails_closed() public {
        FundNFTInvest nft = _create(1, 0);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 0.4 ether, 0.4 ether, "");
        assertEq(vault.nav(), address(vault).balance + 0.4 ether);

        feed.setPrice(3 ether);
        vm.expectRevert(FundAllowlist.PriceRejected.selector);
        vault.nav();
        vm.prank(manager);
        vm.expectRevert(FundAllowlist.PriceRejected.selector);
        vault.swap(address(router), address(alpha), address(0), 0.1 ether, 1, "");
        feed.setPrice(1 ether);

        vm.warp(3 hours);
        feed.pinAt(uint64(block.timestamp - 2 hours));
        vm.expectRevert(FundAllowlist.PriceStale.selector);
        vault.nav();
        uint256 expected = vault.spendableEth();
        uint256 tokens = alpha.balanceOf(address(vault));
        uint256 ethBefore = manager.balance;
        vm.prank(manager);
        nft.exit(_one(1));
        assertEq(manager.balance - ethBefore, expected);
        assertEq(alpha.balanceOf(manager), tokens);
        assertEq(nft.outstanding(), 0);
    }

    function test_asset_without_a_feed_cannot_be_enabled() public {
        vm.expectRevert(FundAllowlist.PriceUnavailable.selector);
        allowlist.proposeAsset(makeAddr("bare"), address(0), 1 hours, 1, 2);
        MockERC20 gamma = new MockERC20("Gamma", "GAM", 0);
        uint256 id = allowlist.propose(address(gamma), false, true);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(FundAllowlist.PriceUnavailable.selector);
        allowlist.execute(id);
    }

    function testFuzz_refund_matches_spendable_and_leaves_fees(uint96 priceRaw, uint16 entryRaw) public {
        uint256 price = bound(priceRaw, 0.01 ether, 1 ether);
        uint256 entry = bound(entryRaw, 0, 500);
        FundFactoryInvest.Params memory p = _params(3, entry);
        p.minSkinBps = 0;
        p.mintPrice = price;
        p.raiseCap = price * 4;
        vm.prank(manager);
        FundNFTInvest nft = FundNFTInvest(factory.createFund(p));
        vm.prank(manager);
        nft.mint{value: price}(1);
        vm.prank(alice);
        nft.mint{value: price}(1);
        vm.prank(bob);
        nft.mint{value: price}(1);
        FundVaultInvest vault = nft.vault();
        uint256 pool = vault.spendableEth();
        uint256 fees = vault.claimableFees();
        vm.warp(vault.raiseDeadline() + 1);
        vault.failRaise();
        uint256 a = alice.balance;
        uint256 b = bob.balance;
        uint256 m = manager.balance;
        vm.prank(alice);
        nft.refund(_one(2));
        vm.prank(bob);
        nft.refund(_one(3));
        vm.prank(manager);
        nft.refund(_one(1));
        assertEq((alice.balance - a) + (bob.balance - b) + (manager.balance - m), pool);
        assertEq(vault.claimableFees(), fees);
        assertEq(vault.spendableEth(), 0);
        assertEq(address(vault).balance, fees);
    }
}
