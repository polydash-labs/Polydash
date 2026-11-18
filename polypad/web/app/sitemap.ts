import type { MetadataRoute } from 'next';
import { getLaunchesSnapshot } from '@/lib/launches-server';
import { listCollectionAddresses } from '@/lib/nft-server';
import { isHiddenLaunch } from '@/lib/hidden-launches';

export const dynamic = 'force-dynamic';

const BASE = 'https://polypad.family';
const STATIC_PATHS = ['/', '/about', '/agents', '/agents/launch', '/create', '/portfolio', '/leaderboard', '/nfts', '/stake', '/risk', '/terms', '/privacy', '/contracts', '/contact', '/brand'];

const within = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [launches, collections] = await Promise.all([
    within(getLaunchesSnapshot(8_000), 9_000, null),
    within(listCollectionAddresses(), 9_000, [] as string[]),
  ]);
  const tokens = Array.from(new Set((launches ?? []).filter((t) => !isHiddenLaunch(t)).map((t) => t.launchAddress.toLowerCase())));
  return [
    ...STATIC_PATHS.map((p) => ({ url: p === '/' ? BASE : `${BASE}${p}` })),
    ...tokens.map((a) => ({ url: `${BASE}/token/${a}` })),
    ...collections.map((a) => ({ url: `${BASE}/nfts/${a}` })),
  ];
}
