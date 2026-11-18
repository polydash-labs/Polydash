'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { type Abi, type PublicClient, type TransactionReceipt } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { NFT_FACTORY_DEPLOY_BLOCK } from '@/lib/contracts/nft-abis';
import { GATED_COLLECTION_ABI, GATED_FACTORY_ABI } from '@/lib/gatedArtifacts';
import { useLaunches } from '@/lib/hooks/use-launches';
import {
  Erc20GateABI, Erc721GateABI, LaunchCreatorABI, gatedFactory, gatedGas, isAddr, isPolydashToken, isZero, sameAddr,
  type Addr,
} from '@/lib/gatedMint';

const CHAIN = robinhoodChain.id;
const FACTORY_ABI = GATED_FACTORY_ABI as unknown as Abi;
const COLLECTION_ABI = GATED_COLLECTION_ABI as unknown as Abi;
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);
const big = (x: any) => (typeof x === 'bigint' ? x : BigInt(0));
const num = (x: any) => (typeof x === 'bigint' || typeof x === 'number' ? Number(x) : 0);

// ---------- launch creator check ----------
export interface GateToken {
  address: Addr; launch: Addr | null; creator: Addr | null; isCreator: boolean;
  name: string; symbol: string; decimals: number;
}

async function readGateToken(client: PublicClient, factory: Addr, token: Addr, user?: string): Promise<GateToken> {
  const launch = (await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'launchOf', args: [token] })) as Addr;
  if (isZero(launch)) return { address: token, launch: null, creator: null, isCreator: false, name: '', symbol: '', decimals: 18 };
  const res = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: launch, abi: LaunchCreatorABI, functionName: 'creator' },
      { address: token, abi: Erc20GateABI, functionName: 'name' },
      { address: token, abi: Erc20GateABI, functionName: 'symbol' },
      { address: token, abi: Erc20GateABI, functionName: 'decimals' },
    ] as any,
  });
  const creator = ok<Addr>(res[0]) ?? null;
  return {
    address: token, launch, creator, isCreator: sameAddr(creator, user),
    name: ok<string>(res[1]) ?? '', symbol: ok<string>(res[2]) ?? '', decimals: Number(ok<number>(res[3]) ?? 18),
  };
}

/** One token: factory.launchOf(token) then launch.creator() vs the connected wallet. */
export function useGateToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  const factory = gatedFactory();
  const t = isAddr(token) && !isPolydashToken(token) ? (token as Addr) : null;
  return useQuery({
    queryKey: ['gated', 'token', t?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!factory && !!t,
    staleTime: 30_000,
    queryFn: () => readGateToken(client as PublicClient, factory!, t!, user),
  });
}

/** Polypad tokens whose launch creator is the connected wallet, confirmed on-chain. POLYDASH is never listed. */
export function useCreatorTokens() {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  const factory = gatedFactory();
  const { data: launches, isLoading: launchesLoading } = useLaunches();
  const candidates = useMemo(
    () => (launches ?? []).filter((l) => sameAddr(l.creator, user) && !isPolydashToken(l.tokenAddress)).map((l) => l.tokenAddress as Addr),
    [launches, user],
  );
  const q = useQuery({
    queryKey: ['gated', 'creator-tokens', user?.toLowerCase(), candidates.join(',').toLowerCase()],
    enabled: !!client && !!factory && !!user && !!launches,
    staleTime: 60_000,
    queryFn: async (): Promise<GateToken[]> => {
      const out: GateToken[] = [];
      for (const t of candidates) {
        try {
          const g = await readGateToken(client as PublicClient, factory!, t, user);
          if (g.isCreator) out.push(g);
        } catch (e) {
          console.error('holder mint: creator check failed for', t, e);
        }
      }
      return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
    },
  });
  return { ...q, isLoading: q.isLoading || launchesLoading };
}

// ---------- collection summaries (lists, token card) ----------
export interface GatedSummary {
  address: Addr; name: string; symbol: string; imageUri: string; phase: number; gated: boolean;
  holderPrice: bigint; publicPrice: bigint; totalMinted: bigint; maxSupply: bigint; floorPerToken: bigint;
}

const SUMMARY_FIELDS = ['name', 'symbol', 'imageUri', 'phase', 'gated', 'holderPrice', 'publicPrice', 'totalMinted', 'maxSupply', 'floorPerToken'] as const;

export async function readGatedSummaries(client: PublicClient, addrs: Addr[]): Promise<GatedSummary[]> {
  if (!addrs.length) return [];
  const k = SUMMARY_FIELDS.length;
  const res = await client.multicall({
    allowFailure: true,
    contracts: addrs.flatMap((a) => SUMMARY_FIELDS.map((functionName) => ({ address: a, abi: COLLECTION_ABI, functionName }))) as any,
  });
  return addrs.map((a, i) => {
    const r = res.slice(i * k, i * k + k);
    return {
      address: a, name: ok<string>(r[0]) ?? 'Holder mint', symbol: ok<string>(r[1]) ?? '', imageUri: ok<string>(r[2]) ?? '',
      phase: num(ok(r[3])), gated: ok<boolean>(r[4]) ?? true, holderPrice: big(ok(r[5])), publicPrice: big(ok(r[6])),
      totalMinted: big(ok(r[7])), maxSupply: big(ok(r[8])), floorPerToken: big(ok(r[9])),
    };
  });
}

export function useGatedCollectionsOfToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = gatedFactory();
  return useQuery({
    queryKey: ['gated', 'of-token', token?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(token),
    staleTime: 30_000,
    queryFn: async () => {
      const list = (await client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'collectionsOfToken', args: [token as Addr] })) as readonly Addr[];
      return readGatedSummaries(client as PublicClient, [...list].reverse());
    },
  });
}

export function useAllGatedCollections() {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = gatedFactory();
  return useQuery({
    queryKey: ['gated', 'all'],
    enabled: !!client && !!factory,
    refetchInterval: 30_000,
    queryFn: async () => {
      const n = Number(await client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'allCollectionsLength' }));
      if (!n) return [];
      const res = await client!.multicall({
        allowFailure: true,
        contracts: Array.from({ length: n }, (_, i) => ({ address: factory!, abi: FACTORY_ABI, functionName: 'allCollections', args: [BigInt(i)] })) as any,
      });
      const addrs = res.map((r) => ok<Addr>(r)).filter((a): a is Addr => isAddr(a)).reverse();
      return readGatedSummaries(client as PublicClient, addrs);
    },
  });
}

// ---------- single collection ----------
export interface GatedDetail extends GatedSummary {
  description: string; gateToken: Addr; tokenSymbol: string; tokenDecimals: number; creator: Addr; payoutWallet: Addr;
  minBalance: bigint; holderStart: number; publicStart: number; holderMaxPerWallet: number; maxPerWallet: number;
  floorReserve: bigint; revealed: boolean; creatorBalance: bigint; platformBalance: bigint | null;
}

const DETAIL_FIELDS = [
  'description', 'gateToken', 'creator', 'payoutWallet', 'minBalance', 'holderStart', 'publicStart', 'holderMaxPerWallet',
  'maxPerWallet', 'floorReserve', 'revealed', 'creatorBalance', 'platformBalance',
] as const;

/** null = not a collection from the gated factory. */
export function useGatedCollection(collection?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = gatedFactory();
  return useQuery({
    queryKey: ['gated', 'detail', collection?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(collection),
    refetchInterval: 15_000,
    queryFn: async (): Promise<GatedDetail | null> => {
      const c = collection as Addr;
      const isCollection = await client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'isCollection', args: [c] });
      if (!isCollection) return null;
      const [[summary], res] = await Promise.all([
        readGatedSummaries(client as PublicClient, [c]),
        client!.multicall({ allowFailure: true, contracts: DETAIL_FIELDS.map((functionName) => ({ address: c, abi: COLLECTION_ABI, functionName })) as any }),
      ]);
      const d: Record<string, any> = {};
      DETAIL_FIELDS.forEach((f, i) => { d[f] = ok(res[i]); });
      const gateToken = (d.gateToken ?? '0x0000000000000000000000000000000000000000') as Addr;
      const meta = isZero(gateToken) ? [] : await client!.multicall({
        allowFailure: true,
        contracts: [
          { address: gateToken, abi: Erc20GateABI, functionName: 'symbol' },
          { address: gateToken, abi: Erc20GateABI, functionName: 'decimals' },
        ] as any,
      });
      return {
        ...summary,
        description: d.description ?? '', gateToken, tokenSymbol: ok<string>(meta[0]) ?? '', tokenDecimals: Number(ok<number>(meta[1]) ?? 18),
        creator: (d.creator ?? '0x0000000000000000000000000000000000000000') as Addr,
        payoutWallet: (d.payoutWallet ?? '0x0000000000000000000000000000000000000000') as Addr,
        minBalance: big(d.minBalance), holderStart: num(d.holderStart), publicStart: num(d.publicStart),
        holderMaxPerWallet: num(d.holderMaxPerWallet), maxPerWallet: num(d.maxPerWallet), floorReserve: big(d.floorReserve),
        revealed: !!d.revealed, creatorBalance: big(d.creatorBalance), platformBalance: typeof d.platformBalance === 'bigint' ? d.platformBalance : null,
      };
    },
  });
}

export interface GatedUser {
  tokenBalance: bigint; isHolder: boolean; holderMinted: number; walletMinted: number; isContract: boolean; tokenIds: bigint[];
}

/** Wallet state in a gated collection. Owned ids come from Transfer logs, confirmed with ownerOf. */
export function useGatedUser(collection?: Addr, gateToken?: Addr) {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  return useQuery({
    queryKey: ['gated', 'user', collection?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!collection && !!user,
    refetchInterval: 15_000,
    queryFn: async (): Promise<GatedUser> => {
      const c = collection!;
      const u = user as Addr;
      const [res, code, logs] = await Promise.all([
        client!.multicall({
          allowFailure: true,
          contracts: [
            { address: c, abi: COLLECTION_ABI, functionName: 'isHolder', args: [u] },
            { address: c, abi: COLLECTION_ABI, functionName: 'holderMinted', args: [u] },
            { address: c, abi: COLLECTION_ABI, functionName: 'walletMinted', args: [u] },
            ...(gateToken && !isZero(gateToken) ? [{ address: gateToken, abi: Erc20GateABI, functionName: 'balanceOf', args: [u] }] : []),
          ] as any,
        }),
        client!.getCode({ address: u }).catch(() => undefined),
        client!.getContractEvents({ address: c, abi: Erc721GateABI, eventName: 'Transfer', args: { to: u }, fromBlock: NFT_FACTORY_DEPLOY_BLOCK, toBlock: 'latest' })
          .catch((e) => { console.error('holder mint: Transfer log read failed', e); return []; }),
      ]);
      const candidates = Array.from(new Set(logs.map((l) => (l.args as any).tokenId as bigint))).sort((x, y) => (x < y ? -1 : 1));
      let tokenIds: bigint[] = [];
      if (candidates.length) {
        const owners = await client!.multicall({
          allowFailure: true,
          contracts: candidates.map((id) => ({ address: c, abi: Erc721GateABI, functionName: 'ownerOf', args: [id] })) as any,
        });
        tokenIds = candidates.filter((_, i) => sameAddr(ok<string>(owners[i]), u));
      }
      return {
        isHolder: !!ok<boolean>(res[0]), holderMinted: num(ok(res[1])), walletMinted: num(ok(res[2])), tokenBalance: big(ok(res[3])),
        isContract: !!code && code !== '0x', tokenIds,
      };
    },
  });
}

// ---------- transactions ----------
const ERRORS: Record<string, string> = {
  InvalidParam: 'One of the collection settings is outside the allowed range. Check the fields above.',
  NotTokenCreator: 'Only the launch creator of this token can create a holder mint for it.',
  NotPolydashToken: 'This token was not launched through the Polypad factory.',
  ZeroAddress: 'An address field is empty.',
  NotCreator: 'Only the collection creator can do that.',
  NotHolder: 'This wallet does not hold the minimum token balance right now.',
  NotEOA: 'Holder mint must be sent from a regular wallet address (EOA).',
  NotHolderPhase: 'The holder phase is not open right now.',
  NotPublicPhase: 'The public mint is not open right now.',
  BadValue: 'The ETH sent does not match quantity x price.',
  BadQuantity: 'That quantity is not allowed.',
  WalletLimit: 'That quantity is above your per-wallet limit.',
  SoldOut: 'Not enough supply left for that quantity.',
  NotOwner: 'You do not own one of the selected NFTs.',
  Frozen: 'The base URI can only be changed before the first mint.',
  NothingToWithdraw: 'Nothing to withdraw yet.',
  TransferFailed: 'The ETH transfer failed. Please try again.',
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

/** Sends a holder-mint tx with gas = max(estimate x 1.5, 4,000,000). The connected wallet signs. Returns the receipt or null. */
export function useGatedTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: 'factory' | 'collection'; functionName: string; args?: readonly unknown[]; value?: bigint; success?: string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) return null;
    const abi = o.abi === 'factory' ? FACTORY_ABI : COLLECTION_ABI;
    setPending(o.key);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateContractGas({ address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, account: address } as any);
      } catch (e) {
        if (errorName(e)) throw e;
        console.error(`${o.functionName} gas estimate failed, using floor`, e);
      }
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({
        address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, chainId: CHAIN, gas: gatedGas(estimate),
      } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await qc.invalidateQueries({ queryKey: ['gated'] });
      return r;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const name = errorName(e);
      const msg = (name && ERRORS[name]) || (name ? `Transaction would fail: ${name}` : '') || e?.shortMessage || e?.message || 'Transaction failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg, { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  return { send, pending };
}

export { FACTORY_ABI as GATED_FACTORY_ABI_LOOSE };
