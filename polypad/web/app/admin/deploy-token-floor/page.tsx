import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeployTokenFloor } from './_components/deploy-token-floor';

export const metadata: Metadata = {
  title: 'Deploy token-backed floor factory | Polypad',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeployTokenFloorPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <DeployTokenFloor />
      </main>
      <Footer />
    </div>
  );
}
