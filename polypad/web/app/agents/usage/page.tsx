import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { AgentUsageContent } from './_components/agent-usage-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'API Usage | Polypad',
  description: 'See what your Pro API key has been used for: calls per day, calls by tool, reads vs prepares, and how close you are to your per-minute limits.',
  path: '/agents/usage',
});

export default function AgentUsagePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <AgentUsageContent />
      </main>
      <Footer />
    </div>
  );
}
