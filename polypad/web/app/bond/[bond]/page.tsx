import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { BondDetailView } from './_components/bond-detail';

export async function generateMetadata({ params }: { params: Promise<{ bond: string }> }) {
  const { bond } = await params;
  return pageMetadata({
    title: 'Creator bond | Polypad',
    description: 'Creator bond on Robinhood Chain. New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.',
    path: `/bond/${bond}`,
  });
}

export default async function BondPage({ params }: { params: Promise<{ bond: string }> }) {
  const { bond } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <BondDetailView bond={bond} />
      </main>
      <Footer />
    </div>
  );
}
