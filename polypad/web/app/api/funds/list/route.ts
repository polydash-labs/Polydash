import { NextResponse } from 'next/server';
import { readFundsList } from '@/lib/fund/list-server';
import type { FundsListWire } from '@/lib/fund/list-wire';

export const dynamic = 'force-dynamic';

/**
 * GET /api/funds/list
 *
 * All four fund lists in one call (Phase 3, V2, V3, legacy) — the /funds
 * page's four sections. The lists used to read the chain directly from the
 * browser: allFundsLength + allFunds + two multicalls per fund, per
 * factory, all at once in the first-load storm. The official RPC rejected
 * them often enough that the lists sat on "Loading tokenized funds…" for
 * 20+s while the rest of the page had already loaded (round 4). The reads
 * now run once here, on the server, and the browser makes one cheap
 * request.
 *
 * Caching follows the /api/fund/detail rules (Nov 21): in-memory cache,
 * 30s TTL (the page refetches every 20–30s); `no-store` to the browser so
 * a new mint shows up on the next refetch; a stale value is refreshed
 * inline (bounded by WAIT_MS), never in after(); no cache yet: the read is
 * awaited up to WAIT_MS, else 502 and the client retries with backoff.
 */
const TTL_MS = 30_000;
const WAIT_MS = 8_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Entry = { value?: FundsListWire; at: number; inflight?: Promise<FundsListWire> };
let entry: Entry = { at: 0 };

export async function GET() {
  if (entry.value && Date.now() - entry.at < TTL_MS) {
    return NextResponse.json(entry.value, { headers: NO_STORE });
  }
  const refresh = () => {
    if (entry.inflight) return entry.inflight;
    const p = readFundsList()
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
    return NextResponse.json(v, { headers: NO_STORE });
  }
  const timedOut = Symbol('timedOut');
  const v = await Promise.race([refresh(), new Promise((resolve) => setTimeout(() => resolve(timedOut), WAIT_MS))]).catch(() => undefined);
  if (v === undefined || v === timedOut) {
    return NextResponse.json({ error: 'Could not read the tokenized funds right now.' }, { status: 502 });
  }
  return NextResponse.json(v, { headers: NO_STORE });
}
