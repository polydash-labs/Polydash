import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CreateContent } from './_components/create-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Create your agent | Polypad',
  description: 'Five steps: connect your wallet, create your agent’s wallet, register it for a credit score, connect its tools, done. Your agent runs on your own computer — Polypad gives it a wallet and tools.',
  path: '/agents/create',
  noindex: true,
});

export default function CreateAgentPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CreateContent />
      </main>
      <Footer />
    </div>
  );
}
