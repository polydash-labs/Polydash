'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Layers, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StakingState, StakingStatus, StakingStatusLite } from '@/lib/staking-status';

export const STAKE_PAGE_URL = 'https://polypad.family/stake';
export const stakePoolUrl = (pool: string) => `https://polypad.family/stake/${pool}`;
const COMMITTED_TIP = 'An active Polydash staking pool exists for this token. Pool terms are set by its creator. Not financial advice.';

/** Batch statuses for all launch tokens (one request for every card). Keys are lowercase token addresses. */
export function useStakingStatuses() {
  const q = useQuery({
    queryKey: ['staking-statuses'],
    queryFn: async (): Promise<Record<string, StakingStatusLite> | null> => {
      const res = await fetch('/api/staking-status');
      if (!res.ok) throw new Error(`staking-status ${res.status}`);
      return ((await res.json()) as { statuses: Record<string, StakingStatusLite> | null }).statuses;
    },
    staleTime: 120_000,
    refetchInterval: 300_000,
  });
  return q.data ?? null;
}

/** Full status for one token (pools with end times). */
export function useStakingStatus(token?: string | null) {
  const q = useQuery({
    queryKey: ['staking-status', token?.toLowerCase()],
    enabled: !!token,
    queryFn: async (): Promise<StakingStatus> => {
      const res = await fetch(`/api/staking-status/${token}`);
      if (!res.ok) throw new Error(`staking-status ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });
  return q.data ?? null;
}

export function StakingBadgeView({ state, byCreator, size = 'sm' }: { state?: StakingState | null; byCreator?: boolean; size?: 'sm' | 'md' }) {
  if (!state || state === 'unknown') return null;
  const cls = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]';
  const icon = <Layers className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={1.75} aria-hidden />;
  if (state === 'committed') {
    return (
      <span title={COMMITTED_TIP} className={cn('inline-flex items-center gap-1 rounded-full bg-polydash-green/15 font-medium text-polydash-green', cls)}>
        {icon}Staking committed{byCreator ? <span className="text-polydash-green/80">· by creator</span> : null}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-white/[0.06] font-medium text-white/60', cls)}>
      {icon}{state === 'ended' ? 'Staking ended' : 'No staking pool'}
    </span>
  );
}

/** Card badge (batch data). */
export function StakingBadge({ token }: { token?: string }) {
  const all = useStakingStatuses();
  if (!token || !all) return null;
  const s = all[token.toLowerCase()];
  return <StakingBadgeView state={s?.state ?? 'none'} byCreator={s?.byCreator} />;
}

/** Header badge (single-token data). */
export function StakingBadgeFull({ token }: { token?: string }) {
  const s = useStakingStatus(token);
  if (!s) return null;
  const byCreator = s.state === 'committed' ? s.pools.some((p) => p.active && p.byCreator) : false;
  return <StakingBadgeView state={s.state} byCreator={byCreator} size="md" />;
}

const fmtDay = (sec: number) => new Date(sec * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** PolyCTO row: active pool (ends date) / ended / none found. */
export function StakingRow({ token }: { token?: string }) {
  const s = useStakingStatus(token);
  if (!s || s.state === 'unknown') return null;
  const active = s.pools.filter((p) => p.active).sort((a, b) => Number(b.byCreator) - Number(a.byCreator) || b.endTime - a.endTime)[0];
  const latest = [...s.pools].sort((a, b) => b.endTime - a.endTime)[0];
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="inline-flex items-center gap-1.5 text-white/65"><Layers className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />Staking</span>
      {s.state === 'committed' && active ? (
        <a href={stakePoolUrl(active.pool)} className="text-polydash-green hover:underline">Active pool (ends {fmtDay(active.endTime)}){active.byCreator ? ' · by creator' : ''}</a>
      ) : s.state === 'ended' && latest ? (
        <a href={stakePoolUrl(latest.pool)} className="text-white/70 hover:underline">Ended</a>
      ) : (
        <span className="text-white/55">None found</span>
      )}
    </div>
  );
}

/** Shown only to the launch creator when the token has no staking pool. */
export function CreateStakingPoolButton({ token, creator }: { token?: string; creator?: string | null }) {
  const { address } = useAccount();
  const s = useStakingStatus(token);
  if (!address || !creator || address.toLowerCase() !== creator.toLowerCase() || s?.state !== 'none') return null;
  return (
    <a
      href={STAKE_PAGE_URL}
      className="inline-flex items-center gap-1.5 rounded-full bg-polydash-green px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-110"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      Create staking pool
    </a>
  );
}
