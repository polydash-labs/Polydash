/**
 * Platform API usage totals — summed across ALL tool calls, Pro-keyed and free.
 *
 * One row in ApiKeyUsage exists per tool call (MCP tools/call + v2 REST).
 * Free (unkeyed) calls are logged with keyId 'free' and counted in the total
 * — a free call is the product working — and the totals show the Pro/free
 * split in plain words. `mlo` counts calls to polypad_agent_chat, the tool
 * only Major League Operator's key can call, so MLO's usage is visible as
 * its own line. `keysActive` counts real Pro keys only, never 'free'.
 *
 * A failed read returns status 'error' with nulls — never a stale or guessed
 * number — and the query races a 5s timeout so a slow database never blocks
 * the homepage render.
 */
import { prisma } from '@/lib/db';
import { FREE_KEY_ID } from '@/lib/agents-api/v2/usage';

export type UsageTotals = {
  status: 'ok' | 'error';
  total: number | null;
  pro: number | null;
  free: number | null;
  mlo: number | null;
  reads: number | null;
  prepares: number | null;
  intents: number | null;
  ok: number | null;
  errors: number | null;
  rateLimited: number | null;
  last24h: number | null;
  keysActive: number | null;
  checkedAt: string;
  note: string | null;
};

const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 1_500;

let cache: { at: number; value: UsageTotals } | null = null;

function errorTotals(note: string): UsageTotals {
  return {
    status: 'error',
    total: null,
    pro: null,
    free: null,
    mlo: null,
    reads: null,
    prepares: null,
    intents: null,
    ok: null,
    errors: null,
    rateLimited: null,
    last24h: null,
    keysActive: null,
    checkedAt: new Date().toISOString(),
    note,
  };
}

async function compute(): Promise<UsageTotals> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [byKindStatus, last24h, distinctKeys, byKey, mloCalls] = await Promise.all([
    prisma.apiKeyUsage.groupBy({ by: ['kind', 'status'], _count: { _all: true } }),
    prisma.apiKeyUsage.count({ where: { createdAt: { gte: since24h } } }),
    prisma.apiKeyUsage.findMany({ select: { keyId: true }, distinct: ['keyId'] }),
    prisma.apiKeyUsage.groupBy({ by: ['keyId'], _count: { _all: true } }),
    prisma.apiKeyUsage.count({ where: { tool: 'polypad_agent_chat' } }),
  ]);

  const sum = (kind?: string, status?: string): number =>
    byKindStatus
      .filter((r) => (kind === undefined || r.kind === kind) && (status === undefined || r.status === status))
      .reduce((acc, r) => acc + r._count._all, 0);

  const total = sum();
  const free = byKey.find((r) => r.keyId === FREE_KEY_ID)?._count._all ?? 0;

  return {
    status: 'ok',
    total,
    pro: total - free,
    free,
    mlo: mloCalls,
    reads: sum('read'),
    prepares: sum('prepare'),
    intents: sum('intent'),
    ok: sum(undefined, 'ok'),
    errors: sum(undefined, 'error'),
    rateLimited: sum(undefined, 'rate_limited'),
    last24h,
    keysActive: distinctKeys.filter((r) => r.keyId !== FREE_KEY_ID).length,
    checkedAt: new Date().toISOString(),
    note: null,
  };
}

export async function getUsageTotals(): Promise<UsageTotals> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const attempt = async (): Promise<UsageTotals> => {
    try {
      return await Promise.race([
        compute(),
        new Promise<UsageTotals>((resolve) =>
          setTimeout(() => resolve(errorTotals('The usage database did not answer in time.')), QUERY_TIMEOUT_MS),
        ),
      ]);
    } catch (e) {
      // Logged server-side (Vercel logs) so a real failure can be diagnosed.
      console.error('[usage-totals] query failed:', e instanceof Error ? e.message : e);
      return errorTotals('Could not read the platform usage totals.');
    }
  };
  // Neon compute suspends when idle: a first-attempt failure is often just
  // the database waking up. Retry once before giving up.
  let value = await attempt();
  if (value.status === 'error') {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    value = await attempt();
  }
  // Only cache good numbers — a transient failure must not stick for a minute.
  if (value.status === 'ok') cache = { at: Date.now(), value };
  return value;
}
