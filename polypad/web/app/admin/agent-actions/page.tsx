import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { AgentActionsAdmin } from './_components/agent-actions-admin';

export const metadata: Metadata = {
  title: 'Agent actions',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AgentActionsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <AgentActionsAdmin />
      </main>
      <Footer />
    </div>
  );
}
