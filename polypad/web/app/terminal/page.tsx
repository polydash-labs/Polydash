import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { TerminalContent } from './_components/terminal-content';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Terminal | Polypad',
  description: 'Live activity across Polypad — Tokenized Fund NAV rankings, recent trades, share mints and new staking pools, read straight from Robinhood Chain.',
  path: '/terminal',
});

export default function TerminalPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <TerminalContent />
      </main>
      <Footer />
    </div>
  );
}
