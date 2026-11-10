// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {FundFactoryPhase3} from "../../src/fund/phase3/FundFactoryPhase3.sol";
import {FundNFTPhase3} from "../../src/fund/phase3/FundNFTPhase3.sol";
import {FundVaultPhase3} from "../../src/fund/phase3/FundVaultPhase3.sol";
import {StrategyTemplate} from "../../src/fund/phase3/StrategyTemplate.sol";
import {FundCarryRights} from "../../src/fund/phase5/FundCarryRights.sol";
import {FundConvictionLock} from "../../src/fund/phase5/FundConvictionLock.sol";
import {FundNavFloor} from "../../src/fund/phase5/FundNavFloor.sol";
import {FundPhase5} from "../../src/fund/phase5/FundPhase5.sol";
import {FundSecondaryMarket} from "../../src/fund/phase5/FundSecondaryMarket.sol";
import {FundShareRenderer} from "../../src/fund/phase5/FundShareRenderer.sol";

/// @notice Phase 5 against the live Phase 3 factory on a Robinhood Chain fork.
///         Nothing is broadcast. The live factory, template, and facet code hashes stay put.
contract FundPhase5ForkTest is Test {
    address constant LIVE_FACTORY = 0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B;
    address constant LIVE_TEMPLATE = 0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba;
    address constant LIVE_FACET = 0x40Ef3ae910A46aDDC14f45F0983060161884f045;
    address constant LIVE_ALLOW = 0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19;

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

    function test_phase5_on_the_live_factory() public {
        if (!on) return;
        uint256 start = gasleft();
        FundPhase5 phase5 = new FundPhase5(LIVE_FACTORY);
        console2.log("phase5 constructor gas", start - gasleft());
        console2.log("phase5 runtime", address(phase5).code.length);
        assertEq(address(phase5.factory()), LIVE_FACTORY);

        FundSecondaryMarket market = FundSecondaryMarket(payable(phase5.market()));
        FundShareRenderer renderer = FundShareRenderer(phase5.renderer());
        FundConvictionLock locks = FundConvictionLock(payable(phase5.locks()));
        FundCarryRights carry = FundCarryRights(payable(phase5.carry()));
        FundNavFloor floor = FundNavFloor(payable(phase5.navFloor()));

        StrategyTemplate templates = StrategyTemplate(LIVE_TEMPLATE);
        FundFactoryPhase3 factory = FundFactoryPhase3(LIVE_FACTORY);
        vm.prank(templates.owner());
        uint256 id = templates.publish(
            keccak256("phase5-fork-quote"), "ipfs://phase5-fork-quote", new address[](0), 7500, 7500, 5000, 0, 0, 1 days
        );

        address manager = makeAddr("forkManager");
        address buyer = makeAddr("forkBuyer");
        address buyer2 = makeAddr("forkBuyer2");
        vm.deal(manager, 5 ether);
        vm.deal(buyer, 5 ether);
        vm.deal(buyer2, 5 ether);
        vm.prank(manager);
        FundNFTPhase3 nft = FundNFTPhase3(
            factory.createFund(
                FundFactoryPhase3.Params({
                    templateId: id,
                    name: "Fork5",
                    symbol: "F5",
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
        FundVaultPhase3 vault = nft.vault();
        vm.prank(manager);
        vault.enableInvesting();

        vm.prank(buyer);
        nft.approve(address(market), 2);
        vm.prank(buyer);
        uint256 listingId = market.list(address(nft), 2, 0.25 ether);
        vm.prank(buyer2);
        market.fill{value: 0.25 ether}(listingId);
        assertEq(nft.ownerOf(2), buyer2);
        vm.prank(buyer);
        market.withdraw();
        assertEq(market.owedTotal(), 0);

        string memory art = renderer.svg(address(nft), 2);
        assertGt(bytes(art).length, 0);
        assertTrue(_has(art, "Fork5"));
        assertTrue(_has(art, "#000000"));
        assertTrue(_has(art, "#ffffff"));
        assertTrue(_has(renderer.metadata(address(nft), 2), "Not financial advice"));

        vm.startPrank(buyer2);
        nft.approve(address(locks), 2);
        locks.lock(address(nft), 2, 30);
        vm.stopPrank();
        assertEq(nft.ownerOf(2), address(locks));
        assertEq(locks.tierOf(address(nft), 2), 30);
        vm.warp(block.timestamp + 30 days);
        vm.prank(buyer2);
        locks.unlock(address(nft), 2);

        vm.prank(manager);
        vault.setPayoutWallet(address(carry));
        vm.prank(manager);
        uint256 carryId = carry.arm(address(nft));
        assertEq(carry.ownerOf(carryId), manager);
        vm.prank(manager);
        carry.transferFrom(manager, buyer, carryId);
        assertEq(carry.ownerOf(carryId), buyer);

        (uint256 ethShare,,) = floor.quote(address(nft), 2);
        vm.startPrank(buyer2);
        nft.approve(address(floor), 2);
        floor.queue(address(nft), 2);
        vm.stopPrank();
        vm.warp(block.timestamp + floor.EXIT_COOLDOWN());
        uint256 before = buyer2.balance;
        vm.prank(buyer2);
        uint256 paid = floor.redeem(address(nft), 2);
        assertEq(paid, ethShare);
        assertEq(buyer2.balance - before, ethShare);
        assertEq(vault.claimableProtocolFee(), (2 ether * 20) / 10_000);

        assertEq(LIVE_FACTORY.codehash, factoryCode);
        assertEq(LIVE_TEMPLATE.codehash, templateCode);
        assertEq(LIVE_FACET.codehash, facetCode);
        assertEq(LIVE_ALLOW.codehash, allowCode);
    }

    function _has(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool matched = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }
}
