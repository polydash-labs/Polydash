'use client';

import { TabBar, useUrlTab } from '@/components/nft-staking/url-tabs';
import { NftStakeList } from '@/app/nfts/stake/_components/nft-stake-list';
import { StakeExplore } from './stake-explore';

const KEYS = ['tokens', 'nfts'] as const;
const TABS = [{ k: 'tokens', label: 'Tokens' }, { k: 'nfts', label: 'NFTs' }] as const;

export function StakeTabs({ initialTab }: { initialTab?: string | null }) {
  const [tab, setTab] = useUrlTab(KEYS, 'tokens', initialTab);
  return (
    <>
      <div className="mx-auto w-full max-w-container px-4 pt-6 sm:px-6 lg:px-8">
        <TabBar tabs={TABS} value={tab} onChange={setTab} label="Staking type" />
      </div>
      {tab === 'nfts' ? <NftStakeList embedded /> : <StakeExplore />}
    </>
  );
}
