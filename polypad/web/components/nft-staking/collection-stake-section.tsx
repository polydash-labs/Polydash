'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNowSec } from '@/app/stake/_components/primitives';
import { useNftStakingPools } from '@/lib/hooks/use-nft-staking';
import { NFT_STAKING_FACTORY_ADDRESS, NOT_AUDITED_NOTE, type Addr } from '@/lib/nftStaking';
import { PoolCard } from './pool-card';

/** Stake tab content on a collection page: this collection's pools plus a Create pool shortcut. */
export function CollectionStakeSection({ collection, name }: { collection: Addr; name: string }) {
  const live = !!(NFT_STAKING_FACTORY_ADDRESS as Addr | null);
  const { data: pools, isLoading } = useNftStakingPools(collection);
  const now = useNowSec(15_000);
  return (
    <section id="stake" className="glass-card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Stake</h2>
          <p className="text-[12px] text-white/55">Stake {name} NFTs in reward pools.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline" className="rounded-full"><Link href="/nfts/stake">All pools</Link></Button>
          <Button asChild size="sm" className="rounded-full">
            <Link href={`/nfts/stake/create?collection=${collection}`}><Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />Create pool</Link>
          </Button>
        </div>
      </div>
      {!live ? (
        <p className="text-[12px] text-white/55">NFT staking is not live yet. Pools will appear here once the staking factory is deployed.</p>
      ) : isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
      ) : pools && pools.length ? (
        <div className="grid gap-3">{pools.map((p) => <PoolCard key={p.address} p={p} now={now} />)}</div>
      ) : (
        <p className="text-[12px] text-white/55">No pools for this collection yet.</p>
      )}
      <p className="text-[11px] text-white/55">{NOT_AUDITED_NOTE}</p>
    </section>
  );
}
