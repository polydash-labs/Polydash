'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { type Abi, type PublicClient, type TransactionReceipt } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { NftStakingFactoryABI } from '@/lib/contracts/nft-staking-factory-abi';
import { NftStakingPoolABI } from '@/lib/contracts/nft-staking-pool-abi';
import { NFT_FACTORY_DEPLOY_BLOCK } from '@/lib/contracts/nft-abis';
import {
  CURVE_NFT_FACTORY, ERC721_INTERFACE_ID, Erc20MiniABI, Erc721ReadABI, FIXED_NFT_FACTORY, IsCollectionABI,
  NFT_STAKING_FACTORY_ADDRESS, NFT_STAKING_FROM_BLOCK, fetchTokenImage, gasFloor, gasLimit, isAddr,
  type Addr, type StakingFn,
} from '@/lib/nftStaking';

const CHAIN = robinhoodChain.id;
const FACTORY = NFT_STAKING_FACTORY_ADDRESS as Addr | null;
const ok = (r: any) => (r?.status === 'success' ? r.result : undefined);

export interface StakingPool {
  address: Addr;
  collection: Addr;
  rewardToken: Addr;
  creator: Addr;
  start: number;
  end: number;
  totalStaked: bigint;
  totalFunded: bigint;
  totalWeight: bigint;
  rewardRate: bigint;
  pendingUnallocated: bigint;
  setMin: number;
  setBonusBps: number;
  tierAfter: number[];
  tierBps: number[];
  collectionName: string;
  collectionSymbol: string;
  polypad: boolean;
  rewardSymbol: string;
  rewardDecimals: number;
}

const POOL_FIELDS = ['collection', 'rewardToken', 'creator', 'startTime', 'endTime', 'totalStaked', 'totalFunded', 'totalWeight', 'rewardRate', 'pendingUnallocated', 'setMin', 'setBonusBps', 'tiers'] as const;

/** Polypad = registered on the fixed-price or curve NFT factory. */
async function polypadFlags(client: PublicClient, cols: Addr[]): Promise<Map<string, boolean>> {
  const res = await client.multicall({
    contracts: cols.flatMap((c) => [
      { address: FIXED_NFT_FACTORY, abi: IsCollectionABI, functionName: 'isCollection', args: [c] },
      { address: CURVE_NFT_FACTORY, abi: IsCollectionABI, functionName: 'isCollection', args: [c] },
    ]) as any,
    allowFailure: true,
  });
  return new Map(cols.map((c, i) => [c.toLowerCase(), ok(res[i * 2]) === true || ok(res[i * 2 + 1]) === true]));
}

async function fetchPools(client: PublicClient, addrs: Addr[]): Promise<StakingPool[]> {
  if (!addrs.length) return [];
  const res = await client.multicall({
    contracts: addrs.flatMap((a) => POOL_FIELDS.map((f) => ({ address: a, abi: NftStakingPoolABI, functionName: f }))) as any,
    allowFailure: true,
  });
  const raw = addrs.map((address, i) => {
    const g = (f: (typeof POOL_FIELDS)[number]) => ok(res[i * POOL_FIELDS.length + POOL_FIELDS.indexOf(f)]);
    const tiers = g('tiers') as readonly [readonly number[], readonly number[]] | undefined;
    return {
      address,
      collection: (g('collection') ?? '0x0000000000000000000000000000000000000000') as Addr,
      rewardToken: (g('rewardToken') ?? '0x0000000000000000000000000000000000000000') as Addr,
      creator: (g('creator') ?? '0x0000000000000000000000000000000000000000') as Addr,
      start: Number(g('startTime') ?? 0),
      end: Number(g('endTime') ?? 0),
      totalStaked: (g('totalStaked') ?? BigInt(0)) as bigint,
      totalFunded: (g('totalFunded') ?? BigInt(0)) as bigint,
      totalWeight: (g('totalWeight') ?? BigInt(0)) as bigint,
      rewardRate: (g('rewardRate') ?? BigInt(0)) as bigint,
      pendingUnallocated: (g('pendingUnallocated') ?? BigInt(0)) as bigint,
      setMin: Number(g('setMin') ?? 0),
      setBonusBps: Number(g('setBonusBps') ?? 0),
      tierAfter: tiers ? tiers[0].map(Number) : [0],
      tierBps: tiers ? tiers[1].map(Number) : [10_000],
    };
  });
  const cols = Array.from(new Set(raw.map((p) => p.collection.toLowerCase()))) as Addr[];
  const toks = Array.from(new Set(raw.map((p) => p.rewardToken.toLowerCase()))) as Addr[];
  const [meta, flags] = await Promise.all([
    client.multicall({
      contracts: [
        ...cols.flatMap((c) => [
          { address: c, abi: Erc721ReadABI, functionName: 'name' },
          { address: c, abi: Erc721ReadABI, functionName: 'symbol' },
        ]),
        ...toks.flatMap((t) => [
          { address: t, abi: Erc20MiniABI, functionName: 'symbol' },
          { address: t, abi: Erc20MiniABI, functionName: 'decimals' },
        ]),
      ] as any,
      allowFailure: true,
    }),
    polypadFlags(client, cols),
  ]);
  const colMeta = new Map(cols.map((c, i) => [c, { name: (ok(meta[i * 2]) as string) || 'Unnamed collection', symbol: (ok(meta[i * 2 + 1]) as string) || '' }]));
  const off = cols.length * 2;
  const tokMeta = new Map(toks.map((t, i) => [t, { symbol: (ok(meta[off + i * 2]) as string) || 'TOKEN', decimals: Number(ok(meta[off + i * 2 + 1]) ?? 18) }]));
  return raw.map((p) => {
    const cm = colMeta.get(p.collection.toLowerCase() as Addr)!;
    const tm = tokMeta.get(p.rewardToken.toLowerCase() as Addr)!;
    return {
      ...p,
      collectionName: cm.name,
      collectionSymbol: cm.symbol,
      polypad: flags.get(p.collection.toLowerCase()) ?? false,
      rewardSymbol: tm.symbol,
      rewardDecimals: tm.decimals,
    };
  });
}

/** All pools (newest first), or only the pools for one collection. */
export function useNftStakingPools(collection?: Addr) {
  const client = usePublicClient({ chainId: CHAIN });
  return useQuery({
    queryKey: ['nft-staking', 'pools', collection?.toLowerCase() ?? 'all'],
    enabled: !!client,
    refetchInterval: 30_000,
    queryFn: async (): Promise<StakingPool[]> => {
      if (!FACTORY) return [];
      let addrs: Addr[];
      if (collection) {
        addrs = [...((await client!.readContract({ address: FACTORY, abi: NftStakingFactoryABI, functionName: 'poolsByCollection', args: [collection] })) as readonly Addr[])];
      } else {
        const len = Number(await client!.readContract({ address: FACTORY, abi: NftStakingFactoryABI, functionName: 'poolsLength' }));
        if (!len) return [];
        const r = await client!.multicall({
          contracts: Array.from({ length: len }, (_, i) => ({ address: FACTORY, abi: NftStakingFactoryABI, functionName: 'allPools', args: [BigInt(i)] })) as any,
          allowFailure: true,
        });
        addrs = r.flatMap((x) => (x.status === 'success' ? [x.result as Addr] : []));
      }
      return (await fetchPools(client!, addrs.reverse()));
    },
  });
}

export function useNftStakingPool(pool?: string) {
  const client = usePublicClient({ chainId: CHAIN });
  const valid = isAddr(pool);
  return useQuery({
    queryKey: ['nft-staking', 'pool', pool?.toLowerCase()],
    enabled: !!client && valid,
    refetchInterval: 20_000,
    queryFn: async (): Promise<StakingPool | null> => {
      if (!FACTORY) return null;
      const isPool = await client!.readContract({ address: FACTORY, abi: NftStakingFactoryABI, functionName: 'isPool', args: [pool as Addr] });
      if (!isPool) return null;
      const [p] = await fetchPools(client!, [pool as Addr]);
      return p ?? null;
    },
  });
}

export interface CollectionCheck {
  isContract: boolean;
  isErc721: boolean;
  allowed: boolean | null;
  polypad: boolean;
  name: string;
  symbol: string;
  image: string | null;
}

/** Validates any address as an ERC-721 collection the factory accepts. */
export function useCollectionCheck(address?: string) {
  const client = usePublicClient({ chainId: CHAIN });
  const valid = isAddr(address);
  return useQuery({
    queryKey: ['nft-staking', 'check', address?.toLowerCase()],
    enabled: !!client && valid,
    staleTime: 60_000,
    queryFn: async (): Promise<CollectionCheck> => {
      const a = address as Addr;
      const code = await client!.getCode({ address: a });
      const empty: CollectionCheck = { isContract: false, isErc721: false, allowed: null, polypad: false, name: '', symbol: '', image: null };
      if (!code || code === '0x') return empty;
      const r = await client!.multicall({
        contracts: [
          { address: a, abi: Erc721ReadABI, functionName: 'supportsInterface', args: [ERC721_INTERFACE_ID] },
          { address: a, abi: Erc721ReadABI, functionName: 'name' },
          { address: a, abi: Erc721ReadABI, functionName: 'symbol' },
          { address: a, abi: Erc721ReadABI, functionName: 'tokenURI', args: [BigInt(1)] },
          { address: a, abi: Erc721ReadABI, functionName: 'tokenURI', args: [BigInt(0)] },
        ] as any,
        allowFailure: true,
      });
      const isErc721 = ok(r[0]) === true;
      let allowed: boolean | null = null;
      if (FACTORY && isErc721) {
        try {
          allowed = (await client!.readContract({ address: FACTORY, abi: NftStakingFactoryABI, functionName: 'isAllowedCollection', args: [a] })) as boolean;
        } catch { allowed = false; }
      }
      const flags = await polypadFlags(client!, [a]);
      const uri = (ok(r[3]) as string) || (ok(r[4]) as string) || '';
      const image = isErc721 && uri ? await fetchTokenImage(uri) : null;
      return { isContract: true, isErc721, allowed, polypad: flags.get(a.toLowerCase()) ?? false, name: (ok(r[1]) as string) || '', symbol: (ok(r[2]) as string) || '', image };
    },
  });
}

export interface StakedNft { id: bigint; tier: number; eligibleTier: number; toNext: number; since: number }
export interface UserPoolState {
  staked: bigint;
  earned: bigint;
  perDay: bigint;
  setBonus: boolean;
  weight: bigint;
  baseWeight: bigint;
  approved: boolean;
  ids: StakedNft[];
  fetchedAt: number;
}

async function stakedIdsOf(client: PublicClient, pool: Addr, user: Addr): Promise<bigint[]> {
  const logs = await client.getContractEvents({ address: pool, abi: NftStakingPoolABI, eventName: 'Staked', args: { user }, fromBlock: NFT_STAKING_FROM_BLOCK, toBlock: 'latest' });
  const ids = Array.from(new Set(logs.flatMap((l) => ((l.args as any).tokenIds ?? []) as bigint[]))).sort((x, y) => (x < y ? -1 : 1));
  if (!ids.length) return [];
  const who = await client.multicall({ contracts: ids.map((id) => ({ address: pool, abi: NftStakingPoolABI, functionName: 'stakerOf', args: [id] })) as any, allowFailure: true });
  return ids.filter((_, i) => String(ok(who[i]) ?? '').toLowerCase() === user.toLowerCase());
}

/** Wallet position in a pool: balances, rewards, approval and per-NFT boost state. */
export function useUserPoolState(pool?: Addr, collection?: Addr, user?: Addr) {
  const client = usePublicClient({ chainId: CHAIN });
  return useQuery({
    queryKey: ['nft-staking', 'user', pool?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!pool && !!collection && !!user,
    refetchInterval: 30_000,
    queryFn: async (): Promise<UserPoolState> => {
      const p = { address: pool!, abi: NftStakingPoolABI } as const;
      const [r, idList] = await Promise.all([
        client!.multicall({
          contracts: [
            { ...p, functionName: 'balanceOf', args: [user!] },
            { ...p, functionName: 'earned', args: [user!] },
            { ...p, functionName: 'rewardsPerDay', args: [user!] },
            { ...p, functionName: 'hasSetBonus', args: [user!] },
            { ...p, functionName: 'userWeight', args: [user!] },
            { ...p, functionName: 'userBaseWeight', args: [user!] },
            { address: collection!, abi: Erc721ReadABI, functionName: 'isApprovedForAll', args: [user!, pool!] },
          ] as any,
          allowFailure: true,
        }),
        stakedIdsOf(client!, pool!, user!),
      ]);
      let ids: StakedNft[] = [];
      if (idList.length) {
        const fns = ['tierOf', 'eligibleTierOf', 'timeToNextTier', 'stakedSince'] as const;
        const d = await client!.multicall({ contracts: idList.flatMap((id) => fns.map((f) => ({ ...p, functionName: f, args: [id] }))) as any, allowFailure: true });
        ids = idList.map((id, i) => ({
          id,
          tier: Number(ok(d[i * 4]) ?? 0),
          eligibleTier: Number(ok(d[i * 4 + 1]) ?? 0),
          toNext: Number(ok(d[i * 4 + 2]) ?? 0),
          since: Number(ok(d[i * 4 + 3]) ?? 0),
        }));
      }
      return {
        staked: (ok(r[0]) ?? BigInt(0)) as bigint,
        earned: (ok(r[1]) ?? BigInt(0)) as bigint,
        perDay: (ok(r[2]) ?? BigInt(0)) as bigint,
        setBonus: ok(r[3]) === true,
        weight: (ok(r[4]) ?? BigInt(0)) as bigint,
        baseWeight: (ok(r[5]) ?? BigInt(0)) as bigint,
        approved: ok(r[6]) === true,
        ids,
        fetchedAt: Math.floor(Date.now() / 1000),
      };
    },
  });
}

const MAX_SCAN_CANDIDATES = 3000;

/** NFTs a wallet holds in any ERC-721: Transfer logs to the wallet, confirmed with ownerOf. tooLarge = use manual ids. */
export function useWalletNfts(collection?: Addr, user?: Addr, polypad = false) {
  const client = usePublicClient({ chainId: CHAIN });
  return useQuery({
    queryKey: ['nft-staking', 'owned', collection?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!collection && !!user,
    refetchInterval: 30_000,
    retry: false,
    queryFn: async (): Promise<{ ids: bigint[]; tooLarge: boolean }> => {
      let logs: any[];
      try {
        logs = await client!.getContractEvents({
          address: collection!, abi: Erc721ReadABI, eventName: 'Transfer', args: { to: user! },
          fromBlock: polypad ? NFT_FACTORY_DEPLOY_BLOCK : BigInt(0), toBlock: 'latest',
        });
      } catch (e) {
        console.error('NFT log scan failed, falling back to manual token ids', e);
        return { ids: [], tooLarge: true };
      }
      const candidates = Array.from(new Set(logs.map((l) => (l.args as any).tokenId as bigint))).sort((x, y) => (x < y ? -1 : 1));
      if (candidates.length > MAX_SCAN_CANDIDATES) return { ids: [], tooLarge: true };
      if (!candidates.length) return { ids: [], tooLarge: false };
      const owners = await client!.multicall({ contracts: candidates.map((id) => ({ address: collection!, abi: Erc721ReadABI, functionName: 'ownerOf', args: [id] })) as any, allowFailure: true });
      return { ids: candidates.filter((_, i) => String(ok(owners[i]) ?? '').toLowerCase() === user!.toLowerCase()), tooLarge: false };
    },
  });
}

/** Checks manually entered ids: which ones the wallet owns. */
export async function verifyOwnedIds(client: PublicClient, collection: Addr, user: Addr, ids: bigint[]): Promise<bigint[]> {
  if (!ids.length) return [];
  const owners = await client.multicall({ contracts: ids.map((id) => ({ address: collection, abi: Erc721ReadABI, functionName: 'ownerOf', args: [id] })) as any, allowFailure: true });
  return ids.filter((_, i) => String(ok(owners[i]) ?? '').toLowerCase() === user.toLowerCase());
}

export interface LeaderRow { user: Addr; count: number; weight: bigint; multiple: number; share: number }

/** Staker leaderboard from the latest WeightChanged event per wallet. */
export function usePoolLeaderboard(pool?: Addr) {
  const client = usePublicClient({ chainId: CHAIN });
  return useQuery({
    queryKey: ['nft-staking', 'leaders', pool?.toLowerCase()],
    enabled: !!client && !!pool,
    refetchInterval: 60_000,
    queryFn: async (): Promise<LeaderRow[]> => {
      const logs = await client!.getContractEvents({ address: pool!, abi: NftStakingPoolABI, eventName: 'WeightChanged', fromBlock: NFT_STAKING_FROM_BLOCK, toBlock: 'latest' });
      const latest = new Map<string, { user: Addr; count: bigint; weight: bigint }>();
      for (const l of logs) {
        const a = l.args as any;
        latest.set(String(a.user).toLowerCase(), { user: a.user, count: a.count as bigint, weight: a.weight as bigint });
      }
      const rows = Array.from(latest.values()).filter((r) => r.count > BigInt(0));
      const total = rows.reduce((s, r) => s + r.weight, BigInt(0));
      return rows
        .map((r) => ({
          user: r.user,
          count: Number(r.count),
          weight: r.weight,
          multiple: Number(r.weight) / (Number(r.count) * 10_000),
          share: total > BigInt(0) ? Number((r.weight * BigInt(1_000_000)) / total) / 10_000 : 0,
        }))
        .sort((x, y) => (y.weight > x.weight ? 1 : y.weight < x.weight ? -1 : 0));
    },
  });
}

const ERRORS: Record<string, string> = {
  CollectionNotAllowed: 'This collection is not allowed by the factory.',
  InvalidParams: 'Invalid pool parameters.',
  AlreadyStaked: 'One of these NFTs is already staked.',
  AmountTooLarge: 'Amount is too large.',
  BatchTooLarge: 'Too many NFTs in one transaction. Select fewer.',
  InvalidBoost: 'Invalid boost settings.',
  NotCreator: 'Only the pool creator can do that.',
  NotStaker: 'You did not stake one of the selected NFTs.',
  PoolEnded: 'This pool has ended.',
  PoolNotEnded: 'The pool has not ended yet.',
  TransferNotReceived: 'The token transfer did not arrive in full.',
  WrongCollection: 'Wrong collection for this pool.',
  ZeroAddress: 'Zero address.',
  ZeroAmount: 'Amount must be above zero.',
  SafeERC20FailedOperation: 'Token transfer failed. Check your balance and approval.',
};

function errorName(e: any): string | undefined {
  let x = e;
  for (let i = 0; i < 6 && x; i++) {
    if (x?.data?.errorName) return x.data.errorName;
    x = x.cause;
  }
  return undefined;
}

/** Sends a staking tx with gas = max(estimate x 1.5, floor). The connected wallet signs. Returns the receipt or null. */
export function useStakingTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[];
    fn: StakingFn; ids?: number; success?: string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) return null;
    setPending(o.key);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      const floor = gasFloor(o.fn, o.ids ?? 0);
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateContractGas({ address: o.address, abi: o.abi as Abi, functionName: o.functionName, args: (o.args ?? []) as any, account: address } as any);
      } catch (e) {
        // A decoded revert means the call would fail: stop here instead of spending gas.
        if (errorName(e)) throw e;
        console.error(`${o.functionName} gas estimate failed, using floor`, e);
      }
      const gas = gasLimit(estimate, floor);
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({ address: o.address, abi: o.abi as Abi, functionName: o.functionName, args: (o.args ?? []) as any, chainId: CHAIN, gas: gas > BigInt(0) ? gas : undefined } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await qc.invalidateQueries({ queryKey: ['nft-staking'] });
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
