// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlistV2} from "../../src/fund/phase2v2/FundAllowlistV2.sol";
import {FundFactoryV2} from "../../src/fund/phase2v2/FundFactoryV2.sol";
import {FundNFTV2} from "../../src/fund/phase2v2/FundNFTV2.sol";
import {FundSwapFacetV2} from "../../src/fund/phase2v2/FundSwapFacetV2.sol";
import {FundV2Store} from "../../src/fund/phase2v2/FundV2Store.sol";
import {FundVaultV2} from "../../src/fund/phase2v2/FundVaultV2.sol";
import {IFundOracleV2} from "../../src/fund/phase2v2/Interfaces.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockWETH, RateRouter} from "./InvestMocks.sol";

contract QuoteOracle is IFundOracleV2 {
    uint256 public perWad;
    uint256 public updatedAt;

    function set(uint256 next) external {
        perWad = next;
        updatedAt = block.timestamp;
    }

    function price(address) external view returns (uint256, uint256) {
        return (perWad, updatedAt);
    }
}

contract FundV2Test is Test {
    FundAllowlistV2 allowlist;
    FundFactoryV2 factory;
    MockWETH weth;
    MockERC20 alpha;
    RateRouter router;
    address manager = makeAddr("manager");
    address alice = makeAddr("alice");
    address feeTo = makeAddr("fee");

    function setUp() public {
        weth = new MockWETH();
        alpha = new MockERC20("Alpha", "ALP", 0);
        router = new RateRouter(1e18, 1e18);
        address[] memory routers = new address[](1);
        routers[0] = address(router);
        address[] memory assets = new address[](2);
        assets[0] = address(weth);
        assets[1] = address(alpha);
        allowlist = new FundAllowlistV2(address(this), 1 days, routers, assets);
        factory = new FundFactoryV2(feeTo, address(allowlist), address(weth), address(new FundSwapFacetV2()));
        vm.deal(manager, 1000 ether);
        vm.deal(alice, 1000 ether);
        alpha.transfer(address(router), 1000 ether);
        vm.deal(address(router), 1000 ether);
    }

    function _params(uint256 supply, uint256 entry) internal view returns (FundFactoryV2.Params memory p) {
        p.name = "V2 Fund";
        p.symbol = "V2";
        p.mintPrice = 1 ether;
        p.raiseCap = 1 ether * supply;
        p.entryFeeBps = entry;
        p.minSkinBps = supply == 1 ? 10_000 : 0;
        p.raiseDuration = 7 days;
        p.mandateHash = keccak256("v2");
        p.assets = new address[](1);
        p.assets[0] = address(alpha);
    }

    function _create(uint256 supply, uint256 entry) internal returns (FundNFTV2 nft) {
        vm.prank(manager);
        nft = FundNFTV2(factory.createFund(_params(supply, entry)));
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](b == 0 ? 1 : 2);
        ids[0] = a;
        if (b != 0) ids[1] = b;
    }

    function test_missed_deadline_refunds_the_full_mint_price() public {
        FundNFTV2 nft = _create(4, 500);
        FundVaultV2 vault = nft.vault();
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(alice);
        nft.mint{value: 1 ether}(1);
        assertGt(vault.claimableFees(), 0);
        vm.prank(manager);
        vm.expectRevert(FundV2Store.FeesLocked.selector);
        vault.withdrawEntryFee();
        vm.warp(vault.raiseDeadline());
        vm.expectRevert(FundV2Store.RaiseOpen.selector);
        vault.settleRaise();
        vm.warp(vault.raiseDeadline() + 1);
        vault.settleRaise();
        assertEq(uint8(vault.status()), uint8(FundV2Store.Status.Failed));
        uint256 aliceBefore = alice.balance;
        uint256 managerBefore = manager.balance;
        vm.prank(alice);
        nft.refund(_ids(2, 0));
        vm.prank(manager);
        nft.refund(_ids(1, 0));
        assertEq(alice.balance, aliceBefore + 1 ether);
        assertEq(manager.balance, managerBefore + 1 ether);
        assertEq(nft.outstanding(), 0);
        assertEq(address(vault).balance, 0);
        (bool ok,) = address(vault).call(abi.encodeWithSignature("withdrawPrincipal(address)", manager));
        assertFalse(ok);
    }

    function test_filled_raise_can_wind_down_and_redeem_pro_rata() public {
        FundNFTV2 nft = _create(2, 0);
        FundVaultV2 vault = nft.vault();
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(alice);
        nft.mint{value: 1 ether}(1);
        assertEq(uint8(vault.status()), uint8(FundV2Store.Status.RaisingClosed));
        vm.prank(manager);
        vault.enableInvesting();
        uint256 navBefore = vault.nav();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 0.4 ether, 0.4 ether, "");
        assertEq(vault.nav(), navBefore - 0.4 ether);
        assertEq(vault.totalCostBasis(), 0.4 ether);
        assertEq(vault.costBasis(address(alpha)), 0.4 ether);
        (uint256 indicated, bool live) = vault.indicatedQuote(address(alpha), 0.4 ether);
        assertEq(indicated, 0);
        assertFalse(live);
        QuoteOracle oracle = new QuoteOracle();
        oracle.set(2e18);
        vm.prank(manager);
        vault.setOracle(address(oracle));
        (indicated, live) = vault.indicatedQuote(address(alpha), alpha.balanceOf(address(vault)));
        assertTrue(live);
        assertGt(indicated, 0);
        assertEq(vault.nav(), navBefore - 0.4 ether);

        vm.prank(manager);
        vault.startWindDown();
        assertEq(uint8(vault.status()), uint8(FundV2Store.Status.WindingDown));
        vm.prank(manager);
        vm.expectRevert(FundV2Store.NotInvesting.selector);
        vault.swap(address(router), address(0), address(alpha), 0.1 ether, 1, "");

        uint256 ethPool = address(vault).balance;
        uint256 tokenPool = alpha.balanceOf(address(vault));
        uint256 aliceEth = alice.balance;
        uint256 aliceTok = alpha.balanceOf(alice);
        vm.prank(alice);
        nft.redeem(_ids(2, 0));
        assertEq(alice.balance - aliceEth, ethPool / 2);
        assertEq(alpha.balanceOf(alice) - aliceTok, tokenPool / 2);
        uint256 managerEth = manager.balance;
        vm.prank(manager);
        nft.redeem(_ids(1, 0));
        assertEq(manager.balance - managerEth, address(vault).balance + (manager.balance - managerEth));
        assertEq(address(vault).balance, 0);
        assertEq(alpha.balanceOf(address(vault)), 0);
        assertLt(manager.balance - managerEth, ethPool);
    }

    function test_skin_gate_still_holds() public {
        FundFactoryV2.Params memory p = _params(10, 0);
        p.minSkinBps = 0;
        vm.prank(manager);
        FundNFTV2 nft = FundNFTV2(factory.createFund(p));
        vm.prank(alice);
        vm.expectRevert(FundNFTV2.SkinRequired.selector);
        nft.mint{value: 1 ether}(1);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        assertTrue(nft.publicOpen());
    }

    function test_direct_facet_and_script_gate() public {
        FundSwapFacetV2 facet = FundSwapFacetV2(factory.swapFacet());
        vm.expectRevert(FundV2Store.DirectFacetCall.selector);
        facet.swap(address(0), address(0), address(weth), 1, 1, "");
    }
}
