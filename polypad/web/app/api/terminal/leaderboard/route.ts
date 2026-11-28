import { NextResponse } from 'next/server';
import { readNavs, type VaultNavs } from '@/lib/terminal/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/terminal/leaderboard?vaults=0x…,0x…
 *
 * The Terminal leaderboard's live values: navPerNft + total value per
 * vault. The browser used to multicall these per vault into the
 * first-load storm; the reads timed out often enough that the leaderboard
 * cycled "Value unavailable, retrying" → "Could not load the leaderboard
 * right now" → recovered (round 4). The read now runs once here, on the
 * server, and the browser makes one cheap request.
 *
 * The route takes the vault addresses as a parameter instead of re-reading
 * the fund lists: the Terminal already has the lists from /api/funds/list,
 * so re-reading three factory lists here would triple the cold cost (the
 * first version of this route did exactly that and 502'd on a cold start
 * at the 8s bound). One NAV multicall + balances is ~0.3s even cold.
 *
 * Caching follows the /api/fund/detail rules (Nov 21): in-memory cache,
 * 30s TTL (the page refetches every 30s), keyed by the vault set;
 * `no-store` to the browser; a stale value is refreshed inline (bounded
 * by WAIT_MS), never in after(); no cache yet: the read is awaited up to
 * WAIT_MS, else 502 and the client retries with backoff.
 */
const TTL_MS = 30_000;
const WAIT_MS = 8_000;
const NO_STORE = { 'Cache-Control': 'no-store' };
const ADDR = /^0x[0-9a-fA-F]{40}$/;

type Navs = VaultNavs;
type Entry = { value?: { navs: Navs; updatedAt: number }; at: number; inflight?: Promise<{ navs: Navs; updatedAt: number }> };
const cache = new Map<string, Entry>();

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('vaults') ?? '';
  const vaults = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ADDR.test(s))
    .slice(0, 50) as `0x${string}`[];
  if (!vaults.length) {
    return NextResponse.json({ error: 'At least one vault address (0x…) is required.' }, { status: 400 });
  }
  const key = vaults
    .map((v) => v.toLowerCase())
    .sort()
    .join(',');
  let e = cache.get(key);
  if (!e) {
    e = { at: 0 };
    cache.set(key, e);
  }
  const entry = e;
  if (entry.value && Date.now() - entry.at < TTL_MS) {
    return NextResponse.json(entry.value, { headers: NO_STORE });
  }
  const refresh = () => {
    if (entry.inflight) return entry.inflight;
    const p = readNavs(vaults)
      .then((navs) => {
        const v = { navs, updatedAt: Date.now() };
        entry.value = v;
        entry.at = Date.now();
        return v;
      })
      .finally(() => {
        entry.inflight = undefined;
      });
    entry.inflight = p;
    return p;
  };
  if (entry.value) {
    const fresh = await Promise.race([
      refresh().then((v) => ({ ok: true as const, value: v })),
      new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), WAIT_MS)),
    ]).catch(() => ({ ok: false as const }));
    const v = fresh.ok ? fresh.value : entry.value;
    return NextResponse.json(v, { headers: NO_STORE });
  }
  const timedOut = Symbol('timedOut');
  const v = await Promise.race([refresh(), new Promise((resolve) => setTimeout(() => resolve(timedOut), WAIT_MS))]).catch(() => undefined);
  if (v === undefined || v === timedOut) {
    return NextResponse.json({ error: 'Could not read the leaderboard right now.' }, { status: 502 });
  }
  return NextResponse.json(v, { headers: NO_STORE });
}
