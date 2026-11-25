import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { FloorNotLive } from '@/components/floor-vault/notes';
import { floorLive } from '@/lib/floorVault';
import { FloorCollection } from './_components/floor-collection';

export const metadata: Metadata = { title: 'Token-backed floor | Polypad' };

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
