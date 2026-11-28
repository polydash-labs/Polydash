import { NextResponse } from 'next/server';
import type { Hex } from 'viem';
import { getJob, resolveJobView } from '@/lib/earn/server';
import { readLock, readLockEvents } from '@/lib/earn/chain';
import { isValidJobId } from '@/lib/earn/job-id';
import { buildJobReceipt } from '@/lib/earn/receipt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/earn/jobs/[jobId]/receipt — the public job receipt
 * (format polypad.agent-earn-receipt/1): intent → action → settlement.
 * Built live from the board row + the on-chain lock + escrow events, so
 * it never goes stale. Same shape the /agents/receipts directory links to.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
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
      console.error('[earn/receipt] chain read failed', (e as Error)?.message);
    }
    const view = resolveJobView(job, lock);
    const receipt = buildJobReceipt(job, lock, events, view.status);
    return NextResponse.json(receipt, {
      headers: { 'Cache-Control': 'public, s-maxage=60' },
    });
  } catch (e) {
    console.error('[earn/receipt] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not build the receipt.' }, { status: 500 });
  }
}
