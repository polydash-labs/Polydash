import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DeploySlice } from './_components/deploy-slice';

export const metadata: Metadata = {
  title: 'Deploy airdrop slice contracts',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DeploySlicePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1"><DeploySlice /></main>
      <Footer />
    </div>
  );
}
