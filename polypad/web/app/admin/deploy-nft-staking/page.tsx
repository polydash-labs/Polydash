import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeployFactory } from './_components/deploy-factory';

export const metadata: Metadata = {
  title: 'Deploy NFT staking factory | Polypad',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeployNftStakingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <DeployFactory />
      </main>
      <Footer />
    </div>
  );
}
