// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentEarnEscrowV2
/// @notice Escrow for Polypad's agent-earn pilot (Option A: Polypad smart-contract
///         escrow). The poster locks the full job price in the settlement token
///         before the job is listed; funds move only on poster acceptance
///         (`release`) or a 3-evaluator panel decision (`panelResolve`), or back
///         to the poster on lapse (`refund`). The agent records delivery
///         on-chain (`deliver`); once delivered, the poster can no longer
///         refund unilaterally. There is no path that pays the agent on
///         submission alone, no double settlement, and no function that lets
///         any admin move locked funds to an arbitrary address.
/// @dev v2 (Nov 28, 2026): assigned-agent claims. The poster names the
///      assigned agent at lock time; only that address can ever claim the
///      job. This fixes v1's permissionless claim: any address could claim
///      a job and submit a fake delivery, locking out the real agent and
///      blocking the poster's refund until the panel ruled NoPay (griefing,
///      not theft — the attacker could never get paid). Everything else is
///      v1 unchanged: same panel, fee, refund and settlement rules.
///      No upgrade proxy — the upgrade path is a fresh deployment.
///      No single-EOA owner: the only privileged role is `panelExecutor`
///      (immutable; in production a 2-of-3 multisig), which executes panel
///      decisions and sets the fee config. Poster acceptance needs no admin.
///      Settlement asset is a constructor parameter; the deployment default
///      is USDG (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 6 decimals).
///      Security-scanned, not a formal audit. Use at your own risk.
///      Warden review is required before deploy.
contract AgentEarnEscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice Maximum platform fee: 10%. A fee above this is a misconfiguration.
    uint16 public constant MAX_FEE_BPS = 1_000;
    /// @notice Default platform fee: 2.5% (Jon's decision, Nov 27 — custody
    ///         Option A, fees Option B, rate 2.5% all locked). The deployment
    ///         passes this value as the initial feeBps; the panel executor
    ///         may change it later via setFeeBps.
    uint16 public constant DEFAULT_FEE_BPS = 250;
    /// @notice Evaluator panel size (design doc §5.2: 3 evaluators per dispute).
    uint256 public constant PANEL_SIZE = 3;

    /// @notice Lifecycle of one job's lock. `None` = no lock ever existed for
    ///         the jobId; a settled job can never be re-locked.
    enum LockState {
        None,
        Locked,
        Released,
        Refunded,
        PanelResolved
    }

    /// @notice Panel decision. `None` is the default before settlement;
    ///         meaningful only when `state == PanelResolved`.
    enum Outcome {
        None,
        PayFull,
        PayPart,
        NoPay
    }

    struct Lock {
        address poster;
        address agent;
        /// @notice The agent the poster assigned at lock time. Only this
        ///         address can ever claim the job (v2 fix for v1's
        ///         permissionless claim). Immutable once locked.
        address assignee;
        uint256 amount;
        LockState state;
        uint256 lockedAt;
        uint256 claimedAt;
        /// @notice keccak256 of the deliverable (report/content hash).
        ///         Zero = not delivered. Once set, the poster can no longer
        ///         refund unilaterally — settlement is by poster acceptance
        ///         (`release`) or panel decision (`panelResolve`) only.
        bytes32 deliverableHash;
        /// @notice Timestamp the agent recorded delivery; 0 = not delivered.
        uint256 deliveredAt;
        /// @notice Platform fee in bps snapshotted at lock time. The fee in
        ///         effect at settlement is this snapshot, not the live
        ///         `feeBps` — a mid-job fee change cannot alter an
        ///         already-locked job's split.
        uint16 feeBpsAtLock;
        uint256 settledAt;
        /// @notice Meaningful only when `state == PanelResolved`.
        Outcome outcome;
        /// @notice Gross agent share of the locked amount (before the fee).
        uint256 agentShare;
        /// @notice Poster share of the locked amount.
        uint256 posterShare;
        /// @notice Fee taken from the agent's share at settlement (0 if none).
        uint256 feePaid;
    }

    /// @notice The settlement token (constructor parameter; USDG on Hood).
    IERC20 public immutable token;
    /// @notice Executes panel decisions and sets fee config. Immutable; in
    ///         production a 2-of-3 multisig, never a single EOA.
    address public immutable panelExecutor;

    /// @notice Platform fee in basis points, taken from the agent's payout at
    ///         settlement (Option B: fee on the payout — the poster locks only
    ///         the job price; the agent's net payout is the gross share minus
    ///         this fee). Default DEFAULT_FEE_BPS (2.5%); settable only by the
    ///         panel executor. The fee in effect at lock time is snapshotted
    ///         into the lock (`feeBpsAtLock`) and used at settlement, so a
    ///         fee change applies only to jobs locked after the change. No
    ///         fee is charged on a no-pay outcome or a refund — there is
    ///         nothing to take a fee from.
    uint16 public feeBps;
    /// @notice Receives the platform fee. Default the Polypad fee wallet.
    address public feeRecipient;

    mapping(bytes32 jobId => Lock) internal _locks;

    event Locked(bytes32 indexed jobId, address indexed poster, uint256 amount);
    event Claimed(bytes32 indexed jobId, address indexed agent);
    event Delivered(bytes32 indexed jobId, address indexed agent, bytes32 deliverableHash);
    event Released(bytes32 indexed jobId, address indexed agent, uint256 amount, uint256 fee);
    event PanelResolved(
        bytes32 indexed jobId, Outcome outcome, uint256 agentShare, uint256 posterShare, address[] voters
    );
    event Refunded(bytes32 indexed jobId, address indexed poster, uint256 amount);
    event FeeBpsSet(uint16 feeBps);
    event FeeRecipientSet(address indexed feeRecipient);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroReceived();
    error LockExists();
    error NotLocked();
    error AlreadyClaimed();
    error AlreadyDelivered();
    error ZeroDeliverableHash();
    error NotPoster();
    error NotPanelExecutor();
    error NotAuthorized();
    error NoAgentClaimed();
    error BadSplit();
    error BadVoters();
    error BadFeeBps();

    /// @param token_ Settlement token (deployment default: USDG on Hood).
    /// @param panelExecutor_ Executes panel decisions and fee config. In
    ///        production a 2-of-3 multisig; never a single EOA.
    /// @param feeBps_ Initial platform fee in bps (deployment default:
    ///        DEFAULT_FEE_BPS = 250, i.e. 2.5% — Jon's decision, Nov 27).
    /// @param feeRecipient_ Initial fee recipient (deployment default: the
    ///        Polypad fee wallet 0x9a21c75aC263cC43125E70200636f6397f8776d0).
    constructor(IERC20 token_, address panelExecutor_, uint16 feeBps_, address feeRecipient_) {
        if (address(token_) == address(0) || panelExecutor_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (feeBps_ > MAX_FEE_BPS) revert BadFeeBps();
        token = token_;
        panelExecutor = panelExecutor_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Poster locks the full job price and names the assigned agent.
    ///         The job must not have a lock already (settled or not — a jobId
    ///         settles exactly once). The assignee may not be zero: v2 has no
    ///         open claims — only the assigned agent can ever claim.
    /// @dev Records the amount actually received (balance delta), so a
    ///         fee-on-transfer token cannot leave the escrow short. For
    ///         USDG the received amount equals `amount`.
    ///         Slither flags this function (reentrancy-balance / no-eth,
    ///         incorrect-equality) — reviewed benign: the function is
    ///         nonReentrant, so no reentrant lock/release/panelResolve/refund
    ///         can run during the transfer; claim/deliver/release/
    ///         panelResolve/refund all revert while the lock is unwritten
    ///         (NotLocked); and `received == 0` is a deliberate
    ///         nothing-arrived check on a computed delta, not a balance
    ///         comparison. A token callback can only donate to the escrow
    ///         (inflating the caller's own lock); the escrow never approves
    ///         outgoing token movement.
    /// @param jobId Board-assigned job identifier (bytes32, unique per job).
    /// @param amount Nominal amount to pull from the poster.
    /// @param assignee The agent assigned to the job. Only this address can
    ///        claim; it is the only address that can ever receive the payout.
    function lock(bytes32 jobId, uint256 amount, address assignee) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (_locks[jobId].state != LockState.None) revert LockExists();
        if (assignee == address(0)) revert ZeroAddress();

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroReceived();

        _locks[jobId] = Lock({
            poster: msg.sender,
            agent: address(0),
            assignee: assignee,
            amount: received,
            state: LockState.Locked,
            lockedAt: block.timestamp,
            claimedAt: 0,
            deliverableHash: bytes32(0),
            deliveredAt: 0,
            feeBpsAtLock: feeBps,
            settledAt: 0,
            outcome: Outcome.None,
            agentShare: 0,
            posterShare: 0,
            feePaid: 0
        });

        emit Locked(jobId, msg.sender, received);
    }

    /// @notice The assigned agent claims the job from its session-key wallet.
    ///         Only the address the poster named at lock time can claim; any
    ///         other caller reverts. The claiming wallet is the only address
    ///         that can ever receive the payout — never an address supplied
    ///         ad hoc at payout time.
    /// @dev v2: v1 enforced first-claim-wins and nothing else, so any address
    ///      could claim a job and submit a fake delivery. Board-only checks
    ///      (registration, credit score) happen off-chain before the claim
    ///      reaches the board, but the contract is the enforcement point:
    ///      the assignee check here is what stops a direct on-chain claim
    ///      from bypassing the board.
    function claim(bytes32 jobId) external {
        Lock storage l = _locks[jobId];
        if (l.state != LockState.Locked) revert NotLocked();
        if (msg.sender != l.assignee) revert NotAuthorized();
        if (l.agent != address(0)) revert AlreadyClaimed();

        l.agent = msg.sender;
        l.claimedAt = block.timestamp;

        emit Claimed(jobId, msg.sender);
    }

    /// @notice Agent records delivery of the work (keccak256 of the
    ///         deliverable, e.g. the report/content hash). Only the claiming
    ///         agent, only once, only while Locked. Once delivered, the
    ///         poster can no longer refund unilaterally — settlement is by
    ///         poster acceptance (`release`) or a panel decision
    ///         (`panelResolve`) only. The board calls this as part of the
    ///         agent's submission flow, with the deliverable hash.
    function deliver(bytes32 jobId, bytes32 deliverableHash) external {
        Lock storage l = _locks[jobId];
        if (l.state != LockState.Locked) revert NotLocked();
        if (msg.sender != l.agent) revert NotAuthorized();
        if (deliverableHash == bytes32(0)) revert ZeroDeliverableHash();
        if (l.deliverableHash != bytes32(0)) revert AlreadyDelivered();

        l.deliverableHash = deliverableHash;
        l.deliveredAt = block.timestamp;

        emit Delivered(jobId, msg.sender, deliverableHash);
    }

    /// @notice Poster acceptance: releases the locked amount to the claiming
    ///         agent's wallet, minus the platform fee (if any). Only the
    ///         poster recorded at lock time, only once, only after a claim.
    /// @dev The fee is the bps snapshotted at lock time (`feeBpsAtLock`),
    ///      not the live `feeBps` — a mid-job fee change cannot alter an
    ///      already-locked job's split.
    function release(bytes32 jobId) external nonReentrant {
        Lock storage l = _locks[jobId];
        if (l.state != LockState.Locked) revert NotLocked();
        if (msg.sender != l.poster) revert NotPoster();
        if (l.agent == address(0)) revert NoAgentClaimed();

        uint256 amount = l.amount;
        uint256 fee = _feeOn(amount, l.feeBpsAtLock);
        uint256 agentGets = amount - fee;

        l.state = LockState.Released;
        l.settledAt = block.timestamp;
        l.outcome = Outcome.PayFull;
        l.agentShare = amount;
        l.posterShare = 0;
        l.feePaid = fee;

        if (fee > 0) token.safeTransfer(feeRecipient, fee);
        token.safeTransfer(l.agent, agentGets);

        emit Released(jobId, l.agent, amount, fee);
    }

    /// @notice Executes a 3-evaluator panel decision. Only the panel executor
    ///         (in production a 2-of-3 multisig). `voters` are the evaluators
    ///         whose votes the receipt publishes; exactly 3 distinct
    ///         non-zero addresses are required.
    /// @dev Split rules: PayFull requires splitBps == 10_000, NoPay requires
    ///      splitBps == 0, PayPart requires 1..9_999 and both shares > 0.
    ///      The fee is taken from the agent's share only; a no-pay outcome
    ///      and a refund pay no fee. The fee is the bps snapshotted at lock
    ///      time (`feeBpsAtLock`), not the live `feeBps`.
    function panelResolve(bytes32 jobId, Outcome outcome, uint16 splitBps, address[] calldata voters)
        external
        nonReentrant
    {
        if (msg.sender != panelExecutor) revert NotPanelExecutor();

        Lock storage l = _locks[jobId];
        if (l.state != LockState.Locked) revert NotLocked();
        if (outcome == Outcome.None) revert BadSplit();
        if (voters.length != PANEL_SIZE) revert BadVoters();
        if (voters[0] == address(0) || voters[1] == address(0) || voters[2] == address(0)) revert BadVoters();
        if (voters[0] == voters[1] || voters[0] == voters[2] || voters[1] == voters[2]) revert BadVoters();

        uint256 amount = l.amount;
        uint256 agentShare;
        uint256 posterShare;
        if (outcome == Outcome.PayFull) {
            if (splitBps != BPS) revert BadSplit();
            if (l.agent == address(0)) revert NoAgentClaimed();
            agentShare = amount;
            posterShare = 0;
        } else if (outcome == Outcome.PayPart) {
            if (splitBps == 0 || splitBps >= BPS) revert BadSplit();
            if (l.agent == address(0)) revert NoAgentClaimed();
            agentShare = (amount * splitBps) / BPS;
            posterShare = amount - agentShare;
            if (agentShare == 0 || posterShare == 0) revert BadSplit();
        } else {
            // NoPay
            if (splitBps != 0) revert BadSplit();
            agentShare = 0;
            posterShare = amount;
        }

        uint256 fee = _feeOn(agentShare, l.feeBpsAtLock);
        uint256 agentGets = agentShare - fee;

        l.state = LockState.PanelResolved;
        l.settledAt = block.timestamp;
        l.outcome = outcome;
        l.agentShare = agentShare;
        l.posterShare = posterShare;
        l.feePaid = fee;

        if (fee > 0) token.safeTransfer(feeRecipient, fee);
        if (agentGets > 0) token.safeTransfer(l.agent, agentGets);
        if (posterShare > 0) token.safeTransfer(l.poster, posterShare);

        emit PanelResolved(jobId, outcome, agentShare, posterShare, voters);
    }

    /// @notice Returns the full lock to the poster. Called by the poster, or
    ///         by the panel executor on a lapsed claim (agent missed the
    ///         deadline). No fee is charged. Which path fires on a lapse vs. a
    ///         forced panel is the board's off-chain flow decision (§7.5);
    ///         the contract supports both.
    /// @dev Refund is blocked once the agent has delivered (`deliver`):
    ///      after delivery, settlement is by poster acceptance (`release`)
    ///      or panel decision (`panelResolve`) only — the poster cannot take
    ///      the work and refund themselves. The lapse path (no delivery
    ///      recorded) is unaffected.
    function refund(bytes32 jobId) external nonReentrant {
        Lock storage l = _locks[jobId];
        if (l.state != LockState.Locked) revert NotLocked();
        if (l.deliverableHash != bytes32(0)) revert AlreadyDelivered();
        if (msg.sender != l.poster && msg.sender != panelExecutor) revert NotAuthorized();

        uint256 amount = l.amount;

        l.state = LockState.Refunded;
        l.settledAt = block.timestamp;
        l.posterShare = amount;

        token.safeTransfer(l.poster, amount);

        emit Refunded(jobId, l.poster, amount);
    }

    /// @notice Platform fee in bps. Only the panel executor. Capped at
    ///         MAX_FEE_BPS. The fee call lands as config, not a rewrite:
    ///         default is DEFAULT_FEE_BPS (2.5%). A change applies only to
    ///         jobs locked after it — already-locked jobs settle at the fee
    ///         snapshotted at lock time (`feeBpsAtLock`).
    function setFeeBps(uint16 bps) external {
        if (msg.sender != panelExecutor) revert NotPanelExecutor();
        if (bps > MAX_FEE_BPS) revert BadFeeBps();
        feeBps = bps;
        emit FeeBpsSet(bps);
    }

    /// @notice Fee recipient. Only the panel executor.
    function setFeeRecipient(address recipient) external {
        if (msg.sender != panelExecutor) revert NotPanelExecutor();
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice Full lock record for one job — the job receipt reads this.
    ///         `outcome`, `agentShare`, `posterShare` and `feePaid` are
    ///         meaningful only after settlement.
    function getLock(bytes32 jobId) external view returns (Lock memory) {
        return _locks[jobId];
    }

    /// @notice Fee on an agent payout at the fee bps snapshotted at lock
    ///         time (0 by default).
    function _feeOn(uint256 agentShare, uint16 bps) internal pure returns (uint256) {
        if (bps == 0) return 0;
        return (agentShare * bps) / BPS;
    }
}
