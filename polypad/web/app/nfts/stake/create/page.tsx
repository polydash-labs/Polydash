import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { CreatePoolForm } from './_components/create-pool-form';

export const metadata = pageMetadata({
  title: 'Create an NFT staking pool | Polypad',
  description: 'Create a reward pool for any ERC-721 collection on Robinhood Chain. New contract. Security-scanned with Bevor. Not a formal audit.',
  path: '/nfts/stake/create',
  noindex: true,
});

export default async function CreateNftPoolPage({ searchParams }: { searchParams: Promise<{ collection?: string }> }) {
  const { collection } = await searchParams;
  const initial = typeof collection === 'string' && /^0x[0-9a-fA-F]{40}$/.test(collection) ? collection : '';
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CreatePoolForm initialCollection={initial} />
      </main>
      <Footer />
    </div>
  );
}
