import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { LaunchDocs } from './_components/launch-docs';

export const metadata: Metadata = pageMetadata({
  title: 'Launch with your agent | Polypad',
  description: 'Non-custodial agent API for Polypad on Robinhood Chain. Build an unsigned createLaunch transaction, sign it with your own wallet, then register it.',
  path: '/agents/launch',
  noindex: true,
});

export default function AgentLaunchPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <LaunchDocs />
      </main>
      <Footer />
    </div>
  );
}
