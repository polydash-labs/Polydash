'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, type Abi } from 'viem';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTokens, shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { NftStakingPoolABI } from '@/lib/contracts/nft-staking-pool-abi';
import { useNftStakingPool, useStakingTx, useUserPoolState } from '@/lib/hooks/use-nft-staking';
import { BOOST_NOTE, NFT_STAKING_FACTORY_ADDRESS, formatDuration, isAddr, multLabel, poolStatus, type Addr } from '@/lib/nftStaking';
import { useNowSec } from '@/app/stake/_components/primitives';
import { CollectionTag, FactoryMissing, PoolStatusPill, RiskNote } from '@/components/nft-staking/notes';
import { poolName } from '@/components/nft-staking/pool-card';
import { StakePanel } from './stake-panel';
import { Leaderboard } from './leaderboard';
import { ShareCard } from './share-card';

const MAX_BATCH = 50;

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
      <p className="text-[11px] text-white/55">{label}</p>
      <p className="mt-1 font-mono text-[15px] text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-white/50">{sub}</p>}
    </div>
  );
}

const fmtLive = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 2 : 4 });

export function PoolDetail({ pool }: { pool: string }) {
  const valid = isAddr(pool);
  const { address: user } = useAccount();
  const now = useNowSec(1000);
  const q = useNftStakingPool(valid ? pool : undefined);
  const p = q.data ?? null;
  const st = useUserPoolState(p?.address, p?.collection, user as Addr | undefined);
  const state = st.data;
  const { send, pending } = useStakingTx();
  const [origin, setOrigin] = useState('https://polypad.family');
  useEffect(() => setOrigin(globalThis.location?.origin ?? 'https://polypad.family'), []);

  const back = (
    <Link href="/nfts/stake" className="inline-flex items-center gap-1 text-[12px] text-white/60 hover:text-white">
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} /> All NFT pools
    </Link>
  );

  if (!NFT_STAKING_FACTORY_ADDRESS) {
    return <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">{back}<FactoryMissing /><RiskNote /></div>;
  }
  if (!valid || (!q.isLoading && !p)) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        {back}
        <div className="glass-card p-6 text-center">
          <p className="text-[14px] font-medium text-white">{q.isError ? 'Could not load this pool' : 'Pool not found'}</p>
          <p className="mt-1 text-[12px] text-white/55">{q.isError ? 'The network did not respond. Try again shortly.' : 'This address is not an NFT staking pool from the Polypad factory.'}</p>
        </div>
      </div>
    );
  }
  if (!p) {
    return <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">{back}<div className="h-64 animate-pulse rounded-2xl bg-white/[0.04]" /></div>;
  }

  const status = now ? poolStatus(now, p.start, p.end) : 'active';
  const ended = status === 'ended';
  const timeLabel = !now ? '—' : status === 'upcoming' ? `Starts in ${formatDuration(p.start - now)}` : ended ? 'Ended' : `${formatDuration(p.end - now)} left`;
  const boosted = p.tierBps.length > 1;
  const ready = (state?.ids ?? []).filter((s) => s.eligibleTier > s.tier).map((s) => s.id).slice(0, MAX_BATCH);

  // Live ticker: last on-chain earned() plus a client-side count-up at rewardsPerDay / 86400.
  const dec = p.rewardDecimals;
  const base = state ? Number(formatUnits(state.earned, dec)) : 0;
  const perSec = state ? Number(formatUnits(state.perDay, dec)) / 86_400 : 0;
  const tickEnd = Math.min(now || 0, p.end);
  const elapsed = state && now && !ended ? Math.max(0, tickEnd - state.fetchedAt) : 0;
  const live = base + perSec * elapsed;

  const claim = () => ready.length
    ? send({ key: 'claim', address: p.address, abi: NftStakingPoolABI as Abi, functionName: 'pokeAndClaim', args: [ready], fn: 'pokeAndClaim', ids: ready.length, success: 'Boost activated and rewards claimed' })
    : send({ key: 'claim', address: p.address, abi: NftStakingPoolABI as Abi, functionName: 'claim', args: [], fn: 'claim', success: 'Rewards claimed' });
  const recover = () => send({ key: 'recover', address: p.address, abi: NftStakingPoolABI as Abi, functionName: 'recoverUnallocated', args: [], fn: 'recoverUnallocated', success: 'Unallocated rewards recovered' });
  const isCreator = !!user && user.toLowerCase() === p.creator.toLowerCase();

  const myTop = (state?.ids ?? []).reduce((m, s) => Math.max(m, s.tier), 0);
  const share = {
    collection: p.collectionName,
    poolName: poolName(p),
    staked: Number(state?.staked ?? BigInt(0)),
    tier: boosted ? `Tier ${myTop + 1} · ${multLabel(p.tierBps[myTop] ?? 10_000)}` : 'No boost',
    setBonus: p.setMin > 0 && p.setBonusBps > 0 ? (state?.setBonus ? `+${p.setBonusBps / 100}% active` : 'Not active') : 'Not offered',
    url: `${origin}/nfts/stake/${p.address}`,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {back}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PoolStatusPill status={status} />
          <CollectionTag polypad={p.polypad} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{poolName(p)}</h1>
        <p className="text-[13px] text-white/60">
          Stake {p.collectionSymbol || 'NFTs'} from{' '}
          <Link href={p.polypad ? `/nfts/${p.collection}` : getExplorerAddressUrl(p.collection)} target={p.polypad ? undefined : '_blank'} rel="noopener noreferrer" className="text-white/80 underline-offset-2 hover:underline">{p.collectionName}</Link>
          {' '}and earn {p.rewardSymbol}. Pool{' '}
          <a href={getExplorerAddressUrl(p.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono text-white/70 hover:text-white">{shortenAddress(p.address)}<ExternalLink className="h-3 w-3" strokeWidth={1.5} /></a>
        </p>
      </header>

      <RiskNote />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Time left" value={timeLabel} />
        <Stat label="Total staked" value={`${p.totalStaked.toString()} NFTs`} />
        <Stat label="Total funded" value={`${formatTokens(p.totalFunded, dec)} ${p.rewardSymbol}`} />
        <Stat label="Your staked" value={user ? `${Number(state?.staked ?? 0)} NFTs` : '—'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <StakePanel p={p} user={user as Addr | undefined} state={state} now={now} ended={ended} />
          <Leaderboard pool={p.address} me={user as Addr | undefined} />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="glass-card space-y-4 p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold text-white">Pending rewards</h2>
              <span className="text-[11px] text-white/55">Estimated</span>
            </div>
            <p className="font-mono text-2xl tabular-nums text-white">{user && state ? fmtLive(live) : '—'} <span className="text-[13px] text-white/60">{p.rewardSymbol}</span></p>
            <p className="text-[11px] text-white/55">Counts up between on-chain reads every 30 seconds. The amount you receive is what the contract pays at claim time.</p>
            <Button className="w-full rounded-full" disabled={!user || !!pending || !state || (state.earned === BigInt(0) && !ready.length)} onClick={claim}>
              {pending === 'claim' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {ready.length ? 'Activate boost and claim' : 'Claim'}
            </Button>
            {boosted && (
              <div className="space-y-1.5 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
                <p className="text-[12px] font-medium text-white">Loyalty boost</p>
                <ul className="space-y-0.5 text-[12px] text-white/65">
                  {p.tierBps.map((b, i) => (
                    <li key={i} className="flex justify-between"><span>Tier {i + 1}: {p.tierAfter[i] ? `after ${formatDuration(p.tierAfter[i])}` : 'from stake'}</span><span className="font-mono">{multLabel(b)}</span></li>
                  ))}
                </ul>
                <p className="text-[11px] text-white/55">{BOOST_NOTE}</p>
              </div>
            )}
            {p.setMin > 0 && p.setBonusBps > 0 && (
              <p className="text-[12px] text-white/65">Set bonus: +{p.setBonusBps / 100}% weight while you stake {p.setMin} or more.</p>
            )}
          </section>

          {isCreator && ended && p.pendingUnallocated > BigInt(0) && (
            <section className="glass-card space-y-3 p-4 sm:p-5">
              <h2 className="text-[15px] font-semibold text-white">Creator</h2>
              <p className="text-[12px] text-white/60">{formatTokens(p.pendingUnallocated, dec)} {p.rewardSymbol} was never allocated to stakers and can be returned to you.</p>
              <Button variant="outline" className="w-full rounded-full" disabled={!!pending} onClick={recover}>
                {pending === 'recover' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Recover unallocated
              </Button>
            </section>
          )}

          {user && <ShareCard data={share} />}
        </aside>
      </div>
    </div>
  );
}
