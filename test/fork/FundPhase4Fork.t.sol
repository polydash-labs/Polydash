// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {StrategyTemplate} from "../../src/fund/phase3/StrategyTemplate.sol";
import {FundPhase4} from "../../src/fund/phase4/FundPhase4.sol";
import {FundShareAccount} from "../../src/fund/phase4/FundShareAccount.sol";

/// @notice Phase 4 against the live Phase 3 factory on a Robinhood Chain fork.
///         Nothing is broadcast. The live factory, template, and facet code hashes stay put.
contract FundPhase4ForkTest is Test {
    address constant LIVE_FACTORY = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;
    address constant LIVE_TEMPLATE = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address constant LIVE_FACET = 0x40Ef3ae910A46aDDC14f45F0983060161884f045;
    address constant LIVE_ALLOW = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    bool on;
    bytes32 factoryCode;
    bytes32 templateCode;
    bytes32 facetCode;
    bytes32 allowCode;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        if (block.chainid != 4663) return;
        on = true;
        factoryCode = LIVE_FACTORY.codehash;
        templateCode = LIVE_TEMPLATE.codehash;
        facetCode = LIVE_FACET.codehash;
        allowCode = LIVE_ALLOW.codehash;
    }

    function test_phase4_on_the_live_factory() public {
        if (!on) return;
        assertGt(REGISTRY.code.length, 0);
        assertEq(REGISTRY.code.length, 571);

        uint256 start = gasleft();
        FundPhase4 phase4 = new FundPhase4(LIVE_FACTORY);
        uint256 used = start - gasleft();
        console2.log("phase4 constructor gas", used);
        console2.log("basefee", block.basefee);
        console2.log("phase4 runtime", address(phase4).code.length);
        console2.log("share runtime", phase4.shareAccount().code.length);

        assertTrue(phase4.shareAccountsEnabled());
        assertEq(address(phase4.factory()), LIVE_FACTORY);
        assertEq(phase4.weth(), WETH);

        StrategyTemplate templates = StrategyTemplate(LIVE_TEMPLATE);
        FundFactoryPhase3 factory = FundFactoryPhase3(LIVE_FACTORY);
        uint256 beforeFunds = factory.allFundsLength();
        vm.prank(templates.owner());
        uint256 id = templates.publish(
            keccak256("phase4-fork-quote"), "ipfs://phase4-fork-quote", new address[](0), 7500, 7500, 5000, 0, 0, 1 days
        );

        address manager = makeAddr("forkManager");
        vm.deal(manager, 5 ether);
        vm.prank(manager);
        FundNFTPhase3 nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3.Params({
                    templateId: id,
                    name: "Fork",
                    symbol: "FRK",
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
        address buyer = makeAddr("forkBuyer");
        vm.deal(buyer, 5 ether);
        vm.prank(buyer);
        nft.mint{value: 1 ether}(1);
        FundVaultPhase3 vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();
        assertEq(factory.allFundsLength(), beforeFunds + 1);
        assertTrue(factory.isFund(address(nft)));

        vm.prank(manager);
        vault.setExecutor(address(phase4), true);
        vm.prank(manager);
        phase4.arm(address(nft), buyer, uint64(block.timestamp + 1 days), 0.2 ether);
        uint256 ethBefore = address(vault).balance;
        vm.prank(buyer);
        phase4.agentSwap(address(nft), address(0), address(0), WETH, 0.2 ether, 0.2 ether, "");
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0.2 ether);
        assertEq(address(vault).balance, ethBefore - 0.2 ether);
        vm.prank(buyer);
        vm.expectRevert(FundPhase4.AmountCap.selector);
        phase4.agentSwap(address(nft), address(0), address(0), WETH, 0.3 ether, 0.3 ether, "");

        phase4.openSeason(address(nft));
        assertEq(phase4.seasonCount(address(nft)), 1);
        FundPhase4.LiveCard memory card = phase4.liveCard(address(nft));
        assertGt(card.navPerShare, 0);
        assertEq(card.tradeCount, vault.tradeCount());

        address account = phase4.createShareAccount(address(nft), 2);
        assertEq(FundShareAccount(payable(account)).owner(), buyer);
        (address predicted, bool enabled) = phase4.shareWallet(address(nft), 2);
        assertTrue(enabled);
        assertEq(predicted, account);

        vm.prank(buyer);
        nft.approve(address(phase4), 2);
        address sellerFriend = makeAddr("forkBidder");
        vm.deal(sellerFriend, 1 ether);
        uint256 nav = nft.navPerNft();
        uint256 offer = nav > 0.2 ether ? 0.2 ether : nav;
        vm.prank(sellerFriend);
        uint256 bidId = phase4.placeBid{value: offer}(address(nft), 2, uint64(block.timestamp + 1 days));
        uint256 sellerBefore = buyer.balance;
        vm.prank(buyer);
        phase4.settleBid(bidId);
        assertEq(nft.ownerOf(2), sellerFriend);
        assertEq(buyer.balance - sellerBefore, offer);
        assertEq(FundShareAccount(payable(account)).owner(), sellerFriend);
        assertEq(phase4.escrowed(), 0);

        assertEq(LIVE_FACTORY.codehash, factoryCode);
        assertEq(LIVE_TEMPLATE.codehash, templateCode);
        assertEq(LIVE_FACET.codehash, facetCode);
        assertEq(LIVE_ALLOW.codehash, allowCode);
    }
}
