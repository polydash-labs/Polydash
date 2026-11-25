// Server-side launch snapshot for first paint (Explore, token page, link previews).
// Short stale-while-revalidate cache (45s) with one in-flight refresh, so page loads never fan out to the RPC.
// This is a separate read path: the client hooks keep their own polling unchanged.
import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getFactoryAddresses } from '@/lib/contracts/addresses';
import { fetchLaunchAddresses, fetchLaunchDetails, resolveLaunchAddress } from '@/lib/launches-core';
import type { LaunchToken } from '@/lib/token-types';

const TTL = 45_000;
const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 8_000 }) }) as PublicClient;

type Entry<T> = { value: T; at: number; inflight?: Promise<T> };
const cache = new Map<string, Entry<unknown>>();

/** Returns cached data (refreshing in the background when stale). On a cold cache waits up to `waitMs`, else null. */
async function swr<T>(key: string, load: () => Promise<T>, waitMs: number): Promise<T | null> {
  const e = cache.get(key) as Entry<T> | undefined;
  const refresh = () => {
    const cur = cache.get(key) as Entry<T> | undefined;
    if (cur?.inflight) return cur.inflight;
    const p = load()
      .then((value) => { cache.set(key, { value, at: Date.now() }); return value; })
      .catch((err) => {
        console.error(`launch cache refresh failed (${key})`, err);
        const prev = cache.get(key) as Entry<T> | undefined;
        if (prev) cache.set(key, { value: prev.value, at: prev.at });
        else cache.delete(key);
        throw err;
      });
    cache.set(key, { value: cur?.value as T, at: cur?.at ?? 0, inflight: p });
    return p;
  };
  if (e && e.at > 0) {
    if (Date.now() - e.at > TTL) refresh().catch(() => {});
    return e.value;
  }
  const p = refresh();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), waitMs));
  return Promise.race([p, timeout]).catch(() => null);
}

let ethCache: { price: number; at: number } | null = null;
export async function getEthUsd(): Promise<number> {
  if (ethCache && Date.now() - ethCache.at < 60_000) return ethCache.price;
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { cache: 'no-store', signal: AbortSignal.timeout(3_000) });
    const price = Number((await res.json())?.data?.amount);
    if (!Number.isFinite(price) || price <= 0) throw new Error('bad price');
    ethCache = { price, at: Date.now() };
    return price;
  } catch {
    return ethCache?.price ?? 0;
  }
}

/** All launches (same shape as useLaunches), or null if not available within waitMs on a cold cache. */
export function getLaunchesSnapshot(waitMs = 3_500): Promise<LaunchToken[] | null> {
  return swr('all', async () => {
    const factories = getFactoryAddresses();
    if (factories.length === 0) return [];
    const [addrs, ethUsd] = await Promise.all([fetchLaunchAddresses(client, factories), getEthUsd()]);
    return fetchLaunchDetails(client, addrs, ethUsd);
  }, waitMs);
}

/**
 * Like getLaunchSnapshot, plus `missing`: true only when the address is malformed or every factory lookup
 * succeeded and none knows it. Timeouts and RPC errors leave `missing` false (page renders normally).
 */
export async function getLaunchLookup(address: string, waitMs = 3_500): Promise<{ token: LaunchToken | null; missing: boolean }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { token: null, missing: true };
  const token = await getLaunchSnapshot(address, waitMs);
  if (token) return { token, missing: false };
  const e = cache.get(`launch:${address.toLowerCase()}`) as Entry<LaunchToken | null> | undefined;
  return { token: null, missing: !!e && e.at > 0 && e.value === null };
}

/** One launch by launch OR token address (same shape as useLaunch). null = unknown, not a launch, or not ready in time. */
export async function getLaunchSnapshot(address: string, waitMs = 3_500): Promise<LaunchToken | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const a = address.toLowerCase() as `0x${string}`;
  const all = cache.get('all') as Entry<LaunchToken[]> | undefined;
  const hit = all?.at && Date.now() - all.at <= TTL ? all.value.find((t) => t.launchAddress.toLowerCase() === a || t.tokenAddress.toLowerCase() === a) : undefined;
  if (hit) return hit;
  return swr(`launch:${a}`, async () => {
    const factories = getFactoryAddresses();
    const launch = await resolveLaunchAddress(client, factories, a, true);
    if (!launch) return null;
    const ethUsd = await getEthUsd();
    const [t] = await fetchLaunchDetails(client, [launch], ethUsd);
    return t ?? null;
  }, waitMs);
}
