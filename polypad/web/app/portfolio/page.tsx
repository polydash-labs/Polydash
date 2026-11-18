import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { PortfolioContent } from './_components/portfolio-content';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Portfolio | Polypad',
  description: 'Your Polypad token balances, commitments and created tokens on Robinhood Chain. Connect a wallet to view.',
  path: '/portfolio',
});

export default function PortfolioPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <PortfolioContent />
      </main>
      <Footer />
    </div>
  );
}
