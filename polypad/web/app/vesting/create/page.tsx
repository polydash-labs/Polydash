import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { CreateVaultForm } from './_components/create-vault-form';

export const metadata = pageMetadata({
  title: 'Lock & stake | Polypad',
  description: 'Lock Polypad tokens in a vesting vault and optionally stake them in a V2 pool. New contract. Security-scanned with Bevor. Not a formal audit. Not financial advice.',
  path: '/vesting/create',
});

export default async function CreateVestingPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const initial = typeof token === 'string' && /^0x[0-9a-fA-F]{40}$/.test(token) ? token : '';
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CreateVaultForm initialToken={initial} />
      </main>
      <Footer />
    </div>
  );
}
