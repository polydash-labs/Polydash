import { NextResponse } from 'next/server';
import { readFundDetail, type FundDetailWire } from '@/lib/fund/detail-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fund/detail?address=0x…
 *
 * The paint-critical Tokenized Fund detail read (NFT + vault multicalls,
 * vault balance, distribution rounds) moved server-side: the browser used
 * to fire all 43 contract calls into the first-load storm and the official
 * RPC rejected/timed them out often enough that the Polyfund page failed
 * its first load (round 3). The browser now makes one cheap request.
 *
 * Caching follows the Terminal route's hard-won rules (Nov 21):
 * - In-memory cache, 30s TTL (the detail page refetches every 20s).
 * - `no-store` to the browser: a CDN-cached copy would serve a stale mint
 *   count / raise total after a mint.
 * - A stale value is refreshed inline (bounded by WAIT_MS), never in
 *   after(): on serverless the after() refresh ran on an instance that
 *   never served another request, so the cache never advanced.
 * - No cache yet: the read is awaited up to WAIT_MS; on timeout or error
 *   the route answers 502 and the client retries with backoff. A null read
 *   (not a fund) answers 404 so the client does not retry a dead address.
 */
const TTL_MS = 30_000;
const WAIT_MS = 8_000;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Entry = { value?: FundDetailWire; at: number; inflight?: Promise<FundDetailWire | null> };
const cache = new Map<string, Entry>();

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('address') ?? '';
  if (!ADDR.test(raw)) {
    return NextResponse.json({ error: 'A tokenized fund address (0x…) is required.' }, { status: 400 });
  }
  const address = raw as `0x${string}`;
  const key = address.toLowerCase();
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
    const p = readFundDetail(address)
      .then((v) => {
        if (v) {
          entry.value = v;
          entry.at = Date.now();
        }
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
    // the read answers in time; fall back to the stale value when it is slow
    // or fails. A refresh already in flight is shared, not duplicated.
    const fresh = await Promise.race([
      refresh().then((v) => ({ ok: true as const, value: v })),
      new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), WAIT_MS)),
    ]).catch(() => ({ ok: false as const }));
    const v = fresh.ok ? fresh.value : entry.value;
    if (!v) return NextResponse.json({ error: 'Could not read this tokenized fund right now.' }, { status: 502 });
    return NextResponse.json(v, { headers: NO_STORE });
  }
  // Cold: bounded await. A timeout or a read error is a 502 (the client
  // retries); a null read is a 404 (not a fund — do not retry).
  const timedOut = Symbol('timedOut');
  const v = await Promise.race([refresh(), new Promise((resolve) => setTimeout(() => resolve(timedOut), WAIT_MS))]).catch(() => undefined);
  if (v === undefined || v === timedOut) {
    return NextResponse.json({ error: 'Could not read this tokenized fund right now.' }, { status: 502 });
  }
  if (v === null) {
    return NextResponse.json({ error: 'No Polypad tokenized fund was found at this address.' }, { status: 404 });
  }
  return NextResponse.json(v, { headers: NO_STORE });
}
