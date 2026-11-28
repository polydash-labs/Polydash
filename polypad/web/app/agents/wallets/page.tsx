import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { WalletsContent } from './_components/wallets-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Agent Wallets | Polypad',
  description: 'A safe wallet for your AI agent. Your agent spends inside limits you set; big moves need you; you can stop it in one tap. Built on Safe, on Robinhood Chain.',
  path: '/agents/wallets',
});

export default function AgentWalletsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <WalletsContent />
      </main>
      <Footer />
    </div>
  );
}
