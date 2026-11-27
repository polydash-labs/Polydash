import { NextResponse } from 'next/server';
import { readFundKind, type FundKind } from '@/lib/fund/list-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fund/kind?address=0x…
 *
 * Which page a fund address belongs to: one server-side multicall across
 * the three factories (Phase 3, V2, V3). The detail-page switch used to run
 * these three checks from the browser; when they all errored in the
 * first-load storm it fell through to the legacy page, which can never load
 * a V3 fund — that was the Polyfund first-load failure (round 4). The
 * browser now makes one cheap request, and 'legacy' means none of the
 * factories claims the address.
 *
 * Caching follows the /api/fund/detail rules (Nov 21): in-memory cache,
 * 30s TTL (the kind of an address never changes); `no-store` to the
 * browser; a stale value is refreshed inline (bounded by WAIT_MS), never
 * in after(); no cache yet: the read is awaited up to WAIT_MS, else 502
 * and the client retries with backoff.
 */
const TTL_MS = 30_000;
const WAIT_MS = 8_000;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Entry = { value?: FundKind; at: number; inflight?: Promise<FundKind> };
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
    return NextResponse.json({ kind: entry.value }, { headers: NO_STORE });
  }
  const refresh = () => {
    if (entry.inflight) return entry.inflight;
    const p = readFundKind(address)
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
    const fresh = await Promise.race([
      refresh().then((v) => ({ ok: true as const, value: v })),
      new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), WAIT_MS)),
    ]).catch(() => ({ ok: false as const }));
    const v = fresh.ok ? fresh.value : entry.value;
    return NextResponse.json({ kind: v }, { headers: NO_STORE });
  }
  const timedOut = Symbol('timedOut');
  const v = await Promise.race([refresh(), new Promise((resolve) => setTimeout(() => resolve(timedOut), WAIT_MS))]).catch(() => undefined);
  if (v === undefined || v === timedOut) {
    return NextResponse.json({ error: 'Could not read this tokenized fund right now.' }, { status: 502 });
  }
  return NextResponse.json({ kind: v }, { headers: NO_STORE });
}
