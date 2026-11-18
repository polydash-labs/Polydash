import { Suspense } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { StakeTabs } from './_components/stake-tabs';

export const metadata = pageMetadata({
  title: 'Stake | Polypad',
  description: 'Permissionless staking pools on Robinhood Chain. Stake tokens, see the current variable APR and claim rewards anytime. Non-custodial.',
  path: '/stake',
});

export default async function StakePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const initialTab = typeof sp.tab === 'string' ? sp.tab : null;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <Suspense fallback={null}>
          <StakeTabs initialTab={initialTab} />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
