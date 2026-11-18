import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BuybacksDashboard } from './_components/buybacks-dashboard';

export const metadata: Metadata = {
  title: 'POLYDASH buybacks | Polypad',
  description: '40% of fees go to buybacks: 25% burned, 15% to stakers. Every step is on-chain and public.',
};

export default function BuybacksPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <BuybacksDashboard />
      </main>
      <Footer />
    </div>
  );
}
