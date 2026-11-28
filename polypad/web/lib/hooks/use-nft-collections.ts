'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { type PublicClient } from 'viem';
import { NftCollectionABI, NftFactoryABI, NFT_FACTORY_DEPLOY_BLOCK, getNftFactoryAddress } from '@/lib/contracts/nft-abis';
import { filterHiddenNftCollections, isHiddenNftCollection } from '@/lib/nft-hidden';
import { robinhoodChain } from '@/lib/chain';

const FIELDS = [
  'name', 'symbol', 'imageUri', 'description', 'baseURI', 'creator', 'payoutWallet', 'maxSupply', 'mintPrice', 'floorBps',
  'floorPerToken', 'maxPerWallet', 'commitEnd', 'royaltyBps', 'totalCommitted', 'committerCount', 'claimedCommitters',
  'totalMinted', 'totalRedeemed', 'floorReserve', 'publicAvailable', 'creatorBalance',
] as const;
const STRING_FIELDS = new Set<string>(['name', 'symbol', 'imageUri', 'description', 'baseURI', 'creator', 'payoutWallet']);

export interface NftCollection {
  address: `0x${string}`;
  name: string;
  symbol: string;
  imageUri: string;
  description: string;
  baseURI: string;
  creator: `0x${string}`;
  payoutWallet: `0x${string}`;
  maxSupply: bigint;
  mintPrice: bigint;
  floorBps: bigint;
  floorPerToken: bigint;
  maxPerWallet: bigint;
  commitEnd: bigint;
  royaltyBps: bigint;
  totalCommitted: bigint;
  committerCount: bigint;
  claimedCommitters: bigint;
  totalMinted: bigint;
  totalRedeemed: bigint;
  floorReserve: bigint;
  publicAvailable: bigint;
  creatorBalance: bigint;
}

const Z = BigInt(0);

async function fetchCollections(client: PublicClient, addrs: `0x${string}`[]): Promise<NftCollection[]> {
  if (addrs.length === 0) return [];
  const res = await client.multicall({
    contracts: addrs.flatMap((a) => FIELDS.map((f) => ({ address: a, abi: NftCollectionABI, functionName: f }))) as any,
    allowFailure: true,
  });
  return addrs.map((address, i) => {
    const o: Record<string, any> = { address };
    FIELDS.forEach((f, j) => {
      const r = res[i * FIELDS.length + j];
      const v = r?.status === 'success' ? r.result : undefined;
      o[f] = v ?? (STRING_FIELDS.has(f) ? '' : Z);
    });
    if (typeof o.royaltyBps === 'number') o.royaltyBps = BigInt(o.royaltyBps);
    return o as NftCollection;
  });
}

export function useNftCollections() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['nft-collections'],
    enabled: !!client,
    refetchInterval: 30_000,
    queryFn: async () => {
      const factory = getNftFactoryAddress();
      const len = Number(await client!.readContract({ address: factory, abi: NftFactoryABI, functionName: 'allCollectionsLength' }));
      if (len === 0) return [];
      const idx = Array.from({ length: len }, (_, i) => BigInt(i));
      const addrRes = await client!.multicall({
        contracts: idx.map((i) => ({ address: factory, abi: NftFactoryABI, functionName: 'allCollections', args: [i] })) as any,
        allowFailure: true,
      });
      const addrs = filterHiddenNftCollections(
        addrRes.flatMap((r) => (r.status === 'success' ? [r.result as `0x${string}`] : [])),
      ).reverse();
      return fetchCollections(client!, addrs);
    },
  });
}

export function useNftCollection(address?: string) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!address && /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['nft-collection', address?.toLowerCase()],
    enabled: !!client && valid,
    refetchInterval: 15_000,
    queryFn: async () => {
      const a = address as `0x${string}`;
      // Hidden test collections never render, even by direct URL.
      if (isHiddenNftCollection(a)) return null;
      const ok = await client!.readContract({ address: getNftFactoryAddress(), abi: NftFactoryABI, functionName: 'isCollection', args: [a] });
      if (!ok) return null;
      const [c] = await fetchCollections(client!, [a]);
      return c ?? null;
    },
  });
}

export interface NftUserState {
  committed: bigint;
  claimed: boolean;
  allocation: bigint;
  walletMinted: bigint;
  tokenIds: bigint[];
}

/** Wallet position in a collection. Owned token ids come from Transfer logs, confirmed with ownerOf. */
export function useNftUser(collection?: `0x${string}`, user?: `0x${string}`) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['nft-user', collection?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!collection && !!user,
    refetchInterval: 15_000,
    queryFn: async (): Promise<NftUserState> => {
      const c = collection!;
      const u = user!;
      const base = { address: c, abi: NftCollectionABI } as const;
      const [committed, claimed, allocation, walletMinted] = await client!.multicall({
        contracts: [
          { ...base, functionName: 'committed', args: [u] },
          { ...base, functionName: 'claimed', args: [u] },
          { ...base, functionName: 'allocationOf', args: [u] },
          { ...base, functionName: 'walletMinted', args: [u] },
        ],
        allowFailure: false,
      });
      const logs = await client!.getContractEvents({
        address: c, abi: NftCollectionABI, eventName: 'Transfer', args: { to: u }, fromBlock: NFT_FACTORY_DEPLOY_BLOCK, toBlock: 'latest',
      });
      const candidates = Array.from(new Set(logs.map((l) => (l.args as any).tokenId as bigint))).sort((x, y) => (x < y ? -1 : 1));
      let tokenIds: bigint[] = [];
      if (candidates.length) {
        const owners = await client!.multicall({
          contracts: candidates.map((id) => ({ ...base, functionName: 'ownerOf', args: [id] })) as any,
          allowFailure: true,
        });
        tokenIds = candidates.filter((_, i) => owners[i].status === 'success' && String(owners[i].result).toLowerCase() === u.toLowerCase());
      }
      return { committed: committed as bigint, claimed: claimed as boolean, allocation: allocation as bigint, walletMinted: walletMinted as bigint, tokenIds };
    },
  });
}

/** Seconds since epoch, updated every second after mount (null during SSR). */
export function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type NftStatus = 'commit' | 'claim' | 'mint' | 'minted-out';

export function collectionStatus(c: NftCollection, now: number | null): NftStatus {
  if (now != null && BigInt(now) < c.commitEnd) return 'commit';
  if (now == null && c.totalMinted === Z) return 'commit';
  if (c.publicAvailable > Z) return 'mint';
  if (c.claimedCommitters < c.committerCount) return 'claim';
  return 'minted-out';
}

export const STATUS_LABEL: Record<NftStatus, string> = {
  commit: 'Commitments open',
  claim: 'Claiming',
  mint: 'Minting',
  'minted-out': 'Minted out',
};

export function formatCountdown(secs: number) {
  if (secs <= 0) return '0s';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}
