import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAddress, isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';
import { deriveJobId, newJobNonce } from '@/lib/earn/job-id';
import { serializeJob, listJobs } from '@/lib/earn/server';
import { checkLimit, clientIp } from '@/lib/earn/rate-limit';
import {
  JOB_STATUSES,
  MAX_JOB_PRICE_USD,
  MIN_JOB_PRICE_USD,
  PILOT_JOB_LIMIT,
} from '@/lib/earn/constants';
import { usdToUsdgUnits } from '@/lib/earn/fees';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/earn/jobs — public job list.
 * Without ?poster=, only jobs the board may show (screened-in and beyond,
 * minus screened-out and pending). With ?poster=<address>, that poster's
 * own jobs in any status are included too (so a poster can find a
 * screened-in job to lock). Unscreened jobs are never visible to agents.
 */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Agent earn is not configured yet.' }, { status: 503 });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const posterParam = url.searchParams.get('poster');
  const poster = posterParam && isAddress(posterParam, { strict: false }) ? getAddress(posterParam) : null;
  // The admin (Atlas) sees everything, including jobs awaiting screening.
  const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value).catch(() => null);

  const statuses = statusParam
    ? (statusParam.split(',').filter((s) => (JOB_STATUSES as readonly string[]).includes(s)) as (typeof JOB_STATUSES)[number][])
    : undefined;
  try {
    const rows = await listJobs(statuses);
    const visible = rows.filter((job) => {
      if (admin) return true;
      if (job.status === 'pending_screening' || job.status === 'screened_out') {
        return poster !== null && job.poster.toLowerCase() === poster.toLowerCase();
      }
      return true;
    });
    return NextResponse.json(
      { jobs: visible.map(serializeJob) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[earn/jobs] list failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not load jobs.' }, { status: 500 });
  }
}

/**
 * POST /api/agents/earn/jobs — create a job (poster).
 * The job starts pending_screening and is invisible until Atlas approves
 * it AND the poster locks the price in escrow. The jobId is derived
 * server-side from the poster + a fresh random nonce (unpredictable —
 * brief §2.4), never client-supplied.
 */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Agent earn is not configured yet.' }, { status: 503 });
  }
  const block = checkLimit(clientIp(req));
  if (block) {
    return NextResponse.json({ error: block.reply }, { status: 429, headers: { 'Retry-After': String(block.retryAfter) } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send the request as JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Send the request as JSON.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const posterRaw = str(b.poster, 42);
  if (!isAddress(posterRaw, { strict: false })) {
    return NextResponse.json({ error: 'Connect your wallet — the poster address is missing or invalid.' }, { status: 400 });
  }
  const poster = getAddress(posterRaw);
  const title = str(b.title, 120);
  const topic = str(b.topic, 200);
  const researchQuestions = str(b.researchQuestions, 5000);
  const format = str(b.format, 500);
  const sourceConstraints = str(b.sourceConstraints, 2000);
  const acceptanceCriteria = str(b.acceptanceCriteria, 2000);
  const priceUsd = typeof b.priceUsd === 'number' ? b.priceUsd : Number(b.priceUsd);
  const deadlineRaw = str(b.deadline, 40);
  const deadline = new Date(deadlineRaw);

  if (!title) return NextResponse.json({ error: 'Give the job a title.' }, { status: 400 });
  if (!topic) return NextResponse.json({ error: 'Say what the research is about.' }, { status: 400 });
  if (researchQuestions.length < 10) {
    return NextResponse.json({ error: 'Write the research questions — at least a sentence.' }, { status: 400 });
  }
  if (!format) return NextResponse.json({ error: 'Say what format the report should be in (length, sections).' }, { status: 400 });
  if (acceptanceCriteria.length < 10) {
    return NextResponse.json({
      error: 'Write the acceptance criteria — how will the poster know the report is good enough? Vague briefs are bounced at screening.',
    }, { status: 400 });
  }
  if (!Number.isFinite(priceUsd) || priceUsd < MIN_JOB_PRICE_USD || priceUsd > MAX_JOB_PRICE_USD) {
    return NextResponse.json({ error: `The price must be between $${MIN_JOB_PRICE_USD} and $${MAX_JOB_PRICE_USD} for the pilot.` }, { status: 400 });
  }
  if (isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Pick a deadline in the future.' }, { status: 400 });
  }
  if (deadline.getTime() - Date.now() > 60 * 86400_000) {
    return NextResponse.json({ error: 'The deadline must be within 60 days.' }, { status: 400 });
  }

  try {
    const liveCount = await prisma.agentEarnJob.count({
      where: { status: { not: 'screened_out' } },
    });
    if (liveCount >= PILOT_JOB_LIMIT) {
      return NextResponse.json({ error: `The pilot is full — ${PILOT_JOB_LIMIT} jobs. New jobs open when one settles.` }, { status: 409 });
    }

    const nonce = newJobNonce();
    const jobId = deriveJobId(poster, nonce);
    const row = await prisma.agentEarnJob.create({
      data: {
        id: jobId,
        poster,
        posterNonce: nonce,
        title,
        topic,
        researchQuestions,
        format,
        sourceConstraints,
        acceptanceCriteria,
        priceUsdg: usdToUsdgUnits(priceUsd),
        deadline,
        status: 'pending_screening',
        timeline: [{ type: 'created', at: new Date().toISOString(), note: `Job created by ${poster}. Awaiting screening.` }],
      },
    });
    return NextResponse.json({ job: serializeJob(row) }, { status: 201 });
  } catch (e) {
    console.error('[earn/jobs] create failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not create the job.' }, { status: 500 });
  }
}
