import { after, NextResponse } from 'next/server';
import { scanTerminalActivity } from '@/lib/terminal/server';
import type { TerminalActivity } from '@/lib/terminal/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/terminal/activity?funds=0x..,0x..
 *
 * The Terminal's 24h activity scan (trades, share mints, new staking pools)
 * used to run in the browser: ~27 chunked eth_getLogs calls plus up to 40
 * getBlock calls against the official RPC, on every page load, alongside the
 * fund lists, NAV reads and launches. It timed out at 20s in the browser and
 * the page showed "Couldn't load" / "Trending tokens are not available right
 * now" — a first-time visitor never got data, so the client-side last-good
 * cache never had anything to show.
 *
 * The scan now runs once here, on the server (~5.4s measured against the
 * live RPC, Nov 21 2026), and the result is cached in memory for 30s (the
 * page's refetch interval). The browser makes one cheap request.
 *
 * - Fresh cache: returned immediately.
 * - Stale cache: the refresh is awaited inline (bounded by WAIT_MS) and the
 *   fresh value served when the scan answers in time; the stale value is
 *   served when the scan is slow or fails. Serving stale + refreshing in
 *   after() did NOT work on serverless (verified live against the preview,
 *   Nov 21): the refresh ran on an instance that never served another
 *   request, so `updatedAt` stayed frozen for over a minute and the
 *   Terminal pill stuck on "Updating…". The response is also `no-store`:
 *   the old `public, max-age=15, stale-while-revalidate=60` header let the
 *   edge serve an old `updatedAt` for up to 75s after the in-memory cache
 *   had already refreshed.
 * - No cache yet: the first scan is awaited up to WAIT_MS; if the RPC is
 *   slow that day the route answers 202 { pending: true } and the scan
 *   keeps running in the background — the client polls until data arrives.
 * - Scan error with no cache: 502. A stale value, when one exists, is
 *   served instead of an error.
 */
const TTL_MS = 30_000;
const WAIT_MS = 8_000;
const ADDR = /^0x[0-9a-fA-F]{40}$/;

type Entry = { value?: TerminalActivity; at: number; inflight?: Promise<TerminalActivity> };
const cache = new Map<string, Entry>();

function parseFunds(param: string | null): `0x${string}`[] {
  if (!param) return [];
  return param
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ADDR.test(s))
    .map((s) => s as `0x${string}`);
}

/** BigInts cannot go over JSON: blocks become numbers, tokenIds strings. */
function serialize(p: TerminalActivity) {
  return {
    rows: p.rows.map((r) =>
      r.kind === 'mint'
        ? { ...r, block: Number(r.block), tokenId: r.tokenId.toString() }
        : r.kind === 'trade'
          ? { ...r, block: Number(r.block) }
          : r,
    ),
    ticker: p.ticker,
    updatedAt: p.updatedAt,
    degraded: p.degraded,
  };
}

const CACHE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const funds = parseFunds(new URL(req.url).searchParams.get('funds'));
  const key = funds.join(',');
  let e = cache.get(key);
  if (!e) {
    e = { at: 0 };
    cache.set(key, e);
  }
  const entry = e;
  if (entry.value && Date.now() - entry.at < TTL_MS) {
    return NextResponse.json(serialize(entry.value), { headers: CACHE_HEADERS });
  }
  const refresh = () => {
    if (entry.inflight) return entry.inflight;
    const p = scanTerminalActivity(funds)
      .then((v) => {
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
    // Stale but usable: refresh now (bounded) and serve the fresh value when
    // the scan answers in time; fall back to the stale value when the scan is
    // slow or fails. A refresh already in flight is shared, not duplicated.
    const fresh = await Promise.race([
      refresh().then((v) => ({ ok: true as const, value: v })),
      new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), WAIT_MS)),
    ]).catch(() => ({ ok: false as const }));
    return NextResponse.json(serialize(fresh.ok ? fresh.value : entry.value), { headers: CACHE_HEADERS });
  }
  // Cold: wait for the first scan (bounded), else 202 and keep scanning.
  const raced = await Promise.race([
    refresh().then((v) => ({ done: true as const, value: v })),
    new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false }), WAIT_MS)),
  ]).catch(() => ({ done: false as const, error: true as const }));
  if (!raced.done) {
    if ('error' in raced) {
      return NextResponse.json({ error: 'Could not read Terminal activity right now.' }, { status: 502 });
    }
    // Keep the scan alive after the response so the next poll finds it done.
    after(async () => {
      await entry.inflight?.catch(() => undefined);
    });
    return NextResponse.json({ pending: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(serialize(raced.value), { headers: CACHE_HEADERS });
}
