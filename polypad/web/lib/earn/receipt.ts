// Agent-earn job receipts — format polypad.agent-earn-receipt/1.
// One receipt per job, public and permanent, linked from the job board,
// the agent's identity card (job history — #3 reads these), and the
// poster's history. It extends the receipts system at /agents/receipts:
// same intent → action → settlement shape, same disclaimer.
//
// The receipt is built from two sources and says which is which:
//   - on-chain (AgentEarnEscrow.getLock + escrow events): lock state,
//     amounts, fee snapshot, settlement, tx hashes — the proof.
//   - off-chain (the AgentEarnJob row): the brief, the screening decision,
//     the deliverable text, the dispute reasons, the panel ballots — the
//     paper trail. Ballots live ONLY here (the chain anchors the voter set
//     + outcome; the individual votes are published on the receipt).
//
// Fields are kept stable and hash-friendly so #3 can add signed intent
// hashes later without reshaping the receipt.

import { keccak256, stringToHex, type Hex } from 'viem';
import type { AgentEarnJob } from '@prisma/client';
import type { EscrowLock } from './abi';
import { AGENT_EARN_ESCROW_ADDRESS } from './constants';
import { formatUsdg, netPayout } from './fees';
import { getExplorerTxUrl, getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { parseTimeline, type TimelineEntry } from './server';
import type { LockChainEvent } from './chain';

export const JOB_RECEIPT_FORMAT = 'polypad.agent-earn-receipt/1' as const;

export interface JobBallot {
  agentId: number;
  name: string;
  wallet: string;
  /** PayFull | PayPart | NoPay */
  vote: string;
  /** Agent share in bps when the vote is PayPart. */
  splitBps?: number;
  reason?: string;
  at: string;
}

export interface JobReceipt {
  receiptFormat: typeof JOB_RECEIPT_FORMAT;
  receiptId: string;
  chain: { id: 4663; name: 'Robinhood Chain' };
  jobId: string;
  escrow: string;
  escrowExplorerUrl: string;
  status: string;
  lockState: string;
  intent: {
    poster: string;
    posterExplorerUrl: string;
    title: string;
    topic: string;
    briefHash: string;
    price: string;
    priceUsdgUnits: string;
    deadline: string;
    deadlineIso: string;
    acceptanceCriteria: string;
    screening: { decision: string; reason: string | null; at: string | null };
    lockTxHash: string | null;
    lockTxUrl: string | null;
    agent: { agentId: number | null; wallet: string | null; identityUrl: string | null };
    claimTxHash: string | null;
    claimTxUrl: string | null;
    sessionKeyAtClaim: unknown;
  };
  action: {
    deliverableHash: string | null;
    deliverableUrl: string | null;
    submittedAt: string | null;
    submittedOnTime: boolean | null;
    deliveredEventTxHash: string | null;
    dispute: { reasons: string | null; at: string | null } | null;
    panel: {
      members: { agentId: number; name: string; wallet: string }[];
      ballots: JobBallot[];
      seed: string | null;
      poolAgentIds: number[] | null;
      drawnAt: string | null;
    } | null;
    lapses: TimelineEntry[];
  };
  settlement: {
    outcome: string;
    outcomeName: string;
    price: string;
    feeBpsAtLock: number | null;
    fee: string | null;
    netToAgent: string | null;
    posterRefund: string | null;
    txHash: string | null;
    txUrl: string | null;
    settledAt: string | null;
  };
  timeline: TimelineEntry[];
  disclaimer: 'This receipt records what happened on-chain. It is not a guarantee, reimbursement, or insurance promise.';
}

/** keccak256 of the canonical brief — the brief's fingerprint. Anyone can
 * re-derive it from the job's public fields. */
export function briefHash(job: AgentEarnJob): Hex {
  const canonical = JSON.stringify({
    title: job.title,
    topic: job.topic,
    researchQuestions: job.researchQuestions,
    format: job.format,
    sourceConstraints: job.sourceConstraints,
    acceptanceCriteria: job.acceptanceCriteria,
    priceUsdg: job.priceUsdg.toString(),
    deadline: job.deadline.toISOString(),
  });
  return keccak256(stringToHex(canonical));
}

function parseBallots(job: AgentEarnJob): JobBallot[] {
  if (!job.ballots || !Array.isArray(job.ballots)) return [];
  return job.ballots as unknown as JobBallot[];
}

function txUrl(hash: string | null): string | null {
  return hash ? getExplorerTxUrl(hash) : null;
}

export function buildJobReceipt(
  job: AgentEarnJob,
  lock: EscrowLock | null,
  events: LockChainEvent[],
  status: string,
): JobReceipt {
  const timeline = parseTimeline(job);
  const ballots = parseBallots(job);
  const lockState = lock ? ['None', 'Locked', 'Released', 'Refunded', 'PanelResolved'][lock.state] : 'None';
  const outcomeName = lock ? ['None', 'PayFull', 'PayPart', 'NoPay'][lock.outcome] : 'None';

  const deliveredEvent = events.find((e) => e.event === 'Delivered');
  const panelEvent = events.find((e) => e.event === 'PanelResolved');
  const releasedEvent = events.find((e) => e.event === 'Released');
  const refundedEvent = events.find((e) => e.event === 'Refunded');
  const settlementEvent = panelEvent ?? releasedEvent ?? refundedEvent;
  const settlementTx = settlementEvent?.txHash ?? job.releaseTxHash ?? job.refundTxHash ?? job.panelTxHash ?? null;

  const claimEntry = timeline.find((t) => t.type === 'claimed');
  const sessionKeyAtClaim = claimEntry?.data?.sessionKey ?? null;

  const feeBpsAtLock = lock ? lock.feeBpsAtLock : null;
  let fee: string | null = null;
  let netToAgent: string | null = null;
  let posterRefund: string | null = null;
  if (lock && lock.state !== 0 && lock.state !== 1) {
    // Settled on-chain: the lock carries the exact split.
    fee = formatUsdg(lock.feePaid);
    netToAgent = lock.agentShare > 0n ? formatUsdg(lock.agentShare - lock.feePaid) : '$0.00';
    posterRefund = lock.posterShare > 0n ? formatUsdg(lock.posterShare) : '$0.00';
  } else if (lock) {
    // Open: show the expected net if the poster accepts in full.
    const split = netPayout(lock.amount, lock.feeBpsAtLock);
    fee = formatUsdg(split.fee);
    netToAgent = formatUsdg(split.net);
    posterRefund = '$0.00';
  }

  const panelPool = Array.isArray(job.panelPool) ? (job.panelPool as number[]) : null;
  const panelDrawn = Array.isArray(job.panelDrawn) ? (job.panelDrawn as number[]) : null;
  const panelMembers =
    panelDrawn && ballots.length > 0
      ? ballots.map((b) => ({ agentId: b.agentId, name: b.name, wallet: b.wallet }))
      : (panelDrawn ?? []).map((id) => ({ agentId: id, name: `Agent #${id}`, wallet: '' }));

  const submittedOnTime =
    job.deliveredAt && job.deadline ? job.deliveredAt.getTime() <= job.deadline.getTime() : null;

  return {
    receiptFormat: JOB_RECEIPT_FORMAT,
    receiptId: job.id,
    chain: { id: 4663, name: 'Robinhood Chain' },
    jobId: job.id,
    escrow: AGENT_EARN_ESCROW_ADDRESS,
    escrowExplorerUrl: getExplorerAddressUrl(AGENT_EARN_ESCROW_ADDRESS),
    status,
    lockState: lockState ?? 'Unknown',
    intent: {
      poster: job.poster,
      posterExplorerUrl: getExplorerAddressUrl(job.poster),
      title: job.title,
      topic: job.topic,
      briefHash: briefHash(job),
      price: formatUsdg(job.priceUsdg),
      priceUsdgUnits: job.priceUsdg.toString(),
      deadline: job.deadline.toISOString(),
      deadlineIso: job.deadline.toISOString(),
      acceptanceCriteria: job.acceptanceCriteria,
      screening: {
        decision: job.status === 'screened_out' ? 'rejected' : job.screenedAt ? 'approved' : 'pending',
        reason: job.screeningReason ?? null,
        at: job.screenedAt?.toISOString() ?? null,
      },
      lockTxHash: job.lockTxHash ?? null,
      lockTxUrl: txUrl(job.lockTxHash ?? null),
      agent: {
        agentId: job.claimedByAgentId ?? null,
        wallet: job.claimedByWallet ?? null,
        identityUrl: job.claimedByAgentId ? `/agents/${job.claimedByAgentId}` : null,
      },
      claimTxHash: job.claimTxHash ?? null,
      claimTxUrl: txUrl(job.claimTxHash ?? null),
      sessionKeyAtClaim,
    },
    action: {
      deliverableHash: job.deliverableHash ?? null,
      deliverableUrl: job.deliverableHash ? `/agents/earn/${job.id}#deliverable` : null,
      submittedAt: job.deliveredAt?.toISOString() ?? null,
      submittedOnTime,
      deliveredEventTxHash: deliveredEvent?.txHash ?? job.deliverTxHash ?? null,
      dispute: job.disputeReasons
        ? { reasons: job.disputeReasons, at: job.disputedAt?.toISOString() ?? null }
        : null,
      panel:
        panelDrawn || ballots.length > 0
          ? {
              members: panelMembers,
              ballots,
              seed: job.panelSeed ?? null,
              poolAgentIds: panelPool,
              drawnAt: job.panelDrawnAt?.toISOString() ?? null,
            }
          : null,
      lapses: timeline.filter((t) => t.type === 'lapsed'),
    },
    settlement: {
      outcome: outcomeName ?? 'None',
      outcomeName: outcomeName ?? 'None',
      price: formatUsdg(job.priceUsdg),
      feeBpsAtLock,
      fee,
      netToAgent,
      posterRefund,
      txHash: settlementTx,
      txUrl: txUrl(settlementTx),
      settledAt: job.settledAt?.toISOString() ?? (lock && lock.settledAt > 0n ? new Date(Number(lock.settledAt) * 1000).toISOString() : null),
    },
    timeline,
    disclaimer: 'This receipt records what happened on-chain. It is not a guarantee, reimbursement, or insurance promise.',
  };
}
