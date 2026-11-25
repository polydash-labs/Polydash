'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { type Abi, type PublicClient, type TransactionReceipt } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { NFT_FACTORY_DEPLOY_BLOCK } from '@/lib/contracts/nft-abis';
import { TOKEN_FLOOR_COLLECTION_ABI, TOKEN_FLOOR_FACTORY_ABI } from '@/lib/floorVaultArtifacts';
import { useLaunches } from '@/lib/hooks/use-launches';
import { Erc20GateABI, LaunchCreatorABI } from '@/lib/gatedMint';
import { ERRORS, floorFactory, floorGas, isAddr, isPolydashToken, isZero, sameAddr, type Addr } from '@/lib/floorVault';

const CHAIN = robinhoodChain.id;
const FACTORY_ABI = TOKEN_FLOOR_FACTORY_ABI as unknown as Abi;
const COLLECTION_ABI = TOKEN_FLOOR_COLLECTION_ABI as unknown as Abi;
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);
const big = (x: any) => (typeof x === 'bigint' ? x : BigInt(0));
const num = (x: any) => (typeof x === 'bigint' || typeof x === 'number' ? Number(x) : 0);
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Addr;

// ---------- launch creator check ----------
export interface FloorToken {
  address: Addr; launch: Addr | null; creator: Addr | null; isCreator: boolean; name: string; symbol: string; decimals: number;
}

async function readFloorToken(client: PublicClient, factory: Addr, token: Addr, user?: string): Promise<FloorToken> {
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

/** factory.launchOf(token) != 0 and launch.creator() == connected wallet. POLYDASH is never checked. */
export function useFloorToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  const factory = floorFactory();
  const t = isAddr(token) && !isPolydashToken(token) ? (token as Addr) : null;
  return useQuery({
    queryKey: ['floor', 'token', t?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!factory && !!t,
    staleTime: 30_000,
    queryFn: () => readFloorToken(client as PublicClient, factory!, t!, user),
  });
}

export function useFloorCreatorTokens() {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  const factory = floorFactory();
  const { data: launches, isLoading: launchesLoading } = useLaunches();
  const candidates = useMemo(
    () => (launches ?? []).filter((l) => sameAddr(l.creator, user) && !isPolydashToken(l.tokenAddress)).map((l) => l.tokenAddress as Addr),
    [launches, user],
  );
  const q = useQuery({
    queryKey: ['floor', 'creator-tokens', user?.toLowerCase(), candidates.join(',').toLowerCase()],
    enabled: !!client && !!factory && !!user && !!launches,
    staleTime: 60_000,
    queryFn: async (): Promise<FloorToken[]> => {
      const out: FloorToken[] = [];
      for (const t of candidates) {
        try {
          const g = await readFloorToken(client as PublicClient, factory!, t, user);
          if (g.isCreator) out.push(g);
        } catch (e) {
          console.error('floor vault: creator check failed for', t, e);
        }
      }
      return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
    },
  });
  return { ...q, isLoading: q.isLoading || launchesLoading };
}

// ---------- summaries ----------
export interface FloorSummary {
  address: Addr; name: string; symbol: string; imageUri: string; token: Addr; tokenSymbol: string; tokenDecimals: number;
  totalMinted: bigint; maxSupply: bigint; price: bigint; tokenShareBps: number; ethFloor: bigint; pendingEth: bigint; tokenReserve: bigint;
}

const SUMMARY_FIELDS = ['name', 'symbol', 'imageUri', 'token', 'totalMinted', 'maxSupply', 'price', 'tokenShareBps', 'ethFloor', 'pendingEth', 'tokenReserve'] as const;

export async function readFloorSummaries(client: PublicClient, addrs: Addr[]): Promise<FloorSummary[]> {
  if (!addrs.length) return [];
  const k = SUMMARY_FIELDS.length;
  const res = await client.multicall({
    allowFailure: true,
    contracts: addrs.flatMap((a) => SUMMARY_FIELDS.map((functionName) => ({ address: a, abi: COLLECTION_ABI, functionName }))) as any,
  });
  const tokens = addrs.map((_, i) => (ok<Addr>(res[i * k + 3]) ?? ZERO_ADDR));
  const uniq = Array.from(new Set(tokens.filter((t) => !isZero(t)).map((t) => t.toLowerCase()))) as Addr[];
  const meta = uniq.length ? await client.multicall({
    allowFailure: true,
    contracts: uniq.flatMap((t) => [
      { address: t, abi: Erc20GateABI, functionName: 'symbol' },
      { address: t, abi: Erc20GateABI, functionName: 'decimals' },
    ]) as any,
  }) : [];
  const metaOf = (t: string) => {
    const i = uniq.indexOf(t.toLowerCase() as Addr);
    return i < 0 ? { s: '', d: 18 } : { s: ok<string>(meta[i * 2]) ?? '', d: Number(ok<number>(meta[i * 2 + 1]) ?? 18) };
  };
  return addrs.map((a, i) => {
    const r = res.slice(i * k, i * k + k);
    const m = metaOf(tokens[i]);
    return {
      address: a, name: ok<string>(r[0]) ?? 'Token-backed collection', symbol: ok<string>(r[1]) ?? '', imageUri: ok<string>(r[2]) ?? '',
      token: tokens[i], tokenSymbol: m.s, tokenDecimals: m.d,
      totalMinted: big(ok(r[4])), maxSupply: big(ok(r[5])), price: big(ok(r[6])), tokenShareBps: num(ok(r[7])),
      ethFloor: big(ok(r[8])), pendingEth: big(ok(r[9])), tokenReserve: big(ok(r[10])),
    };
  });
}

export function useFloorCollectionsOfToken(token?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = floorFactory();
  return useQuery({
    queryKey: ['floor', 'of-token', token?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(token),
    staleTime: 30_000,
    queryFn: async () => {
      const list = (await client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'collectionsOfToken', args: [token as Addr] })) as readonly Addr[];
      return readFloorSummaries(client as PublicClient, [...list].reverse());
    },
  });
}

export function useAllFloorCollections() {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = floorFactory();
  return useQuery({
    queryKey: ['floor', 'all'],
    enabled: !!client && !!factory,
    refetchInterval: 30_000,
    queryFn: async () => {
      const n = Number(await client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'collectionsLength' }));
      if (!n) return [];
      const res = await client!.multicall({
        allowFailure: true,
        contracts: Array.from({ length: n }, (_, i) => ({ address: factory!, abi: FACTORY_ABI, functionName: 'allCollections', args: [BigInt(i)] })) as any,
      });
      const addrs = res.map((r) => ok<Addr>(r)).filter((a): a is Addr => isAddr(a)).reverse();
      return readFloorSummaries(client as PublicClient, addrs);
    },
  });
}

// ---------- single collection ----------
export interface FloorDetail extends FloorSummary {
  description: string; creator: Addr; payoutWallet: Addr; launch: Addr; floorBps: number; maxSlippageBps: number; maxBuyEth: bigint;
  maxPerWallet: number; startTime: number; createdAt: number; graduated: boolean; tokenShareActive: boolean;
  obsTime: number; lastBuyTime: number; perNftEth: bigint; perNftToken: bigint; totalEthSwapped: bigint; totalTokensBought: bigint;
  creatorBalance: bigint; platformBalance: bigint;
}

const DETAIL_FIELDS = [
  'description', 'creator', 'payoutWallet', 'launch', 'floorBps', 'maxSlippageBps', 'maxBuyEth', 'maxPerWallet', 'startTime', 'createdAt',
  'graduated', 'tokenShareActive', 'obsTime', 'lastBuyTime', 'redeemValuePerNft', 'totalEthSwapped', 'totalTokensBought', 'creatorBalance', 'platformBalance',
] as const;

/** null = not a collection from the token floor factory. */
export function useFloorCollection(collection?: string | null) {
  const client = usePublicClient({ chainId: CHAIN });
  const factory = floorFactory();
  return useQuery({
    queryKey: ['floor', 'detail', collection?.toLowerCase()],
    enabled: !!client && !!factory && isAddr(collection),
    refetchInterval: 15_000,
    queryFn: async (): Promise<FloorDetail | null> => {
      const c = collection as Addr;
      const isCollection = await client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'isCollection', args: [c] });
      if (!isCollection) return null;
      const [[summary], res] = await Promise.all([
        readFloorSummaries(client as PublicClient, [c]),
        client!.multicall({ allowFailure: true, contracts: DETAIL_FIELDS.map((functionName) => ({ address: c, abi: COLLECTION_ABI, functionName })) as any }),
      ]);
      const d: Record<string, any> = {};
      DETAIL_FIELDS.forEach((f, i) => { d[f] = ok(res[i]); });
      const per = (d.redeemValuePerNft ?? []) as readonly bigint[];
      return {
        ...summary,
        description: d.description ?? '', creator: (d.creator ?? ZERO_ADDR) as Addr, payoutWallet: (d.payoutWallet ?? ZERO_ADDR) as Addr,
        launch: (d.launch ?? ZERO_ADDR) as Addr, floorBps: num(d.floorBps), maxSlippageBps: num(d.maxSlippageBps), maxBuyEth: big(d.maxBuyEth),
        maxPerWallet: num(d.maxPerWallet), startTime: num(d.startTime), createdAt: num(d.createdAt), graduated: !!d.graduated,
        tokenShareActive: !!d.tokenShareActive, obsTime: num(d.obsTime), lastBuyTime: num(d.lastBuyTime),
        perNftEth: big(per[0]), perNftToken: big(per[1]), totalEthSwapped: big(d.totalEthSwapped), totalTokensBought: big(d.totalTokensBought),
        creatorBalance: big(d.creatorBalance), platformBalance: big(d.platformBalance),
      };
    },
  });
}

export interface FloorUser { walletMinted: number; tokenOwed: bigint; tokenIds: bigint[] }

/** Wallet state. Owned ids come from Transfer logs, confirmed with ownerOf (no enumerable function). */
export function useFloorUser(collection?: Addr) {
  const client = usePublicClient({ chainId: CHAIN });
  const { address: user } = useAccount();
  return useQuery({
    queryKey: ['floor', 'user', collection?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!collection && !!user,
    refetchInterval: 15_000,
    queryFn: async (): Promise<FloorUser> => {
      const c = collection!;
      const u = user as Addr;
      const [res, logs] = await Promise.all([
        client!.multicall({
          allowFailure: true,
          contracts: [
            { address: c, abi: COLLECTION_ABI, functionName: 'walletMinted', args: [u] },
            { address: c, abi: COLLECTION_ABI, functionName: 'tokenOwed', args: [u] },
          ] as any,
        }),
        client!.getContractEvents({ address: c, abi: COLLECTION_ABI, eventName: 'Transfer', args: { to: u }, fromBlock: NFT_FACTORY_DEPLOY_BLOCK, toBlock: 'latest' })
          .catch((e) => { console.error('floor vault: Transfer log read failed', e); return []; }),
      ]);
      const candidates = Array.from(new Set(logs.map((l) => (l as any).args?.tokenId as bigint).filter((x) => typeof x === 'bigint'))).sort((x, y) => (x < y ? -1 : 1));
      let tokenIds: bigint[] = [];
      if (candidates.length) {
        const owners = await client!.multicall({
          allowFailure: true,
          contracts: candidates.map((id) => ({ address: c, abi: COLLECTION_ABI, functionName: 'ownerOf', args: [id] })) as any,
        });
        tokenIds = candidates.filter((_, i) => sameAddr(ok<string>(owners[i]), u));
      }
      return { walletMinted: num(ok(res[0])), tokenOwed: big(ok(res[1])), tokenIds };
    },
  });
}

// ---------- transactions ----------
export function floorErrorName(e: any): string | undefined {
  let x = e;
  for (let i = 0; i < 6 && x; i++) {
    if (x?.data?.errorName) return x.data.errorName;
    x = x.cause;
  }
  return undefined;
}

export const floorErrorText = (e: any) => {
  const name = floorErrorName(e);
  return (name && ERRORS[name]) || (name ? `Transaction would fail: ${name}` : '') || e?.shortMessage || e?.message || 'Transaction failed';
};

/** Sends a floor vault tx with gas = max(estimate x 1.5, 4,000,000). The connected wallet signs. Returns the receipt or null. */
export function useFloorTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [lastError, setLastError] = useState<{ key: string; text: string } | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: 'factory' | 'collection'; functionName: string; args?: readonly unknown[]; value?: bigint; success?: string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) return null;
    const abi = o.abi === 'factory' ? FACTORY_ABI : COLLECTION_ABI;
    setPending(o.key);
    setLastError(null);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateContractGas({ address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, account: address } as any);
      } catch (e) {
        if (floorErrorName(e)) throw e;
        console.error(`${o.functionName} gas estimate failed, using floor`, e);
      }
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({
        address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, chainId: CHAIN, gas: floorGas(estimate),
      } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await qc.invalidateQueries({ queryKey: ['floor'] });
      return r;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const msg = floorErrorText(e);
      const text = /User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg;
      setLastError({ key: o.key, text });
      toast.error(text, { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  return { send, pending, lastError };
}
