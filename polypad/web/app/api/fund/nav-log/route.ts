import { NextResponse } from 'next/server';
import { readNavLogServer } from '@/lib/fund/list-server';
import type { NavLogWire } from '@/lib/fund/list-wire';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fund/nav-log?vault=0x…
 *
 * The Value history card's NavTape points for one vault. The card used to
 * scan the chain directly from the browser (a ~10M-block log walk from the
 * Phase 3 deploy block); on a first load it fired into the same storm that
 * broke the detail page and failed often enough that the card sat on
 * "Could not read the value history right now" permanently (round 5). The
 * scan now runs once here, on the server, and the browser makes one cheap
 * request. An empty log is a real answer — a fund that has never recorded
 * a value has no points, and the card shows its honest empty state.
 *
 * Caching follows the /api/fund/detail rules (Nov 21): in-memory cache,
 * 60s TTL (the card refetches every 60s); `no-store` to the browser; a
 * stale value is refreshed inline (bounded by WAIT_MS), never in after();
 * no cache yet: the read is awaited up to WAIT_MS, else 502 and the client
 * retries with backoff.
 */
const TTL_MS = 60_000;
const WAIT_MS = 8_000;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Entry = { value?: NavLogWire; at: number; inflight?: Promise<NavLogWire> };
const cache = new Map<string, Entry>();

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('vault') ?? '';
  if (!ADDR.test(raw)) {
    return NextResponse.json({ error: 'A vault address (0x…) is required.' }, { status: 400 });
  }
  const vault = raw as `0x${string}`;
  const key = vault.toLowerCase();
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
    const p = readNavLogServer(vault)
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
    return NextResponse.json({ error: 'Could not read the value history right now.' }, { status: 502 });
  }
  return NextResponse.json(v, { headers: NO_STORE });
}
