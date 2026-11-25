// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentExecutor} from "../../../src/fund/phase4/AgentExecutor.sol";
import {AgentStrategies} from "../../../src/fund/phase4/AgentStrategies.sol";
import {Instruction, StrategyParams} from "../../../src/fund/phase4/AgentTypes.sol";
import {FundNFTInvest} from "../../../src/fund/phase2/FundNFTInvest.sol";
import {FundVaultInvest} from "../../../src/fund/phase2/FundVaultInvest.sol";
import {Phase4Setup} from "./Phase4Setup.sol";

contract AgentExecutorTest is Phase4Setup {
    function _balanced() internal pure returns (StrategyParams memory) {
        return AgentStrategies.defaults(4, 1);
    }

    function _momentum() internal pure returns (StrategyParams memory) {
        return AgentStrategies.defaults(0, 1);
    }

    function _live() internal returns (FundVaultInvest vault, AgentExecutor executor) {
        FundNFTInvest nft = _create(_params());
        vault = _ready(nft);
        executor = _deployExecutor(vault, _balanced());
        _authorize(vault, executor);
    }

    function test_happy_path_buy_sets_nonce_high_water_and_daily_count() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        Instruction memory ix = _buyIx(executor, 0.5 ether, 0.5 ether);
        (bool ok, string memory reason) = executor.validate(ix, _signAgent(executor, ix));
        assertTrue(ok);
        assertEq(reason, "ok");

        uint256 day = block.timestamp / 1 days;
        vm.expectEmit(true, true, true, false, address(executor));
        emit AgentExecutor.InstructionExecuted(address(vault), address(0), address(alpha), 0.5 ether, 0.5 ether, 0, 0);
        executor.execute(ix, _signAgent(executor, ix));

        assertEq(alpha.balanceOf(address(vault)), 0.5 ether);
        assertEq(executor.nextNonce(), 1);
        assertEq(executor.tradesToday(day), 1);
        assertEq(executor.lastExecution(), block.timestamp);
        assertGt(executor.highWaterNavPerNft(), 0);
        assertEq(vault.tradeCount(), 1);
    }

    function test_happy_path_sell_after_price_rise_grows_nav() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        uint256 navBefore = vault.nav();
        _executeBuy(executor, 0.5 ether, 0.5 ether);

        vm.warp(block.timestamp + 12 hours);
        feed.setPrice(1.5 ether);
        router.setEthPerToken(1.5 ether);
        Instruction memory ix = _sellIx(executor, 0.5 ether, 0.75 ether);
        (bool ok,) = executor.validate(ix, _signAgent(executor, ix));
        assertTrue(ok);
        executor.execute(ix, _signAgent(executor, ix));

        assertEq(alpha.balanceOf(address(vault)), 0);
        assertEq(vault.tradeCount(), 2);
        assertGt(vault.nav(), navBefore);
    }

    function test_wrap_eth_weth_needs_no_router_and_skips_position_cap() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        ix.router = address(0);
        ix.assetOut = address(weth);
        (bool ok,) = executor.validate(ix, _signAgent(executor, ix));
        assertTrue(ok);
        executor.execute(ix, _signAgent(executor, ix));
        assertEq(weth.balanceOf(address(vault)), 0.1 ether);
    }

    function test_reject_expired() public {
        (, AgentExecutor executor) = _live();
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        ix.deadline = block.timestamp - 1;
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "expired");
        vm.expectRevert(AgentExecutor.Expired.selector);
        executor.execute(ix, sig);
    }

    function test_reject_bad_nonce() public {
        (, AgentExecutor executor) = _live();
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        ix.nonce = executor.nextNonce() + 1;
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "bad-nonce");
        vm.expectRevert(AgentExecutor.BadNonce.selector);
        executor.execute(ix, sig);
    }

    function test_reject_wrong_vault() public {
        (, AgentExecutor executor) = _live();
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        ix.vault = makeAddr("other-vault");
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "wrong-vault");
        vm.expectRevert(AgentExecutor.WrongVault.selector);
        executor.execute(ix, sig);
    }

    function test_reject_bad_signature() public {
        (, AgentExecutor executor) = _live();
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        // Signed by a different key.
        bytes memory sig = _sign(executor, 0x9999, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "bad-signature");
        vm.expectRevert(AgentExecutor.BadSignature.selector);
        executor.execute(ix, sig);

        // Signed for one amount, submitted with another.
        bytes memory good = _signAgent(executor, ix);
        ix.amountIn = 0.2 ether;
        (ok, reason) = executor.validate(ix, good);
        assertFalse(ok);
        assertEq(reason, "bad-signature");
        vm.expectRevert(AgentExecutor.BadSignature.selector);
        executor.execute(ix, good);
    }

    function test_reject_not_in_mandate() public {
        (, AgentExecutor executor) = _live();
        // Beta is allowlisted but not in this fund's mandate.
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        ix.assetOut = address(beta);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "not-in-mandate");
        vm.expectRevert(AgentExecutor.NotInMandate.selector);
        executor.execute(ix, sig);
    }

    function test_reject_not_allowlisted_after_timelock_removal() public {
        (, AgentExecutor executor) = _live();
        uint256 id = allowlist.propose(address(alpha), false, false);
        vm.warp(block.timestamp + 2 days);
        allowlist.execute(id);
        assertFalse(allowlist.assetAllowed(address(alpha)));

        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "not-allowlisted");
        vm.expectRevert(AgentExecutor.NotAllowlisted.selector);
        executor.execute(ix, sig);
    }

    function test_reject_bad_router() public {
        (, AgentExecutor executor) = _live();
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        ix.router = makeAddr("unlisted-router");
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "bad-router");
        vm.expectRevert(AgentExecutor.BadRouter.selector);
        executor.execute(ix, sig);
    }

    function test_reject_over_trade_cap() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        // Balanced trade cap is 50% of NAV (~1.9996 ETH); 1.5 ETH is over it.
        uint256 nav = vault.nav();
        assertGt(1.5 ether * 10_000, 5000 * nav);
        Instruction memory ix = _buyIx(executor, 1.5 ether, 1.5 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "trade-cap");
        vm.expectRevert(AgentExecutor.TradeCap.selector);
        executor.execute(ix, sig);
    }

    function test_reject_over_position_cap_precheck() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        StrategyParams memory tight = _balanced();
        tight.maxPositionBps = 1000; // 10% of NAV (~0.2 ETH).
        executor = _deployExecutor(vault, tight);
        _authorize(vault, executor);

        // Small trade, but minAmountOut would leave a 0.3 ETH position: over the 10% cap.
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.3 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "position-cap");
        vm.expectRevert(AgentExecutor.PositionCap.selector);
        executor.execute(ix, sig);
    }

    function test_reject_revoked_executor() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        vm.prank(manager);
        vault.setExecutor(address(executor), false);

        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "not-executor");
        vm.expectRevert(AgentExecutor.NotExecutor.selector);
        executor.execute(ix, sig);
    }

    function test_reject_not_investing_before_enable() public {
        FundNFTInvest nft = _create(_params());
        FundVaultInvest vault = nft.vault();
        AgentExecutor executor = _deployExecutor(vault, _balanced());
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "not-investing");
        vm.expectRevert(AgentExecutor.NotInvesting.selector);
        executor.execute(ix, sig);
    }

    function test_reject_vault_swaps_paused() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        vm.prank(manager);
        vault.setSwapsPaused(true);

        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "vault-paused");
        vm.expectRevert(AgentExecutor.VaultPaused.selector);
        executor.execute(ix, sig);
    }

    function test_reject_daily_limit() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        StrategyParams memory tight = _balanced();
        tight.dailyTradeLimit = 1;
        tight.rebalanceIntervalSeconds = 1;
        executor = _deployExecutor(vault, tight);
        _authorize(vault, executor);

        _executeBuy(executor, 0.1 ether, 0.1 ether);
        vm.warp(block.timestamp + 2);
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "daily-limit");
        vm.expectRevert(AgentExecutor.DailyLimitExceeded.selector);
        executor.execute(ix, sig);
    }

    function test_reject_circuit_breaker_after_drawdown() public {
        (, AgentExecutor executor) = _live();
        _executeBuy(executor, 0.5 ether, 0.5 ether);
        uint256 highWater = executor.highWaterNavPerNft();
        assertGt(highWater, 0);

        // Alpha halves: NAV-per-NFT falls ~12.5%, past the 10% balanced breaker.
        vm.warp(block.timestamp + 12 hours);
        feed.setPrice(0.5 ether);
        Instruction memory ix = _sellIx(executor, 0.5 ether, 0.25 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "circuit-breaker");
        vm.expectRevert(AgentExecutor.BreakerTripped.selector);
        executor.execute(ix, sig);
        // The revert rolls the latch back, so the trip is observable via the revert and
        // `validate()`; the manager pauses explicitly (or the runner reports it).
        assertFalse(executor.paused());
    }

    function test_reject_too_soon() public {
        (, AgentExecutor executor) = _live();
        _executeBuy(executor, 0.1 ether, 0.1 ether);
        vm.warp(block.timestamp + 1 hours); // Balanced interval is 12h.
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        bytes memory sig = _signAgent(executor, ix);
        (bool ok, string memory reason) = executor.validate(ix, sig);
        assertFalse(ok);
        assertEq(reason, "too-soon");
        vm.expectRevert(AgentExecutor.TooSoon.selector);
        executor.execute(ix, sig);

        vm.warp(block.timestamp + 11 hours);
        // Rebuild: the earlier instruction's deadline has passed by now.
        Instruction memory ix2 = _buyIx(executor, 0.1 ether, 0.1 ether);
        (ok, reason) = executor.validate(ix2, _signAgent(executor, ix2));
        assertTrue(ok);
        assertEq(reason, "ok");
        executor.execute(ix2, _signAgent(executor, ix2));
        assertEq(executor.nextNonce(), 2);
    }

    function test_pause_unpause_retire_and_key_rotation() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();

        // The agent key may pause, but only the manager may unpause.
        vm.prank(agentKey);
        executor.pause();
        assertTrue(executor.paused());
        Instruction memory ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        (bool ok, string memory reason) = executor.validate(ix, _signAgent(executor, ix));
        assertFalse(ok);
        assertEq(reason, "paused");
        vm.expectRevert(AgentExecutor.ExecutorPaused.selector);
        executor.execute(ix, _signAgent(executor, ix));

        vm.prank(agentKey);
        vm.expectRevert(AgentExecutor.NotManager.selector);
        executor.unpause();
        vm.prank(manager);
        executor.unpause();
        assertFalse(executor.paused());

        // Rotate the key: the old key's signature stops working, the new key's works.
        address newKey = vm.addr(0xBEEF);
        vm.prank(alice);
        vm.expectRevert(AgentExecutor.NotManager.selector);
        executor.updateAgentKey(newKey);
        vm.prank(manager);
        executor.updateAgentKey(newKey);
        assertEq(executor.agentKey(), newKey);
        ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        vm.expectRevert(AgentExecutor.BadSignature.selector);
        executor.execute(ix, _signAgent(executor, ix));
        executor.execute(ix, _sign(executor, 0xBEEF, ix));
        assertEq(alpha.balanceOf(address(vault)), 0.1 ether);

        // Retire stops trading for good.
        vm.prank(manager);
        executor.retire();
        assertTrue(executor.retired());
        assertTrue(executor.paused());
        vm.warp(block.timestamp + 12 hours);
        ix = _buyIx(executor, 0.1 ether, 0.1 ether);
        (ok, reason) = executor.validate(ix, _sign(executor, 0xBEEF, ix));
        assertFalse(ok);
        assertEq(reason, "paused");
    }

    function test_effective_caps_take_the_tighter_of_strategy_and_vault() public {
        (FundVaultInvest vault, AgentExecutor executor) = _live();
        assertEq(vault.maxTradeBps(), 7500);
        assertEq(vault.maxPositionBps(), 7500);
        // Balanced defaults (5000/5000) are tighter than the vault's 7500.
        assertEq(executor.effectiveTradeCapBps(), 5000);
        assertEq(executor.effectivePositionCapBps(), 5000);
        assertEq(executor.effectiveDailyLimit(), 6);
        assertEq(executor.effectiveCircuitBreakerBps(), 1000);
        assertEq(executor.effectiveRebalanceInterval(), 12 hours);

        // A strategy cap above the vault's is clamped to the vault's.
        StrategyParams memory loose = _momentum();
        loose.maxTradeBps = 9000;
        loose.maxPositionBps = 9000;
        AgentExecutor looseExecutor = _deployExecutor(vault, loose);
        assertEq(looseExecutor.effectiveTradeCapBps(), 7500);
        assertEq(looseExecutor.effectivePositionCapBps(), 7500);

        // Zero strategy values fall back to the vault / spec defaults.
        StrategyParams memory zeros = _momentum();
        zeros.maxTradeBps = 0;
        zeros.maxPositionBps = 0;
        zeros.dailyTradeLimit = 0;
        zeros.circuitBreakerBps = 0;
        zeros.rebalanceIntervalSeconds = 0;
        AgentExecutor zeroExecutor = _deployExecutor(vault, zeros);
        assertEq(zeroExecutor.effectiveTradeCapBps(), 7500);
        assertEq(zeroExecutor.effectivePositionCapBps(), 7500);
        assertEq(zeroExecutor.effectiveDailyLimit(), 5);
        assertEq(zeroExecutor.effectiveCircuitBreakerBps(), 1000);
        assertEq(zeroExecutor.effectiveRebalanceInterval(), 3600);
    }
}
