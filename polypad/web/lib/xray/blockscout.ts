// Explorer (Blockscout, Etherscan-compatible API) client used ONLY by X-ray funding checks. Server only.
// Fully separate from anything else in the app: its own limiter (max 2 in flight, ~3 req/s), its own backoff
// and its own 10-min breaker, so X-ray load can never affect other features. Successful lookups are cached
// forever in XrayFunding, so each early buyer is looked up once.
// Blockscout's bot protection challenges requests with a default client User-Agent (e.g. Node's "node"),
// so every request sends an identifying User-Agent and Accept: application/json.
import { prisma } from '@/lib/db';
import type { Funding, FundingTx } from './core';

const BASE = 'https://robinhoodchain.blockscout.com/api';
const HEADERS = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; PolypadXray/1.0; +https://polypad.abacusai.app)' };
const MIN_GAP_MS = 340; // ~3 req/s
const MAX_IN_FLIGHT = 2;
const PAGE = 25;
const BREAKER_MS = 10 * 60_000;

let nextSlot = 0;
let inFlight = 0;
const waiters: (() => void)[] = [];
let blockedUntil = 0;

async function acquire() {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiters.push(r));
  inFlight++;
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
function release() { inFlight--; waiters.shift()?.(); }

export class ExplorerUnavailable extends Error {}
class Challenged extends Error {}

async function call(params: Record<string, string>): Promise<any[]> {
  if (Date.now() < blockedUntil) throw new ExplorerUnavailable('explorer temporarily unavailable');
  const url = `${BASE}?${new URLSearchParams(params).toString()}`;
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    await acquire();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: HEADERS, cache: 'no-store' });
      const text = await res.text();
      if (res.status === 403 || /<title>Just a moment/i.test(text)) throw new Challenged('bot challenge');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error('non-JSON response'); }
      if (Array.isArray(j?.result)) return j.result;
      if (j?.message && /no (internal )?transactions found/i.test(j.message)) return [];
      throw new Error(`unexpected response: ${String(j?.message ?? '').slice(0, 80)}`);
    } catch (e) {
      last = e;
      if (e instanceof Challenged) break; // retrying a challenge only makes it worse
    } finally { release(); }
  }
  blockedUntil = Date.now() + BREAKER_MS;
  throw new ExplorerUnavailable((last as Error)?.message ?? 'explorer error');
}

// ---------- Build activity helpers (same User-Agent, limiter, retries and breaker as X-ray) ----------

/** Etherscan-style list call (e.g. txlist / txlistinternal) for Build activity. Throws ExplorerUnavailable. */
export function explorerList(params: Record<string, string>): Promise<any[]> {
  return call(params);
}

/** Blockscout v2 GET (e.g. /smart-contracts/{a}). Returns null on 404. Throws ExplorerUnavailable. */
export async function explorerV2(path: string): Promise<any | null> {
  if (Date.now() < blockedUntil) throw new ExplorerUnavailable('explorer temporarily unavailable');
  const url = `${BASE.replace(/\/api$/, '')}/api/v2${path}`;
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    await acquire();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: HEADERS, cache: 'no-store' });
      if (res.status === 404) return null;
      const text = await res.text();
      if (res.status === 403 || /<title>Just a moment/i.test(text)) throw new Challenged('bot challenge');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try { return JSON.parse(text); } catch { throw new Error('non-JSON response'); }
    } catch (e) {
      last = e;
      if (e instanceof Challenged) break;
    } finally { release(); }
  }
  blockedUntil = Date.now() + BREAKER_MS;
  throw new ExplorerUnavailable((last as Error)?.message ?? 'explorer error');
}

const lc = (a: unknown) => String(a ?? '').toLowerCase();
const toTx = (r: any): FundingTx => ({ h: lc(r.hash || r.transactionHash), f: lc(r.from), t: lc(r.to), v: Number(r.value ?? 0) / 1e18, ts: Number(r.timeStamp ?? 0) });

function fromRow(r: { firstFunder: string | null; fundingTx: string | null; fundedAt: number | null; txs: unknown }): Funding {
  const txs = (Array.isArray(r.txs) ? r.txs : []) as (FundingTx & { tr?: boolean })[];
  return { firstFunder: r.firstFunder, fundingTx: r.fundingTx, fundedAt: r.fundedAt, txs, truncated: txs.some((t) => t.tr) };
}

/** First transactions of a wallet (oldest first): normal + internal, cached forever. Throws ExplorerUnavailable. */
export async function getFunding(wallet: string): Promise<Funding> {
  const w = lc(wallet);
  const hit = await prisma.xrayFunding.findUnique({ where: { wallet: w } }).catch(() => null);
  if (hit) return fromRow(hit);
  const common = { module: 'account', address: w, sort: 'asc', page: '1', offset: String(PAGE) };
  const [normal, internal] = await Promise.all([call({ ...common, action: 'txlist' }), call({ ...common, action: 'txlistinternal' })]);
  const truncated = normal.length >= PAGE || internal.length >= PAGE;
  const txs = [...normal, ...internal].map(toTx).filter((t) => t.ts > 0).sort((a, b) => a.ts - b.ts);
  const first = txs.find((t) => t.t === w && t.v > 0 && t.f !== w) ?? null;
  const stored = txs.slice(0, 100).map((t, i) => (i === 0 && truncated ? { ...t, tr: true } : t));
  const data = { firstFunder: first?.f ?? null, fundingTx: first?.h ?? null, fundedAt: first?.ts ?? null, txCountAtBuy: null, txs: stored as any };
  await prisma.xrayFunding.upsert({ where: { wallet: w }, create: { wallet: w, ...data }, update: data }).catch(() => null);
  return { firstFunder: data.firstFunder, fundingTx: data.fundingTx, fundedAt: data.fundedAt, txs, truncated };
}

/** Funding for many wallets (2 at a time). After an explorer failure the rest are 'pending' and retried on a later sync. */
export async function getFundingMany(wallets: string[]): Promise<Record<string, Funding | 'pending'>> {
  const out: Record<string, Funding | 'pending'> = {};
  const all = Array.from(new Set(wallets.map(lc)));
  const cachedRows = await prisma.xrayFunding.findMany({ where: { wallet: { in: all } } }).catch(() => []);
  for (const r of cachedRows) out[r.wallet] = fromRow(r);
  const todo = all.filter((w) => !out[w]);
  let down = false, i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const w = todo[i++];
      if (down) { out[w] = 'pending'; continue; }
      try { out[w] = await getFunding(w); } catch { down = true; out[w] = 'pending'; }
    }
  };
  await Promise.all([worker()]); // one wallet at a time; its 2 requests (txlist + txlistinternal) run in parallel = max 2 in flight
  return out;
}
