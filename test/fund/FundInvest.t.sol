// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {FundFactory} from "../../src/fund/FundFactory.sol";
import {FundNFT} from "../../src/fund/FundNFT.sol";
import {FundVault} from "../../src/fund/FundVault.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryInvest} from "../../src/fund/phase2/FundFactoryInvest.sol";
import {FundSwapFacet} from "../../src/fund/phase2/FundSwapFacet.sol";
import {FundNFTInvest} from "../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../src/fund/phase2/FundVaultInvest.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {FailRouter, MockFeed, MockWETH, RateRouter, ReenterRouter, SkewWETH, ThiefRouter} from "./InvestMocks.sol";

contract InvestMinter is IERC721Receiver {
    function mint(FundNFTInvest nft, uint256 qty) external {
        nft.mint{value: nft.mintPrice() * qty}(qty);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract FundInvestTest is Test {
    FundAllowlist allowlist;
    FundFactoryInvest factory;
    MockWETH weth;
    MockERC20 alpha;
    MockERC20 beta;
    MockERC20 gamma;
    RateRouter router;

    address manager = makeAddr("manager");
    address alice = makeAddr("alice");
    address feeTo = makeAddr("fee");
    address executor = makeAddr("executor");

    bytes32 mandate = keccak256("example-mandate");

    function setUp() public {
        weth = new MockWETH();
        alpha = new MockERC20("Alpha", "ALP", 0);
        beta = new MockERC20("Beta", "BET", 0);
        gamma = new MockERC20("Gamma", "GAM", 0);
        router = new RateRouter(1e18, 1e18);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        MockFeed feed = new MockFeed();
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](3);
        assets[0] = _quote(address(weth));
        assets[1] = _priced(address(alpha), feed);
        assets[2] = _priced(address(beta), feed);
        allowlist = new FundAllowlist(address(this), 2 days, routers, assets);
        factory = new FundFactoryInvest(feeTo, address(allowlist), address(weth), address(new FundSwapFacet()));

        vm.deal(manager, 1000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(executor, 1 ether);
        alpha.transfer(address(router), 1_000_000 ether);
        beta.transfer(address(router), 1_000_000 ether);
        vm.deal(address(router), 1000 ether);
    }

    function _assets() internal view returns (address[] memory assets) {
        assets = new address[](1);
        assets[0] = address(alpha);
    }

    function _params() internal view returns (FundFactoryInvest.Params memory p) {
        p.name = "Example Fund";
        p.symbol = "EF";
        p.imageUri = "ipfs://image";
        p.baseURI = "ipfs://base/";
        p.mintPrice = 1 ether;
        p.raiseCap = 2 ether;
        p.entryFeeBps = 0;
        p.minSkinBps = 10_000;
        p.raiseDuration = 7 days;
        p.mandateHash = mandate;
        p.assets = _assets();
    }

    function _create(FundFactoryInvest.Params memory p) internal returns (FundNFTInvest nft) {
        vm.prank(manager);
        nft = FundNFTInvest(factory.createFund(p));
    }

    function _fill(FundNFTInvest nft) internal {
        uint256 price = nft.mintPrice();
        if (!nft.publicOpen()) {
            uint256 skin = nft.skinRequired() - nft.managerMinted();
            vm.prank(manager);
            nft.mint{value: price * skin}(skin);
        }
        uint256 left = nft.maxSupply() - nft.totalSupply();
        if (left == 0) return;
        vm.prank(alice);
        nft.mint{value: price * left}(left);
    }

    function _ready(FundNFTInvest nft) internal returns (FundVaultInvest vault) {
        _fill(nft);
        vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function test_create_stores_mandate_and_keeps_raise_math() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = nft.vault();
        assertEq(vault.mandateHash(), mandate);
        assertEq(vault.universeHash(), keccak256(abi.encode(_assets())));
        assertEq(vault.mandateAssetCount(), 1);
        assertEq(vault.mandateAssets(0), address(alpha));
        assertTrue(vault.inMandate(address(alpha)));
        assertFalse(vault.inMandate(address(beta)));
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.Raising));
        assertEq(nft.skinRequired(), 2);
        assertEq(factory.weth(), address(weth));
        assertTrue(factory.isFund(address(nft)));
        assertTrue(factory.isVault(address(vault)));

        vm.prank(manager);
        nft.mint{value: 2 ether}(2);
        assertTrue(nft.publicOpen());
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.RaisingClosed));
        assertEq(vault.raised(), 2 ether);
        assertEq(vault.principal() + vault.claimableProtocolFee(), 2 ether);
        assertEq(nft.navPerNft(), address(vault).balance / 2);
        assertEq(nft.navPerNft(), vault.navPerNft());
        assertEq(vault.nav(), address(vault).balance);
    }

    function test_skin_gate_still_blocks_other_wallets() public {
        FundFactoryInvest.Params memory p = _params();
        p.minSkinBps = 0;
        p.mintPrice = 0.01 ether;
        p.raiseCap = 1 ether;
        FundNFTInvest nft = _create(p);
        assertEq(nft.skinRequired(), 5);
        vm.prank(alice);
        vm.expectRevert(FundNFTInvest.SkinRequired.selector);
        nft.mint{value: 0.01 ether}(1);
        vm.prank(manager);
        nft.mint{value: 0.04 ether}(4);
        assertFalse(nft.publicOpen());
        vm.prank(alice);
        vm.expectRevert(FundNFTInvest.SkinRequired.selector);
        nft.mint{value: 0.01 ether}(1);
        vm.prank(manager);
        nft.mint{value: 0.01 ether}(1);
        assertTrue(nft.publicOpen());
        vm.prank(alice);
        nft.mint{value: 0.01 ether}(1);
        assertEq(nft.balanceOf(alice), 1);
        assertEq(uint8(nft.vault().status()), uint8(FundVaultStore.Status.Raising));
    }

    function test_investing_requires_a_closed_raise_and_the_manager() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = nft.vault();
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotClosed.selector);
        vault.enableInvesting();

        vm.prank(manager);
        nft.mint{value: 2 ether}(2);
        vm.prank(alice);
        vm.expectRevert(FundVaultStore.NotManager.selector);
        vault.enableInvesting();
        vm.prank(manager);
        vault.enableInvesting();
        assertEq(uint8(vault.status()), uint8(FundVaultStore.Status.Investing));
        assertEq(vault.investBlock(), block.number);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotClosed.selector);
        vault.enableInvesting();
        vm.prank(alice);
        vm.expectRevert(FundNFTInvest.NotRaising.selector);
        nft.mint{value: 1 ether}(1);
    }

    function test_buy_and_sell_keep_nav_at_cost_and_record_the_blotter() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        uint256 navBefore = vault.nav();
        uint256 fees = vault.claimableFees();

        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 1 ether, 1 ether, hex"1234");

        assertEq(vault.nav(), navBefore);
        assertEq(vault.costBasis(address(alpha)), 1 ether);
        assertEq(vault.totalCostBasis(), 1 ether);
        assertEq(alpha.balanceOf(address(vault)), 1 ether);
        assertEq(vault.spendableEth(), navBefore - fees - 1 ether);
        assertEq(vault.tradeCount(), 1);
        FundVaultStore.TradeRecord memory buy = vault.blotter(0);
        assertEq(buy.asset, address(alpha));
        assertEq(buy.side, vault.SIDE_BUY());
        assertEq(buy.size, 1 ether);
        assertEq(buy.price, 1e18);
        assertEq(buy.navAfter, vault.navPerNft());
        assertEq(router.lastData(), hex"1234");

        // Sell the position for 1.5 ETH. NAV rises by the 0.5 ETH difference from cost.
        router.setEthPerToken(1.5 ether);
        vm.prank(manager);
        vault.swap(address(router), address(alpha), address(0), 1 ether, 1.5 ether, "");

        assertEq(alpha.balanceOf(address(vault)), 0);
        assertEq(vault.costBasis(address(alpha)), 0);
        assertEq(vault.totalCostBasis(), 0);
        assertEq(vault.nav(), navBefore + 0.5 ether);
        assertEq(vault.claimableFees(), fees);
        FundVaultStore.TradeRecord memory sell = vault.blotter(0);
        assertEq(sell.side, vault.SIDE_SELL());
        assertEq(sell.size, 1 ether);
        assertEq(sell.price, 1.5 ether);
        assertEq(vault.tradeCount(), 2);
    }

    function test_loss_on_a_sale_reduces_nav() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        uint256 navBefore = vault.nav();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 1 ether, 1 ether, "");

        RateRouter loss = new RateRouter(1e18, 0.4 ether);
        alpha.transfer(address(loss), 10 ether);
        vm.deal(address(loss), 10 ether);
        _allowRouter(address(loss));

        vm.prank(manager);
        vault.swap(address(loss), address(alpha), address(0), 1 ether, 0.4 ether, "");
        assertEq(vault.nav(), navBefore - 0.6 ether);
        assertEq(vault.totalCostBasis(), 0);
    }

    function test_refund_counts_only_quote_that_left() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        uint256 navBefore = vault.nav();
        router.setRefundBps(5000);
        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), 1 ether, 0.5 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 0.5 ether);
        assertEq(vault.costBasis(address(alpha)), 0.5 ether);
        assertEq(vault.nav(), navBefore);
    }

    function test_wrap_and_unwrap_are_quote_neutral() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        uint256 navBefore = vault.nav();
        vm.prank(manager);
        vault.swap(address(0), address(0), address(weth), 0.5 ether, 0.5 ether, "");
        assertEq(weth.balanceOf(address(vault)), 0.5 ether);
        assertEq(vault.nav(), navBefore);
        assertEq(vault.totalCostBasis(), 0);
        FundVaultStore.TradeRecord memory wrap = vault.blotter(0);
        assertEq(wrap.asset, address(weth));
        assertEq(wrap.side, vault.SIDE_BUY());
        assertEq(wrap.price, 1e18);

        vm.prank(manager);
        vault.swap(address(0), address(weth), address(0), 0.5 ether, 0.5 ether, "");
        assertEq(weth.balanceOf(address(vault)), 0);
        assertEq(vault.nav(), navBefore);
    }

    function test_wrap_and_unwrap_reject_a_short_weth() public {
        SkewWETH skew = new SkewWETH();
        address[] memory routers = new address[](0);
        FundAllowlist.AssetInit[] memory assets = new FundAllowlist.AssetInit[](1);
        assets[0] = FundAllowlist.AssetInit(address(skew), true, address(0), 0, 0, 0);
        FundAllowlist skewList = new FundAllowlist(address(this), 1 days, routers, assets);
        FundFactoryInvest skewFactory =
            new FundFactoryInvest(feeTo, address(skewList), address(skew), address(new FundSwapFacet()));
        FundFactoryInvest.Params memory p = _params();
        p.assets = new address[](0);
        vm.prank(manager);
        FundNFTInvest nft = FundNFTInvest(skewFactory.createFund(p));
        _ready(nft);
        FundVaultInvest vault = nft.vault();

        skew.setShort(true, false);
        uint256 ethBefore = address(vault).balance;
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Slippage.selector);
        vault.swap(address(0), address(0), address(skew), 0.2 ether, 1, "");
        assertEq(address(vault).balance, ethBefore);
        assertEq(skew.balanceOf(address(vault)), 0);

        skew.setShort(false, false);
        vm.prank(manager);
        vault.swap(address(0), address(0), address(skew), 0.2 ether, 0.2 ether, "");
        assertEq(skew.balanceOf(address(vault)), 0.2 ether);
        skew.setShort(false, true);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Slippage.selector);
        vault.swap(address(0), address(skew), address(0), 0.2 ether, 1, "");
        assertEq(skew.balanceOf(address(vault)), 0.2 ether);
    }

    function test_weth_quote_buy_and_sell() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        vm.prank(manager);
        vault.swap(address(0), address(0), address(weth), 1 ether, 1 ether, "");
        uint256 navBefore = vault.nav();

        vm.prank(manager);
        vault.swap(address(router), address(weth), address(alpha), 1 ether, 1 ether, "");
        assertEq(weth.balanceOf(address(vault)), 0);
        assertEq(alpha.balanceOf(address(vault)), 1 ether);
        assertEq(vault.costBasis(address(alpha)), 1 ether);
        assertEq(vault.nav(), navBefore);

        vm.prank(manager);
        vault.swap(address(router), address(alpha), address(weth), 1 ether, 1 ether, "");
        assertEq(alpha.balanceOf(address(vault)), 0);
        assertEq(weth.balanceOf(address(vault)), 1 ether);
        assertEq(vault.costBasis(address(alpha)), 0);
        assertEq(vault.nav(), navBefore);
    }

    function test_allowlist_and_mandate_block_other_assets_and_routers() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.swap(address(router), address(0), address(beta), 0.1 ether, 1, "");

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotInMandate.selector);
        vault.swap(address(router), address(0), address(gamma), 0.1 ether, 1, "");

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotAllowlisted.selector);
        vault.swap(makeAddr("router"), address(0), address(alpha), 0.1 ether, 1, "");

        FailRouter bad = new FailRouter();
        _allowRouter(address(bad));
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.SwapFailed.selector);
        vault.swap(address(bad), address(0), address(alpha), 0.1 ether, 1, "");
        assertEq(vault.tradeCount(), 0);

        address thief = makeAddr("thief");
        ThiefRouter steal = new ThiefRouter(thief);
        _allowRouter(address(steal));
        uint256 before = address(vault).balance;
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Slippage.selector);
        vault.swap(address(steal), address(0), address(alpha), 0.1 ether, 1, "");
        assertEq(address(vault).balance, before);
        assertEq(thief.balance, 0);

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Slippage.selector);
        vault.swap(address(router), address(0), address(alpha), 1 ether, 1 ether + 1, "");
        assertEq(alpha.balanceOf(address(vault)), 0);
    }

    function test_timelock_removal_stops_the_next_swap() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);

        uint256 id = allowlist.propose(address(alpha), false, false);
        vm.expectRevert(FundAllowlist.Timelock.selector);
        allowlist.execute(id);
        vm.warp(block.timestamp + 2 days);
        allowlist.execute(id);
        assertFalse(allowlist.assetAllowed(address(alpha)));

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotAllowlisted.selector);
        vault.swap(address(router), address(0), address(alpha), 0.1 ether, 1, "");

        uint256 routerId = allowlist.propose(address(router), true, false);
        vm.warp(block.timestamp + 2 days);
        allowlist.execute(routerId);
        // Put alpha back, then the router removal still blocks.
        uint256 again = allowlist.propose(address(alpha), false, true);
        vm.warp(block.timestamp + 2 days);
        allowlist.execute(again);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.NotAllowlisted.selector);
        vault.swap(address(router), address(0), address(alpha), 0.1 ether, 1, "");
    }

    function test_pause_executor_and_fee_reservation() public {
        FundFactoryInvest.Params memory p = _params();
        p.entryFeeBps = 500;
        FundNFTInvest nft = _create(p);
        FundVaultInvest vault = _ready(nft);
        uint256 fees = vault.claimableFees();
        assertGt(fees, 0);
        uint256 spendable = vault.spendableEth();

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadAmount.selector);
        vault.swap(address(router), address(0), address(alpha), spendable + 1, 1, "");

        vm.prank(alice);
        vm.expectRevert(FundVaultStore.NotAuthorized.selector);
        vault.swap(address(router), address(0), address(alpha), 0.1 ether, 1, "");

        vm.prank(manager);
        vm.expectRevert(FundVaultStore.BadExecutor.selector);
        vault.setExecutor(manager, true);
        vm.prank(manager);
        vault.setExecutor(executor, true);
        vm.prank(executor);
        vault.swap(address(router), address(0), address(alpha), 0.2 ether, 0.2 ether, "");
        vm.prank(manager);
        vault.setExecutor(executor, false);
        vm.prank(executor);
        vm.expectRevert(FundVaultStore.NotAuthorized.selector);
        vault.swap(address(router), address(0), address(alpha), 0.1 ether, 1, "");

        vm.prank(manager);
        vault.setSwapsPaused(true);
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Paused.selector);
        vault.swap(address(router), address(0), address(alpha), 0.1 ether, 1, "");
        vm.prank(manager);
        vault.setSwapsPaused(false);

        allowlist.pause();
        vm.prank(manager);
        vm.expectRevert(FundVaultStore.Paused.selector);
        vault.swap(address(router), address(0), address(alpha), 0.1 ether, 1, "");
        allowlist.unpause();

        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), spendable - 0.2 ether, 1, "");
        assertGe(address(vault).balance, fees);
        uint256 feeBal = feeTo.balance;
        vault.withdrawProtocolFee();
        assertEq(feeTo.balance, feeBal + (2 ether * 20) / 10_000);
        vm.prank(manager);
        vault.withdrawEntryFee();
        assertEq(vault.claimableFees(), 0);
        assertEq(vault.principal(), 2 ether - fees);
    }

    function test_direct_eth_and_missing_principal_withdraw() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        FundSwapFacet facet = FundSwapFacet(factory.swapFacet());
        vm.expectRevert(FundVaultStore.DirectFacetCall.selector);
        facet.swap(address(0), address(0), address(weth), 1, 1, "");
        uint256 before = address(vault).balance;
        (bool sent,) = address(vault).call{value: 1 ether}("");
        assertFalse(sent);
        assertEq(address(vault).balance, before);

        (bool ok,) = address(vault).call(abi.encodeWithSignature("withdrawPrincipal(address)", manager));
        (bool ok2,) = address(vault).call(abi.encodeWithSignature("rescue(address)", manager));
        assertFalse(ok);
        assertFalse(ok2);
        assertEq(address(vault).balance, before);
        assertGt(vault.principal(), 0);
    }

    function test_protections_omit_high_water_mark() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = nft.vault();
        (uint8 before,, uint8 total) = vault.protectionBits();
        assertEq(total, 6);
        assertEq(before & vault.BIT_HWM(), 0);
        assertEq(before & vault.BIT_SKIN(), 0);
        assertEq(before & vault.BIT_CUSTODY(), vault.BIT_CUSTODY());
        assertEq(before & vault.BIT_ALLOWLIST(), vault.BIT_ALLOWLIST());
        assertEq(before & vault.BIT_SOURCE(), vault.BIT_SOURCE());
        assertEq(before & vault.BIT_TIMELOCK(), vault.BIT_TIMELOCK());

        _ready(nft);
        (uint8 bits, uint8 met,) = vault.protectionBits();
        assertEq(bits & vault.BIT_HWM(), 0);
        assertEq(bits & vault.BIT_SKIN(), vault.BIT_SKIN());
        assertEq(met, 5);
    }

    function test_policy_delay_only_lengthens_and_create_rejects_a_bad_universe() public {
        vm.expectRevert(FundAllowlist.BadDelay.selector);
        allowlist.setDelay(1 days);
        allowlist.setDelay(3 days);
        assertEq(allowlist.delay(), 3 days);
        uint256 id = allowlist.propose(address(gamma), false, true);
        vm.warp(block.timestamp + 3 days - 1);
        vm.expectRevert(FundAllowlist.Timelock.selector);
        allowlist.execute(id);
        allowlist.cancel(id);
        vm.expectRevert(FundAllowlist.BadProposal.selector);
        allowlist.execute(id);

        FundFactoryInvest.Params memory p = _params();
        p.mandateHash = bytes32(0);
        vm.prank(manager);
        vm.expectRevert(FundFactoryInvest.InvalidParams.selector);
        factory.createFund(p);

        p = _params();
        p.assets = new address[](1);
        p.assets[0] = address(weth);
        vm.prank(manager);
        vm.expectRevert(FundFactoryInvest.InvalidParams.selector);
        factory.createFund(p);

        p = _params();
        p.assets = new address[](1);
        p.assets[0] = address(gamma);
        vm.prank(manager);
        vm.expectRevert(FundFactoryInvest.InvalidParams.selector);
        factory.createFund(p);

        p = _params();
        p.assets = new address[](2);
        p.assets[0] = address(alpha);
        p.assets[1] = address(alpha);
        vm.prank(manager);
        vm.expectRevert(FundFactoryInvest.InvalidParams.selector);
        factory.createFund(p);
    }

    function test_reenter_swap_pays_once() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        ReenterRouter looper = new ReenterRouter();
        looper.setVault(vault);
        alpha.transfer(address(looper), 10 ether);
        _allowRouter(address(looper));

        vm.prank(manager);
        vault.swap(address(looper), address(0), address(alpha), 0.25 ether, 0.25 ether, "");
        assertTrue(looper.entered());
        assertEq(vault.tradeCount(), 1);
        assertEq(alpha.balanceOf(address(vault)), 0.25 ether);
        assertEq(vault.costBasis(address(alpha)), 0.25 ether);
    }

    function test_phase1_factory_is_unchanged_by_this_module() public {
        FundFactory phase1 = new FundFactory(feeTo);
        vm.prank(manager);
        FundNFT legacy = FundNFT(
            phase1.createFund(
                FundFactory.Params({
                    name: "Legacy",
                    symbol: "LEG",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 1 ether,
                    entryFeeBps: 0,
                    minSkinBps: 10_000
                })
            )
        );
        vm.prank(manager);
        legacy.mint{value: 1 ether}(1);
        FundVault legacyVault = legacy.vault();
        assertEq(uint8(legacyVault.status()), uint8(FundVault.Status.RaisingClosed));
        (bool ok,) = address(legacyVault).call(abi.encodeWithSignature("enableInvesting()"));
        assertFalse(ok);
        assertEq(legacy.navPerNft(), address(legacyVault).balance);
        assertTrue(phase1.isFund(address(legacy)));
        assertFalse(factory.isFund(address(legacy)));
    }

    function test_blotter_keeps_the_newest_window() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = _ready(nft);
        uint256 lot = 0.01 ether;
        for (uint256 i; i < 33; ++i) {
            vm.prank(manager);
            vault.swap(address(0), address(0), address(weth), lot, lot, "");
            vm.prank(manager);
            vault.swap(address(0), address(weth), address(0), lot, lot, "");
        }
        assertEq(vault.tradeCount(), 66);
        FundVaultStore.TradeRecord memory newest = vault.blotter(0);
        assertEq(newest.side, vault.SIDE_SELL());
        vault.blotter(31);
        vm.expectRevert(FundVaultStore.BadIndex.selector);
        vault.blotter(32);
        assertEq(vault.nav(), address(vault).balance);
    }

    function testFuzz_raise_then_round_trip_conserves_fees(uint96 buyRaw, uint16 entryRaw) public {
        uint256 buy = bound(buyRaw, 0.01 ether, 0.5 ether);
        uint256 entryBps = bound(entryRaw, 0, 500);
        FundFactoryInvest.Params memory p = _params();
        p.entryFeeBps = entryBps;
        FundNFTInvest nft = _create(p);
        FundVaultInvest vault = _ready(nft);
        uint256 fees = vault.claimableFees();
        uint256 navBefore = vault.nav();
        assertEq(navBefore, address(vault).balance);
        assertLe(buy, vault.spendableEth());

        vm.prank(manager);
        vault.swap(address(router), address(0), address(alpha), buy, buy, "");
        assertEq(vault.nav(), navBefore);
        assertEq(vault.claimableFees(), fees);

        vm.prank(manager);
        vault.swap(address(router), address(alpha), address(0), buy, buy, "");
        assertEq(vault.nav(), navBefore);
        assertEq(alpha.balanceOf(address(vault)), 0);
        assertEq(vault.totalCostBasis(), 0);
        if (vault.claimableProtocolFee() > 0) vault.withdrawProtocolFee();
        if (vault.claimableEntryFee() > 0) {
            vm.prank(manager);
            vault.withdrawEntryFee();
        }
        assertEq(address(vault).balance, vault.principal());
        uint256 price = nft.mintPrice();
        vm.expectRevert(FundNFTInvest.NotRaising.selector);
        vm.prank(alice);
        nft.mint{value: price}(1);
    }

    function _quote(address asset) internal pure returns (FundAllowlist.AssetInit memory item) {
        item.asset = asset;
        item.quote = true;
    }

    function _priced(address asset, MockFeed feed) internal pure returns (FundAllowlist.AssetInit memory item) {
        item.asset = asset;
        item.feed = address(feed);
        item.maxStale = 1 hours;
        item.minPriceX18 = 0.5 ether;
        item.maxPriceX18 = 1.5 ether;
    }

    function _allowRouter(address next) internal {
        uint256 id = allowlist.propose(next, true, true);
        vm.warp(block.timestamp + allowlist.delay());
        allowlist.execute(id);
    }
}
