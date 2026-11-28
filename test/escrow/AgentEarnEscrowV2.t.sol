// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentEarnEscrowV2} from "../../src/escrow/AgentEarnEscrowV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC20Decimals} from "../mocks/MockERC20Decimals.sol";

/// @notice ERC20 that tries to re-enter the escrow on every outgoing escrow
///         transfer. Proves the reentrancy guard + checks-effects-interactions:
///         the inner release must fail and the outer settlement must pay once.
contract ReentrantToken is ERC20 {
    AgentEarnEscrowV2 public escrow;
    bytes32 public targetJob;
    bool public armed;
    bool public reentrySucceeded;

    constructor() ERC20("Reentrant", "REENT") {
        _mint(msg.sender, 1e30);
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address escrow_, bytes32 job_) external {
        escrow = AgentEarnEscrowV2(escrow_);
        targetJob = job_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == address(escrow)) {
            armed = false; // one attempt only
            try escrow.release(targetJob) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
    }
}

contract AgentEarnEscrowV2Test is Test {
    AgentEarnEscrowV2 internal escrow;
    MockERC20Decimals internal usdg; // 6 decimals, mirrors USDG on Hood
    address internal poster = makeAddr("poster");
    address internal agent = makeAddr("agent"); // the claiming Safe session-key wallet
    address internal executor = makeAddr("executor"); // stands in for the 2-of-3 multisig
    address internal feeWallet = 0x9a21c75aC263cC43125E70200636f6397f8776d0; // Polypad fee wallet

    bytes32 internal constant JOB = keccak256("job-1");
    bytes32 internal constant JOB2 = keccak256("job-2");
    bytes32 internal constant DELIVERY_HASH = keccak256("deliverable-report-v1");
    uint256 internal constant PRICE = 100_000_000; // 100 USDG (6 decimals)

    address[] internal voters;

    function setUp() public {
        vm.warp(1_760_000_000);
        usdg = new MockERC20Decimals("USDG", "USDG", 6);
        usdg.mint(poster, 10_000_000_000);
        // Deployment default: 250 bps = 2.5% (== DEFAULT_FEE_BPS, Jon Nov 27).
        // (Solidity exposes a contract's constants only via an instance
        // getter, so the deployment value is written out here, not read
        // off the contract type.)
        escrow = new AgentEarnEscrowV2(IERC20(address(usdg)), executor, 250, feeWallet);
        voters = new address[](3);
        voters[0] = makeAddr("eval-1");
        voters[1] = makeAddr("eval-2");
        voters[2] = makeAddr("eval-3");
    }

    function _lock(bytes32 jobId, uint256 amount) internal {
        _lockFor(jobId, amount, agent);
    }

    function _lockFor(bytes32 jobId, uint256 amount, address assignee) internal {
        vm.startPrank(poster);
        usdg.approve(address(escrow), amount);
        escrow.lock(jobId, amount, assignee);
        vm.stopPrank();
    }

    function _claim(bytes32 jobId) internal {
        vm.prank(agent);
        escrow.claim(jobId);
    }

    function _lockAndClaim(bytes32 jobId, uint256 amount) internal {
        _lock(jobId, amount);
        _claim(jobId);
    }

    function _deliver(bytes32 jobId) internal {
        vm.prank(agent);
        escrow.deliver(jobId, DELIVERY_HASH);
    }

    // ---- happy path ----

    function test_LockReleaseHappyPath() public {
        // Zero-fee path: the deployment default is 2.5% (see
        // test_FeeDefault_DollarExamples), so pin the fee to 0 here to
        // assert the no-fee release exactly.
        vm.prank(executor);
        escrow.setFeeBps(0);

        // NOTE: expectEmit must be set after the approve — forge compares the
        // next log emitted in the test frame, and the approve's Approval log
        // would otherwise be compared against the expected Locked event.
        vm.startPrank(poster);
        usdg.approve(address(escrow), PRICE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgentEarnEscrowV2.Locked(JOB, poster, PRICE);
        escrow.lock(JOB, PRICE, agent);
        vm.stopPrank();

        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.poster, poster);
        assertEq(l.agent, address(0));
        assertEq(l.amount, PRICE);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.Locked));
        assertEq(l.lockedAt, block.timestamp);
        assertEq(usdg.balanceOf(address(escrow)), PRICE);

        _claim(JOB);
        l = escrow.getLock(JOB);
        assertEq(l.agent, agent);
        assertEq(l.claimedAt, block.timestamp);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgentEarnEscrowV2.Released(JOB, agent, PRICE, 0);
        vm.prank(poster);
        escrow.release(JOB);

        assertEq(usdg.balanceOf(agent), PRICE);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.Released));
        assertEq(l.settledAt, block.timestamp);
        assertEq(l.feePaid, 0);
    }

    // ---- panel outcomes ----

    function test_PanelPayFull() public {
        vm.prank(executor);
        escrow.setFeeBps(0); // zero-fee path; default-fee math is tested below
        _lockAndClaim(JOB, PRICE);
        vm.prank(executor);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 10_000, voters);

        assertEq(usdg.balanceOf(agent), PRICE);
        assertEq(usdg.balanceOf(poster), 10_000_000_000 - PRICE);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.PanelResolved));
        assertEq(uint256(l.outcome), uint256(AgentEarnEscrowV2.Outcome.PayFull));
        assertEq(l.agentShare, PRICE);
        assertEq(l.posterShare, 0);
    }

    function test_PanelPayPart() public {
        vm.prank(executor);
        escrow.setFeeBps(0); // zero-fee path; default-fee math is tested below
        _lockAndClaim(JOB, PRICE);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit AgentEarnEscrowV2.PanelResolved(JOB, AgentEarnEscrowV2.Outcome.PayPart, 60_000_000, 40_000_000, voters);
        vm.prank(executor);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayPart, 6000, voters);

        assertEq(usdg.balanceOf(agent), 60_000_000);
        assertEq(usdg.balanceOf(poster), 10_000_000_000 - PRICE + 40_000_000);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.PanelResolved));
        assertEq(uint256(l.outcome), uint256(AgentEarnEscrowV2.Outcome.PayPart));
        assertEq(l.agentShare, 60_000_000);
        assertEq(l.posterShare, 40_000_000);
    }

    function test_PanelNoPay() public {
        // No claim needed: nothing was delivered, poster is refunded in full.
        _lock(JOB, PRICE);
        vm.prank(executor);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.NoPay, 0, voters);

        assertEq(usdg.balanceOf(poster), 10_000_000_000);
        assertEq(usdg.balanceOf(agent), 0);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.PanelResolved));
        assertEq(uint256(l.outcome), uint256(AgentEarnEscrowV2.Outcome.NoPay));
        assertEq(l.agentShare, 0);
        assertEq(l.posterShare, PRICE);
    }

    // ---- refund (lapse) ----

    function test_RefundByPoster() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(poster);
        escrow.refund(JOB);

        assertEq(usdg.balanceOf(poster), 10_000_000_000);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.Refunded));
        assertEq(l.posterShare, PRICE);
    }

    function test_RefundByExecutor() public {
        _lock(JOB, PRICE); // lapsed before any claim
        vm.prank(executor);
        escrow.refund(JOB);
        assertEq(usdg.balanceOf(poster), 10_000_000_000);
    }

    // ---- deliver (W-01: refund blocked after delivery) ----

    function test_DeliverRecordsHashAndTimestamp() public {
        _lockAndClaim(JOB, PRICE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgentEarnEscrowV2.Delivered(JOB, agent, DELIVERY_HASH);
        _deliver(JOB);

        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.deliverableHash, DELIVERY_HASH);
        assertEq(l.deliveredAt, block.timestamp);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.Locked));
    }

    function test_DeliverThenPosterRefundReverts() public {
        _lockAndClaim(JOB, PRICE);
        _deliver(JOB);
        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.AlreadyDelivered.selector);
        escrow.refund(JOB);
    }

    function test_DeliverThenExecutorRefundReverts() public {
        _lockAndClaim(JOB, PRICE);
        _deliver(JOB);
        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.AlreadyDelivered.selector);
        escrow.refund(JOB);
    }

    function test_DeliverThenPanelNoPayRefundsPoster() public {
        _lockAndClaim(JOB, PRICE);
        _deliver(JOB);
        vm.prank(executor);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.NoPay, 0, voters);

        assertEq(usdg.balanceOf(poster), 10_000_000_000);
        assertEq(usdg.balanceOf(agent), 0);
        assertEq(usdg.balanceOf(feeWallet), 0);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.PanelResolved));
        assertEq(uint256(l.outcome), uint256(AgentEarnEscrowV2.Outcome.NoPay));
    }

    function test_DeliverThenReleasePaysAgent() public {
        _lockAndClaim(JOB, PRICE);
        _deliver(JOB);
        vm.prank(poster);
        escrow.release(JOB);

        // Default 2.5% fee: agent nets 97.5M, fee 2.5M.
        assertEq(usdg.balanceOf(agent), 97_500_000);
        assertEq(usdg.balanceOf(feeWallet), 2_500_000);
        assertEq(usdg.balanceOf(address(escrow)), 0);
    }

    function test_DeliverByNonClaimantReverts() public {
        _lock(JOB, PRICE);
        // No claim yet: nobody is the claiming agent.
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.deliver(JOB, DELIVERY_HASH);

        _claim(JOB);
        // Poster cannot deliver.
        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.deliver(JOB, DELIVERY_HASH);
        // A different agent cannot deliver.
        vm.prank(makeAddr("agent-2"));
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.deliver(JOB, DELIVERY_HASH);
    }

    function test_DeliverZeroHashReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.ZeroDeliverableHash.selector);
        escrow.deliver(JOB, bytes32(0));
    }

    function test_DeliverTwiceReverts() public {
        _lockAndClaim(JOB, PRICE);
        _deliver(JOB);
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.AlreadyDelivered.selector);
        escrow.deliver(JOB, keccak256("deliverable-report-v2"));
    }

    function test_DeliverOnSettledJobReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(poster);
        escrow.release(JOB);
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.NotLocked.selector);
        escrow.deliver(JOB, DELIVERY_HASH);
    }

    // ---- lock defaults (W-04: outcome None until settlement) ----

    function test_LockOutcomeDefaultsToNone() public {
        _lock(JOB, PRICE);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.outcome), uint256(AgentEarnEscrowV2.Outcome.None));
        assertEq(l.feeBpsAtLock, 250); // deployment default snapshotted
        assertEq(l.deliverableHash, bytes32(0));
        assertEq(l.deliveredAt, 0);
    }

    // ---- one settlement per job ----

    function test_DoubleSettlementReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(poster);
        escrow.release(JOB);

        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NotLocked.selector);
        escrow.release(JOB);

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.NotLocked.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 10_000, voters);

        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NotLocked.selector);
        escrow.refund(JOB);
    }

    function test_ReleaseAfterRefundReverts() public {
        _lock(JOB, PRICE);
        vm.prank(poster);
        escrow.refund(JOB);

        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NotLocked.selector);
        escrow.release(JOB);
    }

    // ---- access control ----

    function test_NonPosterReleaseReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.NotPoster.selector);
        escrow.release(JOB);

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.NotPoster.selector);
        escrow.release(JOB);
    }

    function test_NonExecutorPanelResolveReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NotPanelExecutor.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 10_000, voters);
    }

    function test_NonPosterNonExecutorRefundReverts() public {
        _lock(JOB, PRICE);
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.refund(JOB);
    }

    function test_ExecutorCannotDivertFunds() public {
        // The executor can only refund to the poster — never to itself or an
        // arbitrary address. There is no admin withdrawal function.
        _lock(JOB, PRICE);
        uint256 executorBefore = usdg.balanceOf(executor);
        vm.prank(executor);
        escrow.refund(JOB);
        assertEq(usdg.balanceOf(executor), executorBefore);
        assertEq(usdg.balanceOf(poster), 10_000_000_000);
    }

    // ---- lock / claim validation ----

    function test_LockZeroAmountReverts() public {
        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.ZeroAmount.selector);
        escrow.lock(JOB, 0, agent);
    }

    function test_LockDuplicateReverts() public {
        _lock(JOB, PRICE);
        vm.startPrank(poster);
        usdg.approve(address(escrow), PRICE);
        vm.expectRevert(AgentEarnEscrowV2.LockExists.selector);
        escrow.lock(JOB, PRICE, agent);
        vm.stopPrank();
    }

    function test_LockAfterSettlementReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(poster);
        escrow.release(JOB);

        vm.startPrank(poster);
        usdg.approve(address(escrow), PRICE);
        vm.expectRevert(AgentEarnEscrowV2.LockExists.selector);
        escrow.lock(JOB, PRICE, agent);
        vm.stopPrank();
    }

    function test_ClaimNonexistentReverts() public {
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.NotLocked.selector);
        escrow.claim(JOB);
    }

    function test_DoubleClaimReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(makeAddr("agent-2"));
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.claim(JOB);
    }

    function test_ReleaseWithoutClaimReverts() public {
        _lock(JOB, PRICE);
        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NoAgentClaimed.selector);
        escrow.release(JOB);
    }

    // ---- panel validation ----

    function test_PanelBadVotersReverts() public {
        _lockAndClaim(JOB, PRICE);
        address[] memory two = new address[](2);
        two[0] = voters[0];
        two[1] = voters[1];
        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadVoters.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 10_000, two);
    }

    function test_PanelDuplicateVotersReverts() public {
        _lockAndClaim(JOB, PRICE);
        address[] memory dup = new address[](3);
        dup[0] = voters[0];
        dup[1] = voters[0]; // same evaluator twice
        dup[2] = voters[2];
        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadVoters.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 10_000, dup);
    }

    function test_PanelZeroVoterReverts() public {
        _lockAndClaim(JOB, PRICE);
        address[] memory zeroed = new address[](3);
        zeroed[0] = voters[0];
        zeroed[1] = address(0);
        zeroed[2] = voters[2];
        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadVoters.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 10_000, zeroed);
    }

    function test_PanelNoneOutcomeReverts() public {
        // Outcome.None is the unset default — it must never resolve a job.
        // (Without this guard it would silently fall through as NoPay.)
        _lockAndClaim(JOB, PRICE);
        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadSplit.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.None, 0, voters);
    }

    function test_PanelBadSplitReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadSplit.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 9000, voters);

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadSplit.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.NoPay, 100, voters);

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadSplit.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayPart, 0, voters);

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadSplit.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayPart, 10_000, voters);
    }

    function test_PanelPayWithoutClaimReverts() public {
        _lock(JOB, PRICE);
        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.NoAgentClaimed.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayFull, 10_000, voters);

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.NoAgentClaimed.selector);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayPart, 5000, voters);
    }

    // ---- fee config (parameterized, default 0) ----

    function test_DefaultFeeIs250() public view {
        assertEq(escrow.DEFAULT_FEE_BPS(), 250);
        assertEq(escrow.feeBps(), 250);
    }

    function test_FeeDefault_DollarExamples() public {
        // Deployment default is 2.5% (Option B, Jon Nov 27). USDG has 6
        // decimals, so $10 = 10_000_000 units and $50 = 50_000_000 units.
        // $10 job: agent nets $9.75, fee $0.25.
        _lockAndClaim(JOB, 10_000_000);
        vm.prank(poster);
        escrow.release(JOB);
        assertEq(usdg.balanceOf(agent), 9_750_000);
        assertEq(usdg.balanceOf(feeWallet), 250_000);

        // $50 job: agent nets $48.75, fee $1.25.
        address agent2 = makeAddr("agent-2");
        vm.startPrank(poster);
        usdg.approve(address(escrow), 50_000_000);
        escrow.lock(JOB2, 50_000_000, agent2);
        vm.stopPrank();
        vm.prank(agent2);
        escrow.claim(JOB2);
        vm.prank(poster);
        escrow.release(JOB2);
        assertEq(usdg.balanceOf(agent2), 48_750_000);
        assertEq(usdg.balanceOf(feeWallet), 250_000 + 1_250_000);
    }

    function test_FeeOnRelease() public {
        vm.prank(executor);
        escrow.setFeeBps(100); // 1%
        assertEq(escrow.feeBps(), 100);

        _lockAndClaim(JOB, PRICE);
        vm.prank(poster);
        escrow.release(JOB);

        assertEq(usdg.balanceOf(feeWallet), 1_000_000);
        assertEq(usdg.balanceOf(agent), 99_000_000);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.feePaid, 1_000_000);
        assertEq(l.agentShare, PRICE);
    }

    function test_FeeOnPanelPayPart() public {
        vm.prank(executor);
        escrow.setFeeBps(250); // 2.5%
        _lockAndClaim(JOB, PRICE);
        vm.prank(executor);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.PayPart, 6000, voters);

        // agent share 60, fee 2.5% of 60 = 1.5, agent nets 58.5, poster 40
        assertEq(usdg.balanceOf(agent), 58_500_000);
        assertEq(usdg.balanceOf(poster), 10_000_000_000 - PRICE + 40_000_000);
        assertEq(usdg.balanceOf(feeWallet), 1_500_000);
    }

    function test_FeeSnapshotAtLock() public {
        // W-02: the fee in effect at lock time is snapshotted; a mid-job
        // fee change cannot alter an already-locked job's split.
        vm.prank(executor);
        escrow.setFeeBps(100); // 1% at lock time
        _lockAndClaim(JOB, PRICE);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.feeBpsAtLock, 100);

        // Executor raises the fee to the 10% cap mid-job; the locked job
        // must still settle at the 1% snapshot.
        vm.prank(executor);
        escrow.setFeeBps(1000);
        vm.prank(poster);
        escrow.release(JOB);
        assertEq(usdg.balanceOf(feeWallet), 1_000_000); // 1%, not 10%
        assertEq(usdg.balanceOf(agent), 99_000_000);

        // Same snapshot rule on the panel path.
        vm.prank(executor);
        escrow.setFeeBps(100);
        _lockAndClaim(JOB2, PRICE);
        vm.prank(executor);
        escrow.setFeeBps(1000);
        vm.prank(executor);
        escrow.panelResolve(JOB2, AgentEarnEscrowV2.Outcome.PayPart, 6000, voters);
        // agent share 60M, fee 1% of 60M = 0.6M, agent nets 59.4M
        assertEq(usdg.balanceOf(agent), 99_000_000 + 59_400_000);
        assertEq(usdg.balanceOf(feeWallet), 1_000_000 + 600_000);
        assertEq(usdg.balanceOf(poster), 10_000_000_000 - 2 * PRICE + 40_000_000);
    }

    function test_NoFeeOnNoPayOrRefund() public {
        vm.prank(executor);
        escrow.setFeeBps(100);

        _lock(JOB, PRICE);
        vm.prank(executor);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.NoPay, 0, voters);
        assertEq(usdg.balanceOf(feeWallet), 0);
        assertEq(usdg.balanceOf(poster), 10_000_000_000);

        _lock(JOB2, PRICE);
        vm.prank(poster);
        escrow.refund(JOB2);
        assertEq(usdg.balanceOf(feeWallet), 0);
        assertEq(usdg.balanceOf(poster), 10_000_000_000);
    }

    function test_FeeConfigAccess() public {
        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NotPanelExecutor.selector);
        escrow.setFeeBps(100);

        vm.prank(poster);
        vm.expectRevert(AgentEarnEscrowV2.NotPanelExecutor.selector);
        escrow.setFeeRecipient(makeAddr("other"));

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.BadFeeBps.selector);
        escrow.setFeeBps(1001); // above MAX_FEE_BPS (10%)

        vm.prank(executor);
        vm.expectRevert(AgentEarnEscrowV2.ZeroAddress.selector);
        escrow.setFeeRecipient(address(0));

        address next = makeAddr("fee-2");
        vm.prank(executor);
        escrow.setFeeRecipient(next);
        assertEq(escrow.feeRecipient(), next);
    }

    // ---- fee-on-transfer token: lock records what actually arrived ----

    function test_FeeOnTransferTokenRecordsReceived() public {
        MockERC20 taxed = new MockERC20("Taxed", "TAX", 100); // 1% tax to 0xdead
        taxed.mint(poster, 10_000_000_000);
        AgentEarnEscrowV2 taxedEscrow = new AgentEarnEscrowV2(IERC20(address(taxed)), executor, 0, feeWallet);

        vm.startPrank(poster);
        taxed.approve(address(taxedEscrow), PRICE);
        taxedEscrow.lock(JOB, PRICE, agent);
        vm.stopPrank();

        AgentEarnEscrowV2.Lock memory l = taxedEscrow.getLock(JOB);
        assertEq(l.amount, 99_000_000); // 1% tax kept out of the escrow
        assertEq(taxed.balanceOf(address(taxedEscrow)), 99_000_000);

        vm.prank(agent);
        taxedEscrow.claim(JOB);
        vm.prank(poster);
        taxedEscrow.release(JOB);
        // The payout transfer is taxed a second time (1% of 99M), so the
        // agent nets 98,010,000 — fee-on-transfer tokens can never deliver
        // the full recorded amount and are NOT suitable settlement assets.
        // USDG has no transfer fee; this test only proves lock() records
        // what actually arrived instead of the nominal amount.
        assertEq(taxed.balanceOf(agent), 98_010_000);
        assertEq(taxed.balanceOf(address(taxedEscrow)), 0);
    }

    // ---- reentrancy ----

    function test_ReentrancyAttemptFails() public {
        ReentrantToken rt = new ReentrantToken();
        rt.mint(poster, 10_000_000_000);
        AgentEarnEscrowV2 rtEscrow = new AgentEarnEscrowV2(IERC20(address(rt)), executor, 0, feeWallet);

        vm.startPrank(poster);
        rt.approve(address(rtEscrow), PRICE);
        rtEscrow.lock(JOB, PRICE, agent);
        vm.stopPrank();

        vm.prank(agent);
        rtEscrow.claim(JOB);

        rt.arm(address(rtEscrow), JOB);
        vm.prank(poster);
        rtEscrow.release(JOB);

        assertFalse(rt.reentrySucceeded(), "reentrant release must fail");
        assertEq(rt.balanceOf(agent), PRICE, "agent paid exactly once");
        assertEq(rt.balanceOf(address(rtEscrow)), 0, "escrow drained exactly once");
    }

    // ---- view ----

    function test_GetLockNonexistent() public view {
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.None));
        assertEq(l.poster, address(0));
        assertEq(l.amount, 0);
    }

    // ---- fuzz: panel split always sums to the locked amount ----

    function testFuzz_PanelSplitSumsToAmount(uint16 splitBps, uint256 amount) public {
        splitBps = uint16(bound(splitBps, 1, 9999));
        amount = bound(amount, 10_000, 1_000_000_000);
        bytes32 jobId = keccak256(abi.encode(splitBps, amount));
        _lockAndClaim(jobId, amount);
        vm.prank(executor);
        escrow.panelResolve(jobId, AgentEarnEscrowV2.Outcome.PayPart, splitBps, voters);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(jobId);
        assertEq(l.agentShare + l.posterShare, amount);
        assertEq(usdg.balanceOf(address(escrow)), 0);
    }

    // ---- v2: assigned-agent claims ----

    function test_LockZeroAssigneeReverts() public {
        vm.startPrank(poster);
        usdg.approve(address(escrow), PRICE);
        vm.expectRevert(AgentEarnEscrowV2.ZeroAddress.selector);
        escrow.lock(JOB, PRICE, address(0));
        vm.stopPrank();
    }

    function test_LockRecordsAssignee() public {
        _lock(JOB, PRICE);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.assignee, agent);
        assertEq(l.agent, address(0)); // nobody has claimed yet
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.Locked));
    }

    function test_ClaimByNonAssigneeReverts() public {
        _lock(JOB, PRICE);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.claim(JOB);

        // A second, unrelated agent is refused the same way.
        vm.prank(makeAddr("agent-2"));
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.claim(JOB);

        // The job is still unclaimed and claimable by the assignee.
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.agent, address(0));
        _claim(JOB);
        assertEq(escrow.getLock(JOB).agent, agent);
    }

    function test_ClaimByAssigneeSucceeds() public {
        _lock(JOB, PRICE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgentEarnEscrowV2.Claimed(JOB, agent);
        _claim(JOB);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.agent, agent);
        assertEq(l.assignee, agent);
        assertEq(l.claimedAt, block.timestamp);
    }

    function test_AssigneeDoubleClaimReverts() public {
        _lockAndClaim(JOB, PRICE);
        vm.prank(agent);
        vm.expectRevert(AgentEarnEscrowV2.AlreadyClaimed.selector);
        escrow.claim(JOB);
    }

    function test_AttackerCannotDeliverAfterFailedClaim() public {
        // The v1 griefing chain, end to end: an attacker claims first, then
        // submits a fake delivery. In v2 the first step already reverts, so
        // no fake delivery can ever be recorded and the real agent is never
        // locked out.
        _lock(JOB, PRICE);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.claim(JOB);

        vm.prank(attacker);
        vm.expectRevert(AgentEarnEscrowV2.NotAuthorized.selector);
        escrow.deliver(JOB, keccak256("fake-report"));

        // The assigned agent claims and delivers normally afterwards.
        _claim(JOB);
        _deliver(JOB);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(l.deliverableHash, DELIVERY_HASH);
        assertEq(l.agent, agent);
    }

    function test_PanelNoPayAfterAssigneeFakeDelivery() public {
        // Backstop intact: even if the ASSIGNED agent delivers garbage, the
        // panel can still rule NoPay and the poster is refunded in full.
        _lockAndClaim(JOB, PRICE);
        bytes32 garbage = keccak256("fake-report-not-real-work");
        vm.prank(agent);
        escrow.deliver(JOB, garbage);

        vm.prank(executor);
        escrow.panelResolve(JOB, AgentEarnEscrowV2.Outcome.NoPay, 0, voters);

        assertEq(usdg.balanceOf(poster), 10_000_000_000);
        assertEq(usdg.balanceOf(agent), 0);
        assertEq(usdg.balanceOf(feeWallet), 0);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        AgentEarnEscrowV2.Lock memory l = escrow.getLock(JOB);
        assertEq(uint256(l.state), uint256(AgentEarnEscrowV2.LockState.PanelResolved));
        assertEq(uint256(l.outcome), uint256(AgentEarnEscrowV2.Outcome.NoPay));
        assertEq(l.posterShare, PRICE);
    }
}
