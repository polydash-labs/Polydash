import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { CreateBondForm } from './_components/create-bond-form';

export const metadata = pageMetadata({
  title: 'Post a creator bond | Polypad',
  description: 'Post an ETH bond against a token balance floor for registered wallets. New contract. Security-scanned with Bevor. Not a formal audit. Not financial advice.',
  path: '/bond/create',
});

export default async function CreateBondPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const initial = typeof token === 'string' && /^0x[0-9a-fA-F]{40}$/.test(token) ? token : '';
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CreateBondForm initialToken={initial} />
      </main>
      <Footer />
    </div>
  );
}
