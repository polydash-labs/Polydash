'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatEther, parseAbiItem, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getFactoryAddresses } from '@/lib/contracts/addresses';
import { FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { BOUGHT, SOLD, fetchLaunchAddresses } from '@/lib/launches-core';
import { usePhase3Funds, type Phase3Summary } from '@/lib/fund/use-phase3';
import { useV3Funds } from '@/lib/fund/use-v3';
import { useV2Funds } from '@/lib/fund/use-phase6';

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

export type TerminalFundRow = Phase3Summary & {
  generation: 'V3' | 'Phase 3' | 'V2';
  navPerNft: bigint;
  totalNav: bigint;
};

export function strategyLabel(templateId: number): string {
  if (templateId >= 6 && templateId <= 9) return `Strategy #${templateId} · LP-Dividend`;
  if (templateId === 1) return 'Strategy #1 · Growth';
  if (templateId >= 2 && templateId <= 5) return `Strategy #${templateId} · Growth`;
  return `Strategy #${templateId}`;
}

/** Every live Tokenized Fund (V3 + Phase 3 + V2 factories), ranked by NAV per share. */
export function useTerminalFunds() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const v3 = useV3Funds();
  const p3 = usePhase3Funds();
  const v2 = useV2Funds();

  const funds = useMemo(() => {
    const seen = new Set<string>();
    const out: (Phase3Summary & { generation: TerminalFundRow['generation'] })[] = [];
    const push = (list: Phase3Summary[] | undefined, generation: TerminalFundRow['generation']) => {
      for (const f of list ?? []) {
        const key = f.address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...f, generation });
      }
    };
    push(v3.data, 'V3');
    push(p3.data, 'Phase 3');
    push(v2.data, 'V2');
    return out;
  }, [v3.data, p3.data, v2.data]);

  const key = funds.map((f) => f.address.toLowerCase()).join(',');
  const nav = useQuery({
    queryKey: ['terminal-nav', key],
    enabled: !!client && funds.length > 0,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async (): Promise<TerminalFundRow[]> => {
      if (!client) return [];
      const res = await client.multicall({
        allowFailure: true,
        contracts: funds.flatMap((f) => [
          { address: f.vault, abi: FundVaultPhase3ABI, functionName: 'navPerNft' as const },
          { address: f.vault, abi: FundVaultPhase3ABI, functionName: 'nav' as const },
        ]),
      });
      const balances = await Promise.all(funds.map((f) => client.getBalance({ address: f.vault }).catch(() => 0n)));
      const rows: TerminalFundRow[] = funds.map((f, i) => {
        const per = res[i * 2]?.status === 'success' ? (res[i * 2].result as bigint) : f.mintPrice;
        const total = res[i * 2 + 1]?.status === 'success' ? (res[i * 2 + 1].result as bigint) : balances[i];
        return { ...f, navPerNft: per, totalNav: total };
      });
      rows.sort((a, b) => (a.navPerNft === b.navPerNft ? 0 : a.navPerNft > b.navPerNft ? -1 : 1));
      return rows;
    },
  });

  const refetch = () => {
    void v3.refetch();
    void p3.refetch();
    void v2.refetch();
    void nav.refetch();
  };

  return {
    rows: nav.data ?? [],
    isLoading: v3.isLoading || p3.isLoading || v2.isLoading || (funds.length > 0 && nav.isLoading),
    isError: v3.isError || p3.isError || v2.isError || nav.isError,
    isFetching: v3.isFetching || p3.isFetching || v2.isFetching || nav.isFetching,
    fundAddresses: funds.map((f) => f.address),
    funds,
    refetch,
  };
}

export type TradeActivity = {
  kind: 'trade';
  launch: `0x${string}`;
  isBuy: boolean;
  trader: string;
  eth: number;
  tokens: number;
  txHash: string;
  block: bigint;
  timestamp: number;
};
export type MintActivity = {
  kind: 'mint';
  fund: `0x${string}`;
  to: string;
  tokenId: bigint;
  txHash: string;
  block: bigint;
  timestamp: number;
};
export type StakeActivity = {
  kind: 'stake';
  pool: string;
  name: string;
  stakeSymbol: string;
  rewardSymbol: string;
  creator: string | null;
  timestamp: number;
};
export type ActivityRow = TradeActivity | MintActivity | StakeActivity;
export type TickerRow = { launch: string; volumeEth: number; trades: number };

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

/**
 * The newest on-chain activity in the last 24h: token trades, Tokenized Fund
 * share mints, and new staking pools. Trades are the core read — if the RPC
 * rejects them the query errors and the UI says so; mints and staking pools
 * are best-effort and a failure there only sets `degraded`.
 */
export function useTerminalActivity(fundAddresses: `0x${string}`[]) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const key = fundAddresses.join(',');
  return useQuery({
    queryKey: ['terminal-activity', key],
    enabled: !!client,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async (): Promise<{ rows: ActivityRow[]; ticker: TickerRow[]; updatedAt: number; degraded: boolean }> => {
      if (!client) throw new Error('No chain connection');
      const latest = await client.getBlockNumber();
      const fromBlock = latest > DAY_BLOCKS ? latest - DAY_BLOCKS : 0n;
      const { rows: trades, ticker } = await readTrades(client, fromBlock, latest).catch((e) => {
        throw new Error(`Could not read recent trades from Robinhood Chain: ${(e as Error)?.message?.slice(0, 120) ?? 'RPC error'}`);
      });
      let degraded = false;
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
      let stakes: StakeActivity[] = [];
      try {
        const r = await fetch('/api/stake/pools');
        const j = (await r.json()) as { pools?: { address: string; name: string; creator: string | null; stake: { symbol: string }; reward: { symbol: string }; startTime: number }[] };
        const nowSec = Math.floor(Date.now() / 1000);
        stakes = (j.pools ?? [])
          .filter((p) => p.startTime > nowSec - 86_400)
          .map((p) => ({ kind: 'stake' as const, pool: p.address, name: p.name, stakeSymbol: p.stake.symbol, rewardSymbol: p.reward.symbol, creator: p.creator, timestamp: p.startTime * 1000 }));
      } catch {
        degraded = true;
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
    },
  });
}
