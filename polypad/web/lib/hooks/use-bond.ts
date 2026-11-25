'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { type Abi, type PublicClient, type TransactionReceipt } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { BOND_ABI, BOND_FACTORY_ABI } from '@/lib/bondArtifacts';
import {
  Erc20BondABI, GAS_FLOORS, LaunchCreatorABI, bondFactory, bondMeetsBadge, gasLimit, isAddr, isZero,
  type Addr, type BondFn,
} from '@/lib/bond';

const CHAIN = robinhoodChain.id;
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);
const big = (x: any) => (typeof x === 'bigint' ? x : BigInt(0));

// ---------- token check (create flow) ----------
export interface BondToken {
  address: Addr; isPolypad: boolean; launch: Addr | null; creator: Addr | null;
  name: string; symbol: string; decimals: number; creatorBalance: bigint; minBond: bigint;
}

export function useBondToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = bondFactory();
  return useQuery({
    queryKey: ['bond', 'token', token?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(token),
    refetchInterval: 30_000,
    queryFn: async (): Promise<BondToken> => {
      const t = token as Addr;
      const [launch, minBond] = await Promise.all([
        client!.readContract({ address: factory!, abi: BOND_FACTORY_ABI, functionName: 'launchOf', args: [t] }) as Promise<Addr>,
        client!.readContract({ address: factory!, abi: BOND_FACTORY_ABI, functionName: 'MIN_BOND' }) as Promise<bigint>,
      ]);
      if (isZero(launch)) return { address: t, isPolypad: false, launch: null, creator: null, name: '', symbol: '', decimals: 18, creatorBalance: BigInt(0), minBond };
      const creator = (await client!.readContract({ address: launch, abi: LaunchCreatorABI, functionName: 'creator' })) as Addr;
      const res = await client!.multicall({
        allowFailure: true,
        contracts: [
          { address: t, abi: Erc20BondABI, functionName: 'name' },
          { address: t, abi: Erc20BondABI, functionName: 'symbol' },
          { address: t, abi: Erc20BondABI, functionName: 'decimals' },
          { address: t, abi: Erc20BondABI, functionName: 'balanceOf', args: [creator] },
        ] as any,
      });
      return {
        address: t, isPolypad: true, launch, creator,
        name: ok<string>(res[0]) ?? '', symbol: ok<string>(res[1]) ?? '', decimals: Number(ok<number>(res[2]) ?? 18),
        creatorBalance: big(ok(res[3])), minBond,
      };
    },
  });
}

/** Token balances for a list of wallets (same order). */
export function useWalletBalances(token?: string | null, wallets: string[] = []) {
  const client = usePublicClient({ chainId: CHAIN });
  const valid = wallets.filter((w) => isAddr(w)) as Addr[];
  return useQuery({
    queryKey: ['bond', 'balances', token?.toLowerCase(), valid.map((w) => w.toLowerCase()).join(',')],
    enabled: !!client && isAddr(token) && valid.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await client!.multicall({
        allowFailure: true,
        contracts: valid.map((w) => ({ address: token as Addr, abi: Erc20BondABI, functionName: 'balanceOf', args: [w] })) as any,
      });
      return new Map(valid.map((w, i) => [w.toLowerCase(), ok<bigint>(res[i])]));
    },
  });
}

// ---------- bonds for a token (card) ----------
export interface BondRow {
  address: Addr; status: number; bondAmount: bigint; floor: bigint; aggregate: bigint; endTime: number; duration: number; meetsBadge: boolean;
}

export async function readBondRows(client: PublicClient, bonds: Addr[]): Promise<BondRow[]> {
  if (!bonds.length) return [];
  const fns = ['status', 'bondAmount', 'floor', 'aggregateBalance', 'endTime', 'duration'] as const;
  const res = await client.multicall({
    allowFailure: true,
    contracts: bonds.flatMap((b) => fns.map((functionName) => ({ address: b, abi: BOND_ABI, functionName }))) as any,
  });
  return bonds.map((b, i) => {
    const r = res.slice(i * fns.length, (i + 1) * fns.length);
    const status = Number(ok<number>(r[0]) ?? -1);
    const bondAmount = big(ok(r[1]));
    const duration = Number(ok<bigint>(r[5]) ?? 0);
    return {
      address: b, status, bondAmount, floor: big(ok(r[2])), aggregate: big(ok(r[3])), endTime: Number(ok<bigint>(r[4]) ?? 0), duration,
      meetsBadge: bondMeetsBadge(status, bondAmount, duration),
    };
  });
}

export function useBondsByToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = bondFactory();
  return useQuery({
    queryKey: ['bond', 'by-token', token?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(token),
    staleTime: 60_000,
    queryFn: async () => {
      const bonds = await client!.readContract({ address: factory!, abi: BOND_FACTORY_ABI, functionName: 'bondsByToken', args: [token as Addr] });
      return readBondRows(client as PublicClient, [...(bonds as readonly Addr[])].reverse());
    },
  });
}

// ---------- single bond ----------
export interface BondWallet { address: Addr; balance: bigint | undefined; confirmed: boolean }
export interface BondDetail {
  address: Addr; token: Addr; creator: Addr; symbol: string; name: string; decimals: number;
  status: number; bondAmount: bigint; pot: bigint; committed: bigint; allowanceBps: number; floor: bigint; aggregate: bigint;
  startTime: number; endTime: number; duration: number; pendingConfirmations: number; supplyAtSlash: bigint;
  totalPaid: bigint; totalBurned: bigint; canSlash: boolean; isBelowFloor: boolean; wallets: BondWallet[];
  userRegistered: boolean; userConfirmed: boolean; userBalance: bigint; userAllowance: bigint;
}

const BOND_FIELDS = [
  'token', 'creator', 'status', 'bondAmount', 'pot', 'committed', 'allowanceBps', 'floor', 'aggregateBalance', 'startTime', 'endTime',
  'duration', 'pendingConfirmations', 'supplyAtSlash', 'totalPaid', 'totalBurned', 'canSlash', 'isBelowFloor', 'wallets',
] as const;

/** null = not a bond from the factory. */
export function useBond(bond?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  const factory = bondFactory();
  return useQuery({
    queryKey: ['bond', 'detail', bond?.toLowerCase(), user],
    enabled: !!client && !!factory && isAddr(bond),
    refetchInterval: 20_000,
    queryFn: async (): Promise<BondDetail | null> => {
      const b = bond as Addr;
      const isBond = await client!.readContract({ address: factory!, abi: BOND_FACTORY_ABI, functionName: 'isBond', args: [b] });
      if (!isBond) return null;
      const res = await client!.multicall({ allowFailure: true, contracts: BOND_FIELDS.map((functionName) => ({ address: b, abi: BOND_ABI, functionName })) as any });
      const d: Record<string, any> = {};
      BOND_FIELDS.forEach((f, i) => { d[f] = ok(res[i]); });
      const token = d.token as Addr;
      const wallets = [...((d.wallets ?? []) as Addr[])];
      const extra = await client!.multicall({
        allowFailure: true,
        contracts: [
          { address: token, abi: Erc20BondABI, functionName: 'symbol' },
          { address: token, abi: Erc20BondABI, functionName: 'name' },
          { address: token, abi: Erc20BondABI, functionName: 'decimals' },
          ...wallets.flatMap((w) => [
            { address: token, abi: Erc20BondABI, functionName: 'balanceOf', args: [w] },
            { address: b, abi: BOND_ABI, functionName: 'isConfirmed', args: [w] },
          ]),
          ...(user ? [
            { address: b, abi: BOND_ABI, functionName: 'isRegistered', args: [user] },
            { address: b, abi: BOND_ABI, functionName: 'isConfirmed', args: [user] },
            { address: token, abi: Erc20BondABI, functionName: 'balanceOf', args: [user] },
            { address: token, abi: Erc20BondABI, functionName: 'allowance', args: [user, b] },
          ] : []),
        ] as any,
      });
      const u = 3 + wallets.length * 2;
      return {
        address: b, token, creator: d.creator, symbol: ok<string>(extra[0]) ?? '', name: ok<string>(extra[1]) ?? '', decimals: Number(ok<number>(extra[2]) ?? 18),
        status: Number(d.status ?? -1), bondAmount: big(d.bondAmount), pot: big(d.pot), committed: big(d.committed), allowanceBps: Number(d.allowanceBps ?? 0),
        floor: big(d.floor), aggregate: big(d.aggregateBalance), startTime: Number(d.startTime ?? 0), endTime: Number(d.endTime ?? 0),
        duration: Number(d.duration ?? 0), pendingConfirmations: Number(d.pendingConfirmations ?? 0), supplyAtSlash: big(d.supplyAtSlash),
        totalPaid: big(d.totalPaid), totalBurned: big(d.totalBurned), canSlash: d.canSlash === true, isBelowFloor: d.isBelowFloor === true,
        wallets: wallets.map((w, i) => ({ address: w, balance: ok<bigint>(extra[3 + i * 2]), confirmed: ok<boolean>(extra[4 + i * 2]) === true })),
        userRegistered: !!user && ok<boolean>(extra[u]) === true, userConfirmed: !!user && ok<boolean>(extra[u + 1]) === true,
        userBalance: user ? big(ok(extra[u + 2])) : BigInt(0), userAllowance: user ? big(ok(extra[u + 3])) : BigInt(0),
      };
    },
  });
}

export function useRedeemQuote(bond?: string | null, amount?: bigint | null) {
  const client = usePublicClient({ chainId: CHAIN });
  return useQuery({
    queryKey: ['bond', 'quote', bond?.toLowerCase(), amount?.toString()],
    enabled: !!client && isAddr(bond) && !!amount && amount > BigInt(0),
    queryFn: async () => (await client!.readContract({ address: bond as Addr, abi: BOND_ABI, functionName: 'quoteRedeem', args: [amount!] })) as bigint,
  });
}

// ---------- transactions ----------
const ERRORS: Record<string, string> = {
  BadAllowance: 'Allowance must be between 0% and 20%.',
  BadDuration: 'Duration must be 7 to 730 days.',
  BadWallets: 'Check the registered wallets: up to 10, no duplicates, creator included, no token or launch address.',
  BondTooSmall: 'The bond is below the minimum.',
  InsufficientBalance: "The registered wallets' total is below the committed amount.",
  NotCreator: "Only this token's launch creator can post a bond.",
  NotPolydashToken: 'Only tokens launched on Polypad can be bonded.',
  ZeroAddress: 'An address is missing.',
  ZeroCommitted: 'Enter a committed amount.',
  AlreadyConfirmed: 'This wallet has already confirmed.',
  BadStatus: 'That action is not available in the current bond status.',
  BelowFloor: 'The registered wallets are below the floor, so the bond cannot be refunded.',
  Ended: 'The bond has ended.',
  NotEnded: 'The bond has not ended yet.',
  NotRegistered: 'This wallet is not registered on the bond.',
  NotRugged: 'The registered wallets are not below the floor.',
  OnlyCreator: 'Only the creator can do that.',
  RegisteredCannotRedeem: 'Registered wallets cannot redeem.',
  TransferFailed: 'ETH transfer failed.',
  ZeroAmount: 'Enter an amount.',
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

/** Sends a bond tx with gas = max(estimate x 1.5, floor). The connected wallet signs. Returns the receipt or null. */
export function useBondTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint; fn: BondFn; success?: string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) return null;
    setPending(o.key);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      const base = { address: o.address, abi: o.abi as Abi, functionName: o.functionName, args: (o.args ?? []) as any, ...(o.value ? { value: o.value } : {}) };
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateContractGas({ ...base, account: address } as any);
      } catch (e) {
        if (errorName(e)) throw e; // a decoded revert means the call would fail
        console.error(`${o.functionName} gas estimate failed, using floor`, e);
      }
      const gas = gasLimit(estimate, GAS_FLOORS[o.fn]);
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({ ...base, chainId: CHAIN, gas } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await qc.invalidateQueries({ queryKey: ['bond'] });
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
