import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { RewardsPool } from './_components/rewards-pool';

export const metadata: Metadata = {
  title: 'POLYDASH Rewards Pool | Polypad',
  description: "Stake POLYDASH. The stakers' share of buybacks is streamed to this pool over 30 days.",
};

export default function RewardsPoolPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <RewardsPool />
      </main>
      <Footer />
    </div>
  );
}
