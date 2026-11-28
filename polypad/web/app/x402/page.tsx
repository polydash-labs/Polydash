import Link from 'next/link';
import { ArrowRight, Coins } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { X402Content } from './_components/x402-content';
import { SettleVolume } from './_components/settle-volume';
import { pageMetadata } from '@/lib/seo';
import { EMERALD_CARD_STRONG, SECTION } from '@/lib/ui/template';

export const metadata = pageMetadata({
  title: 'Pay per call | Polypad',
  description: 'Agents pay per API call on Robinhood Chain — token reports, CTO reports, and Tokenized Fund NAV snapshots, settled in USDG or POLYDASH with x402. No account, no subscription.',
  path: '/x402',
});

export default function X402Page() {
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-1">
        <X402Content />
        <section className="border-t border-white/10 bg-white/[0.02]">
          <div className={SECTION}>
            <SettleVolume />
          </div>
        </section>
        <section className="border-t border-white/10">
          <div className={SECTION}>
            <div className={EMERALD_CARD_STRONG}>
              <Coins className="h-5 w-5 text-emerald-400" />
              <h2 className="mt-3 text-[18px] font-semibold text-white">Pay with Poly credits</h2>
              <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-white/60">
                No crypto in your wallet? Pay with Poly credits from your Pro key instead of USDG or
                POLYDASH — 1 credit = 1 cent, so a token report or fund NAV check costs 1 credit and
                a CTO report costs 5. Claim $25 free, or buy more with ETH or POLYDASH.
              </p>
              <p className="mt-4">
                <Link href="/agents/credits" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-emerald-300 hover:underline">
                  Get Poly credits <ArrowRight className="h-4 w-4" />
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
