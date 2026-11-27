import { NextResponse } from 'next/server';
import { readAllowlistServer } from '@/lib/fund/list-server';
import type { AllowlistWire } from '@/lib/fund/list-wire';

export const dynamic = 'force-dynamic';

/**
 * GET /api/funds/allowlist
 *
 * Tokens on the FundAllowlist contract: allowed now, plus asset proposals
 * still in their public wait. The allowlist menu used to read them directly
 * from the browser (proposalCount + one multicall per proposal + three
 * more calls per token for the allowed flag, symbol and name); on a first
 * load it fired into the same storm that broke the detail page, so the
 * menu sat on "The approved list could not be read right now" (round 5).
 * The reads now run once here, on the server, and the browser makes one
 * cheap request.
 *
 * Caching follows the /api/fund/detail rules (Nov 21): in-memory cache,
 * 60s TTL (the menu refetches every 120s); `no-store` to the browser; a
 * stale value is refreshed inline (bounded by WAIT_MS), never in after();
 * no cache yet: the read is awaited up to WAIT_MS, else 502 and the client
 * retries with backoff.
 */
const TTL_MS = 60_000;
const WAIT_MS = 8_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Entry = { value?: AllowlistWire; at: number; inflight?: Promise<AllowlistWire> };
let entry: Entry = { at: 0 };

export async function GET() {
  if (entry.value && Date.now() - entry.at < TTL_MS) {
    return NextResponse.json(entry.value, { headers: NO_STORE });
  }
  const refresh = () => {
    if (entry.inflight) return entry.inflight;
    const p = readAllowlistServer()
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
    return NextResponse.json({ error: 'Could not read the approved list right now.' }, { status: 502 });
  }
  return NextResponse.json(v, { headers: NO_STORE });
}
