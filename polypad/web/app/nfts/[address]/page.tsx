import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { getCollectionName } from '@/lib/nft-server';
import { CollectionContent } from './_components/collection-content';

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const name = await Promise.race([getCollectionName(address), new Promise<null>((r) => setTimeout(() => r(null), 4_000))]);
  return pageMetadata({
    title: name ? `${name} NFT | Polypad` : 'NFT collection | Polypad',
    description: name ? `Mint, trade and view the ${name} NFT collection on Polypad, on Robinhood Chain.` : 'An NFT collection on Polypad, on Robinhood Chain.',
    path: `/nfts/${address.toLowerCase()}`,
  });
}

export default async function NftCollectionPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CollectionContent address={address} />
      </main>
      <Footer />
    </div>
  );
}
