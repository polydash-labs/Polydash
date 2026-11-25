import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { AgentAccountsContent } from './_components/agent-accounts-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Agent Accounts | Polypad',
  description: 'One account for your agent: a registered identity with a credit score, money in a vault it can spend, limits you control, and a connection to everything Polypad does.',
  path: '/agents/accounts',
});

export default function AgentAccountsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <AgentAccountsContent />
      </main>
      <Footer />
    </div>
  );
}
