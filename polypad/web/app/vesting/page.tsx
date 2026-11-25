import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { VestingIndex } from './_components/vesting-index';

export const metadata = pageMetadata({
  title: 'Creator vesting | Polypad',
  description: 'Lock Polypad tokens on a vesting schedule and optionally stake them. New contract. Security-scanned with Bevor. Not a formal audit. Not financial advice.',
  path: '/vesting',
});

export default function VestingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <VestingIndex />
      </main>
      <Footer />
    </div>
  );
}
