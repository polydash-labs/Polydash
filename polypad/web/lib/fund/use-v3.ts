'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { FundFactoryPhase3ABI, FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { readSummary, type Phase3Summary } from '@/lib/fund/use-phase3';
import { FundVaultV3ABI } from '@/lib/contracts/fund-v3-abi';
import { robinhoodChain } from '@/lib/chain';
import { FUND_FACTORY_V3 } from '@/lib/fund/phase7';
import { POLYDASH_TOKEN } from '@/lib/fund/phase6';

type Addr = `0x${string}`;
const ok = <T,>(r: { status: string; result?: unknown } | undefined, f: T): T => (r?.status === 'success' ? (r.result as T) : f);

/** true when the address was created by the V3 factory (Strategy #6–#9). */
export function useV3IsFund(address: string) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['p6', 'v3isfund', address.toLowerCase()],
    enabled: !!client && valid,
    staleTime: Infinity,
    retry: 2,
    queryFn: async () => (client ? client.readContract({ address: FUND_FACTORY_V3, abi: FundFactoryPhase3ABI, functionName: 'isFund', args: [address as Addr] }) : false),
  });
}

export type V3FundSummary = Phase3Summary & { raiseDeadline: number };

/** Every tokenized fund listed by the V3 factory (Strategy #6–#9), newest first. */
export function useV3Funds() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p6', 'v3funds'],
    enabled: !!client,
    refetchInterval: 30_000,
    // A slow first-paint chain read must not flash the error state: the
    // single RPC times out at 10s under concurrent load, so retry with
    // backoff inside the loading state, and keep the last good list when
    // a background refetch fails (same pattern as useLaunches).
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<V3FundSummary[]> => {
      if (!client) return [];
      const count = Number(await client.readContract({ address: FUND_FACTORY_V3, abi: FundFactoryPhase3ABI, functionName: 'allFundsLength' }));
      if (!count) return [];
      const addrs = await client.multicall({
        allowFailure: true,
        contracts: Array.from({ length: Math.min(count, 200) }, (_, i) => ({ address: FUND_FACTORY_V3, abi: FundFactoryPhase3ABI, functionName: 'allFunds' as const, args: [BigInt(i)] as const })),
      });
      const rows = await Promise.all(addrs.map((r, i) => (r.status === 'success' ? readSummary(client, r.result as Addr, i) : Promise.resolve(null))));
      const list = rows.filter((r): r is Phase3Summary => r !== null);
      const deadlines = list.length
        ? await client.multicall({ allowFailure: true, contracts: list.map((f) => ({ address: f.vault, abi: FundVaultPhase3ABI, functionName: 'raiseDeadline' as const })) })
        : [];
      return list.map((f, i) => ({ ...f, raiseDeadline: Number(ok(deadlines[i], 0n)) })).reverse();
    },
  });
}

export type LpPosition = { id: `0x${string}`; tickLower: number; tickUpper: number; liquidity: bigint; amount0: bigint; amount1: bigint; fees0: bigint; fees1: bigint; lastHarvestAt: number; active: boolean };
export type LpProposal = { id: number; tickLower: number; tickUpper: number; maxLpBps: number; reason: string; thesisUri: string; readyAt: number; status: number };
export type StakeRow = { pool: Addr; amount: bigint; valueEth: bigint; earned: bigint };

export function useV3Positions(vault: Addr | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p6', 'v3pos', vault ?? ''],
    enabled: !!client && !!vault,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !vault) return null;
      const head = await client.multicall({ allowFailure: true, contracts: [
        { address: vault, abi: FundVaultV3ABI, functionName: 'lpPoolCount' },
        { address: vault, abi: FundVaultV3ABI, functionName: 'lpProposalCount' },
        { address: vault, abi: FundVaultV3ABI, functionName: 'lpValue' },
        { address: vault, abi: FundVaultV3ABI, functionName: 'stakedPools' },
      ] });
      const poolCount = Number(ok(head[0], 0n));
      const propCount = Number(ok(head[1], 0n));
      const ids = poolCount ? [...ok<readonly `0x${string}`[]>(await client.multicall({ allowFailure: true, contracts: [{ address: vault, abi: FundVaultV3ABI, functionName: 'lpPoolIds', args: [0n, 20n] }] }).then((r) => r[0]), [])] : [];
      const posRes = ids.length ? await client.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: vault, abi: FundVaultV3ABI, functionName: 'lpPositions' as const, args: [id] as const })) }) : [];
      const positions: LpPosition[] = [];
      posRes.forEach((r, i) => {
        if (r.status !== 'success') return;
        const p = r.result as readonly unknown[];
        positions.push({ id: ids[i], tickLower: Number(p[5]), tickUpper: Number(p[6]), liquidity: p[7] as bigint, amount0: p[8] as bigint, amount1: p[9] as bigint, fees0: p[10] as bigint, fees1: p[11] as bigint, lastHarvestAt: Number(p[12]), active: p[13] as boolean });
      });
      const propIds = Array.from({ length: Math.min(propCount, 20) }, (_, i) => propCount - i).filter((x) => x >= 1);
      const propRes = propIds.length ? await client.multicall({ allowFailure: true, contracts: propIds.map((id) => ({ address: vault, abi: FundVaultV3ABI, functionName: 'lpProposals' as const, args: [BigInt(id)] as const })) }) : [];
      const proposals: LpProposal[] = [];
      propRes.forEach((r, i) => {
        if (r.status !== 'success') return;
        const p = r.result as readonly unknown[];
        proposals.push({ id: propIds[i], tickLower: Number(p[1]), tickUpper: Number(p[2]), maxLpBps: Number(p[3]), reason: String(p[4]), thesisUri: String(p[5]), readyAt: Number(p[6]), status: Number(p[7]) });
      });
      const pools = [...ok<readonly Addr[]>(head[3], [])];
      const sRes = pools.length ? await client.multicall({ allowFailure: true, contracts: pools.flatMap((p) => [
        { address: vault, abi: FundVaultV3ABI, functionName: 'stakedAmount' as const, args: [p] as const },
        { address: vault, abi: FundVaultV3ABI, functionName: 'stakedValueEth' as const, args: [p] as const },
        { address: vault, abi: FundVaultV3ABI, functionName: 'earnedRewards' as const, args: [p] as const },
      ]) }) : [];
      const stakes: StakeRow[] = pools.map((pool, i) => ({ pool, amount: ok(sRes[i * 3], 0n), valueEth: ok(sRes[i * 3 + 1], 0n), earned: ok(sRes[i * 3 + 2], 0n) }));
      return { positions, proposals, stakes, lpValue: ok(head[2], 0n) };
    },
  });
}

export type StakePoolOption = { address: Addr; name: string; apr: number | null };
/** Live POLYDASH staking pools that are not ended (from /api/stake/pools). */
export function usePolydashStakePools(enabled: boolean) {
  return useQuery({
    queryKey: ['p6', 'v3stakepools'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<StakePoolOption[]> => {
      const r = await fetch('/api/stake/pools');
      const j = (await r.json()) as { pools?: { address: string; name: string; status: string; apr: number | null; stake: { address: string } }[] };
      return (j.pools ?? []).filter((p) => p.stake.address.toLowerCase() === POLYDASH_TOKEN && p.status !== 'ended').map((p) => ({ address: p.address as Addr, name: p.name, apr: p.apr ?? null }));
    },
  });
}
