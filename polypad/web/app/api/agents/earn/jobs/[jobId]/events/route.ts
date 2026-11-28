import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { keccak256, stringToHex, getAddress, type Hex } from 'viem';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';
import { publicClient } from '@/lib/agents/tools';
import { AgentRegistryABI } from '@/lib/contracts/agent-credit-score-abi';
import { getAgentRegistryAddress } from '@/lib/contracts/addresses';
import { readAgentIdentityCached } from '@/lib/agents/identity';
import { getJob, appendTimeline } from '@/lib/earn/server';
import { verifyTxEvent, readLock } from '@/lib/earn/chain';
import { checkLimit, clientIp } from '@/lib/earn/rate-limit';
import { isValidJobId } from '@/lib/earn/job-id';
import { AGENT_EARN_PANEL_EXECUTOR } from '@/lib/earn/constants';
import { OUTCOME_NAMES } from '@/lib/earn/abi';

export const dynamic = 'force-dynamic';

const EVENT_NAMES = ['locked', 'claimed', 'delivered', 'released', 'refunded', 'panelResolved', 'lapsed'] as const;
type EventName = (typeof EVENT_NAMES)[number];

const CHAIN_EVENT: Record<Exclude<EventName, 'lapsed'>, 'Locked' | 'Claimed' | 'Delivered' | 'Released' | 'PanelResolved' | 'Refunded'> = {
  locked: 'Locked',
  claimed: 'Claimed',
  delivered: 'Delivered',
  released: 'Released',
  refunded: 'Refunded',
  panelResolved: 'PanelResolved',
};

/**
 * POST /api/agents/earn/jobs/[jobId]/events — record a job transition.
 * On-chain events (lock/claim/deliver/release/refund/panel) are VERIFIED
 * against the chain before anything is stored: the tx hash must exist,
 * must have succeeded, must contain the escrow event for this jobId, and
 * must be sent by the actor the contract expects (poster / claiming
 * agent / panel executor). A client claim alone is never recorded.
 *
 * The delivered event carries the report text: the server hashes it and
 * requires the hash to equal the on-chain deliverableHash — the text
 * stored IS the text the chain anchors (brief §2.2, W-01).
 *
 * The lapsed event is off-chain (admin only): the agent missed the
 * deadline, the claim lapses, the job re-lists.
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
  const event = typeof b.event === 'string' ? b.event : '';
  if (!(EVENT_NAMES as readonly string[]).includes(event)) {
    return NextResponse.json({ error: `Event must be one of: ${EVENT_NAMES.join(', ')}.` }, { status: 400 });
  }

  try {
    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    // --- Lapse: off-chain, admin only. ---
    if (event === 'lapsed') {
      const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
      if (!admin) return NextResponse.json({ error: 'Sign in with the admin wallet.' }, { status: 401 });
      if (job.status !== 'claimed' && job.status !== 'locked') {
        return NextResponse.json({ error: `A ${job.status} job cannot lapse.` }, { status: 409 });
      }
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : 'The agent missed the deadline.';
      await prisma.agentEarnJob.update({ where: { id: jobId }, data: { status: 'lapsed' } });
      await appendTimeline(jobId, { type: 'lapsed', at: new Date().toISOString(), note });
      return NextResponse.json({ ok: true, status: 'lapsed' });
    }

    // --- On-chain events: verify the tx first. ---
    const txHash = typeof b.txHash === 'string' ? b.txHash : '';
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return NextResponse.json({ error: 'Send the transaction hash.' }, { status: 400 });
    }
    const verified = await verifyTxEvent(txHash as Hex, jobId as Hex, CHAIN_EVENT[event as Exclude<EventName, 'lapsed'>]);
    if (!verified) {
      return NextResponse.json({ error: 'That transaction could not be verified on-chain for this job.' }, { status: 400 });
    }
    if (verified.status !== 'success') {
      return NextResponse.json({ error: 'That transaction reverted — nothing happened on-chain.' }, { status: 400 });
    }
    const from = verified.from.toLowerCase();
    const args = verified.eventArgs ?? {};
    const now = new Date(verified.blockTimestamp * 1000);

    if (event === 'locked') {
      if (job.status !== 'screened_in') {
        return NextResponse.json({ error: `This job is ${job.status} — it must be screened in before it can lock.` }, { status: 409 });
      }
      if (from !== job.poster.toLowerCase()) {
        return NextResponse.json({ error: 'The lock transaction was not sent by the poster.' }, { status: 400 });
      }
      await prisma.agentEarnJob.update({ where: { id: jobId }, data: { lockTxHash: txHash, status: 'locked' } });
      await appendTimeline(jobId, { type: 'locked', at: now.toISOString(), txHash, note: `Poster locked ${job.priceUsdg.toString()} USDG units in escrow.` });
      return NextResponse.json({ ok: true, status: 'locked' });
    }

    if (event === 'claimed') {
      if (job.status !== 'locked') {
        return NextResponse.json({ error: `This job is ${job.status} — only an open job can be claimed.` }, { status: 409 });
      }
      const agentWallet = getAddress(args.agent as string);
      const registry = getAddress(getAgentRegistryAddress() as `0x${string}`);
      const agentId = Number(await publicClient.readContract({
        address: registry, abi: AgentRegistryABI, functionName: 'agentIdByWallet', args: [agentWallet],
      }));
      if (agentId === 0) {
        return NextResponse.json({ error: 'The claiming wallet is not a registered agent.' }, { status: 400 });
      }
      // Capture the session-key caps in force at claim time for the receipt.
      let sessionKey: unknown = null;
      try {
        const identity = await readAgentIdentityCached(agentId);
        sessionKey = identity.sessionKey;
      } catch {
        sessionKey = null;
      }
      await prisma.agentEarnJob.update({
        where: { id: jobId },
        data: { claimTxHash: txHash, claimedByAgentId: agentId, claimedByWallet: agentWallet, status: 'claimed' },
      });
      await appendTimeline(jobId, {
        type: 'claimed', at: now.toISOString(), txHash,
        note: `Agent #${agentId} claimed the job from its session-key wallet.`,
        data: { agentId, wallet: agentWallet, sessionKey },
      });
      return NextResponse.json({ ok: true, status: 'claimed', agentId });
    }

    if (event === 'delivered') {
      if (job.status !== 'claimed') {
        return NextResponse.json({ error: `This job is ${job.status} — only a claimed job can be delivered.` }, { status: 409 });
      }
      const lock = await readLock(jobId as Hex);
      if (!lock || from !== lock.agent.toLowerCase()) {
        return NextResponse.json({ error: 'The delivery transaction was not sent by the claiming agent.' }, { status: 400 });
      }
      const text = typeof b.deliverableText === 'string' ? b.deliverableText : '';
      if (text.length < 10 || text.length > 200_000) {
        return NextResponse.json({ error: 'Send the report text (10 to 200,000 characters).' }, { status: 400 });
      }
      // The stored text must hash to the on-chain deliverableHash.
      const hash = keccak256(stringToHex(text));
      const onChainHash = (args.deliverableHash as string | undefined)?.toLowerCase();
      if (hash.toLowerCase() !== onChainHash) {
        return NextResponse.json({ error: 'The report text does not match the hash recorded on-chain.' }, { status: 400 });
      }
      const onTime = now.getTime() <= job.deadline.getTime();
      await prisma.agentEarnJob.update({
        where: { id: jobId },
        data: { deliverTxHash: txHash, deliverableHash: hash, deliverableText: text, deliveredAt: now, status: 'delivered' },
      });
      await appendTimeline(jobId, {
        type: 'delivered', at: now.toISOString(), txHash,
        note: onTime ? 'Report delivered on time.' : 'Report delivered late (after the deadline).',
        data: { deliverableHash: hash, onTime },
      });
      return NextResponse.json({ ok: true, status: 'delivered', onTime });
    }

    if (event === 'released') {
      if (job.status !== 'delivered' && job.status !== 'disputed') {
        return NextResponse.json({ error: `This job is ${job.status} — there is nothing to accept.` }, { status: 409 });
      }
      if (from !== job.poster.toLowerCase()) {
        return NextResponse.json({ error: 'The release transaction was not sent by the poster.' }, { status: 400 });
      }
      await prisma.agentEarnJob.update({ where: { id: jobId }, data: { releaseTxHash: txHash, settledAt: now, status: 'settled' } });
      await appendTimeline(jobId, { type: 'released', at: now.toISOString(), txHash, note: 'Poster accepted the report — agent paid net of the 2.5% fee.' });
      return NextResponse.json({ ok: true, status: 'settled' });
    }

    if (event === 'refunded') {
      if (job.status !== 'locked' && job.status !== 'claimed' && job.status !== 'lapsed') {
        return NextResponse.json({ error: `This job is ${job.status} — it cannot be refunded.` }, { status: 409 });
      }
      const isPoster = from === job.poster.toLowerCase();
      const isExecutor = from === AGENT_EARN_PANEL_EXECUTOR.toLowerCase();
      if (!isPoster && !isExecutor) {
        return NextResponse.json({ error: 'The refund transaction was not sent by the poster or the panel executor.' }, { status: 400 });
      }
      await prisma.agentEarnJob.update({
        where: { id: jobId },
        data: { refundTxHash: txHash, settledAt: now, status: job.status === 'lapsed' ? 'lapsed' : 'refunded' },
      });
      await appendTimeline(jobId, { type: 'refunded', at: now.toISOString(), txHash, note: 'Full lock returned to the poster. No fee.' });
      return NextResponse.json({ ok: true, status: job.status === 'lapsed' ? 'lapsed' : 'refunded' });
    }

    // panelResolved
    if (job.status !== 'disputed' && job.status !== 'panel') {
      return NextResponse.json({ error: `This job is ${job.status} — no panel decision is open.` }, { status: 409 });
    }
    if (from !== AGENT_EARN_PANEL_EXECUTOR.toLowerCase()) {
      return NextResponse.json({ error: 'The panel transaction was not sent by the panel multisig.' }, { status: 400 });
    }
    const outcomeNum = Number(args.outcome ?? 0);
    const outcomeName = (OUTCOME_NAMES as readonly string[])[outcomeNum] ?? 'Unknown';
    const agentShare = BigInt((args.agentShare as bigint | number | string | undefined)?.toString() ?? '0');
    const amount = BigInt(job.priceUsdg.toString());
    const splitBps = amount > 0n ? Number((agentShare * 10_000n) / amount) : 0;
    await prisma.agentEarnJob.update({
      where: { id: jobId },
      data: { panelTxHash: txHash, panelOutcome: outcomeName, panelSplitBps: splitBps, settledAt: now, status: 'settled' },
    });
    await appendTimeline(jobId, {
      type: 'panelResolved', at: now.toISOString(), txHash,
      note: `Panel decided ${outcomeName} (${splitBps / 100}% to the agent).`,
      data: { outcome: outcomeName, splitBps },
    });
    const missingBallots = !job.ballots || !Array.isArray(job.ballots) || job.ballots.length === 0;
    return NextResponse.json({
      ok: true,
      status: 'settled',
      warning: missingBallots ? 'Settled on-chain, but no ballots were recorded on the receipt — record them before announcing the outcome.' : undefined,
    });
  } catch (e) {
    console.error('[earn/events] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not record the event.' }, { status: 500 });
  }
}
