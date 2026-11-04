// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NftStakingFactory} from "../../src/nftstaking/NftStakingFactory.sol";
import {NftStakingPool} from "../../src/nftstaking/NftStakingPool.sol";
import {MockERC20, FeeERC20, HookERC20, IHook, MockCollection, MockCollectionFactory} from "../mocks/CreatorMocks.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Reenterer is IHook {
    NftStakingPool public pool;
    uint256 public mode; // 1 = claim, 2 = withdraw
    uint256[] ids;
    bool public reverted;

    function setup(NftStakingPool p, uint256 m, uint256[] memory i) external {
        pool = p;
        mode = m;
        ids = i;
    }

    function onHook() external {
        if (mode == 0) return;
        uint256 m = mode;
        mode = 0;
        if (m == 1) {
            try pool.claim() {}
            catch (bytes memory r) {
                reverted = bytes4(r) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
            }
        } else {
            try pool.withdraw(ids) {}
            catch (bytes memory r) {
                reverted = bytes4(r) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
            }
        }
    }

    function approveAndStake(MockCollection c) external {
        c.setApprovalForAll(address(pool), true);
        pool.stake(ids);
    }

    function doClaim() external {
        pool.claim();
    }
}

contract NftStakingPoolTest is Test {
    NftStakingFactory fac;
    MockCollectionFactory fixedF;
    MockCollectionFactory curveF;
    MockCollection col;
    MockERC20 rew;
    address creator = address(0xC0);
    address alice = address(0xA1);
    address bob = address(0xB0);
    uint256 constant R = 1_000_000e18;
    uint256 constant D = 100 days;

    function setUp() public {
        vm.warp(1_000_000);
        fixedF = new MockCollectionFactory();
        curveF = new MockCollectionFactory();
        fac = new NftStakingFactory(address(fixedF), address(curveF), true);
        col = new MockCollection();
        fixedF.set(address(col), true);
        rew = new MockERC20("POLYDASH");
        rew.mint(creator, 100 * R);
        rew.mint(bob, 100 * R);
        col.mint(alice, 10); // ids 1..10
        col.mint(bob, 10); // ids 11..20
        vm.prank(creator);
        rew.approve(address(fac), type(uint256).max);
    }

    function _pool(uint256 amt, uint256 start) internal returns (NftStakingPool p) {
        vm.prank(creator);
        p = NftStakingPool(fac.createPool(address(col), address(rew), amt, start, D));
        vm.prank(alice);
        col.setApprovalForAll(address(p), true);
        vm.prank(bob);
        col.setApprovalForAll(address(p), true);
    }

    function _ids(uint256 a, uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = a + i;
        }
    }

    function test_factoryRestriction() public {
        MockCollection other = new MockCollection();
        vm.prank(creator);
        vm.expectRevert(NftStakingFactory.CollectionNotAllowed.selector);
        fac.createPool(address(other), address(rew), R, 0, D);
        curveF.set(address(other), true);
        vm.prank(creator);
        fac.createPool(address(other), address(rew), R, 0, D);
        NftStakingFactory open = new NftStakingFactory(address(0), address(0), false);
        assertTrue(open.isAllowedCollection(address(new MockCollection())));
        assertFalse(open.isAllowedCollection(address(0xdead)));
        vm.expectRevert(NftStakingFactory.InvalidParams.selector);
        new NftStakingFactory(address(0), address(0), true);
    }

    function test_singleStakerGetsAll() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        p.stake(_ids(1, 3));
        assertEq(col.ownerOf(1), address(p));
        assertEq(p.stakerOf(1), alice);
        vm.warp(block.timestamp + D + 1);
        vm.prank(alice);
        p.withdraw(_ids(1, 3));
        assertApproxEqAbs(rew.balanceOf(alice), R, 1);
        assertEq(col.ownerOf(1), alice);
        assertEq(fac.poolsByRewardToken(address(rew))[0], address(p));
    }

    function test_multipleStakersProRata() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.prank(bob);
        p.stake(_ids(11, 3));
        vm.warp(block.timestamp + D);
        vm.prank(alice);
        p.claim();
        vm.prank(bob);
        p.claim();
        assertApproxEqAbs(rew.balanceOf(alice), R / 4, 2);
        assertApproxEqAbs(rew.balanceOf(bob), 100 * R + 3 * R / 4, 2);
    }

    function test_zeroStakerPeriodGoesToCreator() public {
        NftStakingPool p = _pool(R, 0);
        vm.warp(block.timestamp + D / 2);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + D);
        vm.prank(alice);
        p.claim();
        assertApproxEqAbs(rew.balanceOf(alice), R / 2, 2);
        assertApproxEqAbs(p.pendingUnallocated(), R / 2, 2);
        vm.prank(alice);
        vm.expectRevert(NftStakingPool.NotCreator.selector);
        p.recoverUnallocated();
        uint256 b = rew.balanceOf(creator);
        vm.prank(creator);
        p.recoverUnallocated();
        assertApproxEqAbs(rew.balanceOf(creator) - b, R / 2, 2);
    }

    function test_recoverBeforeEndReverts() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(creator);
        vm.expectRevert(NftStakingPool.PoolNotEnded.selector);
        p.recoverUnallocated();
    }

    function test_recoverNeverTakesStakersRewards() public {
        NftStakingPool p = _pool(R, 0);
        vm.warp(block.timestamp + D / 2);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + D); // alice has not claimed
        vm.prank(creator);
        p.recoverUnallocated();
        vm.prank(alice);
        p.withdraw(_ids(1, 1));
        assertApproxEqAbs(rew.balanceOf(alice), R / 2, 2);
    }

    function test_lateFundingStreamsOverRemaining() public {
        NftStakingPool p = _pool(0, 0);
        assertFalse(p.isActive());
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + D / 2);
        vm.prank(bob);
        rew.approve(address(p), R);
        vm.prank(bob);
        p.fund(R); // streams over remaining 50 days
        vm.warp(block.timestamp + D / 2);
        vm.prank(alice);
        p.claim();
        assertApproxEqAbs(rew.balanceOf(alice), R, 2);
    }

    function test_fundAfterEndReverts() public {
        NftStakingPool p = _pool(R, 0);
        vm.warp(block.timestamp + D);
        vm.prank(bob);
        rew.approve(address(p), R);
        vm.prank(bob);
        vm.expectRevert(NftStakingPool.PoolEnded.selector);
        p.fund(R);
    }

    function test_futureStart() public {
        NftStakingPool p = _pool(R, block.timestamp + 10 days);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + 10 days);
        assertEq(p.earned(alice), 0);
        vm.warp(block.timestamp + D);
        assertApproxEqAbs(p.earned(alice), R, 2);
    }

    function test_feeOnTransferFunding() public {
        FeeERC20 f = new FeeERC20(1000);
        f.mint(creator, R);
        vm.startPrank(creator);
        f.approve(address(fac), R);
        NftStakingPool p = NftStakingPool(fac.createPool(address(col), address(f), R, 0, D));
        vm.stopPrank();
        assertEq(p.totalFunded(), R * 9 / 10);
        vm.prank(alice);
        col.setApprovalForAll(address(p), true);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + D);
        vm.prank(alice);
        p.claim(); // pays from what the pool really holds; no revert
        assertApproxEqAbs(f.balanceOf(alice), R * 9 / 10 * 9 / 10, 1e6);
    }

    function test_stakedNftCannotBeBurnedOrMovedByUser() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.prank(alice);
        vm.expectRevert(bytes("NotOwner"));
        col.redeem(_ids(1, 1));
        vm.prank(alice);
        vm.expectRevert();
        col.transferFrom(address(p), alice, 1);
        vm.prank(bob);
        vm.expectRevert(NftStakingPool.NotStaker.selector);
        p.withdraw(_ids(1, 1));
        vm.prank(bob);
        vm.expectRevert(NftStakingPool.NotStaker.selector);
        p.emergencyWithdraw(_ids(1, 1));
        // after withdraw the user can burn again
        vm.prank(alice);
        p.withdraw(_ids(1, 1));
        vm.prank(alice);
        col.redeem(_ids(1, 1));
    }

    function test_safeTransferDirectStake() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        col.safeTransferFrom(alice, address(p), 5);
        assertEq(p.stakerOf(5), alice);
        assertEq(p.balanceOf(alice), 1);
        vm.warp(block.timestamp + D);
        vm.prank(alice);
        p.withdraw(_ids(5, 1));
        assertApproxEqAbs(rew.balanceOf(alice), R, 2);
    }

    function test_onReceivedRejectsOtherCollectionsAndMints() public {
        NftStakingPool p = _pool(R, 0);
        MockCollection other = new MockCollection();
        other.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(NftStakingPool.WrongCollection.selector);
        other.safeTransferFrom(alice, address(p), 1);
        vm.expectRevert(NftStakingPool.ZeroAddress.selector);
        col.safeMintTo(address(p));
    }

    function test_emergencyWithdrawForfeits() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        p.stake(_ids(1, 2));
        vm.prank(bob);
        p.stake(_ids(11, 2));
        vm.warp(block.timestamp + D / 2);
        vm.prank(alice);
        p.emergencyWithdraw(_ids(1, 2));
        assertEq(rew.balanceOf(alice), 0);
        assertEq(col.ownerOf(1), alice);
        vm.warp(block.timestamp + D);
        vm.prank(bob);
        p.claim();
        assertApproxEqAbs(rew.balanceOf(bob), 100 * R + 3 * R / 4, 2);
        vm.prank(creator);
        p.recoverUnallocated();
        assertApproxEqAbs(rew.balanceOf(address(p)), 0, 4);
    }

    function test_partialWithdraw() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        p.stake(_ids(1, 4));
        vm.warp(block.timestamp + D / 2);
        vm.prank(alice);
        p.withdraw(_ids(1, 2));
        assertEq(p.balanceOf(alice), 2);
        vm.warp(block.timestamp + D);
        vm.prank(alice);
        p.claim();
        assertApproxEqAbs(rew.balanceOf(alice), R, 3);
    }

    function test_stakeAfterEndReverts_withdrawStillWorks() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.warp(block.timestamp + D);
        vm.prank(alice);
        vm.expectRevert(NftStakingPool.PoolEnded.selector);
        p.stake(_ids(2, 1));
        vm.prank(alice);
        p.withdraw(_ids(1, 1));
    }

    function test_batchLimitsAndEmpty() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        vm.expectRevert(NftStakingPool.ZeroAmount.selector);
        p.stake(new uint256[](0));
        vm.prank(alice);
        vm.expectRevert(NftStakingPool.BatchTooLarge.selector);
        p.stake(new uint256[](101));
    }

    function test_duplicateIdInBatchReverts() public {
        NftStakingPool p = _pool(R, 0);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 1;
        vm.prank(alice);
        vm.expectRevert();
        p.stake(ids);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.prank(alice);
        vm.expectRevert(NftStakingPool.NotStaker.selector);
        p.withdraw(ids);
    }

    function test_onlyFactoryFundFrom() public {
        NftStakingPool p = _pool(R, 0);
        vm.prank(alice);
        vm.expectRevert(NftStakingPool.NotCreator.selector);
        p.initialFunding(creator);
    }

    function test_reentrancyViaRewardHook() public {
        HookERC20 h = new HookERC20();
        h.mint(creator, R);
        vm.startPrank(creator);
        h.approve(address(fac), R);
        NftStakingPool p = NftStakingPool(fac.createPool(address(col), address(h), R, 0, D));
        vm.stopPrank();
        Reenterer att = new Reenterer();
        col.mint(address(att), 2); // ids 21, 22
        uint256[] memory ids = _ids(21, 2);
        att.setup(p, 0, ids);
        att.approveAndStake(col);
        h.setHook(address(att));
        vm.warp(block.timestamp + D / 2);
        att.setup(p, 2, ids); // try to withdraw during the reward transfer
        att.doClaim();
        assertTrue(att.reverted());
        assertEq(p.balanceOf(address(att)), 2);
        att.setup(p, 1, ids);
        vm.warp(block.timestamp + 1 days);
        att.doClaim();
        assertTrue(att.reverted());
    }

    function test_tinyRewardsRoundingNotLost() public {
        vm.prank(creator);
        NftStakingPool p = NftStakingPool(fac.createPool(address(col), address(rew), 7, 0, D));
        vm.prank(alice);
        col.setApprovalForAll(address(p), true);
        vm.prank(bob);
        col.setApprovalForAll(address(p), true);
        vm.prank(alice);
        p.stake(_ids(1, 1));
        vm.prank(bob);
        p.stake(_ids(11, 2));
        for (uint256 i; i < 50; ++i) {
            vm.warp(block.timestamp + D / 50);
            vm.prank(alice);
            p.claim();
            vm.prank(bob);
            p.claim();
        }
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        p.withdraw(_ids(1, 1));
        vm.prank(bob);
        p.withdraw(_ids(11, 2));
        uint256 paid = rew.balanceOf(alice) + (rew.balanceOf(bob) - 100 * R);
        assertGe(paid, 5); // 7 * total, at most 1 unit stuck per user as fraction
        assertLe(paid, 7);
    }

    /// Conservation: payouts + recoverable never exceed funding, and stakers get >= funded - dust
    /// when someone is always staked.
    function testFuzz_conservation(uint96 amt, uint32 t1, uint32 t2, uint8 na, uint8 nb) public {
        amt = uint96(bound(amt, 1e6, 1e30));
        na = uint8(bound(na, 1, 10));
        nb = uint8(bound(nb, 1, 10));
        rew.mint(creator, amt);
        NftStakingPool p = _pool(amt, 0);
        vm.prank(alice);
        p.stake(_ids(1, na));
        vm.warp(block.timestamp + bound(t1, 0, D - 1));
        vm.prank(bob);
        p.stake(_ids(11, nb));
        vm.warp(block.timestamp + bound(t2, 0, D));
        vm.prank(alice);
        p.withdraw(_ids(1, na));
        vm.warp(block.timestamp + D);
        vm.prank(bob);
        p.withdraw(_ids(11, nb));
        uint256 paid = rew.balanceOf(alice) + (rew.balanceOf(bob) - 100 * R);
        uint256 b0 = rew.balanceOf(creator);
        vm.prank(creator);
        try p.recoverUnallocated() {} catch {}
        uint256 rec = rew.balanceOf(creator) - b0;
        assertLe(paid + rec, amt);
        assertGe(paid + rec + 3, amt); // at most rounding dust left
    }

    /// Two stakers with fuzzed counts split exactly pro rata over the same window.
    function testFuzz_proRata(uint8 na, uint8 nb, uint96 amt) public {
        na = uint8(bound(na, 1, 10));
        nb = uint8(bound(nb, 1, 10));
        amt = uint96(bound(amt, 1e9, 1e30));
        rew.mint(creator, amt);
        NftStakingPool p = _pool(amt, block.timestamp + 1);
        vm.prank(alice);
        p.stake(_ids(1, na));
        vm.prank(bob);
        p.stake(_ids(11, nb));
        vm.warp(block.timestamp + D + 2);
        uint256 ea = p.earned(alice);
        uint256 eb = p.earned(bob);
        assertApproxEqAbs(ea, uint256(amt) * na / (uint256(na) + nb), 2);
        assertApproxEqAbs(eb, uint256(amt) * nb / (uint256(na) + nb), 2);
    }
}
