import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { FundsList } from './_components/funds-list';
import { getInitialFundsWire, getInitialTvl } from '@/lib/first-paint';

export const metadata: Metadata = pageMetadata({
  title: 'Tokenized Funds | Polypad',
  description: 'Start your own on-chain fund on Polypad: raise from anyone, invest in public under a locked mandate, and prove it live on the terminal.',
  path: '/funds',
});

/**
 * First paint carries real figures: the server component reads the live
 * fund lists + TVL before sending HTML, and the client hooks start from
 * that data instead of "Loading tokenized funds…". The root layout forces
 * dynamic rendering, so ISR does not apply — the 30s freshness comes from
 * the in-module server caches (lib/fund/list-server.ts, lib/total-tvl.ts),
 * and export const revalidate = 30 is kept so ISR takes over if
 * force-dynamic is ever lifted.
 */
export const revalidate = 30;

export default async function FundsPage() {
  const [initialWire, initialTvl] = await Promise.all([getInitialFundsWire(), getInitialTvl()]);
  return <FundsList initialWire={initialWire ?? undefined} initialTvl={initialTvl ?? undefined} />;
}
