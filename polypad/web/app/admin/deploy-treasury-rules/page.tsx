import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeployTreasury } from './_components/deploy-treasury';

export const metadata: Metadata = {
  title: 'Deploy treasury rules factory | Polypad',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeployTreasuryPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <DeployTreasury />
      </main>
      <Footer />
    </div>
  );
}
