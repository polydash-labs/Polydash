// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./BuybackBase.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Vm} from "forge-std/Vm.sol";

contract VaultTest is BuybackBase {
    using PoolIdLibrary for PoolKey;

    // ---------------- constructor
    function test_ctor_rejects_bad_params() public {
        V.Init memory p;
        p = _init();
        p.poolManager = address(0);
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.weth = address(0);
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init(); // weth >= polydash
        p.polydash = address(1);
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.maxBuyEth = 0;
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.maxSlippageBps = 0;
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.maxSlippageBps = 1001;
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.maxPoolFeeBps = 1001;
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.tickSpacing = 0;
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.burnShareBps = 10_001;
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.stakingFactory = address(0);
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
        p = _init();
        p.targetAdmin = address(0);
        vm.expectRevert(V.InvalidParams.selector);
        new V(p);
    }

    function test_immutables() public view {
        assertEq(v.maxBuyEth(), 0.02 ether);
        assertEq(v.maxSlippageBps(), 300);
        assertEq(v.burnShareBps(), 6250);
        assertEq(v.targetAdmin(), feesWallet);
        assertEq(v.poolId(), PoolId.unwrap(key.toId()));
        assertEq(v.poolFeeBps(), 30);
    }

    // ---------------- receiving
    function test_factory_buyback_labelled() public {
        vm.expectEmit(true, true, false, true);
        emit V.Received(V.Source.Factory, address(fa), 1 ether);
        _fund(1 ether);
        fb.send{value: 2 ether}(address(v), 2 ether);
        assertEq(v.totalFromFactories(), 3 ether);
        assertEq(v.pendingEth(), 3 ether);
        assertEq(fa.failed(), 0);
    }

    function test_other_buyback_caller_labelled() public {
        vm.prank(alice);
        v.buyback{value: 1 ether}();
        assertEq(v.totalDirect(), 1 ether);
        assertEq(v.totalFromFactories(), 0);
    }

    function test_zero_value_noop() public {
        assertEq(v.buyback(), 0);
        v.topUp();
        assertEq(v.totalManual(), 0);
    }

    function test_topUp_labelled() public {
        vm.expectEmit(true, true, false, true);
        emit V.Received(V.Source.Manual, alice, 0.3 ether);
        vm.prank(alice);
        v.topUp{value: 0.3 ether}();
        assertEq(v.totalManual(), 0.3 ether);
    }

    function test_receive_within_2300_stipend() public {
        StipendSender s = new StipendSender();
        s.viaTransfer{value: 1 ether}(payable(address(v)));
        assertTrue(s.viaSend{value: 1 ether}(payable(address(v))));
        assertEq(address(v).balance, 2 ether);
    }

    function test_factory_hook_low_gas_never_reverts() public {
        // even with tight gas the buyback() path is a single log + SSTORE
        (bool ok,) = address(v).call{value: 1 ether, gas: 40_000}(abi.encodeCall(V.buyback, ()));
        assertTrue(ok);
    }

    // ---------------- observe / buy gating
    function test_observe_twice_reverts_until_expiry() public {
        v.observePrice();
        vm.expectRevert(V.ObservationNotDue.selector);
        v.observePrice();
        skip(1 hours + 1);
        v.observePrice();
    }

    function test_buy_nothing_pending() public {
        v.observePrice();
        skip(6 minutes);
        vm.expectRevert(V.NothingPending.selector);
        v.buy();
    }

    function test_buy_needs_observation() public {
        _fund(1 ether);
        vm.expectRevert(V.NoFreshObservation.selector);
        v.buy();
        v.observePrice();
        skip(5 minutes - 1);
        vm.expectRevert(V.NoFreshObservation.selector);
        v.buy();
        skip(1);
        v.buy(); // exactly at 5 min boundary
    }

    function test_buy_observation_too_old() public {
        _fund(1 ether);
        v.observePrice();
        skip(1 hours + 1);
        vm.expectRevert(V.NoFreshObservation.selector);
        v.buy();
    }

    function test_buy_at_60min_boundary_ok() public {
        _fund(1 ether);
        v.observePrice();
        skip(1 hours);
        v.buy();
    }

    function test_cooldown() public {
        _buyOnce(1 ether);
        v.observePrice();
        skip(5 minutes);
        vm.expectRevert(V.Cooldown.selector);
        v.buy();
        skip(5 minutes);
        v.buy();
    }

    function test_buy_splits_and_burns() public {
        _fund(1 ether);
        _ready();
        uint256 dead0 = tok.balanceOf(DEAD);
        (uint256 e, uint256 b, uint256 k) = v.buy();
        assertEq(e, 0.02 ether, "capped");
        assertEq(tok.balanceOf(DEAD) - dead0, b);
        assertEq(tok.balanceOf(address(v)), k);
        assertApproxEqAbs(b * 10_000 / (b + k), 6250, 1);
        assertEq(v.totalBurned(), b);
        assertEq(v.totalToStakers(), k);
        assertEq(v.totalEthSpent(), e);
        assertEq(v.pendingEth(), 0.98 ether);
        assertEq(v.obsTime(), 0);
        assertEq(v.buyCount(), 1);
        assertEq(weth.balanceOf(address(v)), 0);
        // ~1000 tokens/ETH * 0.05 minus fee and impact
        assertGt(b + k, 19.6 ether * 99 / 100 * 97 / 100);
    }

    function test_buy_small_balance_spends_all() public {
        (uint256 e,,) = _buyOnce(0.01 ether);
        assertEq(e, 0.01 ether);
        assertEq(address(v).balance, 0);
    }

    function test_buy_event() public {
        _fund(1 ether);
        _ready();
        vm.recordLogs();
        v.buy();
        Vm.Log[] memory L = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < L.length; i++) {
            if (L[i].topics[0] == V.BoughtAndBurned.selector) found = true;
        }
        assertTrue(found);
    }

    function test_whale_price_move_between_steps_cancels() public {
        _fund(1 ether);
        v.observePrice();
        _whale(true, 50 ether); // whale buys POLYDASH with WETH: price moves
        skip(6 minutes);
        vm.expectRevert(V.PriceMoved.selector);
        v.buy();
        assertEq(address(v).balance, 1 ether);
    }

    function test_whale_dump_between_steps_cancels() public {
        _fund(1 ether);
        v.observePrice();
        _whale(false, 50_000 ether);
        skip(6 minutes);
        vm.expectRevert(V.PriceMoved.selector);
        v.buy();
    }

    function test_small_move_within_band_ok() public {
        _fund(1 ether);
        v.observePrice();
        _whale(true, 1 ether); // ~0.02% move
        skip(6 minutes);
        v.buy();
    }

    function test_slippage_when_fee_cap_too_low() public {
        // pool with a 5% LP fee, vault assuming at most 0.3%: min-out cannot be met
        PoolKey memory k2 =
            PoolKey(Currency.wrap(address(weth)), Currency.wrap(address(tok)), 50_000, 60, IHooks(address(0)));
        pm.initialize(k2, TickMath.getSqrtPriceAtTick(69_060));
        lp.modifyLiquidity(k2, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e22, 0), "");
        V.Init memory p = _init();
        p.poolFee = 50_000;
        p.maxPoolFeeBps = 30;
        V v2 = new V(p);
        v2.topUp{value: 1 ether}();
        v2.observePrice();
        skip(6 minutes);
        vm.expectRevert(V.Slippage.selector);
        v2.buy();
        assertEq(v2.poolFeeBps(), 30);
    }

    function test_thin_pool_hits_limit_partial_or_reverts() public {
        PoolKey memory k3 =
            PoolKey(Currency.wrap(address(weth)), Currency.wrap(address(tok)), 3000, 10, IHooks(address(0)));
        pm.initialize(k3, TickMath.getSqrtPriceAtTick(69_060));
        lp.modifyLiquidity(k3, IPoolManager.ModifyLiquidityParams(-887_220, 887_220, 1e17, 0), "");
        V.Init memory p = _init();
        p.tickSpacing = 10;
        V v3 = new V(p);
        v3.topUp{value: 1 ether}();
        v3.observePrice();
        skip(6 minutes);
        try v3.buy() returns (uint256 e, uint256, uint256) {
            assertLt(e, 0.02 ether); // stopped at the price limit: only part spent
            assertEq(address(v3).balance, 1 ether - e);
        } catch (bytes memory r) {
            assertEq(bytes4(r), V.Slippage.selector);
        }
    }

    function test_unlockCallback_only_pm() public {
        vm.expectRevert(V.NotPoolManager.selector);
        v.unlockCallback(abi.encode(uint256(1), uint160(1)));
    }

    function test_burn_only_config() public {
        V.Init memory p = _init();
        p.burnShareBps = 10_000;
        V v4 = new V(p);
        v4.topUp{value: 1 ether}();
        v4.observePrice();
        skip(6 minutes);
        (, uint256 b, uint256 k) = v4.buy();
        assertEq(k, 0);
        assertGt(b, 0);
    }

    function test_nextStep() public {
        (uint8 s,) = v.nextStep();
        assertEq(s, 0);
        _fund(1 ether);
        (s,) = v.nextStep();
        assertEq(s, 1);
        v.observePrice();
        (s,) = v.nextStep();
        assertEq(s, 2);
        skip(5 minutes);
        (s,) = v.nextStep();
        assertEq(s, 3);
        v.buy();
        (s,) = v.nextStep();
        assertEq(s, 1);
    }

    // ---------------- reentrancy / malicious
    function test_token_reentry_on_burn_blocked() public {
        _fund(1 ether);
        _ready();
        tok.setReenter(address(v), abi.encodeCall(V.buy, ()));
        v.buy();
        assertEq(tok.reenterAttempts(), 1);
        assertFalse(tok.reenterSucceeded());
    }

    function test_token_reentry_observe_blocked() public {
        _fund(1 ether);
        _ready();
        tok.setReenter(address(v), abi.encodeCall(V.observePrice, ()));
        v.buy();
        assertFalse(tok.reenterSucceeded());
    }

    function test_no_withdraw_or_owner_functions() public {
        // only these selectors may move value out: buy (to pool), releaseToTarget/executeTarget (to target), burnHeldStaking (to dead)
        (bool ok,) = address(v).call(abi.encodeWithSignature("withdraw()"));
        assertFalse(ok);
        (ok,) = address(v).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
    }

    // ---------------- rewards target timelock
    function test_only_admin_can_propose_cancel_execute() public {
        vm.expectRevert(V.NotTargetAdmin.selector);
        v.proposeTarget(address(rp));
        vm.prank(feesWallet);
        v.proposeTarget(address(rp));
        vm.expectRevert(V.NotTargetAdmin.selector);
        v.cancelTarget();
        skip(48 hours);
        vm.expectRevert(V.NotTargetAdmin.selector);
        v.executeTarget();
    }

    function test_target_timelock_48h() public {
        vm.prank(feesWallet);
        v.proposeTarget(address(rp));
        assertEq(v.pendingTargetAt(), block.timestamp + 48 hours);
        skip(48 hours - 1);
        vm.prank(feesWallet);
        vm.expectRevert(V.TimelockActive.selector);
        v.executeTarget();
        skip(1);
        vm.prank(feesWallet);
        v.executeTarget();
        assertEq(v.rewardsTarget(), address(rp));
        assertTrue(v.targetActive());
    }

    function test_cancel() public {
        vm.prank(feesWallet);
        v.proposeTarget(address(rp));
        vm.prank(feesWallet);
        v.cancelTarget();
        assertEq(v.pendingTargetAt(), 0);
        vm.prank(feesWallet);
        vm.expectRevert(V.NoPending.selector);
        v.executeTarget();
        vm.prank(feesWallet);
        vm.expectRevert(V.NoPending.selector);
        v.cancelTarget();
    }

    function test_rejects_eoa_unregistered_wrong_token_ended() public {
        vm.startPrank(feesWallet);
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(alice); // EOA
        MockRewardsPool unreg = new MockRewardsPool(address(tok), address(tok), block.timestamp + 10 days);
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(address(unreg)); // not from the staking factory
        MockRewardsPool wrong = new MockRewardsPool(address(weth), address(tok), block.timestamp + 10 days);
        msf.add(address(wrong));
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(address(wrong)); // stake token not POLYDASH
        MockRewardsPool wrongR = new MockRewardsPool(address(tok), address(weth), block.timestamp + 10 days);
        msf.add(address(wrongR));
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(address(wrongR)); // reward token not POLYDASH
        MockRewardsPool ending = new MockRewardsPool(address(tok), address(tok), block.timestamp + 12 hours);
        msf.add(address(ending));
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(address(ending)); // < 1 day left
        vm.stopPrank();
    }

    function test_execute_rechecks_target_ended_meanwhile() public {
        vm.prank(feesWallet);
        v.proposeTarget(address(rp));
        rp.setEnd(block.timestamp + 1 days);
        skip(48 hours);
        vm.prank(feesWallet);
        vm.expectRevert(V.InvalidTarget.selector);
        v.executeTarget();
    }

    function test_held_without_target_then_released_on_execute() public {
        (,, uint256 k) = _buyOnce(1 ether);
        assertEq(v.heldForStakers(), k);
        _setTarget(address(rp));
        assertEq(rp.notified(), k);
        assertEq(tok.balanceOf(address(rp)), k);
        assertEq(v.heldForStakers(), 0);
        assertEq(v.totalReleased(), k);
    }

    function test_release_while_active_and_never_after_end() public {
        _setTarget(address(rp));
        skip(10 minutes);
        (,, uint256 k) = _buyOnce(1 ether);
        v.releaseToTarget();
        assertEq(rp.notified(), k);
        // pool ends: next buy keeps holding, release refuses
        vm.warp(rp.endTime());
        assertFalse(v.targetActive());
        (,, uint256 k2) = _buyOnce(1 ether);
        vm.expectRevert(V.NoActiveTarget.selector);
        v.releaseToTarget();
        assertEq(v.heldForStakers(), k2);
        assertEq(rp.notified(), k);
    }

    function test_release_must_pull_full_amount() public {
        _buyOnce(1 ether);
        rp.setPullLess(true);
        vm.prank(feesWallet);
        v.proposeTarget(address(rp));
        skip(48 hours);
        vm.prank(feesWallet);
        vm.expectRevert(V.InvalidTarget.selector);
        v.executeTarget();
    }

    function test_v2_style_pool_rejected_even_with_nothing_held() public {
        // regression: a V2 pool (funded once, no top-up function) used to pass execute when held == 0
        address pool = address(new MockV2Pool(address(tok), block.timestamp + 135 days));
        msf.add(pool);
        assertFalse(v.isValidTarget(pool));
        vm.prank(feesWallet);
        vm.expectRevert(V.InvalidTarget.selector);
        v.proposeTarget(pool);
    }

    function test_clear_target_and_burn_after_30_days() public {
        _setTarget(address(rp));
        vm.prank(feesWallet);
        v.proposeTarget(address(0));
        skip(48 hours);
        vm.prank(feesWallet);
        v.executeTarget();
        assertEq(v.rewardsTarget(), address(0));
        skip(1 hours);
        (,, uint256 k) = _buyOnce(1 ether);
        vm.expectRevert(V.TooEarly.selector);
        v.burnHeldStaking();
        skip(30 days);
        uint256 d0 = tok.balanceOf(DEAD);
        vm.prank(bob);
        assertEq(v.burnHeldStaking(), k);
        assertEq(tok.balanceOf(DEAD) - d0, k);
        assertEq(v.totalStakingBurned(), k);
        vm.expectRevert(V.Nothing.selector);
        v.burnHeldStaking();
    }

    function test_burn_after_target_ended_30_days() public {
        _setTarget(address(rp));
        vm.warp(rp.endTime());
        _buyOnce(1 ether);
        vm.expectRevert(V.TooEarly.selector);
        v.burnHeldStaking();
        vm.warp(rp.endTime() + 30 days);
        v.burnHeldStaking();
        assertEq(v.heldForStakers(), 0);
    }

    function test_burn_blocked_while_target_active() public {
        _buyOnce(1 ether);
        _setTarget(address(rp));
        vm.expectRevert(V.TargetActive.selector);
        v.burnHeldStaking();
    }

    function test_burn_never_targeted_after_30d_from_deploy() public {
        _buyOnce(1 ether);
        skip(30 days);
        v.burnHeldStaking();
    }

    function test_target_admin_cannot_take_eth_or_tokens() public {
        _buyOnce(1 ether);
        uint256 e0 = feesWallet.balance;
        vm.startPrank(feesWallet);
        (bool ok,) = address(v).call(abi.encodeWithSignature("withdraw(uint256)", 1));
        assertFalse(ok);
        vm.stopPrank();
        assertEq(feesWallet.balance, e0);
        assertEq(tok.balanceOf(feesWallet), 0);
    }

    // ---------------- fuzz
    function testFuzz_receive_accounting(uint96 a, uint96 b, uint96 c) public {
        vm.deal(address(this), uint256(a) + b + c);
        _fund(a);
        v.topUp{value: b}();
        (bool ok,) = address(v).call{value: c}("");
        assertTrue(ok);
        assertEq(v.totalFromFactories(), a);
        assertEq(v.totalManual(), b);
        assertEq(address(v).balance, uint256(a) + b + c);
    }

    function testFuzz_buy_amount_and_split(uint256 fund) public {
        fund = bound(fund, 1e12, 10 ether);
        (uint256 e, uint256 b, uint256 k) = _buyOnce(fund);
        assertEq(e, fund < 0.02 ether ? fund : 0.02 ether);
        uint256 out = b + k;
        assertEq(b, out * 6250 / 10_000);
        assertEq(address(v).balance, fund - e);
    }

    function testFuzz_deviation_band(int256 whaleAmt) public {
        whaleAmt = bound(whaleAmt, 1e15, 100 ether);
        _fund(1 ether);
        v.observePrice();
        uint160 ref = v.obsSqrtPriceX96();
        _whale(true, whaleAmt);
        uint160 s = v.spotSqrtPriceX96();
        skip(6 minutes);
        uint256 r = uint256(s) * 1e18 / ref;
        uint256 r2 = r * r / 1e18;
        if (r2 < 0.98e18 - 1e9) {
            vm.expectRevert(V.PriceMoved.selector);
            v.buy();
        } else if (r2 > 0.98e18 + 1e9) {
            v.buy();
        }
    }

    function testFuzz_split_ratio(uint16 bps) public {
        bps = uint16(bound(bps, 0, 10_000));
        V.Init memory p = _init();
        p.burnShareBps = bps;
        V vx = new V(p);
        vx.topUp{value: 1 ether}();
        vx.observePrice();
        skip(6 minutes);
        (, uint256 b, uint256 k) = vx.buy();
        assertEq(b, (b + k) * bps / 10_000);
    }
}
