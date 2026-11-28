import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';
import { getJob, appendTimeline } from '@/lib/earn/server';
import { checkLimit, clientIp } from '@/lib/earn/rate-limit';
import { isValidJobId } from '@/lib/earn/job-id';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/earn/jobs/[jobId]/screen — Atlas screening (admin only).
 * Screening judges listability only — legality, coherence,
 * impersonation/trademark, price/deadline plausibility. It never judges
 * quality. A rejected job goes back to the poster with a reason.
 * Admin is the factory owner, signed in with the admin wallet (same
 * cookie as the agent-actions admin routes).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Agent earn is not configured yet.' }, { status: 503 });
  }
  const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!admin) return NextResponse.json({ error: 'Sign in with the admin wallet.' }, { status: 401 });
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
  const decision = typeof b.decision === 'string' ? b.decision : '';
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 1000) : '';
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: "Decision must be 'approve' or 'reject'." }, { status: 400 });
  }
  if (decision === 'reject' && reason.length < 5) {
    return NextResponse.json({ error: 'A rejected job needs a reason — the poster sees it.' }, { status: 400 });
  }

  try {
    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    if (job.status !== 'pending_screening') {
      return NextResponse.json({ error: `This job is already ${job.status} — screening is done.` }, { status: 409 });
    }
    const now = new Date();
    await prisma.agentEarnJob.update({
      where: { id: jobId },
      data: {
        status: decision === 'approve' ? 'screened_in' : 'screened_out',
        screeningReason: reason || null,
        screenedAt: now,
      },
    });
    await appendTimeline(jobId, {
      type: decision === 'approve' ? 'screened_in' : 'screened_out',
      at: now.toISOString(),
      note:
        decision === 'approve'
          ? 'Approved at screening — the poster can now lock the price in escrow.'
          : `Rejected at screening: ${reason}`,
    });
    return NextResponse.json({ ok: true, status: decision === 'approve' ? 'screened_in' : 'screened_out' });
  } catch (e) {
    console.error('[earn/screen] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not record the screening decision.' }, { status: 500 });
  }
}
