import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { SliceStaker } from './_components/slice-staker';

export const metadata: Metadata = pageMetadata({
  title: 'Airdrop slice for POLYDASH stakers | Polypad',
  description: 'Claim your slice of the POLYDASH airdrop as a staker. Your share is read live from your staked balance.',
  path: '/slice',
});

export default function SlicePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1"><SliceStaker /></main>
      <Footer />
    </div>
  );
}
