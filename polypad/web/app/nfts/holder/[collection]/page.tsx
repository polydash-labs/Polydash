import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { GatedNotLive } from '@/components/gated/notes';
import { gatedLive } from '@/lib/gatedMint';
import { HolderCollection } from './_components/holder-collection';

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const { collection } = await params;
  return pageMetadata({
    title: 'Holder mint | Polypad',
    description: 'Mint from this NFT collection as a holder on Polypad.',
    path: `/nfts/holder/${collection.toLowerCase()}`,
  });
}

export default async function HolderCollectionPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        {gatedLive() ? <HolderCollection collection={collection} /> : <div className="px-5 py-16"><GatedNotLive /></div>}
      </main>
      <Footer />
    </div>
  );
}
