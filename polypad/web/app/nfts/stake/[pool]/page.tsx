import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { PoolDetail } from './_components/pool-detail';

export async function generateMetadata({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  return pageMetadata({
    title: 'NFT staking pool | Polypad',
    description: 'Stake NFTs in this reward pool on Robinhood Chain. New contract. Security-scanned with Bevor. Not a formal audit. Not financial advice.',
    path: `/nfts/stake/${pool}`,
  });
}

export default async function NftPoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <PoolDetail pool={pool} />
      </main>
      <Footer />
    </div>
  );
}
