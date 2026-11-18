import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { NftExplore } from './_components/nft-explore';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'NFT collections | Polypad',
  description: 'NFT collections on Robinhood Chain: commitment-window or bonding-curve mints, a floor vault per NFT, and creator royalties.',
  path: '/nfts',
});

export default function NftsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <NftExplore />
      </main>
      <Footer />
    </div>
  );
}
