import type { MetadataRoute } from 'next';
import { getLaunchesSnapshot } from '@/lib/launches-server';
import { listCollectionAddresses } from '@/lib/nft-server';
import { readFundsList } from '@/lib/fund/list-server';
import { isHiddenLaunch } from '@/lib/hidden-launches';

export const dynamic = 'force-dynamic';

const BASE = 'https://polypad.family';

/**
 * Public, indexable routes only. Functional pages (create flows, sign-in,
 * admin, per-job/per-wallet detail) carry robots noindex in their metadata
 * and are deliberately NOT listed here.
 */
const STATIC_PATHS: Array<{ path: string; priority: number; changefreq: 'daily' | 'weekly' | 'monthly' }> = [
  { path: '/', priority: 1.0, changefreq: 'daily' },
  { path: '/funds', priority: 0.9, changefreq: 'daily' },
  { path: '/agents', priority: 0.9, changefreq: 'weekly' },
  { path: '/terminal', priority: 0.8, changefreq: 'daily' },
  { path: '/stake', priority: 0.8, changefreq: 'weekly' },
  { path: '/build', priority: 0.8, changefreq: 'weekly' },
  { path: '/agents/earn', priority: 0.8, changefreq: 'weekly' },
  { path: '/business', priority: 0.8, changefreq: 'weekly' },
  { path: '/agents/wallets', priority: 0.7, changefreq: 'weekly' },
  { path: '/agents/credits', priority: 0.7, changefreq: 'weekly' },
  { path: '/agents/scores', priority: 0.7, changefreq: 'weekly' },
  { path: '/agents/receipts', priority: 0.6, changefreq: 'weekly' },
  { path: '/agents/accounts', priority: 0.6, changefreq: 'weekly' },
  { path: '/agents/wallets/base', priority: 0.6, changefreq: 'monthly' },
  { path: '/agents/wallets/cap-proof', priority: 0.6, changefreq: 'monthly' },
  { path: '/agents/security', priority: 0.6, changefreq: 'monthly' },
  { path: '/inference', priority: 0.7, changefreq: 'weekly' },
  { path: '/x402', priority: 0.7, changefreq: 'weekly' },
  { path: '/build/partnerships', priority: 0.7, changefreq: 'monthly' },
  { path: '/nfts', priority: 0.7, changefreq: 'weekly' },
  { path: '/nfts/floor', priority: 0.5, changefreq: 'weekly' },
  { path: '/start', priority: 0.7, changefreq: 'monthly' },
  { path: '/bond', priority: 0.6, changefreq: 'weekly' },
  { path: '/slice', priority: 0.6, changefreq: 'weekly' },
  { path: '/buybacks', priority: 0.6, changefreq: 'weekly' },
  { path: '/rewards-pool', priority: 0.6, changefreq: 'weekly' },
  { path: '/leaderboard', priority: 0.6, changefreq: 'weekly' },
  { path: '/about', priority: 0.6, changefreq: 'monthly' },
  { path: '/brand', priority: 0.5, changefreq: 'monthly' },
  { path: '/contact', priority: 0.5, changefreq: 'monthly' },
  { path: '/contracts', priority: 0.6, changefreq: 'monthly' },
  { path: '/pricing', priority: 0.6, changefreq: 'monthly' },
  { path: '/security', priority: 0.6, changefreq: 'monthly' },
  { path: '/audits', priority: 0.6, changefreq: 'monthly' },
  { path: '/audits/reports/agent-wallets-v2', priority: 0.5, changefreq: 'monthly' },
  { path: '/audits/reports/agent-wallets-v2-final', priority: 0.5, changefreq: 'monthly' },
  { path: '/audits/reports/agent-wallets-v2-phase3', priority: 0.5, changefreq: 'monthly' },
  { path: '/audits/reports/agent-wallets-v2-phase4', priority: 0.5, changefreq: 'monthly' },
  { path: '/docs', priority: 0.6, changefreq: 'monthly' },
  { path: '/docs/tools', priority: 0.7, changefreq: 'monthly' },
  { path: '/docs/rules', priority: 0.5, changefreq: 'monthly' },
  { path: '/docs/sdks', priority: 0.5, changefreq: 'monthly' },
  { path: '/docs/langchain', priority: 0.5, changefreq: 'monthly' },
  { path: '/docs/vercel-ai-sdk', priority: 0.5, changefreq: 'monthly' },
  { path: '/docs/sign-loop', priority: 0.5, changefreq: 'monthly' },
  { path: '/docs/case-studies', priority: 0.5, changefreq: 'monthly' },
  { path: '/risk', priority: 0.5, changefreq: 'monthly' },
  { path: '/terms', priority: 0.5, changefreq: 'monthly' },
  { path: '/privacy', priority: 0.5, changefreq: 'monthly' },
  { path: '/changelog', priority: 0.5, changefreq: 'weekly' },
  { path: '/pulse', priority: 0.5, changefreq: 'weekly' },
  { path: '/status', priority: 0.5, changefreq: 'weekly' },
];

const within = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [launches, collections, funds] = await Promise.all([
    within(getLaunchesSnapshot(8_000), 9_000, null),
    within(listCollectionAddresses(), 9_000, [] as string[]),
    within(readFundsList(), 9_000, null),
  ]);
  const tokens = Array.from(new Set((launches ?? []).filter((t) => !isHiddenLaunch(t)).map((t) => t.launchAddress.toLowerCase())));
  const fundAddresses = funds
    ? Array.from(new Set([...funds.phase3, ...funds.v2, ...funds.v3, ...funds.legacy].map((f) => f.address.toLowerCase())))
    : [];
  return [
    ...STATIC_PATHS.map((p) => ({ url: p.path === '/' ? BASE : `${BASE}${p.path}`, priority: p.priority, changeFrequency: p.changefreq })),
    ...tokens.map((a) => ({ url: `${BASE}/token/${a}`, priority: 0.5, changeFrequency: 'weekly' as const })),
    ...collections.map((a) => ({ url: `${BASE}/nfts/${a}`, priority: 0.5, changeFrequency: 'weekly' as const })),
    ...fundAddresses.map((a) => ({ url: `${BASE}/funds/${a}`, priority: 0.7, changeFrequency: 'weekly' as const })),
  ];
}
