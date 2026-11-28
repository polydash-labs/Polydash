import { NextResponse } from 'next/server';
import type { Hex } from 'viem';
import { getJob, serializeJob, resolveJobView } from '@/lib/earn/server';
import { readLock, readLockEvents } from '@/lib/earn/chain';
import { isValidJobId } from '@/lib/earn/job-id';
import { buildJobReceipt } from '@/lib/earn/receipt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/earn/jobs/[jobId] — one job: the board row, the live
 * on-chain lock, the resolved display status, and the public receipt.
 * The lock state wins on any disagreement with the board row.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Agent earn is not configured yet.' }, { status: 503 });
  }
  const { jobId } = await params;
  if (!isValidJobId(jobId)) {
    return NextResponse.json({ error: 'That is not a job id.' }, { status: 400 });
  }
  try {
    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    let lock = null;
    let events: Awaited<ReturnType<typeof readLockEvents>> = [];
    try {
      lock = await readLock(jobId as Hex);
      events = await readLockEvents(jobId as Hex);
    } catch (e) {
      console.error('[earn/job] chain read failed', (e as Error)?.message);
    }
    const view = resolveJobView(job, lock);
    const receipt = buildJobReceipt(job, lock, events, view.status);
    return NextResponse.json(
      { job: serializeJob(job), lock: lock ? {
        poster: lock.poster,
        agent: lock.agent,
        amount: lock.amount.toString(),
        state: lock.state,
        lockedAt: Number(lock.lockedAt),
        claimedAt: Number(lock.claimedAt),
        deliverableHash: lock.deliverableHash,
        deliveredAt: Number(lock.deliveredAt),
        feeBpsAtLock: lock.feeBpsAtLock,
        settledAt: Number(lock.settledAt),
        outcome: lock.outcome,
        agentShare: lock.agentShare.toString(),
        posterShare: lock.posterShare.toString(),
        feePaid: lock.feePaid.toString(),
      } : null, status: view.status, lockState: view.lockState, receipt },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[earn/job] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not load the job.' }, { status: 500 });
  }
}
