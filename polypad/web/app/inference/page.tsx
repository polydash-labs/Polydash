import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { InferenceContent } from './_components/inference-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'AI inference marketplace | Polypad',
  description:
    'Pick an AI inference provider, check its on-chain reputation, and pay a few cents per answer with x402. No account, no subscription — live on Robinhood Chain.',
  path: '/inference',
});

export default function InferencePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <InferenceContent />
      </main>
      <Footer />
    </div>
  );
}
