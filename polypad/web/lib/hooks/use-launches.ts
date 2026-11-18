'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatEther, type PublicClient } from 'viem';
import { getFactoryAddresses } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import type { LaunchToken } from '@/lib/token-types';
import { BOUGHT, SOLD, fetchLaunchAddresses, fetchLaunchDetails, getLogsFromDeploy, resolveLaunchAddress } from '@/lib/launches-core';

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

/** All launches created through the factory, read live from the chain. `initial` (server snapshot) is shown until the first live read. */
export function useLaunches(initial?: LaunchToken[] | null) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { data: ethUsd } = useEthPrice();
  const factories = getFactoryAddresses();
  return useQuery({
    queryKey: ['launches', factories.join(','), ethUsd ?? 0],
    enabled: !!client && factories.length > 0,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev ?? initial ?? undefined,
    queryFn: async () => {
      if (!client || factories.length === 0) return [];
      // Strict: an inconclusive address lookup throws instead of resolving
      // to [], so a flaky refetch keeps the last good list instead of
      // blanking the homepage. [] then only means every factory genuinely
      // reports zero launches.
      const addrs = await fetchLaunchAddresses(client as PublicClient, factories, true);
      if (addrs.length === 0) return [];
      return fetchLaunchDetails(client as PublicClient, addrs, ethUsd ?? 0);
    },
  });
}

/** A single launch by its launch contract address or its token address (any known factory). `initial` (server snapshot) is shown until the first live read. */
export function useLaunch(address: string, initial?: LaunchToken | null) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { data: ethUsd } = useEthPrice();
  const factories = getFactoryAddresses();
  return useQuery({
    queryKey: ['launch', address, ethUsd ?? 0],
    enabled: !!client && factories.length > 0 && /^0x[0-9a-fA-F]{40}$/.test(address),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev ?? initial ?? undefined,
    queryFn: async () => {
      if (!client || factories.length === 0) return null;
      // Strict: an inconclusive lookup (an RPC call failed) throws instead of
      // resolving null, so a flaky refetch keeps the last good data instead of
      // flipping a loaded page to "Token not found". Null then only means the
      // address genuinely is not a launch on any factory.
      const launch = await resolveLaunchAddress(client as PublicClient, factories, address as `0x${string}`, true);
      if (!launch) return null;
      const [t] = await fetchLaunchDetails(client as PublicClient, [launch], ethUsd ?? 0);
      return t ?? null;
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
