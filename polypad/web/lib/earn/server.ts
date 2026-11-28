// Agent-earn server helpers — Prisma reads/writes for jobs, plus the
// merge of off-chain board state with the live on-chain lock.
// The escrow is the source of truth for money; on any disagreement the
// on-chain lock state wins and the row is corrected on the next event.

import { prisma, withTimeout } from '@/lib/db';
import type { AgentEarnJob } from '@prisma/client';
import type { Hex } from 'viem';
import { readLock, type LockChainEvent } from './chain';
import type { EscrowLock } from './abi';
import { BOARD_VISIBLE_STATUSES, type JobStatus } from './constants';

export type TimelineEntry = {
  type: string;
  at: string;
  txHash?: string;
  note?: string;
  data?: Record<string, unknown>;
};

export function parseTimeline(job: AgentEarnJob): TimelineEntry[] {
  if (!job.timeline || !Array.isArray(job.timeline)) return [];
  return job.timeline as TimelineEntry[];
}

export function serializeJob(job: AgentEarnJob): Record<string, unknown> {
  return {
    ...job,
    priceUsdg: job.priceUsdg.toString(),
    deadline: job.deadline.toISOString(),
    screenedAt: job.screenedAt?.toISOString() ?? null,
    deliveredAt: job.deliveredAt?.toISOString() ?? null,
    disputedAt: job.disputedAt?.toISOString() ?? null,
    panelDrawnAt: job.panelDrawnAt?.toISOString() ?? null,
    settledAt: job.settledAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function getJob(jobId: string): Promise<AgentEarnJob | null> {
  return withTimeout(prisma.agentEarnJob.findUnique({ where: { id: jobId } }));
}

export async function listJobs(statuses?: JobStatus[]): Promise<AgentEarnJob[]> {
  return (await withTimeout(
    prisma.agentEarnJob.findMany({
      where: statuses ? { status: { in: statuses } } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  )) ?? [];
}

/** Jobs the public board shows: screened-in AND locked on-chain. The DB
 * status alone is not enough — the lock must exist, so this also reads
 * the chain and drops any row whose lock is missing. */
export async function listBoardJobs(): Promise<{ job: AgentEarnJob; lock: EscrowLock }[]> {
  const rows = await listJobs([...BOARD_VISIBLE_STATUSES, 'delivered', 'disputed', 'panel', 'settled', 'refunded', 'lapsed']);
  const out: { job: AgentEarnJob; lock: EscrowLock }[] = [];
  for (const job of rows) {
    try {
      const lock = await readLock(job.id as Hex);
      if (!lock) continue;
      out.push({ job, lock });
    } catch {
      // Chain unreadable for this job — skip it rather than show stale money.
    }
  }
  return out;
}

/** Append a transition to the job's timeline (append-only; never rewrite
 * history — the receipt renders this log). */
export async function appendTimeline(jobId: string, entry: TimelineEntry): Promise<void> {
  const job = await prisma.agentEarnJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const timeline = parseTimeline(job);
  timeline.push(entry);
  await prisma.agentEarnJob.update({ where: { id: jobId }, data: { timeline: JSON.parse(JSON.stringify(timeline)) } });
}

/** The job's display state, merging the board flow with the live lock.
 * The lock wins: a job the board thinks is "claimed" but whose lock reads
 * Released is settled, full stop. */
export function resolveJobView(job: AgentEarnJob, lock: EscrowLock | null): {
  status: JobStatus;
  lockState: string;
  lock: EscrowLock | null;
} {
  if (!lock) return { status: job.status as JobStatus, lockState: 'None', lock: null };
  const lockState = ['None', 'Locked', 'Released', 'Refunded', 'PanelResolved'][lock.state] ?? 'Unknown';
  let status = job.status as JobStatus;
  if (lock.state === 2) status = 'settled';
  else if (lock.state === 3) status = job.status === 'lapsed' ? 'lapsed' : 'refunded';
  else if (lock.state === 4) status = 'settled';
  else if (lock.state === 1) {
    if (lock.deliveredAt > 0n && (status === 'locked' || status === 'claimed')) status = 'delivered';
    else if (lock.agent !== '0x0000000000000000000000000000000000000000' && status === 'locked') status = 'claimed';
  }
  return { status, lockState, lock };
}

export type { LockChainEvent };
