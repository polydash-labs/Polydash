import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { X402Content } from './_components/x402-content';
import { SettleVolume } from './_components/settle-volume';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Pay per call | Polypad',
  description: 'Agents pay per API call on Robinhood Chain — token reports, CTO reports, and Tokenized Fund NAV snapshots, settled in USDG or POLYDASH with x402. No account, no subscription.',
  path: '/x402',
});

export default function X402Page() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <X402Content />
        <div className="mx-auto max-w-container px-5 pb-2 sm:px-8">
          <SettleVolume />
        </div>
        <div className="mx-auto max-w-container px-5 pb-8 sm:px-8">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-[18px] font-semibold text-white">Pay with Poly credits</h2>
            <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-white/55">
              No crypto in your wallet? Pay with Poly credits from your Pro key instead of USDG or
              POLYDASH — 1 credit = 1 cent, so a token report or fund NAV check costs 1 credit and
              a CTO report costs 5. Claim $25 free, or buy more with ETH or POLYDASH.
            </p>
            <p className="mt-3">
              <Link href="/agents/credits" className="text-[13px] font-medium text-polydash-green hover:underline">
                Get Poly credits →
              </Link>
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
