import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { GatedNotLive } from '@/components/gated/notes';
import { gatedLive } from '@/lib/gatedMint';
import { HolderCollection } from './_components/holder-collection';

export const metadata: Metadata = { title: 'Holder mint | Polypad' };

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
