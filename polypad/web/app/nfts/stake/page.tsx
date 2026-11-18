import { redirect } from 'next/navigation';

// NFT pools now live in the NFTs tab of the staking page.
export default function NftStakePage() {
  redirect('/stake?tab=nfts');
}
