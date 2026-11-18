// Server-side NFT collection reads for metadata and the sitemap (memory-cached, short RPC timeouts).
import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { NftCollectionABI, NftFactoryABI, getNftFactoryAddress } from '@/lib/contracts/nft-abis';
import { getCurveFactoryAddress } from '@/lib/contracts/nft-market-abis';

const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 8_000 }) }) as PublicClient;
const TTL = 10 * 60_000;

const names = new Map<string, { name: string; at: number }>();

/** Collection name, or null if the address isn't a readable collection. */
export async function getCollectionName(address: string): Promise<string | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const key = address.toLowerCase();
  const hit = names.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.name;
  try {
    const name = String(await client.readContract({ address: key as `0x${string}`, abi: NftCollectionABI, functionName: 'name' })).trim();
    if (!name) return null;
    names.set(key, { name, at: Date.now() });
    return name;
  } catch {
    return hit?.name ?? null;
  }
}

let list: { value: string[]; at: number } | null = null;

/** All collection addresses (lowercase) from the phase 1 factory and, if configured, the curve factory. */
export async function listCollectionAddresses(): Promise<string[]> {
  if (list && Date.now() - list.at < TTL) return list.value;
  const factories = [getNftFactoryAddress(), getCurveFactoryAddress()].filter((a): a is `0x${string}` => !!a);
  const out = new Set<string>();
  for (const f of factories) {
    try {
      const n = Number(await client.readContract({ address: f, abi: NftFactoryABI, functionName: 'allCollectionsLength' }));
      const addrs = await Promise.all(Array.from({ length: Math.min(n, 500) }, (_, i) =>
        client.readContract({ address: f, abi: NftFactoryABI, functionName: 'allCollections', args: [BigInt(i)] }).catch(() => null)));
      for (const a of addrs) if (a) out.add(String(a).toLowerCase());
    } catch (err) {
      console.error('collection list failed', f, err instanceof Error ? err.message : err);
    }
  }
  const value = Array.from(out);
  if (value.length > 0 || !list) list = { value, at: Date.now() };
  return list.value;
}
