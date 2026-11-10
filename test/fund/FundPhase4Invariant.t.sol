// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FundAllowlist} from "../../src/fund/phase2/FundAllowlist.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundSwapFacetPhase3} from "../../src/fund/phase3/FundSwapFacetPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {StrategyTemplate} from "../../src/fund/phase3/StrategyTemplate.sol";
import {FundPhase4} from "../../src/fund/phase4/FundPhase4.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed, MockWETH, RateRouter} from "./InvestMocks.sol";

contract Phase4BidHandler is Test {
    FundPhase4 public phase4;
    FundNFTPhase3 public nft;
    address public holder;
    uint256 public vaultStart;

    constructor(FundPhase4 nextPhase, FundNFTPhase3 nextNft, address nextHolder, uint256 startBalance) {
        phase4 = nextPhase;
        nft = nextNft;
        holder = nextHolder;
        vaultStart = startBalance;
    }

    function bid(uint96 raw, uint32 dur) external {
        uint256 nav = nft.navPerNft();
        if (nav < phase4.MIN_BID()) return;
        uint256 amount = bound(raw, phase4.MIN_BID(), nav);
        uint256 window = bound(dur, 1, 7 days);
        address payer = address(uint160(bound(uint256(uint160(msg.sender)), 1, type(uint160).max - 1)));
        if (payer == holder || payer == address(phase4) || payer == address(nft)) return;
        vm.deal(payer, amount);
        vm.prank(payer);
        try phase4.placeBid{value: amount}(address(nft), 2, uint64(block.timestamp + window)) {} catch {}
    }

    function take(uint256 id) external {
        uint256 n = phase4.bidCount();
        if (n == 0) return;
        id = bound(id, 1, n);
        vm.prank(holder);
        try phase4.settleBid(id) {} catch {}
    }

    function pull(uint256 id) external {
        uint256 n = phase4.bidCount();
        if (n == 0) return;
        id = bound(id, 1, n);
        try phase4.cancelBid(id) {} catch {}
    }

    function warp(uint32 secondsForward) external {
        skip(bound(secondsForward, 0, 3 days));
    }
}

/// forge-config: default.invariant.runs = 32
/// forge-config: default.invariant.depth = 12
/// forge-config: ci.invariant.runs = 32
/// forge-config: ci.invariant.depth = 12
contract FundPhase4InvariantTest is Test {
    FundPhase4 phase4;
    FundNFTPhase3 nft;
    FundVaultPhase3 vault;
    Phase4BidHandler handler;
    address manager = makeAddr("manager");
    address buyer = makeAddr("buyer");

    function setUp() public {
        MockWETH weth = new MockWETH();
        MockFeed feed = new MockFeed();
        RateRouter router = new RateRouter(1e18, 1e18);
        vm.deal(address(router), 10 ether);
        vm.deal(manager, 10 ether);
        vm.deal(buyer, 10 ether);

        address[] memory routers = new address[](1);
        routers[0] = address(router);
        FundAllowlist.AssetInit[] memory seeded = new FundAllowlist.AssetInit[](1);
        seeded[0] = FundAllowlist.AssetInit(address(weth), true, address(0), 0, 0, 0);
        FundAllowlist allow = new FundAllowlist(address(this), 1 days, routers, seeded);
        StrategyTemplate templates = new StrategyTemplate(address(this));
        uint256 templateId = templates.publish(
            keccak256("quote"), "ipfs://phase4-invariant", new address[](0), 7500, 7500, 5000, 0, 0, 1 days
        );
        FundFactoryPhase3 factory = new FundFactoryPhase3(
            address(this), address(allow), address(weth), address(new FundSwapFacetPhase3()), address(templates)
        );
        phase4 = new FundPhase4(address(factory));

        vm.prank(manager);
        nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3.Params({
                    templateId: templateId,
                    name: "Inv",
                    symbol: "INV",
                    imageUri: "",
                    baseURI: "",
                    mintPrice: 1 ether,
                    raiseCap: 2 ether,
                    entryFeeBps: 0,
                    minSkinBps: 5000,
                    raiseDuration: 7 days
                })
            )
        );
        vm.prank(manager);
        nft.mint{value: 1 ether}(1);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
        vm.prank(buyer);
        nft.approve(address(phase4), 2);

        handler = new Phase4BidHandler(phase4, nft, buyer, address(vault).balance);
        targetContract(address(handler));
    }

    function invariant_bid_escrow_is_solvent() public view {
        uint256 sum;
        uint256 n = phase4.bidCount();
        for (uint256 i = 1; i <= n; ++i) {
            (address who,,, uint256 amount,) = phase4.bids(i);
            if (who != address(0)) sum += amount;
        }
        assertEq(phase4.escrowed(), sum);
        assertEq(address(phase4).balance, sum);
    }

    function invariant_vault_and_manager_stay_put() public view {
        assertEq(address(vault).balance, handler.vaultStart());
        assertEq(vault.manager(), manager);
        assertEq(nft.manager(), manager);
        assertEq(vault.nft(), address(nft));
    }
}
