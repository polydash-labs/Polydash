import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeployVesting } from './_components/deploy-vesting';

export const metadata: Metadata = {
  title: 'Deploy vesting factory',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeployVestingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <DeployVesting />
      </main>
      <Footer />
    </div>
  );
}
