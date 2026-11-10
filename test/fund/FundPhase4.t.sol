// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundVaultStore} from "../../src/fund/phase2/FundVaultStore.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundSwapFacetPhase3} from "../../src/fund/phase3/FundSwapFacetPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {StrategyTemplate} from "../../src/fund/phase3/StrategyTemplate.sol";
import {FundPhase4} from "../../src/fund/phase4/FundPhase4.sol";
import {FundShareAccount} from "../../src/fund/phase4/FundShareAccount.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "./InvestMocks.sol";
import {ERC6551Registry} from "./ERC6551Registry.sol";

contract HostileRouter {
    FundVaultPhase3 public vault;
    FundPhase4 public phase4;

    function set(FundVaultPhase3 nextVault, FundPhase4 nextPhase) external {
        vault = nextVault;
        phase4 = nextPhase;
    }

    function swap(address, address assetOut, uint256, uint256, bytes calldata) external payable returns (uint256) {
        if (address(vault) != address(0)) {
            try vault.withdrawEntryFee() {
                revert("fee");
            } catch {}
            try vault.withdrawPerformanceFee() {
                revert("perf");
            } catch {}
            try vault.setExecutor(address(this), true) {
                revert("exec");
            } catch {}
            try vault.distribute(1) {
                revert("dist");
            } catch {}
            try phase4.revoke(vault.nft()) {
                revert("revoke");
            } catch {}
        }
        require(IERC20(assetOut).transfer(msg.sender, msg.value), "pay");
        return msg.value;
    }
}

contract ThiefToAgent {
    address public agent;

    function set(address next) external {
        agent = next;
    }

    function swap(address, address, uint256, uint256, bytes calldata) external payable returns (uint256) {
        (bool ok,) = agent.call{value: msg.value}("");
        require(ok, "to-agent");
        return 0;
    }

    receive() external payable {}
}

contract BusyAgent {
    receive() external payable {}

    function trade(FundPhase4 phase4, address nft, address router, address assetOut, uint256 amount) external {
        phase4.agentSwap(nft, router, address(0), assetOut, amount, 1, "");
    }

    function attack(FundVaultPhase3 vault, FundPhase4 phase4, address nft) external {
        try vault.withdrawEntryFee() {} catch {}
        try vault.withdrawPerformanceFee() {} catch {}
        try vault.withdrawProtocolFee() {} catch {}
        try vault.distribute(1) {} catch {}
        try vault.setPayoutWallet(address(this)) {} catch {}
        try vault.setExecutor(address(this), true) {} catch {}
        try vault.setSwapsPaused(true) {} catch {}
        try phase4.revoke(nft) {} catch {}
        try phase4.arm(nft, address(this), uint64(block.timestamp + 1 days), 0) {} catch {}
    }
}

contract ReenterPayee {
    FundPhase4 public phase4;
    uint256 public id;
    bool public armed;
    uint256 public nestedOk;

    constructor(FundPhase4 next) {
        phase4 = next;
    }

    function place(address nft, uint256 tokenId, uint64 expiry) external payable returns (uint256 bidId) {
        bidId = phase4.placeBid{value: msg.value}(nft, tokenId, expiry);
        id = bidId;
    }

    function arm(uint256 bidId) external {
        id = bidId;
        armed = true;
    }

    function cancel() external {
        phase4.cancelBid(id);
    }

    function settle() external {
        phase4.settleBid(id);
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        try phase4.settleBid(id) {
            nestedOk += 1;
        } catch {}
        try phase4.cancelBid(id) {
            nestedOk += 1;
        } catch {}
    }
}

contract FundPhase4Test is Test {
    MockWETH weth;
    MockERC20 asset;
    MockFeed feed;
    RateRouter router;
    HostileRouter hostile;
    ThiefToAgent thief;
    FundAllowlist allow;
    StrategyTemplate templates;
    FundFactoryPhase3 factory;
    FundPhase4 phase4;
    uint256 templateId;

    address manager = makeAddr("manager");
    address buyer = makeAddr("buyer");
    address bidder = makeAddr("bidder");
    BusyAgent agent;

    function setUp() public {
        weth = new MockWETH();
        asset = new MockERC20("Alpha", "ALP", 0);
        feed = new MockFeed();
        feed.setPrice(1e18);
        router = new RateRouter(1e18, 1e18);
        hostile = new HostileRouter();
        thief = new ThiefToAgent();
        asset.transfer(address(router), 1000 ether);
        asset.transfer(address(hostile), 1000 ether);
        vm.deal(address(router), 100 ether);
        vm.deal(manager, 50 ether);
        vm.deal(buyer, 50 ether);
        vm.deal(bidder, 50 ether);

        address[] memory routers = new address[](3);
        routers[0] = address(router);
        routers[1] = address(hostile);
        routers[2] = address(thief);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](2);
        seeded[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        seeded[1] = FundAllowlist.AssetInit(address(asset), false, address(feed), 1 hours, 0.1e18, 10e18);
        allow = new FundAllowlist(address(this), 1 days, routers, seeded);

        templates = new StrategyTemplate(address(this));
        address[] memory universe = new address[](1);
        universe[0] = address(asset);
        templateId = templates.publish(
            keccak256("mandate"), "ipfs://phase4-mandate", universe, 7500, 7500, 5000, 1000, 1000, 7 days
        );
        factory = new FundFactoryPhase3(
            address(this), address(allow), address(weth), address(new FundSwapFacetPhase3()), address(templates)
        );
        phase4 = new FundPhase4(address(factory));
        agent = new BusyAgent();
        thief.set(address(agent));
    }

    function test_constants_match_the_live_factory_bounds() public view {
        assertEq(phase4.MIN_MINT_PRICE(), factory.MIN_MINT_PRICE());
        assertEq(phase4.MAX_MINT_PRICE(), factory.MAX_MINT_PRICE());
        assertEq(phase4.MAX_ENTRY_FEE_BPS(), factory.MAX_ENTRY_FEE_BPS());
        assertEq(phase4.MIN_RAISE_DURATION(), factory.MIN_RAISE_DURATION());
        assertEq(phase4.MAX_RAISE_DURATION(), factory.MAX_RAISE_DURATION());
        assertEq(phase4.MAX_SUPPLY(), factory.MAX_SUPPLY());
        assertEq(phase4.DEFAULT_MIN_SKIN_BPS(), factory.DEFAULT_MIN_SKIN_BPS());
        assertEq(phase4.ERC6551_REGISTRY(), 0x000000006551c19487814612e58FE06813775758);
    }

    function test_deploy_gas_is_logged() public {
        uint256 start = gasleft();
        FundPhase4 fresh = new FundPhase4(address(factory));
        uint256 used = start - gasleft();
        console2.log("phase4 constructor gas", used);
        console2.log("phase4 runtime", address(fresh).code.length);
        console2.log("share runtime", fresh.shareAccount().code.length);
        assertGt(address(fresh).code.length, 0);
        assertFalse(fresh.shareAccountsEnabled());
    }

    function test_clone_sender_is_the_manager() public {
        (FundNFTPhase3 nft,) = _open();
        FundPhase4.Cosmetic memory cosmetic = _cosmetic();
        (address target, bytes memory data) = phase4.cloneFromFund(address(nft), cosmetic);
        assertEq(target, address(factory));

        vm.prank(buyer);
        (bool ok, bytes memory ret) = target.call(data);
        assertTrue(ok);
        FundNFTPhase3 clone = FundNFTPhase3(abi.decode(ret, (address)));
        assertEq(clone.manager(), buyer);
        assertEq(clone.vault().templateId(), templateId);
        assertTrue(factory.isFund(address(clone)));
        assertEq(address(phase4).balance, 0);

        vm.prank(address(phase4));
        (ok, ret) = target.call(data);
        assertTrue(ok);
        assertEq(FundNFTPhase3(abi.decode(ret, (address))).manager(), address(phase4));
    }

    function test_clone_from_template_and_bad_cosmetic() public {
        FundPhase4.Cosmetic memory cosmetic = _cosmetic();
        (address target, bytes memory data) = phase4.cloneFromTemplate(templateId, cosmetic);
        assertEq(target, address(factory));
        assertGt(data.length, 4);

        cosmetic.name = "";
        vm.expectRevert(FundPhase4.InvalidParams.selector);
        phase4.cloneFromTemplate(templateId, cosmetic);

        cosmetic = _cosmetic();
        vm.expectRevert();
        phase4.cloneFromTemplate(99, cosmetic);

        vm.expectRevert(FundPhase4.NotFund.selector);
        phase4.cloneFromFund(address(0xBEEF), cosmetic);
    }

    function test_agent_can_swap_and_cannot_take_funds() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        hostile.set(vault, phase4);
        _arm(nft, address(agent), uint64(block.timestamp + 1 days), 0);

        uint256 fees = vault.claimableProtocolFee();
        address payout = vault.payoutWallet();
        bool paused = vault.swapsPaused();
        uint256 agentBefore = address(agent).balance;
        uint256 feeToBefore = address(this).balance;
        agent.attack(vault, phase4, address(nft));
        assertEq(vault.manager(), manager);
        assertEq(vault.payoutWallet(), payout);
        assertEq(vault.swapsPaused(), paused);
        assertEq(address(agent).balance, agentBefore);
        assertEq(address(this).balance - feeToBefore, fees - vault.claimableProtocolFee());
        assertEq(vault.isExecutor(address(agent)), false);
        (address granted,,,) = _grant(nft);
        assertEq(granted, address(agent));

        uint256 vaultBefore = address(vault).balance;
        agent.trade(phase4, address(nft), address(hostile), address(asset), 0.2 ether);
        assertEq(IERC20(address(asset)).balanceOf(address(vault)), 0.2 ether);
        assertEq(address(vault).balance, vaultBefore - 0.2 ether);
        assertEq(address(agent).balance, 0);
        assertEq(IERC20(address(asset)).balanceOf(address(agent)), 0);
        assertEq(IERC20(address(weth)).allowance(address(vault), address(agent)), 0);
        assertEq(IERC20(address(asset)).allowance(address(vault), address(phase4)), 0);
    }

    function test_agent_amount_cap_expiry_revoke_and_isolation() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        _arm(nft, address(agent), uint64(block.timestamp + 2 days), 0.1 ether);

        vm.prank(address(agent));
        vm.expectRevert(FundPhase4.AmountCap.selector);
        phase4.agentSwap(address(nft), address(0), address(0), address(weth), 0.2 ether, 0.2 ether, "");

        vm.prank(address(agent));
        phase4.agentSwap(address(nft), address(0), address(0), address(weth), 0.1 ether, 0.1 ether, "");
        assertEq(IERC20(address(weth)).balanceOf(address(vault)), 0.1 ether);

        vm.prank(bidder);
        vm.expectRevert(FundPhase4.NotAgent.selector);
        phase4.agentSwap(address(nft), address(0), address(0), address(weth), 0.01 ether, 0.01 ether, "");

        vm.warp(block.timestamp + 2 days);
        vm.prank(address(agent));
        phase4.agentSwap(address(nft), address(0), address(weth), address(0), 0.1 ether, 0.1 ether, "");

        vm.warp(block.timestamp + 1);
        vm.prank(address(agent));
        vm.expectRevert(FundPhase4.NotAgent.selector);
        phase4.agentSwap(address(nft), address(0), address(0), address(weth), 0.01 ether, 0.01 ether, "");

        vm.prank(bidder);
        phase4.kick(address(nft));
        (address granted,,, bool active,) = phase4.agentOf(address(nft));
        assertEq(granted, address(0));
        assertFalse(active);

        _arm(nft, address(agent), uint64(block.timestamp + 1 days), 0);
        vm.prank(manager);
        phase4.revoke(address(nft));
        vm.prank(address(agent));
        vm.expectRevert(FundPhase4.NotAgent.selector);
        phase4.agentSwap(address(nft), address(0), address(0), address(weth), 0.01 ether, 0.01 ether, "");

        _arm(nft, address(agent), uint64(block.timestamp + 1 days), 0);
        vm.prank(manager);
        vault.setExecutor(address(phase4), false);
        vm.prank(address(agent));
        vm.expectRevert(FundVaultStore.NotAuthorized.selector);
        phase4.agentSwap(address(nft), address(0), address(0), address(weth), 0.01 ether, 0.01 ether, "");
    }

    function test_agent_thief_router_does_not_keep_eth() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        _arm(nft, address(agent), uint64(block.timestamp + 1 days), 0);
        uint256 vaultBefore = address(vault).balance;
        uint256 agentBefore = address(agent).balance;
        vm.prank(address(agent));
        vm.expectRevert();
        phase4.agentSwap(address(nft), address(thief), address(0), address(asset), 0.1 ether, 1, "");
        assertEq(address(vault).balance, vaultBefore);
        assertEq(address(agent).balance, agentBefore);
        assertEq(address(phase4).balance, 0);
    }

    function test_arm_rejects_bad_callers_and_windows() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        vm.prank(manager);
        vm.expectRevert(FundPhase4.GateNotExecutor.selector);
        phase4.arm(address(nft), address(agent), uint64(block.timestamp + 1 days), 0);

        vm.prank(manager);
        vault.setExecutor(address(phase4), true);
        vm.prank(bidder);
        vm.expectRevert(FundPhase4.NotManager.selector);
        phase4.arm(address(nft), address(agent), uint64(block.timestamp + 1 days), 0);

        vm.prank(manager);
        vm.expectRevert(FundPhase4.BadAgent.selector);
        phase4.arm(address(nft), manager, uint64(block.timestamp + 1 days), 0);
        vm.prank(manager);
        vm.expectRevert(FundPhase4.BadAgent.selector);
        phase4.arm(address(nft), address(phase4), uint64(block.timestamp + 1 days), 0);
        vm.prank(manager);
        vm.expectRevert(FundPhase4.BadExpiry.selector);
        phase4.arm(address(nft), address(agent), uint64(block.timestamp), 0);
        vm.prank(manager);
        vm.expectRevert(FundPhase4.BadExpiry.selector);
        phase4.arm(address(nft), address(agent), uint64(block.timestamp + 30 days + 1), 0);

        vm.prank(bidder);
        vm.expectRevert(FundPhase4.NotExpired.selector);
        phase4.kick(address(nft));
    }

    function test_agent_cannot_touch_another_fund() public {
        (FundNFTPhase3 first,) = _open();
        FundNFTPhase3 second = _create(1 ether, 2 ether, 0, 5000, 7 days);
        vm.prank(manager);
        second.mint{value: 1 ether}(1);
        vm.prank(buyer);
        second.mint{value: 1 ether}(1);
        FundVaultPhase3 secondVault = second.vault();
        vm.prank(manager);
        secondVault.enableInvesting();
        _arm(first, address(agent), uint64(block.timestamp + 1 days), 0);

        vm.prank(address(agent));
        vm.expectRevert(FundPhase4.NotAgent.selector);
        phase4.agentSwap(address(second), address(0), address(0), address(weth), 0.01 ether, 0.01 ether, "");
    }

    function test_season_card_tracks_drawdown_and_closes() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        uint256 startNav = vault.navPerNft();
        phase4.openSeason(address(nft));
        vm.expectRevert(FundPhase4.SeasonState.selector);
        phase4.openSeason(address(nft));
        vm.expectRevert(FundPhase4.TooEarly.selector);
        phase4.closeSeason(address(nft));

        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        feed.setPrice(0.5e18);
        router.setEthPerToken(0.5e18);
        phase4.pokeSeason(address(nft));

        vm.warp(block.timestamp + 1 days);
        phase4.closeSeason(address(nft));
        FundPhase4.Season memory row = phase4.seasonOf(address(nft), 0);
        assertTrue(row.closed);
        assertEq(row.navStart, startNav);
        assertLt(row.navEnd, row.navStart);
        assertLt(row.versusStartBps, 0);
        assertGt(row.maxDrawdownBps, 0);
        assertEq(row.tradeEnd - row.tradeStart, 1);
        assertEq(row.versusStartBps, phase4.returnBps(row.navEnd, row.navStart));
        assertFalse(phase4.seasonOpen(address(nft)));

        FundPhase4.LiveCard memory card = phase4.liveCard(address(nft));
        assertEq(card.navPerShare, vault.navPerNft());
        assertEq(card.tradeCount, vault.tradeCount());
        assertEq(card.status, uint8(FundVaultStore.Status.Investing));
    }

    function test_season_reverts_before_investing_and_when_price_fails() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _raise();
        vm.expectRevert(FundPhase4.NotInvesting.selector);
        phase4.openSeason(address(nft));
        vm.prank(manager);
        vault.enableInvesting();
        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        vm.warp(block.timestamp + 3 hours);
        feed.pinAt(uint64(block.timestamp - 2 hours));
        vm.expectRevert();
        phase4.openSeason(address(nft));
        vm.expectRevert(FundPhase4.SeasonState.selector);
        phase4.pokeSeason(address(nft));
    }

    function testFuzz_return_bps(uint256 start, uint256 end) public view {
        int256 got = phase4.returnBps(end, start);
        if (start == 0) {
            assertEq(got, 0);
            return;
        }
        if (end >= start) {
            uint256 delta = end - start;
            if (delta > type(uint256).max / 10_000) {
                assertEq(got, type(int256).max);
            } else {
                uint256 up = (delta * 10_000) / start;
                if (up > uint256(type(int256).max)) assertEq(got, type(int256).max);
                else assertEq(uint256(got), up);
            }
        } else {
            uint256 drop = start - end;
            if (drop > type(uint256).max / 10_000) {
                assertEq(got, type(int256).min);
            } else {
                uint256 down = (drop * 10_000) / start;
                if (down > uint256(type(int256).max)) assertEq(got, type(int256).min);
                else assertEq(uint256(-got), down);
            }
        }
    }

    function test_bid_settles_atomically_from_bidder_eth() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        uint256 vaultBefore = address(vault).balance;
        uint256 nav = nft.navPerNft();
        vm.prank(buyer);
        nft.approve(address(phase4), 2);
        vm.prank(bidder);
        uint256 id = phase4.placeBid{value: 0.4 ether}(address(nft), 2, uint64(block.timestamp + 2 days));
        assertEq(phase4.escrowed(), 0.4 ether);
        assertEq(address(phase4).balance, 0.4 ether);
        assertLe(0.4 ether, nav);

        uint256 sellerBefore = buyer.balance;
        vm.prank(buyer);
        phase4.settleBid(id);
        assertEq(nft.ownerOf(2), bidder);
        assertEq(buyer.balance - sellerBefore, 0.4 ether);
        assertEq(phase4.escrowed(), 0);
        assertEq(address(phase4).balance, 0);
        assertEq(address(vault).balance, vaultBefore);
        (address who,,,,) = phase4.bids(id);
        assertEq(who, address(0));
    }

    function test_bid_reverts_above_nav_and_after_a_drop() public {
        (FundNFTPhase3 nft, FundVaultPhase3 vault) = _open();
        uint256 nav = nft.navPerNft();
        vm.prank(bidder);
        vm.expectRevert(FundPhase4.AboveNav.selector);
        phase4.placeBid{value: nav + 1}(address(nft), 2, uint64(block.timestamp + 1 days));

        vm.prank(bidder);
        uint256 id = phase4.placeBid{value: nav}(address(nft), 2, uint64(block.timestamp + 1 days));
        vm.prank(manager);
        vault.swap(address(router), address(0), address(asset), 0.5 ether, 1, "");
        feed.setPrice(0.4e18);
        router.setEthPerToken(0.4e18);
        assertLt(nft.navPerNft(), nav);
        vm.prank(buyer);
        nft.approve(address(phase4), 2);
        vm.prank(buyer);
        vm.expectRevert(FundPhase4.AboveNav.selector);
        phase4.settleBid(id);

        uint256 bidderBefore = bidder.balance;
        vm.prank(bidder);
        phase4.cancelBid(id);
        assertEq(bidder.balance - bidderBefore, nav);
        assertEq(phase4.escrowed(), 0);
        assertEq(nft.ownerOf(2), buyer);
    }

    function test_bid_cancel_expiry_skin_lock_and_strangers() public {
        (FundNFTPhase3 nft,) = _open();
        uint256 tiny = phase4.MIN_BID() - 1;
        vm.prank(bidder);
        vm.expectRevert(FundPhase4.BidSmall.selector);
        phase4.placeBid{value: tiny}(address(nft), 2, uint64(block.timestamp + 1 days));
        vm.prank(buyer);
        vm.expectRevert(FundPhase4.SelfBid.selector);
        phase4.placeBid{value: 0.2 ether}(address(nft), 2, uint64(block.timestamp + 1 days));

        vm.prank(bidder);
        uint256 skinBid = phase4.placeBid{value: 0.2 ether}(address(nft), 1, uint64(block.timestamp + 1 days));
        vm.prank(manager);
        nft.approve(address(phase4), 1);
        vm.prank(manager);
        vm.expectRevert(FundNFTPhase3.SkinLocked.selector);
        phase4.settleBid(skinBid);
        (address skinBidder,,,,) = phase4.bids(skinBid);
        assertEq(skinBidder, bidder);
        vm.prank(bidder);
        phase4.cancelBid(skinBid);

        vm.prank(bidder);
        uint256 id = phase4.placeBid{value: 0.2 ether}(address(nft), 2, uint64(block.timestamp + 1 days));
        vm.prank(manager);
        vm.expectRevert(FundPhase4.NotHolder.selector);
        phase4.settleBid(id);
        vm.prank(buyer);
        vm.expectRevert();
        phase4.settleBid(id);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(buyer);
        nft.approve(address(phase4), 2);
        vm.prank(buyer);
        vm.expectRevert(FundPhase4.Expired.selector);
        phase4.settleBid(id);
        uint256 bidderBefore = bidder.balance;
        vm.prank(manager);
        phase4.cancelBid(id);
        assertEq(bidder.balance - bidderBefore, 0.2 ether);

        (bool ok,) = address(phase4).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(phase4).balance, 0);
    }

    function testFuzz_bid_respects_nav(uint96 amount) public {
        (FundNFTPhase3 nft,) = _open();
        uint256 nav = nft.navPerNft();
        amount = uint96(bound(amount, 0, nav + 1 ether));
        address payer = makeAddr("fuzzBidder");
        vm.deal(payer, amount);
        vm.prank(payer);
        if (amount < phase4.MIN_BID() || amount > nav) {
            vm.expectRevert();
            phase4.placeBid{value: amount}(address(nft), 2, uint64(block.timestamp + 1 days));
        } else {
            phase4.placeBid{value: amount}(address(nft), 2, uint64(block.timestamp + 1 days));
            assertEq(phase4.escrowed(), amount);
            assertEq(address(phase4).balance, amount);
        }
    }

    function test_reenter_settle_and_cancel_pay_once() public {
        (FundNFTPhase3 nft,) = _open();
        ReenterPayee payer = new ReenterPayee(phase4);
        vm.deal(address(payer), 1 ether);
        uint256 bidId = payer.place{value: 0.25 ether}(address(nft), 2, uint64(block.timestamp + 1 days));
        payer.arm(bidId);
        uint256 payerBefore = address(payer).balance;
        payer.cancel();
        assertEq(payer.nestedOk(), 0);
        assertEq(address(payer).balance - payerBefore, 0.25 ether);
        assertEq(phase4.escrowed(), 0);
        assertEq(nft.ownerOf(2), buyer);

        ReenterPayee seller = new ReenterPayee(phase4);
        vm.prank(buyer);
        nft.transferFrom(buyer, address(seller), 2);
        vm.prank(address(seller));
        nft.approve(address(phase4), 2);
        vm.prank(bidder);
        uint256 id = phase4.placeBid{value: 0.3 ether}(address(nft), 2, uint64(block.timestamp + 1 days));
        seller.arm(id);
        uint256 before = address(seller).balance;
        seller.settle();
        assertEq(seller.nestedOk(), 0);
        assertEq(address(seller).balance - before, 0.3 ether);
        assertEq(nft.ownerOf(2), bidder);
        assertEq(phase4.escrowed(), 0);
    }

    function test_share_account_follows_the_nft_and_freezes_on_burn() public {
        (FundNFTPhase3 nft,) = _open();
        (address wallet, bool enabled) = phase4.shareWallet(address(nft), 2);
        assertFalse(enabled);
        assertEq(wallet, address(0));
        vm.expectRevert(FundPhase4.RegistryAbsent.selector);
        phase4.createShareAccount(address(nft), 2);

        _etchRegistry();
        assertTrue(phase4.shareAccountsEnabled());
        (wallet, enabled) = phase4.shareWallet(address(nft), 2);
        assertTrue(enabled);
        address created = phase4.createShareAccount(address(nft), 2);
        assertEq(created, wallet);
        assertEq(phase4.createShareAccount(address(nft), 2), created);

        FundShareAccount account = FundShareAccount(payable(created));
        assertEq(account.owner(), buyer);
        vm.deal(buyer, 10 ether);
        vm.prank(buyer);
        account.execute{value: 0.2 ether}(address(0xBEEF), 0.2 ether, "", 0);
        assertEq(address(0xBEEF).balance, 0.2 ether);
        assertEq(account.state(), 1);

        vm.prank(manager);
        vm.expectRevert(FundShareAccount.NotOwner.selector);
        account.execute(address(0xBEEF), 0, "", 0);
        vm.prank(buyer);
        vm.expectRevert(FundShareAccount.BadOperation.selector);
        account.execute(address(0xBEEF), 0, "", 1);

        vm.prank(buyer);
        nft.transferFrom(buyer, manager, 2);
        assertEq(account.owner(), manager);
        vm.prank(buyer);
        vm.expectRevert(FundShareAccount.NotOwner.selector);
        account.execute(address(0xCAFE), 0, "", 0);
        vm.prank(manager);
        account.execute(address(0xCAFE), 0, "", 0);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 2;
        vm.prank(manager);
        nft.exit(ids);
        assertEq(account.owner(), address(0));
        vm.prank(manager);
        vm.expectRevert();
        account.execute(address(0xCAFE), 0, "", 0);

        FundShareAccount impl = FundShareAccount(payable(phase4.shareAccount()));
        assertEq(impl.owner(), address(0));
        vm.expectRevert(FundShareAccount.DirectAccount.selector);
        impl.execute(address(0xBEEF), 0, "", 0);

        vm.expectRevert(FundPhase4.NotFund.selector);
        phase4.createShareAccount(address(0xBEEF), 1);
    }

    function test_bid_rejects_the_share_wallet_as_bidder() public {
        (FundNFTPhase3 nft,) = _open();
        _etchRegistry();
        (address predicted,) = phase4.shareWallet(address(nft), 2);
        vm.deal(predicted, 1 ether);
        vm.prank(predicted);
        vm.expectRevert(FundPhase4.WalletLoop.selector);
        phase4.placeBid{value: 0.2 ether}(address(nft), 2, uint64(block.timestamp + 1 days));
    }

    function test_share_signature_and_wallet_loop_bid() public {
        (FundNFTPhase3 nft,) = _open();
        _etchRegistry();
        (address signer, uint256 key) = makeAddrAndKey("shareSigner");
        vm.prank(buyer);
        nft.transferFrom(buyer, signer, 2);
        address created = phase4.createShareAccount(address(nft), 2);
        FundShareAccount account = FundShareAccount(payable(created));
        bytes32 hash = keccak256("phase4-share");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, hash);
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(account.isValidSignature(hash, signature), bytes4(0x1626ba7e));
        assertEq(account.isValidSigner(signer, ""), bytes4(0x523e3260));
        assertEq(account.isValidSignature(hash, hex"11"), bytes4(0xffffffff));
    }

    function _etchRegistry() internal {
        ERC6551Registry reg = new ERC6551Registry();
        vm.etch(phase4.ERC6551_REGISTRY(), address(reg).code);
    }

    function _arm(FundNFTPhase3 nft, address who, uint64 expiry, uint256 cap) internal {
        FundVaultPhase3 vault = nft.vault();
        vm.prank(manager);
        vault.setExecutor(address(phase4), true);
        vm.prank(manager);
        phase4.arm(address(nft), who, expiry, cap);
    }

    function _grant(FundNFTPhase3 nft) internal view returns (address, uint64, uint256, bool) {
        (address who, uint64 expiry, uint256 cap, bool active,) = phase4.agentOf(address(nft));
        return (who, expiry, cap, active);
    }

    function _cosmetic() internal pure returns (FundPhase4.Cosmetic memory) {
        return FundPhase4.Cosmetic({
            name: "Copy",
            symbol: "CPY",
            imageUri: "",
            baseURI: "",
            mintPrice: 1 ether,
            raiseCap: 2 ether,
            entryFeeBps: 0,
            minSkinBps: 5000,
            raiseDuration: 7 days
        });
    }

    function _raise() internal returns (FundNFTPhase3 nft, FundVaultPhase3 vault) {
        nft = _create(1 ether, 2 ether, 0, 5000, 30 days);
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        vault = nft.vault();
    }

    function _open() internal returns (FundNFTPhase3 nft, FundVaultPhase3 vault) {
        (nft, vault) = _raise();
        vm.prank(manager);
        vault.enableInvesting();
    }

    function _create(uint256 price, uint256 cap, uint256 entryBps, uint256 skinBps, uint256 duration)
        internal
        returns (FundNFTPhase3 nft)
    {
        vm.prank(manager);
        nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3.Params({
                    templateId: templateId,
                    name: "Phase4",
                    symbol: "P4",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: price,
                    raiseCap: cap,
                    entryFeeBps: entryBps,
                    minSkinBps: skinBps,
                    raiseDuration: duration
                })
            )
        );
    }
}
