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

/**
 * The newest on-chain activity in the last 24h: token trades, Tokenized Fund
 * share mints, and new staking pools. Trades are the core read — if the RPC
 * rejects them the scan throws and the route answers 502; mints and staking
 * pools are best-effort and a failure there only sets `degraded`.
 */
export async function scanTerminalActivity(fundAddresses: `0x${string}`[]): Promise<TerminalActivity> {
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
