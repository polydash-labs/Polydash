import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BuybackSettings } from './_components/buyback-settings';

export const metadata: Metadata = {
  title: 'Buyback settings | Polypad',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function BuybackSettingsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <BuybackSettings />
      </main>
      <Footer />
    </div>
  );
}
