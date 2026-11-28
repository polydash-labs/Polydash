import { pageMetadata } from '@/lib/seo';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { NftCreateWizard } from './_components/nft-create-wizard';

export const metadata = pageMetadata({
  title: 'Create NFT collection | Polypad',
  description: 'Launch an NFT collection on Robinhood Chain with Polypad.',
  path: '/nfts/create',
  noindex: true,
});

export default function NftCreatePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <NftCreateWizard />
      </main>
      <Footer />
    </div>
  );
}
