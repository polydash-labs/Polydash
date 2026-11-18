import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeployBond } from './_components/deploy-bond';

export const metadata: Metadata = {
  title: 'Deploy bond factory | Polypad',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeployBondPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <DeployBond />
      </main>
      <Footer />
    </div>
  );
}
