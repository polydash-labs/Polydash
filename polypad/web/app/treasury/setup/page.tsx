import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { TreasuryNotLive } from '@/components/treasury/notes';
import { treasuryLive } from '@/lib/treasury';
import { TreasurySetup } from './_components/treasury-setup';

export const metadata: Metadata = {
  title: 'Set up treasury rules',
  robots: { index: false, follow: true },
};

export default async function TreasurySetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 px-4 py-10 sm:py-14">
        {treasuryLive() ? <TreasurySetup initialToken={token ?? ''} /> : <TreasuryNotLive />}
      </main>
      <Footer />
    </div>
  );
}
