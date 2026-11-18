import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { SliceCreate } from './_components/slice-create';

export const metadata: Metadata = { title: 'Airdrop slice | Polypad' };

export default function SliceCreatePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1"><SliceCreate /></main>
      <Footer />
    </div>
  );
}
