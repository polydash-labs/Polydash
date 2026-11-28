'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { type Abi } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { STAKE_ERRORS, erc20Abi, stakingPoolAbi, type PoolDetailResponse, type PoolSummary, type PoolsResponse } from '@/lib/staking/shared';

async function getJson<T>(url: string): Promise<T | { pending: true }> {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 202) return { pending: true };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || 'Could not load staking data.');
  return j as T;
}

export function useStakePools(token?: string | null, initial?: PoolsResponse) {
  return useQuery({
    queryKey: ['stake-pools', token ?? ''],
    queryFn: () => getJson<PoolsResponse>(`/api/stake/pools${token ? `?token=${token}` : ''}`),
    // First-paint pools (server-read, from the /stake page, unfiltered
    // only): the list renders with real figures immediately; the 30s
    // staleTime avoids a redundant refetch the moment the page mounts. A
    // token-filtered view has a different query key and fetches as before.
    initialData: !token && initial ? initial : undefined,
    staleTime: !token && initial ? 30_000 : 15_000,
    refetchInterval: (q) => {
      const d = q.state.data as any;
      return !d || d.pending || d.analyticsPending || d.totals?.stakers == null ? 4_000 : 60_000;
    },
  });
}

export function usePoolDetail(pool: string) {
  return useQuery({
    queryKey: ['stake-pool', pool.toLowerCase()],
    queryFn: () => getJson<PoolDetailResponse>(`/api/stake/${pool}`),
    refetchInterval: (q) => {
      const d = q.state.data as any;
      return !d || d.pending || d.analyticsPending ? 4_000 : 30_000;
    },
    staleTime: 10_000,
    retry: (n, e: any) => !String(e?.message).includes('not a Polypad') && n < 2,
  });
}

export interface Position { shares: bigint; staked: bigint; claimable: bigint; earned: bigint }

/** The connected wallet's position in each pool (one multicall). */
export function usePositions(pools: PoolSummary[]) {
  const { address } = useAccount();
  const q = useReadContracts({
    contracts: address ? pools.flatMap((p) => [
      { address: p.address as `0x${string}`, abi: stakingPoolAbi, functionName: 'balanceOf', args: [address], chainId: robinhoodChain.id },
      { address: p.address as `0x${string}`, abi: stakingPoolAbi, functionName: 'claimable', args: [address], chainId: robinhoodChain.id },
    ]) : [],
    allowFailure: true,
    query: { enabled: !!address && pools.length > 0, refetchInterval: 30_000 },
  });
  const map = new Map<string, Position>();
  if (address && q.data) {
    pools.forEach((p, i) => {
      const s = q.data?.[i * 2]?.result as bigint | undefined;
      const c = q.data?.[i * 2 + 1]?.result as bigint | undefined;
      map.set(p.address.toLowerCase(), { shares: s ?? BigInt(0), staked: s ?? BigInt(0), claimable: c ?? BigInt(0), earned: c ?? BigInt(0) });
    });
  }
  return { positions: map, connected: !!address, loading: q.isLoading };
}

/** Everything the action panel needs for one pool and wallet. */
export function usePoolWallet(pool: PoolSummary | undefined) {
  const { address } = useAccount();
  const p = pool?.address as `0x${string}` | undefined;
  const t = pool?.stake.address as `0x${string}` | undefined;
  const enabled = !!address && !!p && !!t;
  const q = useReadContracts({
    contracts: enabled ? [
      { address: t!, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: robinhoodChain.id },
      { address: t!, abi: erc20Abi, functionName: 'allowance', args: [address!, p!], chainId: robinhoodChain.id },
      { address: p!, abi: stakingPoolAbi, functionName: 'balanceOf', args: [address!], chainId: robinhoodChain.id },
      { address: p!, abi: stakingPoolAbi, functionName: 'claimable', args: [address!], chainId: robinhoodChain.id },
      { address: p!, abi: stakingPoolAbi, functionName: 'earned', args: [address!], chainId: robinhoodChain.id },
    ] : [],
    allowFailure: true,
    query: { enabled, refetchInterval: 15_000 },
  });
  const r = (i: number) => (q.data?.[i]?.result as bigint | undefined) ?? BigInt(0);
  const shares = r(2);
  const sharesQ = useReadContracts({
    contracts: enabled && shares > BigInt(0) ? [{ address: p!, abi: stakingPoolAbi, functionName: 'sharesToAmount', args: [shares], chainId: robinhoodChain.id }] : [],
    allowFailure: true,
    query: { enabled: enabled && shares > BigInt(0) },
  });
  const staked = (sharesQ.data?.[0]?.result as bigint | undefined) ?? shares;
  return {
    address, ready: !!q.data, balance: r(0), allowance: r(1), shares, staked, claimable: r(3), earned: r(4),
    fetchedAt: q.dataUpdatedAt, refetch: () => { q.refetch(); sharesQ.refetch(); },
  };
}

/** Sends one transaction, waits for the receipt, toasts with an explorer link and refreshes staking data. */
export function useStakeTx() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (o: { key: string; address: `0x${string}`; abi?: Abi; functionName: string; args?: unknown[]; success: string; quiet?: boolean }) => {
    if (!client) return false;
    setPending(o.key);
    const tid = toast.loading('Confirm in your wallet');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({ address: o.address, abi: (o.abi ?? stakingPoolAbi) as Abi, functionName: o.functionName, args: (o.args ?? []) as any, chainId: robinhoodChain.id } as any);
      toast.loading('Waiting for confirmation', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success, { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await qc.invalidateQueries({ predicate: (q) => ['stake-pools', 'stake-pool', 'readContracts', 'readContract'].includes(String(q.queryKey[0])) });
      return true;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const name = e?.cause?.data?.errorName ?? e?.data?.errorName;
      const msg: string = (name && STAKE_ERRORS[name]) || e?.shortMessage || e?.message || 'Transaction failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg.split('\n')[0], { id: tid });
      return false;
    } finally {
      setPending(null);
    }
  };
  return { send, pending };
}
