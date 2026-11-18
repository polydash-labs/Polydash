'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles, Layers } from 'lucide-react';
import { formatTokens } from '@/lib/format';
import { formatDuration, multLabel, poolStatus } from '@/lib/nftStaking';
import type { StakingPool } from '@/lib/hooks/use-nft-staking';
import { CollectionTag, PoolStatusPill } from './notes';

export const poolName = (p: Pick<StakingPool, 'collectionName' | 'rewardSymbol'>) => `${p.collectionName} / ${p.rewardSymbol} pool`;

export function PoolCard({ p, now }: { p: StakingPool; now: number }) {
  const status = poolStatus(now, p.start, p.end);
  const left = status === 'upcoming' ? `Starts in ${formatDuration(p.start - now)}` : status === 'ended' ? 'Ended' : `${formatDuration(p.end - now)} left`;
  const maxTier = Math.max(...p.tierBps);
  return (
    <Link href={`/nfts/stake/${p.address}`} className="glass-card group block p-4 transition hover:border-white/20 hover:bg-white/[0.05] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-white">{poolName(p)}</p>
          <p className="mt-0.5 text-[12px] text-white/55">Stake {p.collectionSymbol || 'NFTs'}, earn {p.rewardSymbol}</p>
        </div>
        <PoolStatusPill status={status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <CollectionTag polypad={p.polypad} />
        {p.tierBps.length > 1 && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-[11px] text-white/70 ring-1 ring-inset ring-white/10">
            <Sparkles className="h-3 w-3" strokeWidth={1.75} /> Loyalty boost up to {multLabel(maxTier)}
          </span>
        )}
        {p.setMin > 0 && p.setBonusBps > 0 && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-[11px] text-white/70 ring-1 ring-inset ring-white/10">
            <Layers className="h-3 w-3" strokeWidth={1.75} /> Set bonus +{p.setBonusBps / 100}% at {p.setMin}+
          </span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
        <div><p className="text-white/50">Time left</p><p className="mt-0.5 font-mono text-white">{now ? left : '—'}</p></div>
        <div><p className="text-white/50">Total staked</p><p className="mt-0.5 font-mono text-white">{p.totalStaked.toString()} NFTs</p></div>
        <div><p className="text-white/50">Total funded</p><p className="mt-0.5 font-mono text-white">{formatTokens(p.totalFunded, p.rewardDecimals)} {p.rewardSymbol}</p></div>
      </div>
      <p className="mt-3 inline-flex items-center gap-1 text-[12px] text-polydash-green">Open pool <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" strokeWidth={1.75} /></p>
    </Link>
  );
}
