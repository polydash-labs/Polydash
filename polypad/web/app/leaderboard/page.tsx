import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { LeaderboardContent } from './_components/leaderboard-content';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Leaderboard | Polypad',
  description: 'Polypad tokens on Robinhood Chain ranked by volume, market cap and bonding curve progress.',
  path: '/leaderboard',
});

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <LeaderboardContent />
      </main>
      <Footer />
    </div>
  );
}
