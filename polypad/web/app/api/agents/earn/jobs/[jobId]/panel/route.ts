import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { encodeFunctionData, type Hex } from 'viem';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';
import { getJob, appendTimeline } from '@/lib/earn/server';
import { readLock } from '@/lib/earn/chain';
import { getEligibleEvaluators, drawPanel } from '@/lib/earn/eligibility';
import { checkLimit, clientIp } from '@/lib/earn/rate-limit';
import { isValidJobId } from '@/lib/earn/job-id';
import { validatePanelSplit } from '@/lib/earn/fees';
import { AgentEarnEscrowABI, AGENT_EARN_ESCROW_ADDRESS, OUTCOME_NUMBERS } from '@/lib/earn/abi';
import { AGENT_EARN_PANEL_EXECUTOR, DISPUTE_WINDOW_SECONDS, PANEL_OUTCOMES, PANEL_SIZE } from '@/lib/earn/constants';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import type { JobBallot } from '@/lib/earn/receipt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/earn/jobs/[jobId]/panel — the panel state: the eligible
 * pool (conflicts excluded), the draw if one happened, the ballots so far,
 * and — once all three ballots are in — the exact panelResolve call data
 * for the 2-of-3 multisig to execute in the Safe app. The board never
 * calls panelResolve itself: only the multisig can.
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
    const lock = await readLock(jobId as Hex).catch(() => null);
    const exclude = [job.poster, lock?.agent ?? ''].filter(Boolean);
    const pool = await getEligibleEvaluators(exclude);
    const ballots = (Array.isArray(job.ballots) ? job.ballots : []) as unknown as JobBallot[];
    const drawn = (Array.isArray(job.panelDrawn) ? job.panelDrawn : []) as number[];
    const callData = buildCallData(job, ballots);
    return NextResponse.json({
      jobId,
      status: job.status,
      pool: pool.map((p) => ({ agentId: p.agentId, name: p.name, wallet: p.wallet, score: p.score })),
      drawn,
      seed: job.panelSeed ?? null,
      poolAgentIds: Array.isArray(job.panelPool) ? job.panelPool : null,
      drawnAt: job.panelDrawnAt?.toISOString() ?? null,
      ballots,
      callData,
      multisig: AGENT_EARN_PANEL_EXECUTOR,
      multisigUrl: `https://app.safe.global/transactions/queue?safe=eth:${AGENT_EARN_PANEL_EXECUTOR}`,
      escrowUrl: getExplorerAddressUrl(AGENT_EARN_ESCROW_ADDRESS),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[earn/panel] GET failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not load the panel.' }, { status: 500 });
  }
}

/** The panelResolve call data, once the three ballots agree on an outcome.
 * Ballots must be unanimous on the outcome (and on the split for PayPart);
 * a split panel has no executable call — Atlas resolves it with the
 * evaluators before execution. Returns null until executable. */
function buildCallData(
  job: { id: string; panelDrawn: unknown; priceUsdg: bigint },
  ballots: JobBallot[],
): { to: string; value: string; data: Hex; outcome: string; splitBps: number; voters: string[] } | null {
  const drawn = (Array.isArray(job.panelDrawn) ? job.panelDrawn : []) as number[];
  if (drawn.length !== PANEL_SIZE || ballots.length !== PANEL_SIZE) return null;
  const votes = ballots.map((b) => b.vote);
  if (new Set(votes).size !== 1) return null;
  const outcome = votes[0] as (typeof PANEL_OUTCOMES)[number];
  if (!(PANEL_OUTCOMES as readonly string[]).includes(outcome)) return null;
  let splitBps = outcome === 'PayFull' ? 10_000 : outcome === 'NoPay' ? 0 : ballots[0].splitBps ?? 0;
  if (outcome === 'PayPart') {
    const splits = new Set(ballots.map((b) => b.splitBps));
    if (splits.size !== 1 || splitBps <= 0 || splitBps >= 10_000) return null;
  }
  const invalid = validatePanelSplit(outcome, splitBps, job.priceUsdg);
  if (invalid) return null;
  const voters = drawn
    .map((id) => ballots.find((b) => b.agentId === id)?.wallet)
    .filter((w): w is string => Boolean(w));
  if (voters.length !== PANEL_SIZE) return null;
  const data = encodeFunctionData({
    abi: AgentEarnEscrowABI,
    functionName: 'panelResolve',
    args: [job.id as Hex, OUTCOME_NUMBERS[outcome], splitBps, voters as `0x${string}`[]],
  });
  return { to: AGENT_EARN_ESCROW_ADDRESS, value: '0', data, outcome, splitBps, voters };
}

/**
 * POST /api/agents/earn/jobs/[jobId]/panel
 * { action: 'draw' } — admin only. Draws 3 evaluators from the eligible
 * pool (poster + claiming agent excluded). The draw is seeded and
 * reproducible: the seed + pool are stored on the receipt, so anyone can
 * re-run it. Requires a dispute, or a delivered job whose 72h window has
 * closed (silence → forced panel).
 * { action: 'ballot', agentId, vote, splitBps?, reason? } — one ballot per
 * drawn evaluator (PayFull / PayPart / NoPay). Ballots are public on the
 * receipt the moment they are recorded. Pilot note: ballots are recorded
 * without a signature — the evaluators are known agents, the multisig
 * executes the outcome, and every ballot is public and attributable.
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
  const action = typeof b.action === 'string' ? b.action : '';

  try {
    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    if (action === 'draw') {
      const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
      if (!admin) return NextResponse.json({ error: 'Sign in with the admin wallet.' }, { status: 401 });
      if (job.status !== 'disputed' && job.status !== 'delivered') {
        return NextResponse.json({ error: `This job is ${job.status} — there is nothing to form a panel for.` }, { status: 409 });
      }
      const lock = await readLock(jobId as Hex);
      if (!lock) return NextResponse.json({ error: 'No lock exists for this job on-chain.' }, { status: 400 });
      if (job.status === 'delivered') {
        // Silence path: only once the 72h window has closed.
        const secondsLeft = Number(lock.deliveredAt) + DISPUTE_WINDOW_SECONDS - Math.floor(Date.now() / 1000);
        if (secondsLeft > 0) {
          return NextResponse.json({ error: 'The poster still has time to accept or dispute — the forced panel forms only after 72h of silence.' }, { status: 409 });
        }
      }
      if (lock.deliveredAt === 0n) {
        return NextResponse.json({ error: 'Nothing has been delivered yet — a panel decides delivered work.' }, { status: 400 });
      }
      const excludeAgentIds = Array.isArray(b.excludeAgentIds)
        ? (b.excludeAgentIds as unknown[]).filter((v): v is number => typeof v === 'number')
        : [];
      const pool = await getEligibleEvaluators([job.poster, lock.agent], excludeAgentIds);
      if (pool.length < PANEL_SIZE) {
        return NextResponse.json({ error: `Only ${pool.length} eligible evaluator(s) — a panel needs ${PANEL_SIZE} (registered, score 300+, session-key wallet).` }, { status: 409 });
      }
      const poolIds = pool.map((p) => p.agentId);
      const { drawn, seed } = drawPanel(poolIds);
      const now = new Date();
      await prisma.agentEarnJob.update({
        where: { id: jobId },
        data: { panelSeed: seed, panelPool: poolIds, panelDrawn: drawn, panelDrawnAt: now, ballots: [], status: 'panel' },
      });
      await appendTimeline(jobId, {
        type: 'panel_drawn', at: now.toISOString(),
        note: `Panel drawn from ${pool.length} eligible evaluators (seed ${seed.slice(0, 10)}…).`,
        data: { pool: poolIds, drawn, seed },
      });
      return NextResponse.json({ ok: true, drawn, seed, pool: poolIds });
    }

    if (action === 'ballot') {
      if (job.status !== 'panel') {
        return NextResponse.json({ error: `This job is ${job.status} — no panel is open.` }, { status: 409 });
      }
      const agentId = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId);
      const vote = typeof b.vote === 'string' ? b.vote : '';
      const splitBps = typeof b.splitBps === 'number' ? b.splitBps : undefined;
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 1000) : '';
      if (!Number.isInteger(agentId) || agentId < 1) {
        return NextResponse.json({ error: 'Send the evaluating agent id.' }, { status: 400 });
      }
      if (!(PANEL_OUTCOMES as readonly string[]).includes(vote)) {
        return NextResponse.json({ error: 'Vote must be PayFull, PayPart or NoPay.' }, { status: 400 });
      }
      if (vote === 'PayPart' && (splitBps === undefined || splitBps <= 0 || splitBps >= 10_000)) {
        return NextResponse.json({ error: 'A partial payment needs a split between 1% and 99%.' }, { status: 400 });
      }
      const drawn = (Array.isArray(job.panelDrawn) ? job.panelDrawn : []) as number[];
      if (!drawn.includes(agentId)) {
        return NextResponse.json({ error: `Agent #${agentId} was not drawn for this panel.` }, { status: 403 });
      }
      const ballots = (Array.isArray(job.ballots) ? job.ballots : []) as unknown as JobBallot[];
      if (ballots.some((x) => x.agentId === agentId)) {
        return NextResponse.json({ error: `Agent #${agentId} has already voted.` }, { status: 409 });
      }
      const lock = await readLock(jobId as Hex);
      // Resolve the voter's wallet + name from the eligible pool (on-chain).
      const pool = await getEligibleEvaluators([job.poster, lock?.agent ?? '']);
      const member = pool.find((p) => p.agentId === agentId);
      const ballot: JobBallot = {
        agentId,
        name: member?.name ?? `Agent #${agentId}`,
        wallet: member?.wallet ?? '',
        vote,
        splitBps: vote === 'PayPart' ? splitBps : undefined,
        reason: reason || undefined,
        at: new Date().toISOString(),
      };
      const next = [...ballots, ballot];
      await prisma.agentEarnJob.update({ where: { id: jobId }, data: { ballots: JSON.parse(JSON.stringify(next)) } });
      await appendTimeline(jobId, {
        type: 'ballot', at: ballot.at,
        note: `Agent #${agentId} voted ${vote}${vote === 'PayPart' ? ` (${splitBps! / 100}% to the agent)` : ''}.`,
        data: { agentId, vote, splitBps },
      });
      const executable = next.length === PANEL_SIZE ? buildCallData(job, next) : null;
      return NextResponse.json({ ok: true, ballots: next, executable: executable !== null, callData: executable });
    }

    return NextResponse.json({ error: "Action must be 'draw' or 'ballot'." }, { status: 400 });
  } catch (e) {
    console.error('[earn/panel] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not update the panel.' }, { status: 500 });
  }
}
