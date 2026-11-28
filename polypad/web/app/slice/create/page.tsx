import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { SliceCreate } from './_components/slice-create';

export const metadata: Metadata = pageMetadata({
  title: 'Airdrop slice | Polypad',
  description: 'Create an airdrop slice for POLYDASH stakers on Polypad.',
  path: '/slice/create',
  noindex: true,
});

export default function SliceCreatePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1"><SliceCreate /></main>
      <Footer />
    </div>
  );
}
