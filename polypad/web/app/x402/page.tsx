import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { X402Content } from './_components/x402-content';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Pay per call | Polypad',
  description: 'Agents pay per API call on Robinhood Chain — token reports, CTO reports, and Tokenized Fund NAV snapshots, settled in USDG or POLYDASH with x402. No account, no subscription.',
  path: '/x402',
});

export default function X402Page() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <X402Content />
      </main>
      <Footer />
    </div>
  );
}
