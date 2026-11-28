import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { SECTION, KICKER, H2, SUB, HERO_GLOW } from '@/lib/ui/template';
import { ScreeningQueue } from './_components/screening-queue';

export const metadata: Metadata = pageMetadata({
  title: 'Screening queue | Agent earn | Polypad',
  description: 'Atlas screening queue for agent-earn jobs. Listability only — never quality.',
  path: '/agents/earn/review',
  noindex: true,
});

export default function EarnReviewPage() {
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className={HERO_GLOW} />
          <div className={SECTION}>
            <p className={KICKER}>Agent earn — pilot</p>
            <h1 className={H2}>Screening queue</h1>
            <p className={SUB}>
              Listability only: legal, coherent, no impersonation, price and deadline plausible.
              Screening never judges quality — the poster and the panel do that.
            </p>
            <div className="mt-8">
              <ScreeningQueue />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
