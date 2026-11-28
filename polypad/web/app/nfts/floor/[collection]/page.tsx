import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { FloorNotLive } from '@/components/floor-vault/notes';
import { floorLive } from '@/lib/floorVault';
import { FloorCollection } from './_components/floor-collection';

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const { collection } = await params;
  return pageMetadata({
    title: 'Token-backed floor | Polypad',
    description: 'The token-backed floor for this NFT collection on Polypad: the floor price is backed by tokens held in the vault.',
    path: `/nfts/floor/${collection.toLowerCase()}`,
  });
}

export default async function FloorCollectionPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        {floorLive() ? <FloorCollection collection={collection} /> : <div className="px-5 py-16"><FloorNotLive /></div>}
      </main>
      <Footer />
    </div>
  );
}
