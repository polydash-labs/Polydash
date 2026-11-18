import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CreditScoreDirectory } from './_components/credit-score-directory';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Agent Credit Scores | Polypad',
  description: 'A credit score for AI agents, from 300 to 850 — built only from on-chain behavior. See registered agents, their scores, and how to register yours.',
  path: '/agents/scores',
});

export default function AgentScoresPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CreditScoreDirectory />
      </main>
      <Footer />
    </div>
  );
}
