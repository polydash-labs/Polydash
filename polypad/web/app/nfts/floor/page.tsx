import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { FloorNotLive } from '@/components/floor-vault/notes';
import { floorLive } from '@/lib/floorVault';

export const metadata: Metadata = { title: 'Token-backed floor | Polypad' };

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
