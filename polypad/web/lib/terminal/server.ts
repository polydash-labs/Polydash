// Terminal activity scan (server only). The same 24h scan the browser used
// to run in lib/terminal/use-terminal.ts — ~27 chunked eth_getLogs calls plus
// up to 40 getBlock calls — now runs once on the server behind
// /api/terminal/activity, so the browser makes one cheap request instead of
// hammering the official RPC with the whole scan on every page load.
//
// Measured Nov 21, 2026 against the live official RPC
// (https://rpc.mainnet.chain.robinhood.com): the full scan takes ~5.4s
// (launch list ~0.7s, trades ~3.3s, mints ~0.9s). Individual calls answer
// in ~200-350ms; the browser failures were the sheer concurrency of firing
// the scan plus the fund lists plus NAV plus launches at once. dRPC
// (https://robinhood.drpc.org) is NOT an alternative for this scan: its free
// tier rejects eth_getLogs ranges over 100 blocks.
import { formatEther, parseAbi, parseAbiItem, type PublicClient } from 'viem';
import { publicClient, tokenMeta } from '@/lib/agents/tools';
import { FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { BOUGHT, SOLD, fetchLaunchAddresses } from '@/lib/launches-core';
import { getFactoryAddresses } from '@/lib/contracts/addresses';
import { STAKING_FACTORIES } from '@/lib/staking/factories';
import type { ActivityRow, MintActivity, StakeActivity, TerminalActivity, TickerRow, TradeActivity } from './types';

const ZERO = '0x0000000000000000000000000000000000000000';
/** ~24h of Robinhood Chain blocks at ~9 blocks/sec. */
const DAY_BLOCKS = 800_000n;
/**
 * The chain RPC caps eth_getLogs at 100,000 blocks per request when the filter
 * has more than one value per position (multi-address queries). Split the 24h
 * window into 99k-block ranges; single-address queries get the 10M allowance.
 */
const LOG_CHUNK = 99_000n;
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

async function getLogsChunked<T>(client: PublicClient, fromBlock: bigint, toBlock: bigint, query: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const ranges: [bigint, bigint][] = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_CHUNK + 1n) {
    ranges.push([from, from + LOG_CHUNK > toBlock ? toBlock : from + LOG_CHUNK]);
  }
  const parts = await Promise.all(ranges.map(([from, to]) => query(from, to)));
  return parts.flat();
}

async function readTrades(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ rows: Omit<TradeActivity, 'timestamp'>[]; ticker: TickerRow[] }> {
  const launches = await fetchLaunchAddresses(client, getFactoryAddresses());
  if (launches.length === 0) return { rows: [], ticker: [] };
  const [buys, sells] = await Promise.all([
    getLogsChunked(client, fromBlock, toBlock, (from, to) => client.getLogs({ address: launches, event: BOUGHT, fromBlock: from, toBlock: to })),
    getLogsChunked(client, fromBlock, toBlock, (from, to) => client.getLogs({ address: launches, event: SOLD, fromBlock: from, toBlock: to })),
  ]);
  const rows: Omit<TradeActivity, 'timestamp'>[] = [
    ...buys.map((l) => ({
      kind: 'trade' as const,
      launch: l.address,
      isBuy: true,
      trader: l.args.buyer ?? '',
      eth: Number(formatEther(l.args.ethIn ?? 0n)),
      tokens: Number(formatEther(l.args.tokensOut ?? 0n)),
      txHash: l.transactionHash,
      block: l.blockNumber,
    })),
    ...sells.map((l) => ({
      kind: 'trade' as const,
      launch: l.address,
      isBuy: false,
      trader: l.args.seller ?? '',
      eth: Number(formatEther(l.args.ethOut ?? 0n)),
      tokens: Number(formatEther(l.args.tokensIn ?? 0n)),
      txHash: l.transactionHash,
      block: l.blockNumber,
    })),
  ];
  const vol = new Map<string, { volumeEth: number; trades: number }>();
  for (const r of rows) {
    const e = vol.get(r.launch.toLowerCase()) ?? { volumeEth: 0, trades: 0 };
    e.volumeEth += r.eth;
    e.trades += 1;
    vol.set(r.launch.toLowerCase(), e);
  }
  const ticker = Array.from(vol.entries())
    .map(([launch, v]) => ({ launch, ...v }))
    .sort((a, b) => b.volumeEth - a.volumeEth);
  return { rows, ticker };
}

const POOL_ABI = parseAbi([
  'function name() view returns (string)',
  'function creator() view returns (address)',
  'function stakeToken() view returns (address)',
  'function rewardToken() view returns (address)',
  'function startTime() view returns (uint256)',
]);
const FACTORY_ABI = parseAbi([
  'function poolsLength() view returns (uint256)',
  'function getPoolAddresses(uint256 offset, uint256 limit) view returns (address[])',
]);

/**
 * Staking pools created in the last 24h, read straight from the factories
 * (a few multicalls — no DB, no event scan). The /api/stake/pools overview
 * needs the full event history for its analytics and cannot answer this
 * cheaply, so the Terminal reads the creation times directly.
 */
async function readRecentPools(client: PublicClient, sinceSec: number): Promise<StakeActivity[]> {
  const out: StakeActivity[] = [];
  for (const f of STAKING_FACTORIES) {
    try {
      const n = await client.readContract({ address: f.address, abi: FACTORY_ABI, functionName: 'poolsLength' });
      if (n === 0n) continue;
      const addrs = await client.readContract({ address: f.address, abi: FACTORY_ABI, functionName: 'getPoolAddresses', args: [0n, n] });
      if (!addrs.length) continue;
      const res = await client.multicall({
        allowFailure: true,
        contracts: addrs.flatMap((a) => (['name', 'creator', 'stakeToken', 'rewardToken', 'startTime'] as const).map((functionName) => ({ address: a, abi: POOL_ABI, functionName }))),
      });
      for (let i = 0; i < addrs.length; i++) {
        const pick = <T,>(row: { status: string; result?: unknown } | undefined, fallback: T): T =>
          row?.status === 'success' && row.result !== undefined ? (row.result as T) : fallback;
        const start = Number(pick(res[i * 5 + 4], 0n));
        if (start <= sinceSec) continue;
        const stakeToken = pick(res[i * 5 + 2], null as `0x${string}` | null);
        const rewardToken = pick(res[i * 5 + 3], null as `0x${string}` | null);
        const [sm, rm] = await Promise.all([
          stakeToken ? tokenMeta(stakeToken).catch(() => ({ symbol: 'n/a' })) : Promise.resolve({ symbol: 'n/a' }),
          rewardToken ? tokenMeta(rewardToken).catch(() => ({ symbol: 'n/a' })) : Promise.resolve({ symbol: 'n/a' }),
        ]);
        out.push({
          kind: 'stake',
          pool: addrs[i],
          name: pick(res[i * 5], 'Staking pool'),
          stakeSymbol: sm.symbol,
          rewardSymbol: rm.symbol,
          creator: pick(res[i * 5 + 1], null as `0x${string}` | null),
          timestamp: start * 1000,
        });
      }
    } catch (e) {
      console.error(`terminal activity: recent-pools read failed on ${f.address}`, e);
      throw e;
    }
  }
  return out;
}

// ---------- first-paint cache (Nov 26) ----------
//
// The root layout forces dynamic rendering, so the /terminal page renders
// per request — ISR does not apply — and its server component calls these
// readers directly, bypassing the activity/leaderboard routes' 30s caches.
// Without a cache here, every /terminal load would re-run the full ~5.4s
// activity scan. A 30s stale-while-revalidate cache per address set keeps
// first paint fast: a fresh-enough result is served immediately, a stale
// one is served while a refresh runs in the background, and a cold read
// behaves exactly as before (awaited, throwing on failure — the routes and
// the first-paint readers keep their own timeouts).
const TERMINAL_TTL = 30_000;
type CacheEntry<T> = { value?: T; at: number; inflight?: Promise<T> };
const terminalCache = new Map<string, CacheEntry<unknown>>();

async function terminalSwr<T>(key: string, load: () => Promise<T>): Promise<T> {
  const e = (terminalCache.get(key) ?? { at: 0 }) as CacheEntry<T>;
  const refresh = () => {
    if (e.inflight) return e.inflight;
    e.inflight = load()
      .then((v) => { e.value = v; e.at = Date.now(); return v; })
      .catch((err) => { console.error(`terminal refresh failed (${key})`, err); throw err; })
      .finally(() => { e.inflight = undefined; });
    terminalCache.set(key, e);
    return e.inflight;
  };
  if (e.value !== undefined) {
    if (Date.now() - e.at > TERMINAL_TTL) refresh().catch(() => {});
    return e.value;
  }
  return refresh();
}

/**
 * The newest on-chain activity in the last 24h: token trades, Tokenized Fund
 * share mints, and new staking pools. Trades are the core read — if the RPC
 * rejects them the scan throws and the route answers 502; mints and staking
 * pools are best-effort and a failure there only sets `degraded`.
 */
export async function scanTerminalActivity(fundAddresses: `0x${string}`[]): Promise<TerminalActivity> {
  return terminalSwr(`activity:${fundAddresses.map((a) => a.toLowerCase()).sort().join(',')}`, () =>
    scanTerminalActivityFresh(fundAddresses),
  );
}

async function scanTerminalActivityFresh(fundAddresses: `0x${string}`[]): Promise<TerminalActivity> {
  const client = publicClient as PublicClient;
  const latest = await client.getBlockNumber();
  const fromBlock = latest > DAY_BLOCKS ? latest - DAY_BLOCKS : 0n;
  const [tradesRes, stakesRes] = await Promise.allSettled([
    readTrades(client, fromBlock, latest),
    readRecentPools(client, Math.floor(Date.now() / 1000) - 86_400),
  ]);
  if (tradesRes.status === 'rejected') {
    throw new Error(`Could not read recent trades from Robinhood Chain: ${(tradesRes.reason as Error)?.message?.slice(0, 120) ?? 'RPC error'}`);
  }
  const { rows: trades, ticker } = tradesRes.value;
  let degraded = stakesRes.status === 'rejected';
  const stakes: StakeActivity[] = stakesRes.status === 'fulfilled' ? stakesRes.value : [];
  let mints: Omit<MintActivity, 'timestamp'>[] = [];
  if (fundAddresses.length > 0) {
    try {
      const logs = await getLogsChunked(client, fromBlock, latest, (from, to) => client.getLogs({ address: fundAddresses, event: TRANSFER, fromBlock: from, toBlock: to }));
      mints = logs
        .filter((l) => (l.args.from ?? '').toLowerCase() === ZERO)
        .map((l) => ({ kind: 'mint' as const, fund: l.address, to: l.args.to ?? '', tokenId: l.args.tokenId ?? 0n, txHash: l.transactionHash, block: l.blockNumber }));
    } catch {
      degraded = true;
    }
  }
  const logRows = [...trades, ...mints].sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1)).slice(0, 40);
  const blocks = Array.from(new Set(logRows.map((r) => r.block)));
  const ts: Record<string, number> = {};
  await Promise.all(
    blocks.map(async (b) => {
      try {
        const blk = await client.getBlock({ blockNumber: b });
        ts[b.toString()] = Number(blk.timestamp) * 1000;
      } catch {
        ts[b.toString()] = 0;
      }
    }),
  );
  const rows: ActivityRow[] = [
    ...logRows.map((r) => ({ ...r, timestamp: ts[r.block.toString()] ?? 0 })),
    ...stakes,
  ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return { rows, ticker, updatedAt: Date.now(), degraded };
}

/** Live NAV per vault: navPerNft + total value, as decimal strings (JSON-safe). */
export type VaultNavs = Record<string, { navPerNft: string | null; totalNav: string | null }>;

/**
 * One NAV multicall + balances per vault (~0.3s even cold). Moved here from
 * /api/terminal/leaderboard (Nov 26) so the Terminal page can read it
 * directly during server rendering instead of fetching its own route; the
 * route still imports it and keeps its own 30s cache.
 */
export async function readNavs(vaults: `0x${string}`[]): Promise<VaultNavs> {
  return terminalSwr(`navs:${vaults.map((v) => v.toLowerCase()).sort().join(',')}`, () => readNavsFresh(vaults));
}

async function readNavsFresh(vaults: `0x${string}`[]): Promise<VaultNavs> {
  const client = publicClient as PublicClient;
  const res = await client.multicall({
    allowFailure: true,
    contracts: vaults.flatMap((v) => [
      { address: v, abi: FundVaultPhase3ABI, functionName: 'navPerNft' as const },
      { address: v, abi: FundVaultPhase3ABI, functionName: 'nav' as const },
    ]),
  });
  const balances = await Promise.all(vaults.map((v) => client.getBalance({ address: v }).catch(() => null)));
  const navs: VaultNavs = {};
  vaults.forEach((v, i) => {
    const per = res[i * 2]?.status === 'success' ? (res[i * 2].result as bigint) : null;
    const total = res[i * 2 + 1]?.status === 'success' ? (res[i * 2 + 1].result as bigint) : balances[i];
    navs[v.toLowerCase()] = {
      navPerNft: per === null ? null : per.toString(),
      totalNav: total === null ? null : total.toString(),
    };
  });
  return navs;
}
