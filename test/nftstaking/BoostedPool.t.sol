// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {NftStakingFactory} from "../../src/nftstaking/NftStakingFactory.sol";
import {NftStakingPool, BoostConfig} from "../../src/nftstaking/NftStakingPool.sol";
import {MockERC20, MockCollection} from "../mocks/CreatorMocks.sol";

contract BoostedPoolTest is Test {
    NftStakingFactory fac;
    MockCollection col;
    MockERC20 rew;
    address creator = address(0xC0);
    address alice = address(0xA1); // ids 1..10
    address bob = address(0xB0); // ids 11..20
    address carol = address(0xCA); // ids 21..30
    address alice2 = address(0xA2); // alice's second wallet
    uint256 constant R = 1_000_000e18;
    uint256 constant D = 14 days;

    function setUp() public {
        vm.warp(1_000_000);
        fac = new NftStakingFactory(address(1), address(2), false);
        col = new MockCollection();
        rew = new MockERC20("POLYDASH");
        rew.mint(creator, 100 * R);
        col.mint(alice, 10);
        col.mint(bob, 10);
        col.mint(carol, 10);
        vm.prank(creator);
        rew.approve(address(fac), type(uint256).max);
    }

    function _def() internal pure returns (BoostConfig memory b) {
        b.tierAfter = new uint32[](3);
        b.tierBps = new uint16[](3);
        b.tierAfter[1] = 3 days;
        b.tierAfter[2] = 7 days;
        b.tierBps[0] = 10_000;
        b.tierBps[1] = 12_500;
        b.tierBps[2] = 15_000;
        b.setMin = 3;
        b.setBonusBps = 1000;
    }

    function _pool(BoostConfig memory b) internal returns (NftStakingPool p) {
        vm.prank(creator);
        p = NftStakingPool(fac.createBoostedPool(address(col), address(rew), R, 0, D, b));
        address[4] memory us = [alice, bob, carol, alice2];
        for (uint256 i; i < 4; ++i) {
            vm.prank(us[i]);
            col.setApprovalForAll(address(p), true);
        }
    }

    function _ids(uint256 a, uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = a + i;
        }
    }

    function test_validateBoost() public {
        NftStakingPool p = _pool(_def());
        BoostConfig memory b = _def();
        b.tierBps[2] = 30_001; // > 3x
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        p.validateBoost(b);
        b = _def();
        b.tierAfter[0] = 1;
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        p.validateBoost(b);
        b = _def(); // not increasing
        b.tierAfter[2] = 3 days;
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        p.validateBoost(b);
        b = _def(); // decreasing
        b.tierBps[2] = 12_000;
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        p.validateBoost(b);
        b = _def();
        b.tierBps[0] = 9000;
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        p.validateBoost(b);
        b = _def();
        b.setBonusBps = 5001;
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        p.validateBoost(b);
        b.tierAfter = new uint32[](5);
        b.tierBps = new uint16[](5);
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        p.validateBoost(b);
        // factory refuses bad config
        b = _def();
        b.tierBps[1] = 40_000;
        vm.prank(creator);
        vm.expectRevert(NftStakingPool.InvalidBoost.selector);
        fac.createBoostedPool(address(col), address(rew), R, 0, D, b);
    }

    function test_tierMath_and_checkpoint() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice);
        p.stake(_ids(1, 1));
        assertEq(p.userWeight(alice), 10_000);
        assertEq(p.timeToNextTier(1), 3 days);
        vm.warp(block.timestamp + 3 days - 1);
        assertEq(p.eligibleTierOf(1), 0);
        assertEq(p.timeToNextTier(1), 1);
        vm.warp(block.timestamp + 1);
        assertEq(p.eligibleTierOf(1), 1);
        assertEq(p.tierOf(1), 0); // not checkpointed yet
        assertEq(p.timeToNextTier(1), 4 days);
        vm.warp(block.timestamp + 4 days);
        assertEq(p.eligibleTierOf(1), 2);
        assertEq(p.timeToNextTier(1), 0);
        vm.prank(bob); // anyone can poke
        p.poke(_ids(1, 1));
        assertEq(p.tierOf(1), 2);
        assertEq(p.userWeight(alice), 15_000);
        // poke again is a no-op
        p.poke(_ids(1, 1));
        assertEq(p.userWeight(alice), 15_000);
    }

    function test_boostAppliesFromCheckpointOnly() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.prank(bob);
        p.stake(_ids(11, 1));
        vm.warp(block.timestamp + 7 days);
        // both equal so far even though alice is eligible for tier 2: split 50/50
        assertApproxEqAbs(p.earned(alice), p.earned(bob), 1);
        p.poke(_ids(1, 1)); // alice only
        uint256 a0 = p.earned(alice);
        uint256 b0 = p.earned(bob);
        vm.warp(block.timestamp + 1 days);
        uint256 da = p.earned(alice) - a0;
        uint256 db = p.earned(bob) - b0;
        assertApproxEqRel(da * 10_000 / db, 15_000, 1e14); // 1.5x vs 1.0x
    }

    function test_setBonusThresholds() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice);
        p.stake(_ids(1, 2));
        assertEq(p.userWeight(alice), 20_000);
        assertFalse(p.hasSetBonus(alice));
        vm.prank(alice);
        p.stake(_ids(3, 1));
        assertEq(p.userWeight(alice), 33_000);
        assertTrue(p.hasSetBonus(alice));
        vm.prank(alice);
        p.stake(_ids(4, 2));
        assertEq(p.userWeight(alice), 55_000);
        vm.prank(alice);
        p.withdraw(_ids(3, 3));
        assertEq(p.userWeight(alice), 20_000);
        assertEq(p.totalWeight(), 20_000);
    }

    function test_resetOnWithdraw() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + 8 days);
        p.poke(_ids(1, 1));
        assertEq(p.userWeight(alice), 15_000);
        vm.prank(alice);
        p.withdraw(_ids(1, 1));
        assertEq(p.totalWeight(), 0);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        assertEq(p.tierOf(1), 0);
        assertEq(p.eligibleTierOf(1), 0);
        assertEq(p.timeToNextTier(1), 3 days);
        p.poke(_ids(1, 1));
        assertEq(p.userWeight(alice), 10_000);
    }

    function test_gaming_transferBetweenOwnWallets_losesTier() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + 8 days);
        p.poke(_ids(1, 1));
        vm.prank(alice);
        p.withdraw(_ids(1, 1));
        vm.prank(alice);
        col.transferFrom(alice, alice2, 1);
        vm.prank(alice2);
        p.stake(_ids(1, 1));
        assertEq(p.tierOf(1), 0);
        assertEq(p.userWeight(alice2), 10_000);
        assertEq(p.stakedSince(1), block.timestamp);
        // direct safeTransfer into the pool also starts at tier 0
        vm.prank(alice);
        col.safeTransferFrom(alice, address(p), 2);
        assertEq(p.tierOf(2), 0);
        assertEq(p.stakerOf(2), alice);
    }

    function test_gaming_flashSetBonus_earnsNothing() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice);
        p.stake(_ids(1, 2));
        vm.prank(bob);
        p.stake(_ids(11, 2));
        vm.warp(block.timestamp + 1 days);
        uint256 before = p.earned(alice);
        // same block: add a 3rd NFT for the set bonus, then pull it out
        vm.startPrank(alice);
        p.stake(_ids(3, 1));
        p.withdraw(_ids(3, 1));
        vm.stopPrank();
        uint256 paid = rew.balanceOf(alice);
        assertEq(paid + p.earned(alice), before); // nothing extra
        vm.warp(block.timestamp + 1 days);
        assertApproxEqAbs(p.earned(alice), p.earned(bob) - (p.earned(bob) - p.earned(alice)), 0);
        assertApproxEqRel(p.earned(alice), p.earned(bob) - before, 1e12); // equal shares again
    }

    function test_boostOff_equalsPlainPool() public {
        BoostConfig memory b;
        b.tierAfter = new uint32[](1);
        b.tierBps = new uint16[](1);
        b.tierBps[0] = 10_000;
        NftStakingPool p = _pool(b);
        vm.prank(alice);
        p.stake(_ids(1, 5));
        vm.warp(block.timestamp + 10 days);
        p.poke(_ids(1, 5));
        assertEq(p.userWeight(alice), 50_000);
        assertFalse(p.hasSetBonus(alice));
        assertEq(p.timeToNextTier(1), 0);
    }

    /// Worked example: 10 NFTs, 3 users, RUGSLAYERS defaults, day 8-9 window.
    function test_workedExample() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice); // day 0
        p.stake(_ids(1, 5));
        vm.prank(bob); // day 0
        p.stake(_ids(11, 3));
        uint256 t0 = p.startTime();
        vm.warp(t0 + 4 days);
        vm.prank(carol); // day 4
        p.stake(_ids(21, 2));
        vm.warp(t0 + 8 days); // day 8
        p.poke(_ids(1, 5));
        p.poke(_ids(11, 3));
        p.poke(_ids(21, 2)); // carol has 4 days -> tier 1
        console2.log("weights a/b/c/total", p.userWeight(alice), p.userWeight(bob), p.userWeight(carol));
        console2.log("totalWeight", p.totalWeight());
        console2.log("perDay a", p.rewardsPerDay(alice) / 1e18);
        console2.log("perDay b", p.rewardsPerDay(bob) / 1e18);
        console2.log("perDay c", p.rewardsPerDay(carol) / 1e18);
        assertEq(p.userWeight(alice), 82_500); // 5 x 1.5 x 1.1
        assertEq(p.userWeight(bob), 49_500); // 3 x 1.5 x 1.1
        assertEq(p.userWeight(carol), 25_000); // 2 x 1.25, no set bonus
        // one day at these weights, then everyone claims
        uint256 a0 = p.earned(alice);
        uint256 b0 = p.earned(bob);
        uint256 c0 = p.earned(carol);
        vm.warp(t0 + 9 days);
        console2.log("day8-9 a", (p.earned(alice) - a0) / 1e18);
        console2.log("day8-9 b", (p.earned(bob) - b0) / 1e18);
        console2.log("day8-9 c", (p.earned(carol) - c0) / 1e18);
        console2.log("days0-8 a b c", a0 / 1e18, b0 / 1e18, c0 / 1e18);
    }

    function test_neverPaysMoreThanFunded() public {
        NftStakingPool p = _pool(_def());
        vm.prank(alice);
        p.stake(_ids(1, 3));
        vm.prank(bob);
        p.stake(_ids(11, 1));
        vm.warp(block.timestamp + 5 days);
        p.poke(_ids(1, 3));
        vm.warp(block.timestamp + 30 days);
        p.poke(_ids(11, 1)); // after end: no-op
        vm.prank(alice);
        p.withdraw(_ids(1, 3));
        vm.prank(bob);
        p.withdraw(_ids(11, 1));
        uint256 paid = rew.balanceOf(alice) + rew.balanceOf(bob);
        assertLe(paid, R);
        assertGe(paid, R - 10); // nobody idle -> all but dust paid out
    }

    /// Fuzz: random sequence of stake / withdraw / poke / claim / emergency / time across 3 users;
    /// at the end everyone exits and the creator recovers: claims + leftover == funded.
    function testFuzz_conservation(uint256 seed) public {
        NftStakingPool p = _pool(_def());
        address[3] memory us = [alice, bob, carol];
        uint256 recovered;
        for (uint256 step; step < 40; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            uint256 ui = seed % 3;
            address u = us[ui];
            uint256 id = ui * 10 + 1 + (seed >> 8) % 10;
            uint256 op = (seed >> 16) % 6;
            uint256[] memory one = _ids(id, 1);
            vm.startPrank(u);
            if (op == 0 && col.ownerOf(id) == u && block.timestamp < p.endTime()) p.stake(one);
            else if (op == 1 && p.stakerOf(id) == u) p.withdraw(one);
            else if (op == 2) p.poke(one);
            else if (op == 3) p.claim();
            else if (op == 4 && p.stakerOf(id) == u) p.emergencyWithdraw(one);
            else if (op == 5) p.pokeAndClaim(one);
            vm.stopPrank();
            vm.warp(block.timestamp + (seed >> 32) % 2 days);
        }
        vm.warp(p.endTime() + 1);
        for (uint256 i; i < 3; ++i) {
            for (uint256 k = 1; k <= 10; ++k) {
                uint256 id = i * 10 + k;
                if (p.stakerOf(id) == us[i]) {
                    vm.prank(us[i]);
                    p.withdraw(_ids(id, 1));
                }
            }
            vm.prank(us[i]);
            p.claim();
        }
        assertEq(p.totalWeight(), 0);
        assertEq(p.totalStaked(), 0);
        if (p.pendingUnallocated() > 0) {
            uint256 b0 = rew.balanceOf(creator);
            vm.prank(creator);
            try p.recoverUnallocated() {
                recovered = rew.balanceOf(creator) - b0;
            } catch {}
        }
        uint256 claims = rew.balanceOf(alice) + rew.balanceOf(bob) + rew.balanceOf(carol);
        uint256 left = rew.balanceOf(address(p));
        assertEq(claims + recovered + left, R);
        assertLe(left, 10); // only rounding dust stays behind
    }
}
