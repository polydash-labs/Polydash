import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BuildContent } from './_components/build-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Build on Polypad | Developer hub',
  description: 'No signup, no API key, no approval. Connect your agent to Polypad with MCP, pay for API calls with x402, and give it a spending vault with limits you set.',
  path: '/build',
});

export default function BuildPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <Suspense>
          <BuildContent />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
