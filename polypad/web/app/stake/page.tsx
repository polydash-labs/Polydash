import { Suspense } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { StakeTabs } from './_components/stake-tabs';
import { getInitialStakeOverview } from '@/lib/first-paint';

export const metadata = pageMetadata({
  title: 'Stake | Polypad',
  description: 'Permissionless staking pools on Robinhood Chain. Stake tokens, see the current variable APR and claim rewards anytime. Non-custodial.',
  path: '/stake',
});

/**
 * First paint carries real figures: the server component reads the live
 * staking pools before sending HTML, and the client starts from that data
 * instead of the skeleton. The root layout forces dynamic rendering, so
 * ISR does not apply — the 60s freshness comes from the in-module server
 * cache (lib/staking/server.ts), and export const revalidate = 30 is kept
 * so ISR takes over if force-dynamic is ever lifted. The page is static
 * now, so ?tab= is no longer seeded from the server — useUrlTab still
 * reads it on the client after mount, so a ?tab=nfts deep link paints the
 * Tokens tab first and flips after hydration.
 */
export const revalidate = 30;

export default async function StakePage() {
  const initialOverview = await getInitialStakeOverview();
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-1">
        <Suspense fallback={null}>
          <StakeTabs initialTab={null} initialOverview={initialOverview ?? undefined} />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
