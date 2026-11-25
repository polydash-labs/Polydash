import { NextResponse } from 'next/server';
import { readLedgerServer } from '@/lib/fund/list-server';
import type { LedgerWire } from '@/lib/fund/list-wire';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fund/ledger?nft=0x…&vault=0x…
 *
 * Holder count, trade blotter, distributions and fee events for one fund,
 * from its logs. The detail page used to run these two log scans directly
 * from the browser (NFT Transfers + all vault events, ~10M blocks each);
 * on a first load they fired into the same storm that broke the detail
 * page, so Holders showed "Not available" and the trade/fee cards had no
 * data (round 5). The scans now run once here, on the server, and the
 * browser makes one cheap request.
 *
 * Caching follows the /api/fund/detail rules (Nov 21): in-memory cache,
 * 60s TTL (the page refetches every 60s); `no-store` to the browser; a
 * stale value is refreshed inline (bounded by WAIT_MS), never in after();
 * no cache yet: the read is awaited up to WAIT_MS, else 502 and the client
 * retries with backoff.
 */
const TTL_MS = 60_000;
const WAIT_MS = 8_000;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Entry = { value?: LedgerWire; at: number; inflight?: Promise<LedgerWire> };
const cache = new Map<string, Entry>();

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const nftRaw = params.get('nft') ?? '';
  const vaultRaw = params.get('vault') ?? '';
  if (!ADDR.test(nftRaw) || !ADDR.test(vaultRaw)) {
    return NextResponse.json({ error: 'A tokenized fund address and vault address (0x…) are required.' }, { status: 400 });
  }
  const nft = nftRaw as `0x${string}`;
  const vault = vaultRaw as `0x${string}`;
  const key = `${nft.toLowerCase()}:${vault.toLowerCase()}`;
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
    const p = readLedgerServer(nft, vault)
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
    return NextResponse.json({ error: 'Could not read this tokenized fund right now.' }, { status: 502 });
  }
  return NextResponse.json(v, { headers: NO_STORE });
}
