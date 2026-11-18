'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { erc20Abi, type Abi, type TransactionReceipt } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { BUYBACK_FACTORY_MIN_ABI, BUYBACK_VAULT_ABI, REWARDS_POOL_ABI } from '@/lib/buybackArtifacts';
import { LAUNCH_FACTORIES, POLYDASH, errorName, errorText, isZeroAddr, poolAddress, vaultAddress, writeGas, type Addr } from '@/lib/buyback';

const CHAIN = robinhoodChain.id;
export const ABIS = {
  vault: BUYBACK_VAULT_ABI as unknown as Abi,
  pool: REWARDS_POOL_ABI as unknown as Abi,
  factory: BUYBACK_FACTORY_MIN_ABI as unknown as Abi,
  erc20: erc20Abi as unknown as Abi,
};
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);
const big = (x: any) => (typeof x === 'bigint' ? x : BigInt(0));

async function getJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// ---------- API reads ----------
export const useBuybackSummary = () => useQuery({ queryKey: ['buyback', 'summary'], queryFn: () => getJson('/api/buybacks/summary'), refetchInterval: 30_000 });
export const useBuybackChart = (enabled: boolean) => useQuery({ queryKey: ['buyback', 'chart'], queryFn: () => getJson('/api/buybacks/chart?bucket=day'), enabled });
export const useBuybackTasks = (enabled: boolean) => useQuery({ queryKey: ['buyback', 'tasks'], queryFn: () => getJson('/api/agents/v1/buyback-tasks'), enabled, refetchInterval: 60_000 });
export const usePoolSummary = () => useQuery({ queryKey: ['buyback', 'pool'], queryFn: () => getJson('/api/rewards-pool/summary'), refetchInterval: 30_000 });
export const usePoolHistory = (enabled: boolean) => useQuery({ queryKey: ['buyback', 'poolHistory'], queryFn: () => getJson('/api/rewards-pool/history'), enabled });
export function useBuybackHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['buyback', 'history'],
    queryFn: ({ pageParam }) => getJson(`/api/buybacks/history?cursor=${pageParam ?? '0'}`),
    initialPageParam: '0',
    getNextPageParam: (last: any) => last?.nextCursor ?? undefined,
    enabled,
  });
}

// ---------- direct chain reads (fresh read-backs for admin + wallet panels) ----------
export function useFactoriesLive() {
  const client = usePublicClient({ chainId: CHAIN });
  return useQuery({
    queryKey: ['buyback', 'factoriesLive'],
    enabled: !!client,
    queryFn: async () => {
      const names = ['owner', 'buybackEnabled', 'buybackBps', 'buybackContract'];
      const fs = LAUNCH_FACTORIES as unknown as Addr[];
      const res = await client!.multicall({ contracts: fs.flatMap((f) => names.map((functionName) => ({ address: f, abi: ABIS.factory, functionName }))) as any, allowFailure: true });
      return fs.map((address, i) => ({
        address,
        owner: ok<Addr>(res[i * 4]) ?? null,
        enabled: ok<boolean>(res[i * 4 + 1]) ?? false,
        bps: Number(ok<bigint>(res[i * 4 + 2]) ?? BigInt(0)),
        contract: ok<Addr>(res[i * 4 + 3]) ?? null,
      }));
    },
  });
}

const TARGET_VIEWS = ['rewardsTarget', 'targetEndTime', 'targetActive', 'heldForStakers', 'pendingTarget', 'pendingTargetAt', 'targetAdmin'] as const;
export function useVaultTargetLive() {
  const client = usePublicClient({ chainId: CHAIN });
  const vault = vaultAddress();
  return useQuery({
    queryKey: ['buyback', 'targetLive'],
    enabled: !!client && !!vault,
    queryFn: async () => {
      const res = await client!.multicall({ contracts: TARGET_VIEWS.map((functionName) => ({ address: vault!, abi: ABIS.vault, functionName })) as any, allowFailure: true });
      const v: Record<string, any> = {};
      TARGET_VIEWS.forEach((n, i) => { v[n] = ok(res[i]); });
      return {
        target: isZeroAddr(v.rewardsTarget) ? null : (v.rewardsTarget as Addr),
        endTime: Number(v.targetEndTime ?? 0),
        active: !!v.targetActive,
        held: big(v.heldForStakers),
        pending: isZeroAddr(v.pendingTarget) ? null : (v.pendingTarget as Addr),
        pendingAt: Number(v.pendingTargetAt ?? 0),
        admin: (v.targetAdmin as Addr) ?? null,
      };
    },
  });
}

export function usePoolUser() {
  const client = usePublicClient({ chainId: CHAIN });
  const { address } = useAccount();
  const pool = poolAddress();
  return useQuery({
    queryKey: ['buyback', 'poolUser', address],
    enabled: !!client && !!pool && !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await client!.multicall({
        contracts: [
          { address: pool!, abi: ABIS.pool, functionName: 'balanceOf', args: [address] },
          { address: pool!, abi: ABIS.pool, functionName: 'earned', args: [address] },
          { address: POLYDASH as Addr, abi: erc20Abi, functionName: 'balanceOf', args: [address!] },
          { address: POLYDASH as Addr, abi: erc20Abi, functionName: 'allowance', args: [address!, pool!] },
        ] as any,
        allowFailure: true,
      });
      return { staked: big(ok(res[0])), earned: big(ok(res[1])), wallet: big(ok(res[2])), allowance: big(ok(res[3])) };
    },
  });
}

// ---------- writes ----------
/** Sends a tx with gas = max(estimate x 1.5, 1,000,000). The connected wallet signs; nothing is stored. */
export function useBuybackTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<{ key: string; hash: `0x${string}` } | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: keyof typeof ABIS; functionName: string; args?: readonly unknown[]; success?: string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) return null;
    const abi = ABIS[o.abi];
    setPending(o.key);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateContractGas({ address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, account: address } as any);
      } catch (e) {
        if (errorName(e)) throw e;
        console.error(`${o.functionName} gas estimate failed, using floor`, e);
      }
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({ address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, chainId: CHAIN, gas: writeGas(estimate) } as any);
      setLastHash({ key: o.key, hash });
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(`https://robinhoodchain.blockscout.com/tx/${hash}`, '_blank') } });
      await qc.invalidateQueries({ queryKey: ['buyback'] });
      return r;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const msg = errorText(e);
      toast.error(/User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg, { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  return { send, pending, lastHash, client, address };
}
