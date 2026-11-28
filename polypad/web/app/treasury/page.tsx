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
          <div className="mx-auto max-w-lg space-y-5">
            <div className="glass-card space-y-3 p-6">
              <h1 className="text-xl font-semibold text-white">Treasury rules</h1>
              <p className="text-[13px] leading-relaxed text-white/65">
                Treasury rules are public limits a token&apos;s creator sets on what the token&apos;s treasury can spend — for example, how much ETH a buyback may use per day, or what fee a reward pool charges when you claim.
              </p>
              <p className="text-[13px] leading-relaxed text-white/65">
                Only the token&apos;s launch creator can set them up. Once set, the rules can only be changed after a public waiting period, so holders can see changes coming.
              </p>
              <TreasuryNote />
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href="/treasury/setup" className="rounded-full bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90">
                  Set up rules for your token
                </Link>
                <Link href="/" className="rounded-full border border-white/15 px-4 py-2 text-[13px] text-white hover:border-white/40">
                  Browse tokens
                </Link>
              </div>
            </div>
            <div className="glass-card space-y-2 p-6">
              <h2 className="text-[15px] font-semibold text-white">Tokens that already have rules</h2>
              <p className="text-[13px] leading-relaxed text-white/65">
                Each token&apos;s rules, balances and history are shown on its own token page. Open a token from the list below to see whether it has treasury rules set up.
              </p>
              <Link href="/" className="inline-block text-[13px] text-white underline-offset-2 hover:underline">Browse tokens →</Link>
            </div>
          </div>
        ) : (
          <TreasuryNotLive />
        )}
      </main>
      <Footer />
    </div>
  );
}
