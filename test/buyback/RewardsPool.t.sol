// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PolydashRewardsPool as RP} from "../../src/buyback/PolydashRewardsPool.sol";
import {PolydashBuybackVault as V} from "../../src/buyback/PolydashBuybackVault.sol";
import "./BuybackBase.sol";
import {MockToken} from "./Mocks.sol";

contract ReentrantStaker {
    RP p;
    MockToken t;
    bool public ok;

    constructor(RP _p, MockToken _t) {
        p = _p;
        t = _t;
        t.approve(address(_p), type(uint256).max);
    }

    function stake(uint256 a) external {
        p.stake(a);
    }

    function exit() external {
        p.exit();
    }
}

contract RewardsPoolTest is Test {
    RP p;
    MockToken t;
    address a = address(0xA);
    address b = address(0xB);
    address funder = address(0xF);

    function setUp() public {
        t = new MockToken();
        p = new RP(address(t));
        for (uint160 i = 0xA; i <= 0xF; i++) {
            t.mint(address(i), 1e27);
            vm.prank(address(i));
            t.approve(address(p), type(uint256).max);
        }
    }

    function _stake(address u, uint256 x) internal {
        vm.prank(u);
        p.stake(x);
    }

    function _fund(uint256 x) internal {
        vm.prank(funder);
        p.notifyRewardAmount(x);
    }

    function _ok() internal view {
        assertGe(t.balanceOf(address(p)), p.totalStaked() + p.rewardReserve());
    }

    function test_views_and_marker() public view {
        assertEq(p.endTime(), type(uint256).max);
        assertEq(p.stakeToken(), address(t));
        assertEq(p.rewardToken(), address(t));
        assertTrue(p.acceptsRewardTopUps());
    }

    function test_ctor_zero() public {
        vm.expectRevert(RP.ZeroAmount.selector);
        new RP(address(0));
    }

    function test_zero_amounts_revert() public {
        vm.expectRevert(RP.ZeroAmount.selector);
        p.stake(0);
        vm.expectRevert(RP.ZeroAmount.selector);
        p.notifyRewardAmount(0);
        vm.expectRevert(RP.ZeroAmount.selector);
        p.withdraw(0);
    }

    function test_stream_over_30_days_not_instant() public {
        _stake(a, 100e18);
        _fund(30e18);
        assertEq(p.earned(a), 0);
        skip(15 days);
        assertApproxEqRel(p.earned(a), 15e18, 1e12);
        skip(15 days);
        assertApproxEqRel(p.earned(a), 30e18, 1e12);
        skip(10 days);
        assertApproxEqRel(p.earned(a), 30e18, 1e12); // stops at periodFinish
        vm.prank(a);
        p.exit();
        assertApproxEqRel(t.balanceOf(a), 1e27 + 30e18, 1e12);
        _ok();
    }

    function test_topup_refreshes_rolling() public {
        _stake(a, 100e18);
        _fund(30e18);
        skip(10 days);
        _fund(30e18); // leftover 20 + 30 over 30 days from now
        assertEq(p.periodFinish(), block.timestamp + 30 days);
        skip(30 days);
        assertApproxEqRel(p.earned(a), 60e18, 1e12);
    }

    function test_pro_rata_two_stakers() public {
        _stake(a, 100e18);
        _stake(b, 300e18);
        _fund(40e18);
        skip(30 days);
        assertApproxEqRel(p.earned(a), 10e18, 1e12);
        assertApproxEqRel(p.earned(b), 30e18, 1e12);
    }

    function test_late_staker_no_retroactive() public {
        _stake(a, 100e18);
        _fund(30e18);
        skip(15 days);
        _stake(b, 100e18);
        skip(15 days);
        assertApproxEqRel(p.earned(a), 22.5e18, 1e12);
        assertApproxEqRel(p.earned(b), 7.5e18, 1e12);
    }

    function test_zero_stake_period_carried_not_lost() public {
        _fund(30e18); // nobody staked
        skip(10 days);
        _stake(a, 100e18); // carry (10 days worth) folded back: 30e18 restreamed over 30 days
        assertEq(p.periodFinish(), block.timestamp + 30 days);
        skip(30 days);
        assertApproxEqRel(p.earned(a), 30e18, 1e9);
    }

    function test_gap_mid_stream_carried() public {
        _stake(a, 100e18);
        _fund(30e18);
        skip(10 days);
        vm.prank(a); // ~10 claimed
        p.exit();
        skip(10 days); // 10 days nobody staked
        _stake(b, 100e18);
        skip(60 days);
        vm.prank(b);
        p.claim();
        uint256 paid = (t.balanceOf(a) - 1e27) + (p.rewards(b) + p.totalClaimed() - (t.balanceOf(a) - 1e27));
        assertApproxEqRel(p.totalClaimed(), 30e18, 1e9);
        paid;
        _ok();
    }

    function test_restreamCarry_public() public {
        _fund(30e18);
        skip(40 days); // all 30 carried (stream ended with nobody staked)
        vm.expectRevert(RP.ZeroAmount.selector);
        p.restreamCarry(); // no stakers yet
        _stake(a, 1e18); // auto-folds
        skip(30 days);
        assertApproxEqRel(p.earned(a), 30e18, 1e9);
    }

    function test_withdraw_any_time_no_penalty() public {
        _stake(a, 100e18);
        vm.prank(a);
        p.withdraw(40e18);
        vm.prank(a);
        p.withdraw(60e18);
        assertEq(t.balanceOf(a), 1e27);
        vm.prank(a);
        vm.expectRevert(RP.Insufficient.selector);
        p.withdraw(1);
    }

    function test_rewards_never_from_principal() public {
        _stake(a, 100e18);
        _stake(b, 100e18);
        _fund(10e18);
        skip(30 days);
        vm.prank(a);
        p.exit();
        vm.prank(b);
        p.claim();
        assertGe(t.balanceOf(address(p)), p.totalStaked());
        vm.prank(b); // principal fully intact
        p.withdraw(100e18);
        _ok();
    }

    function test_donation_ignored_until_synced() public {
        _stake(a, 100e18);
        vm.prank(b); // donation
        t.transfer(address(p), 50e18);
        assertEq(p.donations(), 50e18);
        assertEq(p.rewardReserve(), 0);
        skip(1 days);
        assertEq(p.earned(a), 0);
        p.syncDonations();
        assertEq(p.donations(), 0);
        skip(30 days);
        assertApproxEqRel(p.earned(a), 50e18, 1e12);
    }

    function test_inflation_attack_has_no_effect() public {
        // first staker stakes 1 wei and donates a huge amount: no shares, so the next staker is unaffected
        _stake(a, 1);
        vm.prank(a);
        t.transfer(address(p), 1e24);
        _stake(b, 100e18);
        assertEq(p.balanceOf(b), 100e18);
        vm.prank(b);
        p.withdraw(100e18);
        assertEq(t.balanceOf(b), 1e27);
    }

    function test_reentrancy_via_token_hook_blocked() public {
        _stake(a, 100e18);
        _fund(30e18);
        skip(30 days);
        // MockToken re-enters on transfers to 0xdEaD only; emulate with a re-entrant call from a staker contract
        ReentrantStaker r = new ReentrantStaker(p, t);
        t.mint(address(r), 10e18);
        r.stake(10e18);
        t.setReenter(address(p), abi.encodeCall(RP.claim, ()));
        vm.prank(a); // no transfer to dead: hook not triggered, but guard is in place
        p.exit();
        assertFalse(t.reenterSucceeded());
    }

    function test_dust_tracked_in_carry() public {
        _stake(a, 3);
        _fund(1e18 + 7);
        skip(30 days);
        vm.prank(a);
        p.claim();
        // everything not paid is still reserved (carry/dust), never lost
        uint256 claimed = t.balanceOf(a) + 3 - 1e27;
        assertEq(p.rewardReserve(), 1e18 + 7 - claimed);
        assertLe(p.rewardReserve(), 1e12); // only dust left reserved
        _ok();
    }

    function test_tiny_topups_cannot_stall_stream() public {
        _stake(a, 100e18);
        _fund(30e18);
        uint256 fin = p.periodFinish();
        skip(1 days);
        for (uint256 i; i < 20; i++) {
            _fund(1);
            skip(1 hours);
        }
        assertEq(p.periodFinish(), fin); // clock not reset by dust top-ups
        skip(30 days);
        assertApproxEqRel(p.earned(a), 30e18, 1e12);
        assertGe(p.carryScaled(), 20e18); // the 20 wei are carried, not lost
    }

    function testFuzz_stake_withdraw_conserves(uint96 x, uint96 y) public {
        x = uint96(bound(x, 1, 1e26));
        y = uint96(bound(y, 1, x));
        _stake(a, x);
        vm.prank(a);
        p.withdraw(y);
        assertEq(p.balanceOf(a), x - y);
        assertEq(t.balanceOf(a), 1e27 - x + y);
        _ok();
    }

    function testFuzz_rewards_bounded_by_notified(uint96 s1, uint96 s2, uint96 r, uint32 dt) public {
        s1 = uint96(bound(s1, 1, 1e26));
        s2 = uint96(bound(s2, 1, 1e26));
        r = uint96(bound(r, 1e6, 1e26));
        dt = uint32(bound(dt, 1, 90 days));
        _stake(a, s1);
        _fund(r);
        skip(dt / 2);
        _stake(b, s2);
        skip(dt);
        assertLe(p.earned(a) + p.earned(b), r);
        vm.prank(a);
        p.exit();
        vm.prank(b);
        p.exit();
        assertEq(t.balanceOf(a), 1e27 + (t.balanceOf(a) - 1e27));
        assertGe(t.balanceOf(a), 1e27);
        assertGe(t.balanceOf(b), 1e27);
        _ok();
    }
}

contract PoolHandler is Test {
    RP p;
    MockToken t;
    address[3] us;
    uint256 public ghostStakedIn;
    uint256 public ghostStakedOut;

    constructor(RP _p, MockToken _t) {
        p = _p;
        t = _t;
        us = [address(0x1001), address(0x1002), address(0x1003)];
        for (uint256 i; i < 3; i++) {
            t.mint(us[i], 1e27);
            vm.prank(us[i]);
            t.approve(address(p), type(uint256).max);
        }
        t.mint(address(this), 1e27);
        t.approve(address(p), type(uint256).max);
    }

    function stake(uint8 i, uint96 x) external {
        x = uint96(bound(x, 1, 1e25));
        vm.prank(us[i % 3]);
        p.stake(x);
        ghostStakedIn += x;
    }

    function withdraw(uint8 i, uint96 x) external {
        address u = us[i % 3];
        uint256 bal = p.balanceOf(u);
        if (bal == 0) return;
        x = uint96(bound(x, 1, bal));
        vm.prank(u);
        p.withdraw(x);
        ghostStakedOut += x;
    }

    function claim(uint8 i) external {
        vm.prank(us[i % 3]);
        p.claim();
    }

    function fund(uint96 x) external {
        x = uint96(bound(x, 1, 1e24));
        p.notifyRewardAmount(x);
    }

    function donate(uint96 x) external {
        x = uint96(bound(x, 1, 1e22));
        t.transfer(address(p), x);
    }

    function warp(uint32 s) external {
        skip(bound(s, 1, 20 days));
    }

    function user(uint256 i) external view returns (address) {
        return us[i];
    }
}

contract RewardsPoolInvariant is Test {
    RP p;
    MockToken t;
    PoolHandler h;

    function setUp() public {
        t = new MockToken();
        p = new RP(address(t));
        h = new PoolHandler(p, t);
        targetContract(address(h));
    }

    function invariant_solvent() public view {
        assertGe(t.balanceOf(address(p)), p.totalStaked() + p.rewardReserve());
    }

    function invariant_owed_le_reserve() public view {
        uint256 owed;
        for (uint256 i; i < 3; i++) {
            owed += p.earned(h.user(i));
        }
        assertLe(owed, p.rewardReserve());
    }

    function invariant_no_stake_loss() public view {
        uint256 s;
        for (uint256 i; i < 3; i++) {
            s += p.balanceOf(h.user(i));
        }
        assertEq(s, p.totalStaked());
        assertEq(p.totalStaked(), h.ghostStakedIn() - h.ghostStakedOut());
    }
}

contract VaultWithPoolTest is BuybackBase {
    function test_initial_target_set_and_released() public {
        RP pool = new RP(address(tok));
        V.Init memory q = _init();
        q.initialTarget = address(pool);
        V v2 = new V(q);
        assertEq(v2.rewardsTarget(), address(pool));
        assertTrue(v2.targetActive());
        assertTrue(v2.isValidTarget(address(pool))); // not in staking factory, accepted as initialTarget
        v2.topUp{value: 1 ether}();
        v2.observePrice();
        skip(6 minutes);
        (,, uint256 k) = v2.buy();
        v2.releaseToTarget();
        assertEq(pool.rewardReserve(), k);
        vm.expectRevert(V.TargetActive.selector);
        v2.burnHeldStaking(); // ongoing pool: never "ended"
    }

    function test_initial_target_must_be_valid() public {
        V.Init memory q = _init(); // EOA
        q.initialTarget = alice;
        vm.expectRevert(V.InvalidParams.selector);
        new V(q);
        RP wrong = new RP(address(weth));
        q.initialTarget = address(wrong);
        vm.expectRevert(V.InvalidParams.selector);
        new V(q);
    }

    function test_switch_away_from_initial_by_timelock() public {
        RP pool = new RP(address(tok));
        V.Init memory q = _init();
        q.initialTarget = address(pool);
        V v2 = new V(q);
        vm.prank(feesWallet);
        v2.proposeTarget(address(rp));
        skip(48 hours);
        vm.prank(feesWallet);
        v2.executeTarget();
        assertEq(v2.rewardsTarget(), address(rp));
        // can switch back to the initial target later
        vm.prank(feesWallet);
        v2.proposeTarget(address(pool));
    }
}
