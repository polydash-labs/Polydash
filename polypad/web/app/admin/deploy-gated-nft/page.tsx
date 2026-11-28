import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeployGated } from './_components/deploy-gated';

export const metadata: Metadata = {
  title: 'Deploy holder mint factory',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeployGatedPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <DeployGated />
      </main>
      <Footer />
    </div>
  );
}
