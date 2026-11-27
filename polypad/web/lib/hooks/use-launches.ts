'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatEther, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import type { LaunchToken } from '@/lib/token-types';
import { BOUGHT, SOLD, getLogsFromDeploy } from '@/lib/launches-core';

export { DEPLOY_BLOCK, fetchLaunchDetails } from '@/lib/launches-core';

export function useEthPrice() {
  return useQuery({
    queryKey: ['eth-price'],
    queryFn: async () => {
      const r = await fetch('/api/eth-price');
      const j = await r.json();
      return Number(j?.price ?? 0);
    },
    staleTime: 60_000,
  });
}

/** All launches created through the factory, read on the server behind /api/launches (round 7). `initial` (server snapshot) is shown until the first live read. The browser used to read the chain directly (fetchLaunchAddresses + fetchLaunchDetails, including a full log scan for volumes); on a cold load that read fired into the first-load storm and the token pages and the leaderboard sat on skeletons or flashed a false empty state. A 502 means the server snapshot was not ready in time, never "no launches" — it throws so the retry keeps the last good list. */
export function useLaunches(initial?: LaunchToken[] | null) {
  return useQuery({
    queryKey: ['launches'],
    refetchInterval: 30_000,
    placeholderData: (prev) => prev ?? initial ?? undefined,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    queryFn: async () => {
      const r = await fetch('/api/launches', { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Launch list read failed: ${r.status}`);
      const j = (await r.json()) as { tokens: LaunchToken[] };
      return j.tokens ?? [];
    },
  });
}

/** A single launch by its launch contract address or its token address (any known factory). Read on the server behind /api/launch (round 7) — see useLaunches. `initial` (server snapshot) is shown until the first live read. A 404 means the address genuinely is not a launch; anything else throws so a flaky refetch keeps the last good data instead of flipping a loaded page to "Token not found". */
export function useLaunch(address: string, initial?: LaunchToken | null) {
  return useQuery({
    queryKey: ['launch', address.toLowerCase()],
    enabled: /^0x[0-9a-fA-F]{40}$/.test(address),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev ?? initial ?? undefined,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    queryFn: async () => {
      const r = await fetch(`/api/launch?address=${address}`, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Launch read failed: ${r.status}`);
      const j = (await r.json()) as { token: LaunchToken | null };
      return j.token ?? null;
    },
  });
}

/** priceEth is the curve spot price right after the trade (emitted by the contract). */
export interface TradeRow { isBuy: boolean; trader: string; eth: number; tokens: number; priceEth: number; txHash: string; timestamp: number; }

/** All buys/sells on a launch from on-chain event logs, newest first. */
export function useTrades(address: string) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['trades', address],
    enabled: !!client && /^0x[0-9a-fA-F]{40}$/.test(address),
    refetchInterval: 15_000,
    queryFn: async (): Promise<TradeRow[]> => {
      if (!client) return [];
      const a = address as `0x${string}`;
      const [buys, sells] = await Promise.all([
        getLogsFromDeploy(client as PublicClient, (fromBlock, toBlock) => client.getLogs({ address: a, event: BOUGHT, fromBlock, toBlock })),
        getLogsFromDeploy(client as PublicClient, (fromBlock, toBlock) => client.getLogs({ address: a, event: SOLD, fromBlock, toBlock })),
      ]);
      const rows = [
        ...buys.map((l) => ({ isBuy: true, trader: l.args.buyer ?? '', eth: Number(formatEther(l.args.ethIn ?? BigInt(0))), tokens: Number(formatEther(l.args.tokensOut ?? BigInt(0))), priceEth: Number(formatEther(l.args.price ?? BigInt(0))), txHash: l.transactionHash, block: l.blockNumber, idx: l.logIndex })),
        ...sells.map((l) => ({ isBuy: false, trader: l.args.seller ?? '', eth: Number(formatEther(l.args.ethOut ?? BigInt(0))), tokens: Number(formatEther(l.args.tokensIn ?? BigInt(0))), priceEth: Number(formatEther(l.args.price ?? BigInt(0))), txHash: l.transactionHash, block: l.blockNumber, idx: l.logIndex })),
      ].sort((x, y) => (x.block === y.block ? Number(y.idx) - Number(x.idx) : Number(y.block - x.block))).slice(0, 300);
      const blocks = Array.from(new Set(rows.map((r) => r.block)));
      const ts: Record<string, number> = {};
      await Promise.all(blocks.map(async (b) => {
        try { const blk = await client.getBlock({ blockNumber: b }); ts[b.toString()] = Number(blk.timestamp) * 1000; } catch { ts[b.toString()] = 0; }
      }));
      return rows.map((r) => ({ isBuy: r.isBuy, trader: r.trader, eth: r.eth, tokens: r.tokens, priceEth: r.priceEth, txHash: r.txHash, timestamp: ts[r.block.toString()] ?? 0 }));
    },
  });
}
