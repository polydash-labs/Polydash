import { NextResponse } from 'next/server';
import { getAgent, COMING_SOON_REPLY } from '@/lib/agents/prompts';
import {
  extractAddresses, poolStats, recentFlows, analyzeToken, holdersAndFlows, securityScan, openPools, listPools,
} from '@/lib/agents/tools';
import { buildFactsForAddress } from '@/lib/buildact/view';
import { getAllHolderProtections, getHolderProtections, type HolderProtections } from '@/lib/holder-protections';

const TIER_RANK: Record<string, number> = { gold: 3, silver: 2, bronze: 1 };
const hpFacts = (hp: HolderProtections | null) => hp ? {
  tier: hp.tier, passed: hp.passed, total: hp.total,
  passing: hp.checks.filter((c) => c.status === 'pass').map((c) => c.id),
  notPassing: hp.checks.filter((c) => c.status !== 'pass').map((c) => `${c.id}:${c.status}`),
} : null;

/** Adds holderProtections (tier + passed) to each pool by stake/reward token and orders higher tiers first among pools with the same active state. */
async function withPoolTiers(pools: unknown) {
  if (!Array.isArray(pools)) return pools;
  const all = await getAllHolderProtections().catch(() => null);
  if (!all) return pools;
  const byToken = new Map(Object.values(all).map((v) => [v.token, v]));
  const out = pools.map((p: any) => {
    const h = byToken.get(String(p?.stakeToken ?? '').toLowerCase()) ?? byToken.get(String(p?.rewardToken ?? '').toLowerCase());
    return h ? { ...p, holderProtections: { tier: h.tier, passed: h.passed, total: 5 } } : p;
  });
  return out.sort((a: any, b: any) => (Number(!!b?.isActive) - Number(!!a?.isActive)) || ((TIER_RANK[b?.holderProtections?.tier] ?? 0) - (TIER_RANK[a?.holderProtections?.tier] ?? 0)));
}

export const dynamic = 'force-dynamic';

// In-memory per-IP rate limit: 1 request per 10 seconds and 30 per UTC day.
const GAP_MS = 10_000;
const DAILY_LIMIT = 30;
const hits = new Map<string, { last: number; day: string; count: number }>();
const WAIT_REPLY = 'Please wait a few seconds before sending another message.';
const DAILY_REPLY = "Please wait: you've reached today's limit of 30 messages. Try again tomorrow.";
function checkLimit(ip: string): { reply: string; retryAfter: number } | null {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const cur = hits.get(ip);
  const entry = cur && cur.day === day ? cur : { last: 0, day, count: 0 };
  if (now - entry.last < GAP_MS) return { reply: WAIT_REPLY, retryAfter: Math.ceil((GAP_MS - (now - entry.last)) / 1000) };
  if (entry.count >= DAILY_LIMIT) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return { reply: DAILY_REPLY, retryAfter: Math.ceil((midnight - now) / 1000) };
  }
  entry.last = now;
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.day !== day) hits.delete(k);
  return null;
}

const safe = async <T,>(p: Promise<T>) => { try { return await p; } catch (e: any) { return { error: e?.message ?? 'n/a' }; } };
const stripUrls = (s: string) => s.replace(/(https?:\/\/|www\.)\S+/gi, '').replace(/\b[\w-]+\.(com|io|xyz|org|net|app|world|me|gg)(\/\S*)?/gi, '');

async function toolContext(agent: string, task: string, tokenAddress?: string) {
  const addrs = extractAddresses(`${task} ${tokenAddress ?? ''}`);
  const out: Record<string, unknown> = {};
  if (agent === 'poly-agent') {
    if (addrs.length === 0) out.pools = await withPoolTiers(await safe(/open/i.test(task) ? openPools() : listPools()));
    for (const a of addrs) out[a] = { stats: await safe(poolStats(a)), flows: await safe(recentFlows(a)) };
  } else if (agent === 'polycto') {
    for (const a of addrs) out[a] = { token: await safe(analyzeToken(a)), holders: await safe(holdersAndFlows(a)), security: await safe(securityScan(a)), buildActivity: await buildFactsForAddress(a).catch(() => null), holderProtections: hpFacts(await getHolderProtections(a).catch(() => null)) };
  } else if (agent === 'polyforge') {
    for (const a of addrs) out[a] = { token: await safe(analyzeToken(a)) };
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const agent = getAgent(name);
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const block = checkLimit(ip);
  if (block) return NextResponse.json({ reply: block.reply, rateLimited: true }, { headers: { 'Retry-After': String(block.retryAfter) } });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const task = typeof body?.task === 'string' ? body.task.trim() : '';
  if (!task || task.length > 2000) return NextResponse.json({ error: 'Message must be 1 to 2000 characters.' }, { status: 400 });
  const rawHistory = Array.isArray(body?.history) ? body.history : [];
  if (rawHistory.length > 10) return NextResponse.json({ error: 'History is limited to 10 messages.' }, { status: 400 });
  const history = rawHistory
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  const tokenAddress = typeof body?.tokenAddress === 'string' ? body.tokenAddress : undefined;

  // Read at request time (never inlined at build): server-only env, no NEXT_PUBLIC_.
  const live = process.env['AGENTS_LIVE'];
  const rawKey = process.env['SWARMS_API_KEY'] ?? '';
  // Missing if empty or containing non-ASCII/bullet characters (a masked placeholder can't be sent as a header).
  const apiKey = /^[\x21-\x7e]+$/.test(rawKey) ? rawKey : '';
  // Log presence/length only, never the value or any part of it.
  console.log(`agent ${agent.id} chat: AGENTS_LIVE=${live ?? 'unset'} keyPresent=${!!apiKey} keyLength=${rawKey.length}`);
  if (live !== 'true' || !apiKey) return NextResponse.json({ reply: COMING_SOON_REPLY });

  try {
    const ctx = await toolContext(agent.id, task, tokenAddress);
    const fullTask = Object.keys(ctx).length ? `${task}\n\nTool results:\n${JSON.stringify(ctx).slice(0, 12000)}` : task;
    const res = await fetch('https://api.swarms.world/v1/agent/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        agent_config: {
          agent_name: agent.name, description: agent.description, system_prompt: agent.systemPrompt,
          model_name: 'gpt-4o-mini', max_loops: 1, max_tokens: agent.id === 'poly-agent' ? 900 : 600, temperature: 0.3,
        },
        task: fullTask,
        history,
      }),
    });
    if (!res.ok) {
      const errBody: any = await res.json().catch(() => null);
      const msg = errBody?.error?.message ?? errBody?.detail ?? errBody?.message ?? '';
      throw new Error(`upstream ${res.status}${msg ? `: ${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 200)}` : ''}`);
    }
    const data = await res.json();
    const outputs: any[] = Array.isArray(data?.outputs) ? data.outputs : [];
    const last = [...outputs].reverse().find((o) => (o?.role ?? '').toLowerCase() !== 'user' && o?.content);
    let reply = typeof last?.content === 'string' ? last.content : last?.content ? JSON.stringify(last.content) : '';
    if (!reply) throw new Error('empty reply');
    if (agent.id === 'polyforge') reply = stripUrls(reply);
    return NextResponse.json({ reply });
  } catch (e: any) {
    console.error(`agent ${agent.id} chat failed:`, e?.name === 'TimeoutError' ? 'timeout' : e?.message);
    return NextResponse.json({ reply: 'The agent could not answer right now. Please try again in a moment, or use the tools above.' });
  }
}
