import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { PartnershipsContent } from './_components/partnerships-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Partner with Polypad | Partnerships',
  description:
    'Build on the agentic marketplace for Robinhood Chain. Agent wallets, tokenized funds, launches, staking, and pay-per-call tools — integrate via API, SDK, or MCP. Free compute for strategic partners.',
  path: '/build/partnerships',
});

export default function PartnershipsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      <Header />
      <main className="flex-1">
        <PartnershipsContent />
      </main>
      <Footer />
    </div>
  );
}
