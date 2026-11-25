import { NextResponse } from 'next/server';
import { getAddress, type PublicClient } from 'viem';
import { publicClient } from '@/lib/agents/tools';
import { AgentRegistryABI, AgentScoreABI } from '@/lib/contracts/agent-credit-score-abi';
import { getAgentRegistryAddress, getAgentScoreAddress } from '@/lib/contracts/addresses';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/scores
 *
 * Every registered agent with its credit score, newest first — the same rows
 * useAgentDirectory used to read from the browser. The browser read
 * (agentCount + two multicalls through wagmi) stopped resolving on
 * /agents/scores in the Nov 21 evening scan: the page sat on "Loading agents
 * from Robinhood Chain…" for 35s+ across a reload while /agents and
 * /agents/receipts rendered the same 5 scores fine, so the loader — not the
 * chain — was broken (same first-load storm that broke the token pages).
 * The read now runs once here, on the server, and the browser makes one
 * cheap request (rounds 2/4 pattern).
 *
 * Caching follows the /api/terminal/leaderboard rules: in-memory cache,
 * 60s TTL (the page refetches every 60s), keyed by nothing (one directory);
 * `no-store` to the browser; a stale value is refreshed inline (bounded by
 * WAIT_MS), never in after(); no cache yet: the read is awaited up to
 * WAIT_MS, else 502 and the client retries with backoff.
 *
 * `stake` is serialized as a decimal string: AgentRow carries it as a
 * bigint, which JSON cannot carry. The hook revives it with BigInt().
 */
const TTL_MS = 60_000;
const WAIT_MS = 8_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

type AgentWire = {
  id: number;
  name: string;
  wallet: string;
  agentAccount: string;
  stake: string;
  registeredAt: number;
  active: boolean;
  scored: boolean;
  score: number | null;
  components: number[] | null;
  updatedAt: number | null;
};
type Entry = { value?: { agents: AgentWire[]; updatedAt: number }; at: number; inflight?: Promise<{ agents: AgentWire[]; updatedAt: number }> };
let cache: Entry | null = null;
const client = publicClient as PublicClient;

async function readDirectory(): Promise<{ agents: AgentWire[]; updatedAt: number }> {
  const registry = getAddress(getAgentRegistryAddress() as `0x${string}`);
  const score = getAddress(getAgentScoreAddress() as `0x${string}`);
  const count = Number(await client.readContract({ address: registry, abi: AgentRegistryABI, functionName: 'agentCount' }));
  if (!count) return { agents: [], updatedAt: Date.now() };
  const ids = Array.from({ length: Math.min(count, 200) }, (_, i) => i + 1);
  // NOTE: read via getAgent, NOT the public `agents` mapping getter.
  // viem 2.58 fails to decode the mapping getter's tuple (it reads the
  // wallet address slot as a number — IntegerOutOfRangeError — so the
  // multicall fails and the directory renders empty even though agentCount
  // is 1). getAgent returns the identical Agent struct and decodes fine
  // (verified against both RPCs, Nov 20).
  // NOTE 2: viem decodes tuples as plain objects with named keys only —
  // result[0] is undefined. Read every field by NAME (a.wallet, not a[0]).
  const [agents, scores] = await Promise.all([
    client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({ address: registry, abi: AgentRegistryABI, functionName: 'getAgent' as const, args: [BigInt(id)] as const })),
    }),
    client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({ address: score, abi: AgentScoreABI, functionName: 'scores' as const, args: [BigInt(id)] as const })),
    }),
  ]);
  const rows = ids
    .map((id, i) => {
      const a = agents[i]?.status === 'success' ? (agents[i].result as unknown as { wallet: string; agentAccount: string; name: string; stake: bigint; registeredAt: bigint; active: boolean }) : null;
      const s = scores[i]?.status === 'success' ? (scores[i].result as unknown as { score: number; performance: number; history: number; activity: number; stake: number; conduct: number; updatedAt: bigint; inputsHash: string; exists: boolean }) : null;
      if (!a) return null;
      const scored = !!s && s.exists === true;
      return {
        id,
        name: a.name || `Agent #${id}`,
        wallet: a.wallet,
        agentAccount: a.agentAccount,
        stake: (a.stake ?? 0n).toString(),
        registeredAt: Number(a.registeredAt),
        active: a.active,
        scored,
        score: scored ? Number(s.score) : null,
        components: scored ? [Number(s.performance), Number(s.history), Number(s.activity), Number(s.stake), Number(s.conduct)] : null,
        updatedAt: scored ? Number(s.updatedAt) : null,
      } satisfies AgentWire;
    })
    .filter((r): r is AgentWire => r !== null)
    .reverse();
  return { agents: rows, updatedAt: Date.now() };
}

export async function GET() {
  if (!getAgentRegistryAddress() || !getAgentScoreAddress()) {
    return NextResponse.json({ error: 'The score contracts are not wired up on this deployment yet.' }, { status: 503, headers: NO_STORE });
  }
  const stale = cache && Date.now() - cache.at > TTL_MS;
  if (cache?.value && !stale) return NextResponse.json(cache.value, { headers: NO_STORE });
  const refresh = () => {
    if (cache?.inflight) return cache.inflight;
    const p = readDirectory()
      .then((value) => { cache = { value, at: Date.now() }; return value; })
      .catch((err) => {
        console.error('agent scores refresh failed', err);
        cache = cache?.value ? { value: cache.value, at: cache.at } : null;
        throw err;
      });
    cache = { value: cache?.value, at: cache?.at ?? 0, inflight: p };
    return p;
  };
  if (cache?.value && stale) {
    refresh().catch(() => {});
    return NextResponse.json(cache.value, { headers: NO_STORE });
  }
  const timedOut = Symbol('timedOut');
  const v = await Promise.race([refresh(), new Promise((resolve) => setTimeout(() => resolve(timedOut), WAIT_MS))]).catch(() => undefined);
  if (v === undefined || v === timedOut) {
    return NextResponse.json({ error: 'Could not read the agent list right now.' }, { status: 502, headers: NO_STORE });
  }
  return NextResponse.json(v, { headers: NO_STORE });
}
