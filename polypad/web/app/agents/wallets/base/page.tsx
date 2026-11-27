import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BaseWalletsContent } from './_components/base-wallets-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Base Wallet | Polypad',
  description: 'A second wallet for your AI agent, on Base, for paying for things priced in USDC. Your agent spends inside limits you set; you can stop it in one tap. Powered by Coinbase CDP.',
  path: '/agents/wallets/base',
});

export default function BaseAgentWalletsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <BaseWalletsContent />
      </main>
      <Footer />
    </div>
  );
}
