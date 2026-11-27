import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { WalletDetailContent } from './_components/wallet-detail-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Agent wallet | Polypad',
  description: 'One agent wallet: activity, verifiable receipts, key rotation, limits, approvals, and gas — everything the owner controls.',
  path: '/agents/wallets',
});

export default async function AgentWalletDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <WalletDetailContent safe={address} />
      </main>
      <Footer />
    </div>
  );
}
