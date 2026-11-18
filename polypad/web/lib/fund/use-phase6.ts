'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { FundFactoryPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { Erc20MiniABI, FundAllowlistABI, FundVaultV2ABI } from '@/lib/contracts/fund-phase6-abi';
import { robinhoodChain } from '@/lib/chain';
import { FUND_ALLOWLIST, FUND_WETH } from '@/lib/fund/phase3';
import { FUND_FACTORY_V2, holdingsBps, type FundAsset, type ProposalView } from '@/lib/fund/phase6';
import { readSummary, type Phase3Summary } from '@/lib/fund/use-phase3';

type Addr = `0x${string}`;
const ok = <T,>(r: { status: string; result?: unknown } | undefined, f: T): T => (r?.status === 'success' ? (r.result as T) : f);

/** true when the address was created by the V2 factory. */
export function useV2IsFund(address: string) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['p6', 'isfund', address.toLowerCase()],
    enabled: !!client && valid,
    staleTime: Infinity,
    retry: 2,
    queryFn: async () => (client ? client.readContract({ address: FUND_FACTORY_V2, abi: FundFactoryPhase3ABI, functionName: 'isFund', args: [address as Addr] }) : false),
  });
}

export function useV2Funds() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p6', 'funds'],
    enabled: !!client,
    refetchInterval: 30_000,
    // A slow first-paint chain read must not flash the error state: the
    // single RPC times out at 10s under concurrent load, so retry with
    // backoff inside the loading state, and keep the last good list when
    // a background refetch fails (same pattern as useLaunches).
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Phase3Summary[]> => {
      if (!client) return [];
      const count = Number(await client.readContract({ address: FUND_FACTORY_V2, abi: FundFactoryPhase3ABI, functionName: 'allFundsLength' }));
      if (!count) return [];
      const addrs = await client.multicall({
        allowFailure: true,
        contracts: Array.from({ length: Math.min(count, 200) }, (_, i) => ({ address: FUND_FACTORY_V2, abi: FundFactoryPhase3ABI, functionName: 'allFunds' as const, args: [BigInt(i)] as const })),
      });
      const rows = await Promise.all(addrs.map((r, i) => (r.status === 'success' ? readSummary(client, r.result as Addr, i) : Promise.resolve(null))));
      return rows.filter((r): r is Phase3Summary => r !== null).reverse();
    },
  });
}

export function useV2Proposals(vault: Addr | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p6', 'proposals', vault ?? ''],
    enabled: !!client && !!vault,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !vault) return { list: [] as ProposalView[], tradeCount: 0 };
      const head = await client.multicall({
        allowFailure: true,
        contracts: [
          { address: vault, abi: FundVaultV2ABI, functionName: 'proposalCount' },
          { address: vault, abi: FundVaultV2ABI, functionName: 'tradeCount' },
        ],
      });
      const count = Number(ok(head[0], 0n));
      const ids = Array.from({ length: Math.min(count, 200) }, (_, i) => count - i).filter((id) => id >= 1);
      const rows = ids.length
        ? await client.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: vault, abi: FundVaultV2ABI, functionName: 'getProposal' as const, args: [BigInt(id)] as const })) })
        : [];
      const list: ProposalView[] = [];
      rows.forEach((r, i) => {
        if (r.status !== 'success') return;
        const p = r.result;
        list.push({ id: ids[i], asset: p.asset, capBps: Number(p.maxPositionBps), reason: p.reason, thesisUri: p.thesisUri, readyAt: Number(p.readyAt), status: Number(p.status), kind: Number(p.kind) });
      });
      return { list, tradeCount: Number(ok(head[1], 0n)) };
    },
  });
}

export type Holding = { asset: Addr | 'ETH'; symbol: string; balance: bigint; decimals: number; valueEth: bigint | null; bps: number };

export function useV2Holdings(vault: Addr | undefined, vaultEth: bigint) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p6', 'holdings', vault ?? '', vaultEth.toString()],
    enabled: !!client && !!vault,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Holding[]> => {
      if (!client || !vault) return [];
      const n = Number(await client.readContract({ address: vault, abi: FundVaultV2ABI, functionName: 'mandateAssetCount' }).catch(() => 0n));
      const idx = Array.from({ length: Math.min(n, 20) }, (_, i) => BigInt(i));
      const list = idx.length
        ? (await client.multicall({ allowFailure: true, contracts: idx.map((i) => ({ address: vault, abi: FundVaultV2ABI, functionName: 'mandateAssets' as const, args: [i] as const })) }))
          .map((r) => ok<Addr | null>(r, null)).filter((a): a is Addr => !!a)
        : [];
      const tokens = [FUND_WETH as Addr, ...list.filter((a) => a.toLowerCase() !== FUND_WETH)];
      const meta = await client.multicall({
        allowFailure: true,
        contracts: tokens.flatMap((t) => [
          { address: t, abi: Erc20MiniABI, functionName: 'balanceOf' as const, args: [vault] as const },
          { address: t, abi: Erc20MiniABI, functionName: 'symbol' as const },
          { address: t, abi: Erc20MiniABI, functionName: 'decimals' as const },
        ]),
      });
      const bal = tokens.map((_, i) => ok(meta[i * 3], 0n));
      const quotes = await client.multicall({
        allowFailure: true,
        contracts: tokens.map((t, i) => ({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'quote' as const, args: [t, bal[i]] as const })),
      });
      const rows: Omit<Holding, 'bps'>[] = [
        { asset: 'ETH', symbol: 'ETH', balance: vaultEth, decimals: 18, valueEth: vaultEth },
        ...tokens.map((t, i) => ({
          asset: t,
          symbol: ok(meta[i * 3 + 1], '?'),
          balance: bal[i],
          decimals: Number(ok(meta[i * 3 + 2], 18)),
          valueEth: t.toLowerCase() === FUND_WETH ? bal[i] : bal[i] === 0n ? 0n : ok<bigint | null>(quotes[i], null),
        })),
      ];
      const bps = holdingsBps(rows.map((r) => r.valueEth ?? 0n));
      return rows.map((r, i) => ({ ...r, bps: bps[i] }));
    },
  });
}

export type FundAssetFeed = { assets: FundAsset[]; updatedAt: number | null; stale: boolean };

/** Live asset list; polls every 60 s. On a failed poll react-query keeps the last loaded data. */
export function useFundAssets(enabled: boolean) {
  return useQuery({
    queryKey: ['p6', 'assets'],
    enabled,
    staleTime: 55_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async (): Promise<FundAssetFeed> => {
      const r = await fetch('/api/funds/assets', { cache: 'no-store' });
      const j = (await r.json()) as Partial<FundAssetFeed> & { error?: string };
      if (!j.assets?.length) throw new Error(j.error ?? 'The live token list is not available right now.');
      return { assets: j.assets, updatedAt: j.updatedAt ?? null, stale: !!j.stale || !r.ok };
    },
  });
}
