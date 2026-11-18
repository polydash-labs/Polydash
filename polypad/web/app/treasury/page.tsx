import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { TreasuryNote, TreasuryNotLive } from '@/components/treasury/notes';
import { treasuryLive } from '@/lib/treasury';

export const metadata: Metadata = { title: 'Treasury rules | Polypad', robots: { index: false, follow: true } };

export default function TreasuryPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 px-4 py-10 sm:py-14">
        {treasuryLive() ? (
          <div className="glass-card mx-auto max-w-lg space-y-3 p-6">
            <h1 className="text-xl font-semibold text-white">Treasury rules</h1>
            <p className="text-[13px] text-white/65">
              A token&apos;s launch creator can set up treasury rules from the token page. Each token&apos;s rules, balances and history are shown on its page.
            </p>
            <TreasuryNote />
            <Link href="/" className="inline-block text-[13px] text-white underline-offset-2 hover:underline">Browse tokens</Link>
          </div>
        ) : (
          <TreasuryNotLive />
        )}
      </main>
      <Footer />
    </div>
  );
}
