import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { VaultDetailView } from './_components/vault-detail';

export async function generateMetadata({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  return pageMetadata({
    title: 'Vesting vault | Polypad',
    description: 'Creator vesting vault on Robinhood Chain. New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.',
    path: `/vesting/${vault}`,
  });
}

export default async function VestingVaultPage({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <VaultDetailView vault={vault} />
      </main>
      <Footer />
    </div>
  );
}
