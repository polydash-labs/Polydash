import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeployBuyback } from './_components/deploy-buyback';

export const metadata: Metadata = {
  title: 'Deploy POLYDASH Rewards Pool and buyback vault | Polypad',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeployBuybackPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <DeployBuyback />
      </main>
      <Footer />
    </div>
  );
}
