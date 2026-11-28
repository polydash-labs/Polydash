import { NextResponse } from 'next/server';
import type { Hex } from 'viem';
import { prisma } from '@/lib/db';
import { getJob, appendTimeline } from '@/lib/earn/server';
import { readLock } from '@/lib/earn/chain';
import { checkLimit, clientIp } from '@/lib/earn/rate-limit';
import { isValidJobId } from '@/lib/earn/job-id';
import { DISPUTE_WINDOW_SECONDS } from '@/lib/earn/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/earn/jobs/[jobId]/dispute — poster files a dispute.
 * The poster must state reasons in writing: a rejection WITHOUT stated
 * reasons cannot go to a panel and defaults to acceptance after the
 * window (design doc §5.1). Filing requires the job to be delivered and
 * inside the 72h window, and the caller to be the poster recorded on the
 * lock. This is the paper trail that triggers panel formation — the
 * on-chain settlement still happens only via release or panelResolve.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Agent earn is not configured yet.' }, { status: 503 });
  }
  const block = checkLimit(clientIp(req));
  if (block) {
    return NextResponse.json({ error: block.reply }, { status: 429, headers: { 'Retry-After': String(block.retryAfter) } });
  }

  const { jobId } = await params;
  if (!isValidJobId(jobId)) {
    return NextResponse.json({ error: 'That is not a job id.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send the request as JSON.' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const reasons = typeof b.reasons === 'string' ? b.reasons.trim().slice(0, 5000) : '';
  const poster = typeof b.poster === 'string' ? b.poster.trim().toLowerCase() : '';
  if (reasons.length < 10) {
    return NextResponse.json({ error: 'State the reasons for the dispute — at least a sentence. A rejection without reasons cannot go to a panel.' }, { status: 400 });
  }

  try {
    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    if (job.status !== 'delivered') {
      return NextResponse.json({ error: `This job is ${job.status} — only a delivered job can be disputed.` }, { status: 409 });
    }
    const lock = await readLock(jobId as Hex);
    if (!lock) return NextResponse.json({ error: 'No lock exists for this job on-chain.' }, { status: 400 });
    if (lock.deliveredAt === 0n) {
      return NextResponse.json({ error: 'Nothing has been delivered yet.' }, { status: 400 });
    }
    if (poster !== lock.poster.toLowerCase()) {
      return NextResponse.json({ error: 'Only the poster can dispute this job.' }, { status: 403 });
    }
    const secondsLeft = Number(lock.deliveredAt) + DISPUTE_WINDOW_SECONDS - Math.floor(Date.now() / 1000);
    if (secondsLeft <= 0) {
      return NextResponse.json({ error: 'The 72-hour dispute window has closed — the job now goes to a forced panel.' }, { status: 409 });
    }
    const now = new Date();
    await prisma.agentEarnJob.update({
      where: { id: jobId },
      data: { disputeReasons: reasons, disputedAt: now, status: 'disputed' },
    });
    await appendTimeline(jobId, { type: 'disputed', at: now.toISOString(), note: `Poster disputed with reasons: ${reasons.slice(0, 200)}` });
    return NextResponse.json({ ok: true, status: 'disputed', secondsLeft });
  } catch (e) {
    console.error('[earn/dispute] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not file the dispute.' }, { status: 500 });
  }
}
