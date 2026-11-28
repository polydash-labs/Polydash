'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { type PublicClient } from 'viem';
import { CurveCollectionABI, CurveFactoryABI, getCurveFactoryAddress, getPhase2DeployBlock } from '@/lib/contracts/nft-market-abis';
import { NFT_FACTORY_DEPLOY_BLOCK } from '@/lib/contracts/nft-abis';
import { filterHiddenNftCollections, isHiddenNftCollection } from '@/lib/nft-hidden';
import { robinhoodChain } from '@/lib/chain';

const FIELDS = [
  'name', 'symbol', 'imageUri', 'description', 'baseURI', 'creator', 'payoutWallet', 'maxSupply', 'startPrice', 'priceStep',
  'creatorFeeBps', 'floorBps', 'royaltyBps', 'totalMinted', 'totalRedeemed', 'reserve', 'creatorBalance', 'volume', 'graduated',
  'floorPerToken', 'floorVault', 'circulating', 'nextPrice', 'poolSize',
] as const;
const STRING_FIELDS = new Set<string>(['name', 'symbol', 'imageUri', 'description', 'baseURI', 'creator', 'payoutWallet']);

export interface CurveCollection {
  kind: 'curve';
  address: `0x${string}`;
  name: string;
  symbol: string;
  imageUri: string;
  description: string;
  baseURI: string;
  creator: `0x${string}`;
  payoutWallet: `0x${string}`;
  maxSupply: bigint;
  startPrice: bigint;
  priceStep: bigint;
  creatorFeeBps: bigint;
  floorBps: bigint;
  royaltyBps: bigint;
  totalMinted: bigint;
  totalRedeemed: bigint;
  reserve: bigint;
  creatorBalance: bigint;
  volume: bigint;
  graduated: boolean;
  floorPerToken: bigint;
  floorVault: bigint;
  circulating: bigint;
  nextPrice: bigint;
  poolSize: bigint;
}

const Z = BigInt(0);

async function fetchCurveCollections(client: PublicClient, addrs: `0x${string}`[]): Promise<CurveCollection[]> {
  if (addrs.length === 0) return [];
  const res = await client.multicall({
    contracts: addrs.flatMap((a) => FIELDS.map((f) => ({ address: a, abi: CurveCollectionABI, functionName: f }))) as any,
    allowFailure: true,
  });
  return addrs.map((address, i) => {
    const o: Record<string, any> = { kind: 'curve', address };
    FIELDS.forEach((f, j) => {
      const r = res[i * FIELDS.length + j];
      const v = r?.status === 'success' ? r.result : undefined;
      o[f] = v ?? (f === 'graduated' ? false : STRING_FIELDS.has(f) ? '' : Z);
    });
    if (typeof o.royaltyBps === 'number') o.royaltyBps = BigInt(o.royaltyBps);
    return o as CurveCollection;
  });
}

/** All bonding-curve collections (empty until the curve factory address is configured). */
export function useCurveCollections() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const factory = getCurveFactoryAddress();
  return useQuery({
    queryKey: ['nft-collections', 'curve'],
    enabled: !!client,
    refetchInterval: 30_000,
    queryFn: async (): Promise<CurveCollection[]> => {
      if (!factory) return [];
      const len = Number(await client!.readContract({ address: factory, abi: CurveFactoryABI, functionName: 'allCollectionsLength' }));
      if (len === 0) return [];
      const addrRes = await client!.multicall({
        contracts: Array.from({ length: len }, (_, i) => ({ address: factory, abi: CurveFactoryABI, functionName: 'allCollections', args: [BigInt(i)] })) as any,
        allowFailure: true,
      });
      const addrs = filterHiddenNftCollections(
        addrRes.flatMap((r) => (r.status === 'success' ? [r.result as `0x${string}`] : [])),
      ).reverse();
      return fetchCurveCollections(client!, addrs);
    },
  });
}

export function useCurveCollection(address?: string) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const factory = getCurveFactoryAddress();
  const valid = !!address && /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['nft-collection', 'curve', address?.toLowerCase()],
    enabled: !!client && valid,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!factory) return null;
      const a = address as `0x${string}`;
      // Hidden test collections never render, even by direct URL.
      if (isHiddenNftCollection(a)) return null;
      const ok = await client!.readContract({ address: factory, abi: CurveFactoryABI, functionName: 'isCollection', args: [a] });
      if (!ok) return null;
      const [c] = await fetchCurveCollections(client!, [a]);
      return c ?? null;
    },
  });
}

/** Token ids a wallet holds in any ERC-721 collection: Transfer logs, confirmed with ownerOf. */
export function useOwnedTokenIds(collection?: `0x${string}`, user?: `0x${string}`, curve = false) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['nft-user', 'owned', collection?.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && !!collection && !!user,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint[]> => {
      const base = { address: collection!, abi: CurveCollectionABI } as const;
      const logs = await client!.getContractEvents({
        ...base, eventName: 'Transfer', args: { to: user! }, fromBlock: curve ? getPhase2DeployBlock() : NFT_FACTORY_DEPLOY_BLOCK, toBlock: 'latest',
      });
      const candidates = Array.from(new Set(logs.map((l) => (l.args as any).tokenId as bigint))).sort((x, y) => (x < y ? -1 : 1));
      if (!candidates.length) return [];
      const owners = await client!.multicall({ contracts: candidates.map((id) => ({ ...base, functionName: 'ownerOf', args: [id] })) as any, allowFailure: true });
      return candidates.filter((_, i) => owners[i].status === 'success' && String(owners[i].result).toLowerCase() === user!.toLowerCase());
    },
  });
}
