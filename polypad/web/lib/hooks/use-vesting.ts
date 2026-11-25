'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { type Abi, type PublicClient, type TransactionReceipt } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { VESTING_FACTORY_ABI, VESTING_VAULT_ABI } from '@/lib/vestingArtifacts';
import { fmtApr, type PoolsResponse } from '@/lib/staking/shared';
import {
  Erc20VestABI, GAS_FLOORS, V2FactoryViewABI, V2PoolViewABI, V2_STAKING_FACTORY, gasLimit, isAddr, isZero, vestingFactory,
  type Addr, type VestingFn,
} from '@/lib/vesting';

const CHAIN = robinhoodChain.id;
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);

// ---------- token check (create flow) ----------
export interface VestToken { address: Addr; isPolypad: boolean; name: string; symbol: string; decimals: number; balance: bigint; allowance: bigint }

export function useVestToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  const factory = vestingFactory();
  return useQuery({
    queryKey: ['vesting', 'token', token?.toLowerCase(), user],
    enabled: !!client && !!factory && isAddr(token),
    refetchInterval: 20_000,
    queryFn: async (): Promise<VestToken> => {
      const t = token as Addr;
      const isPolypad = await client!.readContract({ address: factory!, abi: VESTING_FACTORY_ABI, functionName: 'isPolypadToken', args: [t] });
      if (!isPolypad) return { address: t, isPolypad: false, name: '', symbol: '', decimals: 18, balance: BigInt(0), allowance: BigInt(0) };
      const res = await client!.multicall({
        allowFailure: true,
        contracts: [
          { address: t, abi: Erc20VestABI, functionName: 'name' },
          { address: t, abi: Erc20VestABI, functionName: 'symbol' },
          { address: t, abi: Erc20VestABI, functionName: 'decimals' },
          ...(user ? [
            { address: t, abi: Erc20VestABI, functionName: 'balanceOf', args: [user] },
            { address: t, abi: Erc20VestABI, functionName: 'allowance', args: [user, factory!] },
          ] : []),
        ] as any,
      });
      return {
        address: t, isPolypad: true,
        name: ok<string>(res[0]) ?? '', symbol: ok<string>(res[1]) ?? '', decimals: Number(ok<number>(res[2]) ?? 18),
        balance: ok<bigint>(res[3]) ?? BigInt(0), allowance: ok<bigint>(res[4]) ?? BigInt(0),
      };
    },
  });
}

// ---------- eligible V2 pools ----------
export interface EligiblePool { address: Addr; name: string; endTime: number; aprLabel: string | null }

/** V2 pools where isPool, stakeToken == token, funded and endTime in the future. APR only where the site already computes it. */
export function useEligiblePools(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  return useQuery({
    queryKey: ['vesting', 'pools', token?.toLowerCase()],
    enabled: !!client && isAddr(token),
    staleTime: 60_000,
    queryFn: async (): Promise<EligiblePool[]> => {
      const t = (token as string).toLowerCase();
      const n = await client!.readContract({ address: V2_STAKING_FACTORY, abi: V2FactoryViewABI, functionName: 'poolsLength' });
      if (n === BigInt(0)) return [];
      const addrs = (await client!.readContract({ address: V2_STAKING_FACTORY, abi: V2FactoryViewABI, functionName: 'getPoolAddresses', args: [BigInt(0), n] })) as Addr[];
      const res = await client!.multicall({
        allowFailure: true,
        contracts: addrs.flatMap((p) => [
          { address: V2_STAKING_FACTORY, abi: V2FactoryViewABI, functionName: 'isPool', args: [p] },
          { address: V2_STAKING_FACTORY, abi: V2FactoryViewABI, functionName: 'getPoolInfo', args: [p] },
        ]) as any,
      });
      const now = Math.floor(Date.now() / 1000);
      const cands = addrs.map((p, i) => ({ p, isPool: ok<boolean>(res[i * 2]), info: ok<any>(res[i * 2 + 1]) }))
        .filter((x) => x.isPool && x.info && String(x.info.stakeToken).toLowerCase() === t && Number(x.info.endTime) > now);
      if (!cands.length) return [];
      const funded = await client!.multicall({
        allowFailure: true,
        contracts: cands.map((c) => ({ address: c.p, abi: V2PoolViewABI, functionName: 'funded' })) as any,
      });
      let apr = new Map<string, string>();
      try {
        const r = await fetch(`/api/stake/pools?token=${t}`);
        if (r.ok) {
          const j = (await r.json()) as PoolsResponse;
          apr = new Map(j.pools.filter((p) => p.aprKind === 'value' && p.apr != null).map((p) => [p.address.toLowerCase(), fmtApr(p)]));
        }
      } catch (e) {
        console.error('vesting: pool APR lookup failed', e);
      }
      return cands.filter((_, i) => ok<boolean>(funded[i]) === true).map((c) => ({
        address: c.p, name: String(c.info.name || 'Staking pool'), endTime: Number(c.info.endTime), aprLabel: apr.get(c.p.toLowerCase()) ?? null,
      })).sort((a, b) => b.endTime - a.endTime);
    },
  });
}

// ---------- vault summaries (card + index) ----------
export interface VaultRow {
  address: Addr; token: Addr; symbol: string; decimals: number; beneficiary: Addr;
  locked: bigint; cliffEnd: number; endTime: number; isStaked: boolean; meetsBadge: boolean;
}

async function readVaultRows(client: PublicClient, factory: Addr, vaults: Addr[]): Promise<VaultRow[]> {
  if (!vaults.length) return [];
  const fns = ['token', 'beneficiary', 'lockedAmount', 'cliffEnd', 'endTime', 'isStaked'] as const;
  const res = await client.multicall({
    allowFailure: true,
    contracts: vaults.flatMap((v) => [
      ...fns.map((functionName) => ({ address: v, abi: VESTING_VAULT_ABI, functionName })),
      { address: factory, abi: VESTING_FACTORY_ABI, functionName: 'vaultMeetsBadgeMinimum', args: [v] },
    ]) as any,
  });
  const k = fns.length + 1;
  const rows = vaults.map((v, i) => {
    const r = res.slice(i * k, i * k + k);
    return {
      address: v, token: (ok<Addr>(r[0]) ?? '0x') as Addr, symbol: '', decimals: 18, beneficiary: (ok<Addr>(r[1]) ?? '0x') as Addr,
      locked: ok<bigint>(r[2]) ?? BigInt(0), cliffEnd: Number(ok<bigint>(r[3]) ?? 0), endTime: Number(ok<bigint>(r[4]) ?? 0),
      isStaked: !!ok<boolean>(r[5]), meetsBadge: !!ok<boolean>(r[6]),
    };
  });
  const tokens = Array.from(new Set(rows.map((r) => r.token.toLowerCase()).filter((t) => isAddr(t)))) as Addr[];
  const meta = await client.multicall({
    allowFailure: true,
    contracts: tokens.flatMap((t) => [{ address: t, abi: Erc20VestABI, functionName: 'symbol' }, { address: t, abi: Erc20VestABI, functionName: 'decimals' }]) as any,
  });
  const m = new Map(tokens.map((t, i) => [t, { symbol: ok<string>(meta[i * 2]) ?? '', decimals: Number(ok<number>(meta[i * 2 + 1]) ?? 18) }]));
  return rows.map((r) => ({ ...r, ...(m.get(r.token.toLowerCase() as Addr) ?? {}) }));
}

export function useVaultsByToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = vestingFactory();
  return useQuery({
    queryKey: ['vesting', 'by-token', token?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(token),
    staleTime: 60_000,
    queryFn: async () => {
      const t = token as Addr;
      const [vaults, total] = await Promise.all([
        client!.readContract({ address: factory!, abi: VESTING_FACTORY_ABI, functionName: 'vaultsByToken', args: [t] }),
        client!.readContract({ address: factory!, abi: VESTING_FACTORY_ABI, functionName: 'totalLockedForToken', args: [t] }),
      ]);
      return { rows: await readVaultRows(client as PublicClient, factory!, [...vaults] as Addr[]), total };
    },
  });
}

export function useVaultsByBeneficiary(user?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = vestingFactory();
  return useQuery({
    queryKey: ['vesting', 'by-beneficiary', user?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(user),
    staleTime: 30_000,
    queryFn: async () => {
      const vaults = await client!.readContract({ address: factory!, abi: VESTING_FACTORY_ABI, functionName: 'vaultsByBeneficiary', args: [user as Addr] });
      return readVaultRows(client as PublicClient, factory!, [...vaults] as Addr[]);
    },
  });
}

// ---------- single vault ----------
export interface VaultDetail {
  address: Addr; token: Addr; symbol: string; name: string; decimals: number;
  beneficiary: Addr; pendingBeneficiary: Addr; start: number; cliffDuration: number; duration: number; cliffEnd: number; endTime: number;
  totalAllocation: bigint; vestedAmount: bigint; lockedAmount: bigint; releasable: bigint; released: bigint; stakedAmount: bigint;
  idleAmount: bigint; holdings: bigint; pool: Addr; isStaked: boolean; pendingRewards: bigint; meetsBadgeMinimum: boolean;
  totalRewardsForwarded: bigint; poolName: string | null; poolEnd: number | null;
}

const VAULT_FIELDS = [
  'token', 'beneficiary', 'pendingBeneficiary', 'start', 'cliffDuration', 'duration', 'cliffEnd', 'endTime', 'totalAllocation',
  'vestedAmount', 'lockedAmount', 'releasable', 'released', 'stakedAmount', 'idleAmount', 'holdings', 'pool', 'isStaked',
  'pendingRewards', 'meetsBadgeMinimum', 'totalRewardsForwarded',
] as const;

/** null = not a vault from the factory. */
export function useVault(vault?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = vestingFactory();
  return useQuery({
    queryKey: ['vesting', 'vault', vault?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(vault),
    refetchInterval: 20_000,
    queryFn: async (): Promise<VaultDetail | null> => {
      const v = vault as Addr;
      const isVault = await client!.readContract({ address: factory!, abi: VESTING_FACTORY_ABI, functionName: 'isVault', args: [v] });
      if (!isVault) return null;
      const res = await client!.multicall({ allowFailure: true, contracts: VAULT_FIELDS.map((functionName) => ({ address: v, abi: VESTING_VAULT_ABI, functionName })) as any });
      const d: Record<string, any> = {};
      VAULT_FIELDS.forEach((f, i) => { d[f] = ok(res[i]); });
      const token = d.token as Addr;
      const pool = (d.pool ?? '0x0000000000000000000000000000000000000000') as Addr;
      const extra = await client!.multicall({
        allowFailure: true,
        contracts: [
          { address: token, abi: Erc20VestABI, functionName: 'symbol' },
          { address: token, abi: Erc20VestABI, functionName: 'name' },
          { address: token, abi: Erc20VestABI, functionName: 'decimals' },
          ...(isZero(pool) ? [] : [{ address: pool, abi: V2PoolViewABI, functionName: 'name' }, { address: pool, abi: V2PoolViewABI, functionName: 'endTime' }]),
        ] as any,
      });
      const big = (x: any) => (typeof x === 'bigint' ? x : BigInt(0));
      return {
        address: v, token, symbol: ok<string>(extra[0]) ?? '', name: ok<string>(extra[1]) ?? '', decimals: Number(ok<number>(extra[2]) ?? 18),
        beneficiary: d.beneficiary, pendingBeneficiary: d.pendingBeneficiary ?? '0x0000000000000000000000000000000000000000',
        start: Number(d.start ?? 0), cliffDuration: Number(d.cliffDuration ?? 0), duration: Number(d.duration ?? 0),
        cliffEnd: Number(d.cliffEnd ?? 0), endTime: Number(d.endTime ?? 0),
        totalAllocation: big(d.totalAllocation), vestedAmount: big(d.vestedAmount), lockedAmount: big(d.lockedAmount), releasable: big(d.releasable),
        released: big(d.released), stakedAmount: big(d.stakedAmount), idleAmount: big(d.idleAmount), holdings: big(d.holdings), pool,
        isStaked: !!d.isStaked, pendingRewards: big(d.pendingRewards), meetsBadgeMinimum: !!d.meetsBadgeMinimum, totalRewardsForwarded: big(d.totalRewardsForwarded),
        poolName: isZero(pool) ? null : ok<string>(extra[3]) ?? null,
        poolEnd: isZero(pool) ? null : extra[4] && ok<bigint>(extra[4]) != null ? Number(ok<bigint>(extra[4])) : null,
      };
    },
  });
}

// ---------- transactions ----------
const ERRORS: Record<string, string> = {
  InvalidParams: 'Invalid vault parameters. Check the amount, beneficiary, start and schedule.',
  TokenNotLaunched: 'Only tokens launched on Polypad can be locked here.',
  NotVault: 'This address is not a vault from the vesting factory.',
  InvalidBeneficiary: 'Invalid beneficiary address.',
  InvalidPool: 'That pool cannot be used for this token.',
  InvalidSchedule: 'The schedule can only be extended, and the cliff cannot exceed the duration.',
  NotBeneficiary: 'Only the beneficiary can do that.',
  NotPendingBeneficiary: 'Only the pending beneficiary can accept.',
  NothingToRelease: 'Nothing is releasable yet.',
  PoolStillActive: 'The pool has not ended yet.',
  NotFactory: 'Only the factory can do that.',
  AlreadyInitialized: 'This vault is already set up.',
  SafeERC20FailedOperation: 'Token transfer failed. Check your balance and approval.',
  ReentrancyGuardReentrantCall: 'Please try again.',
};

function errorName(e: any): string | undefined {
  let x = e;
  for (let i = 0; i < 6 && x; i++) {
    if (x?.data?.errorName) return x.data.errorName;
    x = x.cause;
  }
  return undefined;
}

/** Sends a vesting tx with gas = max(estimate x 1.5, floor). The connected wallet signs. Returns the receipt or null. */
export function useVestingTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; fn: VestingFn; success?: string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) return null;
    setPending(o.key);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateContractGas({ address: o.address, abi: o.abi as Abi, functionName: o.functionName, args: (o.args ?? []) as any, account: address } as any);
      } catch (e) {
        if (errorName(e)) throw e; // a decoded revert means the call would fail
        console.error(`${o.functionName} gas estimate failed, using floor`, e);
      }
      const gas = gasLimit(estimate, GAS_FLOORS[o.fn]);
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({ address: o.address, abi: o.abi as Abi, functionName: o.functionName, args: (o.args ?? []) as any, chainId: CHAIN, gas } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await qc.invalidateQueries({ queryKey: ['vesting'] });
      return r;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const name = errorName(e);
      const msg = (name && ERRORS[name]) || e?.shortMessage || e?.message || 'Transaction failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg, { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  return { send, pending };
}
