import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { FundAllowlistABI } from '@/lib/contracts/fund-phase6-abi';
import { FUND_ALLOWLIST, FUND_WETH } from '@/lib/fund/phase3';
import { POLYDASH_POOL_ID, POLYDASH_TOKEN, RNJ_POOL_ID, type FundAsset } from '@/lib/fund/phase6';
import { getLaunchesSnapshot } from '@/lib/launches-server';

export const dynamic = 'force-dynamic';

/** GeckoTerminal public API (owner-requested source, Nov 10 2026). Few calls, spaced, cached 60 s. */
const GT = 'https://api.geckoterminal.com/api/v2';
const INC = 'include=base_token,quote_token,dex';
const SOURCES: { url: string; isNew?: boolean }[] = [
  // Must-include tokens first (POLYDASH V4 pool, RNJ V3 pool) in one call.
  { url: `${GT}/networks/robinhood/pools/multi/${POLYDASH_POOL_ID},${RNJ_POOL_ID}?${INC}` },
  { url: `${GT}/networks/robinhood/pools?page=1&${INC}` },
  { url: `${GT}/networks/robinhood/pools?page=2&${INC}` },
  { url: `${GT}/networks/robinhood/pools?page=3&${INC}` },
  { url: `${GT}/networks/robinhood/new_pools?page=1&${INC}`, isNew: true },
  { url: `${GT}/networks/robinhood/new_pools?page=2&${INC}`, isNew: true },
  { url: `${GT}/search/pools?query=pons&network=robinhood&${INC}` },
];
const SKIP = new Set([FUND_WETH, '0x0000000000000000000000000000000000000000']);

/** Robinhood Chain DEX ids whose pools are Uniswap V3 or V4 pools (Pons V1 → V3, Pons V2 → V4). */
const DEXES: Record<string, { version: 'v3' | 'v4'; label: string; pons?: boolean }> = {
  'uniswap-v3-robinhood': { version: 'v3', label: 'Uniswap V3' },
  'uniswap-v4-robinhood': { version: 'v4', label: 'Uniswap V4' },
  'pons-dot-family': { version: 'v3', label: 'Pons (Uniswap V3)', pons: true },
  'pons-v2': { version: 'v4', label: 'Pons V2 (Uniswap V4)', pons: true },
  'pons-v2-dex': { version: 'v4', label: 'Pons V2 (Uniswap V4)', pons: true },
  'clanker-robinhood': { version: 'v4', label: 'Uniswap V4 (hook pool)' },
  'bankr-robinhood': { version: 'v4', label: 'Uniswap V4 (hook pool)' },
};

type Rel = { data?: { id?: string } | null };
type Pool = {
  id?: string;
  attributes?: {
    address?: string; name?: string; pool_created_at?: string | null; reserve_in_usd?: string | null;
    base_token_price_usd?: string | null; base_token_price_native_currency?: string | null;
    volume_usd?: { h24?: string | null }; price_change_percentage?: { h24?: string | null };
  };
  relationships?: { base_token?: Rel; quote_token?: Rel; dex?: Rel };
};
type Included = { id?: string; type?: string; attributes?: { address?: string; name?: string; symbol?: string } };
type Payload = { assets: FundAsset[]; updatedAt: number; stale: boolean };

const client = createPublicClient({ chain: robinhoodChain, transport: http() });
let cache: Payload | null = null;
let inflight: Promise<Payload> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (s?: string | null) => (s != null && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
const addrOf = (id?: string) => (id?.split('_').pop() ?? '').toLowerCase();

async function getJson(url: string, retry = true): Promise<{ data?: Pool | Pool[]; included?: Included[] } | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (res.status === 429 && retry) { await sleep(4_000); return getJson(url, false); }
    if (!res.ok) { console.error(`asset list: ${res.status} ${url}`); return null; }
    return await res.json();
  } catch (e) {
    console.error('asset list: fetch failed', url, e);
    return null;
  }
}

async function build(): Promise<Payload> {
  const launches = (await getLaunchesSnapshot(3_000).catch(() => null)) ?? [];
  const polypad = new Set(launches.map((l) => l.tokenAddress.toLowerCase()));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const best = new Map<string, FundAsset>();
  let okCalls = 0;

  for (let i = 0; i < SOURCES.length; i++) {
    if (i) await sleep(2_500);
    const j = await getJson(SOURCES[i].url);
    if (!j?.data) continue;
    okCalls++;
    const tokens = new Map((j.included ?? []).filter((t) => t.type === 'token').map((t) => [t.id ?? '', t.attributes ?? {}]));
    for (const p of Array.isArray(j.data) ? j.data : [j.data]) {
      const a = p.attributes ?? {};
      const dex = DEXES[p.relationships?.dex?.data?.id ?? ''];
      const baseId = p.relationships?.base_token?.data?.id ?? '';
      const addr = (tokens.get(baseId)?.address ?? addrOf(baseId)).toLowerCase();
      if (!dex || !/^0x[0-9a-f]{40}$/.test(addr) || SKIP.has(addr)) continue;
      const poolUsd = num(a.reserve_in_usd) ?? 0;
      const prev = best.get(addr);
      const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
      const isNew = !!SOURCES[i].isNew || (Number.isFinite(created) && created > weekAgo);
      if (prev && prev.poolUsd >= poolUsd) { if (isNew) prev.isNew = true; continue; }
      const quoteAddr = addrOf(p.relationships?.quote_token?.data?.id);
      const meta = tokens.get(baseId);
      best.set(addr, {
        address: addr,
        symbol: meta?.symbol ?? (a.name ?? '?').split(' / ')[0],
        name: meta?.name ?? '',
        priceUsd: num(a.base_token_price_usd),
        priceEth: num(a.base_token_price_native_currency),
        poolUsd,
        volume24h: num(a.volume_usd?.h24),
        change24h: num(a.price_change_percentage?.h24),
        version: dex.version,
        dexLabel: dex.label,
        pairName: a.name ?? '',
        quoteIsWeth: quoteAddr === FUND_WETH,
        isNew: isNew || !!prev?.isNew,
        createdAt: Number.isFinite(created) ? Math.floor(created / 1000) : null,
        isPons: !!dex.pons,
        isPolypad: polypad.has(addr) || addr === POLYDASH_TOKEN,
        allowed: false,
        allowlistAt: null,
        pairUrl: a.address ? `https://www.geckoterminal.com/robinhood/pools/${a.address}` : '',
      });
    }
  }

  // A failed call never drops tokens we already had: carry over rows missing from this round.
  for (const old of cache?.assets ?? []) if (!best.has(old.address) && !SKIP.has(old.address)) best.set(old.address, { ...old });
  const assets = [...best.values()].sort((a, b) => b.poolUsd - a.poolUsd).slice(0, 200);
  if (!okCalls) return { assets, updatedAt: cache?.updatedAt ?? Date.now(), stale: true };
  if (!assets.length) return { assets, updatedAt: Date.now(), stale: false };

  const pending = new Map<string, number>();
  try {
    const count = Number(await client.readContract({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'proposalCount' }));
    const ids = Array.from({ length: Math.min(count, 100) }, (_, i) => BigInt(i));
    const rows = await client.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'proposals' as const, args: [id] as const })) });
    for (const r of rows) {
      if (r.status !== 'success') continue;
      const [target, isRouter, allowed, readyAt, executed, canceled] = r.result;
      if (!isRouter && allowed && !executed && !canceled) pending.set(target.toLowerCase(), Number(readyAt));
    }
  } catch (e) {
    console.error('asset list: allowlist proposals failed', e);
  }
  const flags = await client.multicall({
    allowFailure: true,
    contracts: assets.map((a) => ({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'assetAllowed' as const, args: [a.address as `0x${string}`] as const })),
  }).catch(() => []);
  assets.forEach((a, i) => {
    const f = flags[i];
    if (f?.status === 'success') a.allowed = Boolean(f.result);
    a.allowlistAt = a.allowed ? null : pending.get(a.address) ?? null;
  });
  return { assets, updatedAt: Date.now(), stale: false };
}

function refresh(): Promise<Payload> {
  if (!inflight) {
    inflight = build()
      .then((p) => { if (p.assets.length || !cache) cache = p; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export async function GET() {
  try {
    if (!cache) await refresh();
    else if (Date.now() - cache.updatedAt > 60_000) void refresh().catch((e) => console.error('asset list refresh failed', e));
    const c = cache!;
    const stale = c.stale || Date.now() - c.updatedAt > 5 * 60_000;
    return NextResponse.json({ ...c, stale }, { status: c.assets.length || !stale ? 200 : 502 });
  } catch (e) {
    console.error('asset list failed', e);
    return NextResponse.json({ assets: cache?.assets ?? [], updatedAt: cache?.updatedAt ?? null, stale: true, error: 'The live token list is not available right now.' }, { status: cache ? 200 : 502 });
  }
}
