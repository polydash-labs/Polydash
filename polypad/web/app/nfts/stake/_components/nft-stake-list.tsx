'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Layers, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNowSec } from '@/app/stake/_components/primitives';
import { useNftStakingPools } from '@/lib/hooks/use-nft-staking';
import { BOOST_NOTE, NFT_STAKING_FACTORY_ADDRESS, poolStatus, type Addr } from '@/lib/nftStaking';
import { FactoryMissing, RiskNote } from '@/components/nft-staking/notes';
import { PoolCard } from '@/components/nft-staking/pool-card';

const FILTERS = [
  { k: 'live', label: 'Live' },
  { k: 'polypad', label: 'Polypad collections' },
  { k: 'outside', label: 'Outside collections' },
  { k: 'ended', label: 'Ended' },
  { k: 'all', label: 'All' },
] as const;

export function NftStakeList({ embedded = false }: { embedded?: boolean }) {
  const live = !!(NFT_STAKING_FACTORY_ADDRESS as Addr | null);
  const { data: pools, isLoading, isError } = useNftStakingPools();
  const now = useNowSec(15_000);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['k']>('live');

  const shown = useMemo(() => (pools ?? []).filter((p) => {
    const s = poolStatus(now, p.start, p.end);
    if (filter === 'live') return s !== 'ended';
    if (filter === 'ended') return s === 'ended';
    if (filter === 'polypad') return p.polypad;
    if (filter === 'outside') return !p.polypad;
    return true;
  }), [pools, filter, now]);

  return (
    <div className={embedded ? 'mx-auto w-full max-w-container px-4 pb-16 pt-6 sm:px-6 lg:px-8' : 'mx-auto max-w-5xl px-4 py-8 sm:py-12'}>
      {!embedded && <Link href="/nfts" className="inline-flex items-center gap-1 text-[12px] text-white/55 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />NFT collections</Link>}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">NFT staking</h1>
          <p className="mt-2 max-w-xl text-[13px] text-white/65">Stake your individual NFTs — each one has its own number (an ERC-721 token) — in reward pools to earn rewards. Anyone can create a pool for any collection and fund it with a reward token.</p>
        </div>
        <Button asChild className="rounded-full"><Link href="/nfts/stake/create"><Plus className="mr-1 h-4 w-4" strokeWidth={1.75} />Create pool</Link></Button>
      </div>

      <RiskNote className="mt-6" />
      {live && (
        <a href={`https://sourcify.dev/#/lookup/${NFT_STAKING_FACTORY_ADDRESS}`} target="_blank" rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-polydash-green hover:underline">
          View contract <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
        </a>
      )}
      <p className="mt-3 text-[12px] text-white/55">{BOOST_NOTE}</p>

      {!live ? (
        <FactoryMissing className="mt-6" />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter pools">
            {FILTERS.map((f) => (
              <button key={f.k} role="tab" aria-selected={filter === f.k} onClick={() => setFilter(f.k)}
                className={cn('h-11 min-h-[44px] rounded-full px-3 text-[12px] transition', filter === f.k ? 'bg-white text-black' : 'bg-white/[0.05] text-white/70 hover:bg-white/10')}>
                {f.label}
              </button>
            ))}
          </div>
          {isLoading ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
          ) : isError ? (
            <p className="mt-6 text-[13px] text-white/60">Could not load pools. Try again shortly.</p>
          ) : shown.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">{shown.map((p) => <PoolCard key={p.address} p={p} now={now} />)}</div>
          ) : (
            <div className="glass-card mt-4 flex flex-col items-center gap-3 p-10 text-center">
              <Layers className="h-6 w-6 text-white/50" strokeWidth={1.5} />
              <p className="text-[13px] text-white/65">No pools here yet.</p>
              <Button asChild size="sm" variant="outline" className="rounded-full"><Link href="/nfts/stake/create">Create the first pool</Link></Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
