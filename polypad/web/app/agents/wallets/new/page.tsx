import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { WizardContent } from './_components/wizard-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Create an agent wallet | Polypad',
  description: 'Three steps, about two minutes: name it, add money, set limits, plug your agent in. Your agent gets its own Safe wallet on Robinhood Chain.',
  path: '/agents/wallets/new',
});

export default function NewAgentWalletPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <WizardContent />
      </main>
      <Footer />
    </div>
  );
}
