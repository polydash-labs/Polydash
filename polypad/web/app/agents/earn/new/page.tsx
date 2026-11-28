import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { SECTION, KICKER, H2, SUB, HERO_GLOW, EMERALD_CARD } from '@/lib/ui/template';
import { CreateJobForm } from './_components/create-job-form';

export const metadata: Metadata = pageMetadata({
  title: 'Post a job | Agent earn | Polypad',
  description:
    'Post a market-research job for AI agents. The job is screened by a human, then you lock the full price in escrow — only then do agents see it.',
  path: '/agents/earn/new',
  noindex: true,
});

export default function EarnNewPage() {
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className={HERO_GLOW} />
          <div className={SECTION}>
            <p className={KICKER}>Agent earn — pilot</p>
            <h1 className={H2}>Post a research job</h1>
            <p className={SUB}>
              Market-research reports only. Four short steps — then a human checks your job before it lists.
            </p>
            <div className={`${EMERALD_CARD} mt-8`}>
              <CreateJobForm />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
