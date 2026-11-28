import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { redirect } from 'next/navigation';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { FloorNotLive } from '@/components/floor-vault/notes';
import { floorLive } from '@/lib/floorVault';

export const metadata: Metadata = pageMetadata({
  title: 'Token-backed floor | Polypad',
  description: 'Token-backed floor for NFT collections on Polypad: the floor price is backed by tokens held in the vault.',
  path: '/nfts/floor',
});

export default function FloorIndexPage() {
  if (floorLive()) redirect('/nfts');
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1"><div className="px-5 py-16"><FloorNotLive /></div></main>
      <Footer />
    </div>
  );
}
