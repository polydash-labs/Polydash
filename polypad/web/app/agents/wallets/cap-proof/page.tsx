import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CapProofContent } from './_components/cap-proof-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Cap proof: the agent tried to overspend, the chain said no | Polypad',
  description:
    'We gave an AI agent a wallet with a daily allowance of 0.00005 ETH, then told it to spend double. The transaction reverted on-chain with CapExceeded. The receipts are public — check them yourself.',
  path: '/agents/wallets/cap-proof',
});

export default function CapProofPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CapProofContent />
      </main>
      <Footer />
    </div>
  );
}
