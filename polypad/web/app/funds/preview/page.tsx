import type { Metadata } from 'next';
import { AssetListPreview } from './_components/asset-list-preview';

export const metadata: Metadata = {
  title: 'Propose an asset (preview) | Tokenized Funds | Polypad',
  robots: { index: false, follow: false },
};

export default function TokenizedFundPreviewPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <AssetListPreview />
    </div>
  );
}
