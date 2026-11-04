// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreatorVestingFactory} from "../../src/vesting/CreatorVestingFactory.sol";
import {CreatorVestingVault} from "../../src/vesting/CreatorVestingVault.sol";
import {PolydashStakingFactoryV2} from "../../src/v2/PolydashStakingFactoryV2.sol";
import {PolydashStakingPoolV2} from "../../src/v2/PolydashStakingPoolV2.sol";
import {MockERC20, FeeERC20, MockLaunchFactory} from "../mocks/CreatorMocks.sol";

contract CreatorVestingVaultTest is Test {
    PolydashStakingFactoryV2 sf;
    CreatorVestingFactory vf;
    MockLaunchFactory lf;
    MockLaunchFactory lfOld;
    MockERC20 tok;
    MockERC20 rew;
    address creator = address(0xC0);
    address alice = address(0xA1);
    address feeTo = address(0xFE);
    uint256 constant ALLOC = 1_000_000e18;

    function setUp() public {
        vm.warp(1_000_000);
        sf = new PolydashStakingFactoryV2(feeTo);
        lf = new MockLaunchFactory();
        lfOld = new MockLaunchFactory();
        vf = new CreatorVestingFactory(address(sf), address(lf), address(lfOld));
        tok = new MockERC20("TOK");
        rew = new MockERC20("REW");
        lf.set(address(tok), address(0x1A));
        tok.mint(creator, 10 * ALLOC);
        rew.mint(creator, 10 * ALLOC);
        tok.mint(alice, ALLOC);
        vm.startPrank(creator);
        tok.approve(address(vf), type(uint256).max);
        tok.approve(address(sf), type(uint256).max);
        rew.approve(address(sf), type(uint256).max);
        vm.stopPrank();
    }

    function _pool(address rewardToken, uint256 dur, uint256 cap) internal returns (PolydashStakingPoolV2) {
        vm.prank(creator);
        return PolydashStakingPoolV2(sf.createPool(address(tok), rewardToken, 100_000e18, 0, dur, cap, 100, "P", ""));
    }

    function _vault(address pool, uint64 cliff, uint64 dur) internal returns (CreatorVestingVault) {
        vm.prank(creator);
        return CreatorVestingVault(vf.createVault(address(tok), creator, ALLOC, 0, cliff, dur, pool));
    }

    function test_createStakesIntoPool() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 365 days, 0);
        CreatorVestingVault v = _vault(address(p), 30 days, 365 days);
        assertEq(v.totalAllocation(), ALLOC);
        assertEq(p.balanceOf(address(v)), ALLOC);
        assertEq(v.stakedAmount(), ALLOC);
        assertEq(v.idleAmount(), 0);
        assertEq(v.lockedAmount(), ALLOC);
        assertEq(v.endTime(), block.timestamp + 365 days);
        assertEq(address(v.pool()), address(p));
        assertTrue(vf.isVault(address(v)));
        assertEq(vf.vaultsByToken(address(tok))[0], address(v));
        assertEq(vf.vaultsByBeneficiary(creator)[0], address(v));
        assertEq(vf.totalLockedForToken(address(tok)), ALLOC);
    }

    function test_noPoolUnstakedLock() public {
        CreatorVestingVault v = _vault(address(0), 0, 100 days);
        assertEq(v.idleAmount(), ALLOC);
        vm.warp(block.timestamp + 50 days);
        v.release();
        assertEq(tok.balanceOf(creator), 9 * ALLOC + ALLOC / 2);
    }

    function test_rejectsForeignPoolAndWrongToken() public {
        // pool for a different stake token
        vm.prank(creator);
        address p2 = sf.createPool(address(rew), address(rew), 1e18, 0, 30 days, 0, 100, "X", "");
        vm.prank(creator);
        vm.expectRevert(CreatorVestingVault.InvalidPool.selector);
        vf.createVault(address(tok), creator, ALLOC, 0, 0, 100 days, p2);
        // a contract that is not a factory pool
        vm.prank(creator);
        vm.expectRevert(CreatorVestingVault.InvalidPool.selector);
        vf.createVault(address(tok), creator, ALLOC, 0, 0, 100 days, address(rew));
    }

    function test_badParams() public {
        vm.startPrank(creator);
        vm.expectRevert(CreatorVestingFactory.InvalidParams.selector);
        vf.createVault(address(tok), creator, ALLOC, 0, 10 days, 5 days, address(0));
        vm.expectRevert(CreatorVestingFactory.InvalidParams.selector);
        vf.createVault(address(tok), creator, 0, 0, 0, 5 days, address(0));
        vm.expectRevert(CreatorVestingFactory.InvalidParams.selector);
        vf.createVault(address(tok), creator, ALLOC, uint64(block.timestamp - 1), 0, 5 days, address(0));
        vm.expectRevert(CreatorVestingFactory.InvalidParams.selector);
        vf.createVault(address(tok), creator, ALLOC, 0, 0, 1 hours, address(0));
        vm.stopPrank();
    }

    function test_cliffBlocksRelease() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 365 days, 0);
        CreatorVestingVault v = _vault(address(p), 90 days, 360 days);
        vm.warp(block.timestamp + 90 days - 1);
        assertEq(v.releasable(), 0);
        vm.expectRevert(CreatorVestingVault.NothingToRelease.selector);
        v.release();
        vm.warp(block.timestamp + 1);
        assertEq(v.releasable(), ALLOC / 4);
        v.release();
        assertEq(tok.balanceOf(creator), 9 * ALLOC + ALLOC / 4);
        assertEq(p.balanceOf(address(v)), ALLOC - ALLOC / 4);
    }

    function test_rewardsImmediateAndPrincipalStaysLocked() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 100 days, 0);
        CreatorVestingVault v = _vault(address(p), 200 days, 400 days);
        vm.warp(block.timestamp + 10 days);
        uint256 before = rew.balanceOf(creator);
        vm.prank(alice); // anyone can trigger; funds go to beneficiary
        uint256 got = v.claimRewards();
        assertGt(got, 0);
        assertEq(rew.balanceOf(creator) - before, got);
        assertApproxEqRel(got, 10_000e18 * 99 / 100, 1e12); // 10% of rewards, minus 1% claim fee
        assertEq(v.stakedAmount(), ALLOC);
        assertEq(v.releasable(), 0);
    }

    function test_fullLifecycle_poolEndsThenMigrate() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 30 days, 0);
        CreatorVestingVault v = _vault(address(p), 0, 300 days);
        vm.warp(block.timestamp + 31 days);
        vm.prank(alice);
        vm.expectRevert(CreatorVestingVault.NotBeneficiary.selector);
        v.migrate(address(p));
        // new pool
        PolydashStakingPoolV2 p2 = _pool(address(rew), 365 days, 0);
        uint256 rb = rew.balanceOf(creator);
        vm.prank(creator);
        v.migrate(address(p2));
        assertGt(rew.balanceOf(creator), rb); // final rewards forwarded during migration
        assertEq(p.balanceOf(address(v)), 0);
        uint256 rel = v.releasable();
        assertEq(p2.balanceOf(address(v)), ALLOC - rel); // releasable part stays idle
        assertEq(tok.balanceOf(creator), 9 * ALLOC); // migration released nothing
        vm.warp(block.timestamp + 300 days);
        v.release();
        assertEq(tok.balanceOf(creator), 10 * ALLOC);
        assertEq(v.holdings(), 0);
    }

    function test_migrateBlockedWhileActive() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 30 days, 0);
        CreatorVestingVault v = _vault(address(p), 0, 300 days);
        PolydashStakingPoolV2 p2 = _pool(address(rew), 365 days, 0);
        vm.prank(creator);
        vm.expectRevert(CreatorVestingVault.PoolStillActive.selector);
        v.migrate(address(p2));
    }

    function test_exitEndedPoolKeepsLocked() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 30 days, 0);
        CreatorVestingVault v = _vault(address(p), 0, 300 days);
        vm.expectRevert(CreatorVestingVault.PoolStillActive.selector);
        v.exitEndedPool();
        vm.warp(block.timestamp + 30 days);
        v.exitEndedPool();
        assertEq(v.idleAmount(), ALLOC);
        assertEq(address(v.pool()), address(0));
        assertEq(v.releasable(), ALLOC * 30 / 300);
    }

    function test_capFallsBackToUnstaked() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 100 days, ALLOC / 2);
        CreatorVestingVault v = _vault(address(p), 0, 100 days);
        assertEq(v.stakedAmount(), 0);
        assertEq(v.idleAmount(), ALLOC);
        assertEq(v.lockedAmount(), ALLOC);
    }

    function test_sameTokenPool_rewardsSeparated() public {
        vm.prank(creator);
        PolydashStakingPoolV2 p =
            PolydashStakingPoolV2(sf.createPool(address(tok), address(tok), 100_000e18, 0, 100 days, 0, 500, "S", ""));
        CreatorVestingVault v = _vault(address(p), 0, 100 days);
        vm.warp(block.timestamp + 50 days);
        uint256 b0 = tok.balanceOf(creator);
        v.release();
        uint256 got = tok.balanceOf(creator) - b0;
        // half principal + ~half rewards net of 5% fee
        assertApproxEqRel(got, ALLOC / 2 + 50_000e18 * 95 / 100, 1e12);
        assertEq(v.released(), ALLOC / 2);
        assertApproxEqRel(v.totalRewardsForwarded(), 50_000e18 * 95 / 100, 1e12);
        vm.warp(block.timestamp + 60 days);
        v.release();
        assertEq(v.released(), ALLOC);
        assertEq(v.holdings(), 0);
    }

    function test_extendOnlyNeverShorten() public {
        CreatorVestingVault v = _vault(address(0), 10 days, 100 days);
        vm.startPrank(creator);
        vm.expectRevert(CreatorVestingVault.InvalidSchedule.selector);
        v.extendSchedule(5 days, 100 days);
        vm.expectRevert(CreatorVestingVault.InvalidSchedule.selector);
        v.extendSchedule(10 days, 99 days);
        v.extendSchedule(20 days, 200 days);
        vm.stopPrank();
        assertEq(v.endTime(), block.timestamp + 200 days);
        vm.prank(alice);
        vm.expectRevert(CreatorVestingVault.NotBeneficiary.selector);
        v.extendSchedule(30 days, 300 days);
    }

    function test_extendAfterPartialReleaseNeverClawsBack() public {
        CreatorVestingVault v = _vault(address(0), 0, 100 days);
        vm.warp(block.timestamp + 50 days);
        v.release();
        vm.prank(creator);
        v.extendSchedule(0, 400 days); // vested now 12.5% < released 50%
        assertEq(v.releasable(), 0);
        vm.warp(block.timestamp + 150 days); // t=200d -> 50%
        assertEq(v.releasable(), 0);
        vm.warp(block.timestamp + 100 days); // t=300d -> 75%
        assertEq(v.releasable(), ALLOC / 4);
    }

    function test_emergencyExitPool() public {
        PolydashStakingPoolV2 p = _pool(address(rew), 100 days, 0);
        CreatorVestingVault v = _vault(address(p), 0, 100 days);
        vm.warp(block.timestamp + 10 days);
        vm.prank(alice);
        vm.expectRevert(CreatorVestingVault.NotBeneficiary.selector);
        v.emergencyExitPool();
        vm.prank(creator);
        v.emergencyExitPool();
        assertEq(v.idleAmount(), ALLOC);
        assertEq(tok.balanceOf(creator), 9 * ALLOC); // still locked
        assertEq(v.releasable(), ALLOC / 10);
    }

    function test_initializeOnlyFactoryOnce() public {
        CreatorVestingVault v = _vault(address(0), 0, 100 days);
        vm.expectRevert(CreatorVestingVault.NotFactory.selector);
        v.initialize(address(0));
    }

    function test_feeOnTransferAllocation() public {
        FeeERC20 f = new FeeERC20(100);
        lf.set(address(f), address(0x1B));
        f.mint(creator, ALLOC);
        vm.startPrank(creator);
        f.approve(address(vf), ALLOC);
        CreatorVestingVault v =
            CreatorVestingVault(vf.createVault(address(f), creator, ALLOC, 0, 0, 10 days, address(0)));
        vm.stopPrank();
        assertEq(v.totalAllocation(), ALLOC * 99 / 100);
        vm.warp(block.timestamp + 10 days);
        v.release();
        assertEq(v.holdings(), 0);
    }

    function test_futureStart() public {
        vm.prank(creator);
        CreatorVestingVault v = CreatorVestingVault(
            vf.createVault(address(tok), creator, ALLOC, uint64(block.timestamp + 10 days), 0, 10 days, address(0))
        );
        vm.warp(block.timestamp + 10 days);
        assertEq(v.releasable(), 0);
        vm.warp(block.timestamp + 5 days);
        assertEq(v.releasable(), ALLOC / 2);
    }

    /// Schedule math: vested is monotonic, 0 before cliff, linear after, capped at total.
    function testFuzz_scheduleMath(uint64 cliff, uint64 dur, uint32 t1, uint32 t2) public {
        dur = uint64(bound(dur, 1 days, 3650 days));
        cliff = uint64(bound(cliff, 0, dur));
        CreatorVestingVault v = _vault(address(0), cliff, dur);
        uint256 s = v.start();
        uint256 a = s + bound(t1, 0, 4000 days);
        uint256 b = a + bound(t2, 0, 4000 days);
        uint256 va = v.vestedAmountAt(a);
        uint256 vb = v.vestedAmountAt(b);
        assertLe(va, vb);
        assertLe(vb, ALLOC);
        if (a < s + cliff) assertEq(va, 0);
        else if (a >= s + dur) assertEq(va, ALLOC);
        else assertEq(va, ALLOC * (a - s) / dur);
    }

    /// Releasing in many steps never exceeds the schedule and ends with everything released.
    function testFuzz_stepwiseRelease(uint8 steps, uint64 dur, uint64 cliff) public {
        dur = uint64(bound(dur, 1 days, 1000 days));
        cliff = uint64(bound(cliff, 0, dur));
        steps = uint8(bound(steps, 1, 20));
        PolydashStakingPoolV2 p = _pool(address(rew), 3650 days, 0);
        CreatorVestingVault v = _vault(address(p), cliff, dur);
        uint256 s = v.start();
        for (uint256 i = 1; i <= steps; ++i) {
            vm.warp(s + (uint256(dur) * i) / steps);
            if (v.releasable() > 0) v.release();
            assertLe(v.released(), v.vestedAmountAt(block.timestamp));
            assertEq(tok.balanceOf(creator), 9 * ALLOC + v.released());
        }
        assertEq(v.released(), ALLOC);
        assertEq(v.holdings(), 0);
    }

    // ---------------- Nov 1 decisions ----------------

    function test_badgeMinimum() public {
        assertTrue(_vault(address(0), 30 days, 180 days).meetsBadgeMinimum());
        CreatorVestingVault a = _vault(address(0), 30 days - 1, 365 days);
        CreatorVestingVault b = _vault(address(0), 60 days, 180 days - 1);
        assertFalse(a.meetsBadgeMinimum());
        assertFalse(b.meetsBadgeMinimum());
        assertFalse(vf.vaultMeetsBadgeMinimum(address(a)));
        assertFalse(vf.vaultMeetsBadgeMinimum(address(0xdead)));
        // extending can earn the badge later
        vm.prank(creator);
        b.extendSchedule(60 days, 180 days);
        assertTrue(b.meetsBadgeMinimum());
        assertTrue(vf.vaultMeetsBadgeMinimum(address(b)));
        // contract floor still 1 day
        assertFalse(_vault(address(0), 0, 1 days).meetsBadgeMinimum());
    }

    function test_onlyPolypadTokens() public {
        MockERC20 other = new MockERC20("OTH");
        other.mint(creator, ALLOC);
        vm.startPrank(creator);
        other.approve(address(vf), type(uint256).max);
        vm.expectRevert(CreatorVestingFactory.TokenNotLaunched.selector);
        vf.createVault(address(other), creator, ALLOC, 0, 0, 10 days, address(0));
        vm.stopPrank();
        lfOld.set(address(other), address(0x2A)); // earlier factory accepted too
        assertTrue(vf.isPolypadToken(address(other)));
        vm.prank(creator);
        vf.createVault(address(other), creator, ALLOC, 0, 0, 10 days, address(0));
    }

    function test_beneficiaryTwoStepTransfer() public {
        CreatorVestingVault v = _vault(address(0), 0, 100 days);
        CreatorVestingVault v2 = _vault(address(0), 0, 100 days);
        address ms = address(0x5AFE);
        // access control
        vm.prank(alice);
        vm.expectRevert(CreatorVestingVault.NotBeneficiary.selector);
        v.proposeBeneficiary(alice);
        vm.prank(creator);
        vm.expectRevert(CreatorVestingVault.InvalidBeneficiary.selector);
        v.proposeBeneficiary(creator);
        // nothing pending
        vm.prank(ms);
        vm.expectRevert(CreatorVestingVault.NotPendingBeneficiary.selector);
        v.acceptBeneficiary();
        // propose alice, overwrite with ms
        vm.startPrank(creator);
        v.proposeBeneficiary(alice);
        v.proposeBeneficiary(ms);
        vm.stopPrank();
        assertEq(v.pendingBeneficiary(), ms);
        vm.prank(alice);
        vm.expectRevert(CreatorVestingVault.NotPendingBeneficiary.selector);
        v.acceptBeneficiary();
        // cancel
        vm.prank(creator);
        v.proposeBeneficiary(address(0));
        vm.prank(ms);
        vm.expectRevert(CreatorVestingVault.NotPendingBeneficiary.selector);
        v.acceptBeneficiary();
        // real flow
        vm.prank(creator);
        v.proposeBeneficiary(ms);
        assertEq(v.beneficiary(), creator); // not yet
        vm.prank(ms);
        v.acceptBeneficiary();
        assertEq(v.beneficiary(), ms);
        assertEq(v.pendingBeneficiary(), address(0));
        // indexes
        address[] memory c = vf.vaultsByBeneficiary(creator);
        assertEq(c.length, 1);
        assertEq(c[0], address(v2));
        assertEq(vf.vaultsByBeneficiary(ms)[0], address(v));
        // old beneficiary lost control, new one has it; releases go to new
        vm.prank(creator);
        vm.expectRevert(CreatorVestingVault.NotBeneficiary.selector);
        v.extendSchedule(0, 200 days);
        vm.prank(ms);
        v.extendSchedule(0, 200 days);
        vm.warp(block.timestamp + 100 days);
        v.release();
        assertEq(tok.balanceOf(ms), ALLOC / 2);
        // only vaults can touch the index
        vm.expectRevert(CreatorVestingFactory.NotVault.selector);
        vf.onBeneficiaryChanged(creator, alice);
    }
}
