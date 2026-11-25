import { notFound } from 'next/navigation';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { PoolDetail } from '../_components/pool-detail';

export async function generateMetadata({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  return pageMetadata({
    title: 'Staking pool | Polypad',
    description: 'Stake, withdraw and claim rewards in this Polypad staking pool on Robinhood Chain. Non-custodial: you sign everything.',
    path: `/stake/${pool.toLowerCase()}`,
  });
}

export default async function StakePoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool)) notFound();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <PoolDetail address={pool} />
      </main>
      <Footer />
    </div>
  );
}
