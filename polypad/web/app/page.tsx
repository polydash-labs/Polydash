import type { Metadata } from 'next';
import Link from 'next/link';
import { preload } from 'react-dom';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { HowItWorksSteps, NftLaunchSection } from '@/components/how-it-works';
import { ExploreContent } from './_components/explore-content';
import { getLaunchesSnapshot } from '@/lib/launches-server';
import { SITE_SHARE, pageMetadata } from '@/lib/seo';

// Home keeps its title/description; share tags + canonical come from the site-wide SITE_SHARE values.
export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Polypad: token launchpad on Robinhood Chain',
    description: 'Launch and trade tokens on Robinhood Chain. Tokens trade on a bonding curve and move to Uniswap V4 when the curve fills.',
    path: '/',
  }),
  ...SITE_SHARE,
};

export default async function HomePage() {
  const initial = await getLaunchesSnapshot(2_500).catch(() => null);
  // First card in the default (newest) sort: preload its logo so the grid paints with it.
  const first = [...(initial ?? [])].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  if (first?.imageUri && /^https:\/\//.test(first.imageUri)) preload(first.imageUri, { as: 'image', fetchPriority: 'high' });
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <ExploreContent initial={initial} intro={<HowItWorksSteps compact />} />
        <section className="mx-auto max-w-container px-5 py-10 sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-polydash-green">Tokenized Funds</p>
          <h2 className="mt-2 max-w-xl text-[24px] font-semibold tracking-tight text-white sm:text-[32px]">Start your own on-chain fund.</h2>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/60 sm:text-[15px]">
            Venture capital used to be a closed room. Now anyone can open a fund, raise from anyone, invest in public, and earn performance fees — with live NAV and a live terminal proving every move.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[13px] leading-relaxed text-white/70">
                <span className="font-semibold text-white">Launch your fund</span> — pick a strategy, set your fee.
              </p>
            </li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[13px] leading-relaxed text-white/70">
                <span className="font-semibold text-white">Raise from anyone</span> — people mint NFT shares with ETH.
              </p>
            </li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[13px] leading-relaxed text-white/70">
                <span className="font-semibold text-white">Invest in public</span> — every move proposed, 2-day wait, live on the terminal.
              </p>
            </li>
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Link
              href="/funds/create"
              className="inline-flex h-9 items-center justify-center rounded-full bg-polydash-green px-4 text-[13px] font-medium text-black transition-colors hover:bg-polydash-green-light"
            >
              Create your tokenized fund
            </Link>
            <Link href="/funds" className="text-[13px] text-white/60 transition-colors hover:text-white">
              See live funds
            </Link>
          </div>
        </section>
        <div className="mx-auto max-w-container px-5 pb-16 pt-6 sm:px-8 sm:pb-20">
          <NftLaunchSection />
        </div>
      </main>
      <Footer />
    </div>
  );
}
