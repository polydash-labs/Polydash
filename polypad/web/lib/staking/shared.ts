// Staking page: shared types, ABI and number formatting (isomorphic, no RPC).
import { parseAbi } from 'viem';
import { formatSmall } from '@/lib/format';

export const POLYDASH_TOKEN = '0x319525528f42167ef7fc18b77b889958080568e4';
export const POLYDASH_LOGO = '/polydash-mark-white.png';
export const ENDING_SOON_SEC = 3 * 86_400;

/** Verified PolydashStakingPoolV2 interface (withdraw takes SHARES; shares are 1:1 with tokens while solvent). */
export const stakingPoolAbi = parseAbi([
  'function stake(uint256 amount)',
  'function withdraw(uint256 shares)',
  'function claim()',
  'function exit()',
  'function emergencyWithdraw()',
  'function earned(address) view returns (uint256)',
  'function claimable(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function sharesToAmount(uint256) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function isActive() view returns (bool)',
  'error NotFunded()',
  'error ZeroAmount()',
  'error PoolEnded()',
  'error CapExceeded()',
  'error InsufficientBalance()',
  'error PoolInsolvent()',
]);
export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);

export type PoolStatus = 'active' | 'ending' | 'ended' | 'upcoming' | 'new';
export type AprKind = 'value' | 'new' | 'na' | 'ended';

export interface TokenInfo { address: string; symbol: string; name: string; decimals: number; logo: string | null; priceUsd: number | null }

export interface PoolSummary {
  address: string;
  name: string;
  description: string;
  creator: string | null;
  stake: TokenInfo;
  reward: TokenInfo;
  sameToken: boolean;
  totalStaked: number;
  totalRewards: number;
  totalRewardsPaid: number;
  rewardsPerDay: number;
  rewardsPerSec: number;
  startTime: number;
  endTime: number;
  stakerCount: number;
  maxTotalStake: number; // 0 = no cap
  claimFeeBps: number;
  funded: boolean;
  status: PoolStatus;
  apr: number | null;
  aprKind: AprKind;
  tvlUsd: number | null;
  createdBlock: number | null;
  createdAt: number | null;
  featured: boolean;
  spark: number[]; // total staked, daily, last 30 days
  factory: string | null; // the staking factory that created this pool
  verified: boolean; // verified flag from that pool's own factory
}

export interface TokenTotal { address: string; symbol: string; logo: string | null; amount: number; usd: number | null }

export interface StakeTotals {
  pools: number;
  active: number;
  staked: TokenTotal[];
  rewardsAllocated: TokenTotal[];
  rewardsPaid: TokenTotal[];
  stakers: number | null; // unique wallets with a stake > 0 (null until the first full event scan)
  stakersExact: boolean;
}

export interface PoolsResponse { pools: PoolSummary[]; totals: StakeTotals; analyticsPending: boolean; updatedAt: number }

export interface DayPoint { t: number; staked: number; in: number; out: number }
export interface FlowItem { type: 'stake' | 'withdraw' | 'emergency' | 'claim'; user: string; amount: number; tx: string; ts: number }
export interface TopStaker { user: string; amount: number; share: number }

export interface PoolDetailResponse {
  pool: PoolSummary;
  series: DayPoint[];
  top: TopStaker[];
  flows: FlowItem[];
  emitted: number; // released by schedule so far
  analyticsPending: boolean;
  updatedAt: number;
}

// ---------- formatting (never scientific notation) ----------
export function fmtNum(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e15) return `${v < 0 ? '-' : ''}>999T`;
  if (a >= 1000 && opts.compact !== false) {
    return v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: a >= 1e5 && a < 1e6 ? 1 : 2 });
  }
  if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return formatSmall(v);
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  if (v > 0 && v < 0.01) return `$${formatSmall(v)}`;
  return `$${fmtNum(v)}`;
}

export function fmtApr(p: Pick<PoolSummary, 'apr' | 'aprKind'>): string {
  if (p.aprKind === 'ended') return 'Ended';
  if (p.aprKind === 'new') return 'No rewards yet';
  if (p.aprKind === 'na' || p.apr == null) return 'No data yet';
  const a = p.apr;
  if (a >= 100_000) return `${fmtNum(a)}%`;
  if (a >= 100) return `${Math.round(a).toLocaleString('en-US')}%`;
  return `${a.toLocaleString('en-US', { maximumFractionDigits: a < 1 ? 3 : 2 })}%`;
}

export function fmtDuration(sec: number): string {
  if (sec <= 0) return 'Ended';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
}

export function poolStatus(p: { startTime: number; endTime: number; totalStaked: number }, now: number): PoolStatus {
  if (p.endTime > 0 && now >= p.endTime) return 'ended';
  if (p.startTime > now) return 'upcoming';
  if (p.totalStaked === 0) return 'new';
  if (p.endTime - now < ENDING_SOON_SEC) return 'ending';
  return 'active';
}

/** Fraction of the reward period elapsed, 0..1. */
export function elapsedFrac(p: { startTime: number; endTime: number }, now: number): number {
  const span = p.endTime - p.startTime;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (now - p.startTime) / span));
}

/** Plain-decimal string for an input field (no exponent), trimmed to `maxDp` decimals. */
export function toInputString(v: number, maxDp = 6): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  return v.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: maxDp });
}

export const STAKE_ERRORS: Record<string, string> = {
  NotFunded: 'This pool is not funded yet.',
  ZeroAmount: 'Enter an amount above zero.',
  PoolEnded: 'This pool has ended. Staking is closed.',
  CapExceeded: 'That is over the pool limit.',
  InsufficientBalance: 'Not enough balance.',
  PoolInsolvent: 'The pool cannot pay this right now.',
};
