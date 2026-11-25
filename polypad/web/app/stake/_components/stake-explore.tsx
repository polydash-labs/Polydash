'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDownToLine, ArrowRight, Coins, Layers, Search, Wallet, X } from 'lucide-react';
import { formatUnits } from 'viem';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { elapsedFrac, fmtApr, fmtDuration, fmtNum, fmtUsd, type PoolSummary, type TokenTotal } from '@/lib/staking/shared';
import { AprLabel, EmptyState, FOOTER_NOTE, PairLabel, ProgressBar, Shimmer, StatusPill, TextPill, TokenLogo, TokenPair, sym, useNowSec } from './primitives';
import { ActionPanel } from './action-panel';
import { usePositions, useStakePools, type Position } from './use-stake';
import { HP_TOOLTIP, HpChipView, HpTierFilter, tierRank, useHolderProtectionsAll } from '@/components/holder-protections';
import type { Tier } from '@/lib/holder-protections';
import { BuyEthButton } from '@/components/onramp/buy-eth';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';

type PoolHp = { tier: Tier; passed: number; creatorTier: Tier };

type Tab = 'all' | 'active' | 'ended' | 'mine';
type Sort = 'apr' | 'tvl' | 'newest';
const Z = BigInt(0);

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 767px)');
    setM(q.matches);
    const on = () => setM(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return m;
}

const isLive = (p: PoolSummary) => p.status !== 'ended';
const aprSortVal = (p: PoolSummary) => (p.aprKind === 'value' && p.apr != null ? p.apr : p.aprKind === 'new' ? -1 : p.aprKind === 'na' ? -2 : -3);
const tvlSortVal = (p: PoolSummary) => p.tvlUsd ?? p.totalStaked * 1e-12;

/** Single headline figure for a per-token total: USD when every token is priced, else the largest token amount — always with its unit. */
function totalFigure(list: TokenTotal[]): { value: number; format: (v: number) => string; sub: string | null } {
  if (!list.length) return { value: 0, format: (v) => fmtNum(v), sub: null };
  if (list.every((t) => t.usd != null)) {
    const usd = list.reduce((a, t) => a + (t.usd ?? 0), 0);
    return { value: usd, format: (v) => fmtUsd(v), sub: list.length > 1 ? `${list.length} tokens` : `${fmtNum(list[0].amount)} ${sym(list[0])}` };
  }
  const top = [...list].sort((a, b) => b.amount - a.amount)[0];
  return {
    value: top.amount,
    format: (v) => `${fmtNum(v)} ${sym(top)}`,
    sub: list.length > 1
      ? `Value unavailable for some pools — total shown in ${sym(top)}`
      : `Value unavailable — total shown in ${sym(top)}`,
  };
}

/** Dollar value for a token amount, or null when the token has no price. */
function usdFor(priceUsd: number | null | undefined, amount: number): string | null {
  return priceUsd != null && priceUsd > 0 ? fmtUsd(amount * priceUsd) : null;
}

/** A token amount with its dollar value underneath, when the token is priced. */
function AmountUsd({ amount, symbol, priceUsd, accent }: { amount: number; symbol: string; priceUsd: number | null | undefined; accent?: boolean }) {
  const usd = usdFor(priceUsd, amount);
  return (
    <span className="block">
      <span className={cn('tabular-nums', accent ? 'text-polydash-green' : 'text-white/90')}>{fmtNum(amount)} {symbol}</span>
      {usd && <span className="mt-0.5 block text-[11.5px] tabular-nums text-white/45">{usd}</span>}
    </span>
  );
}

function StatTile({ label, value, format, sub, loading, unavailable }: { label: string; value: number; format?: (v: number) => string; sub?: string | null; loading: boolean; /** Value not yet known (e.g. a slow event scan) — show a dash with the sub explaining, not a blank pill. */ unavailable?: boolean }) {
  return (
    <div className="stk-glass flex min-h-[112px] flex-col justify-between p-4 sm:p-5">
      <p className="text-[12px] text-white/55">{label}</p>
      {loading ? <Shimmer className="h-8 w-28" /> : unavailable ? (
        <p className="break-words text-[22px] font-semibold leading-tight tabular-nums text-white/40 sm:text-[26px]">—</p>
      ) : (
        <p className="break-words text-[22px] font-semibold leading-tight tabular-nums text-white sm:text-[26px]">{(format ?? fmtNum)(value)}</p>
      )}
      <p className="mt-1 text-[11px] leading-snug text-white/45">{loading ? '' : sub ?? ''}</p>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Layers, title: 'Pick a pool', text: 'Check the token address and the reward.' },
    { icon: ArrowDownToLine, title: 'Stake', text: 'Approve once, then stake. You sign everything.' },
    { icon: Coins, title: 'Claim anytime', text: 'Rewards add up every second while a pool is running. Withdraw when you like. When a pool ends, rewards stop — but your stake is still there to withdraw.' },
  ];
  return (
    <ol className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-polydash-green/10 text-polydash-green ring-1 ring-polydash-green/25">
            <s.icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-[14px] font-medium text-white"><span className="mr-1.5 text-white/40 tabular-nums">{i + 1}.</span>{s.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/55">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function tvlText(p: PoolSummary) {
  return p.tvlUsd != null ? fmtUsd(p.tvlUsd) : `${fmtNum(p.totalStaked)} ${sym(p.stake)}`;
}

function Leaderboard({ pools, now }: { pools: PoolSummary[]; now: number }) {
  const [sort, setSort] = useState<Sort>('apr');
  const rows = useMemo(() => {
    const list = [...pools];
    if (sort === 'apr') list.sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || aprSortVal(b) - aprSortVal(a));
    if (sort === 'tvl') list.sort((a, b) => tvlSortVal(b) - tvlSortVal(a));
    if (sort === 'newest') list.sort((a, b) => (b.createdBlock ?? 0) - (a.createdBlock ?? 0));
    return list;
  }, [pools, sort]);
  const topAddr = useMemo(() => {
    const c = pools.filter((p) => p.aprKind === 'value' && isLive(p)).sort((a, b) => aprSortVal(b) - aprSortVal(a))[0];
    return c?.address;
  }, [pools]);

  return (
    <section aria-labelledby="apr-rank" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="apr-rank" className="text-[18px] font-semibold text-white">APR rankings</h2>
          <AprLabel className="mt-1" />
        </div>
        <div role="tablist" aria-label="Sort rankings" className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          {([['apr', 'APR'], ['tvl', 'TVL'], ['newest', 'Newest']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={sort === k} onClick={() => setSort(k)}
              className={cn('h-9 rounded-lg px-3 text-[13px] transition-colors', sort === k ? 'bg-white/[0.09] text-white' : 'text-white/55 hover:text-white')}>{l}</button>
          ))}
        </div>
      </div>

      {/* desktop table */}
      <div className="stk-glass hidden overflow-hidden md:block">
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-white/40">
            <tr className="border-b border-white/[0.06]">
              <th className="py-3 pl-5 pr-2 font-medium">Rank</th>
              <th className="px-2 py-3 font-medium">Pool</th>
              <th className="px-2 py-3 text-right font-medium">APR</th>
              <th className="px-2 py-3 text-right font-medium">TVL</th>
              <th className="px-2 py-3 text-right font-medium">Rewards/day</th>
              <th className="px-2 py-3 text-right font-medium">Stakers</th>
              <th className="px-2 py-3 text-right font-medium">Time left</th>
              <th className="py-3 pl-2 pr-5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const top = p.address === topAddr;
              return (
                <tr key={p.address} className={cn('border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.025]', top && 'border-l-2 border-l-polydash-green/60 bg-polydash-green/[0.03]')}>
                  <td className="py-3 pl-5 pr-2 tabular-nums text-white/60">{i + 1}</td>
                  <td className="px-2 py-3">
                    <Link href={`/stake/${p.address}`} className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-polydash-green/50">
                      <TokenPair stake={p.stake} reward={p.reward} size={26} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2"><span className="truncate font-medium text-white">{p.name}</span>{top && <TextPill>Top APR</TextPill>}</span>
                        <PairLabel stake={p.stake} reward={p.reward} />
                      </span>
                    </Link>
                  </td>
                  <td className={cn('px-2 py-3 text-right text-[15px] font-semibold tabular-nums', p.aprKind === 'value' ? 'text-polydash-green' : 'text-white/70')}>{fmtApr(p)}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-white/80">
                    {tvlText(p)}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums text-white/80"><AmountUsd amount={p.status === 'ended' ? 0 : p.rewardsPerDay} symbol={sym(p.reward)} priceUsd={p.reward.priceUsd} /></td>
                  <td className="px-2 py-3 text-right tabular-nums text-white/80">{fmtNum(p.stakerCount)}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-white/70">{now ? fmtDuration(p.endTime - now) : ''}</td>
                  <td className="py-3 pl-2 pr-5 text-right"><StatusPill status={p.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <ol className="space-y-2 md:hidden">
        {rows.map((p, i) => {
          const top = p.address === topAddr;
          return (
            <li key={p.address}>
              <Link href={`/stake/${p.address}`} className={cn('stk-glass flex min-h-[64px] items-center gap-3 p-3', top && 'border-l-2 border-l-polydash-green/60')}>
                <span className="w-5 text-center text-[12px] tabular-nums text-white/50">{i + 1}</span>
                <TokenPair stake={p.stake} reward={p.reward} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><span className="truncate text-[14px] font-medium text-white">{p.name}</span>{top && <TextPill>Top APR</TextPill>}</span>
                  <span className="block truncate text-[11.5px] text-white/50">TVL {tvlText(p)} · {fmtNum(p.stakerCount)} stakers · {now ? fmtDuration(p.endTime - now) : ''}</span>
                </span>
                <span className={cn('shrink-0 text-right text-[15px] font-semibold tabular-nums', p.aprKind === 'value' ? 'text-polydash-green' : 'text-white/70')}>{fmtApr(p)}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PoolCard({ p, pos, connected, now, onOpen, mobile, hpTier, rotation }: { p: PoolSummary; pos?: Position; connected: boolean; now: number; onOpen: (p: PoolSummary, action?: 'unstake' | 'claim') => void; mobile: boolean; hpTier?: Tier; rotation?: boolean }) {
  const staked = pos ? Number(formatUnits(pos.staked, p.stake.decimals)) : 0;
  const earned = pos ? Number(formatUnits(pos.claimable, p.reward.decimals)) : 0;
  const cta = p.status === 'ended' ? (staked > 0 ? 'Withdraw' : 'View pool') : 'Stake';
  const exitAction: 'unstake' | 'claim' | undefined = p.status === 'ended' ? (staked > 0 ? 'unstake' : earned > 0 ? 'claim' : undefined) : undefined;
  const href = `/stake/${p.address}${exitAction ? `?action=${exitAction}` : ''}`;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenPair stake={p.stake} reward={p.reward} size={34} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-white">{p.name}</p>
            <PairLabel stake={p.stake} reward={p.reward} />
          </div>
        </div>
        <StatusPill status={p.status} />
      </div>

      <div className="mt-5">
        <AprLabel />
        <p className={cn('mt-1 text-[28px] font-semibold leading-none tabular-nums', p.aprKind === 'value' ? 'text-polydash-green' : 'text-white')}>{fmtApr(p)}</p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
        <div><dt className="text-white/45">Total staked</dt><dd className="mt-0.5"><AmountUsd amount={p.totalStaked} symbol={sym(p.stake)} priceUsd={p.stake.priceUsd} /></dd></div>
        <div><dt className="text-white/45">Total rewards</dt><dd className="mt-0.5"><AmountUsd amount={p.totalRewards} symbol={sym(p.reward)} priceUsd={p.reward.priceUsd} /></dd></div>
        <div><dt className="text-white/45">Rewards per day</dt><dd className="mt-0.5"><AmountUsd amount={p.status === 'ended' ? 0 : p.rewardsPerDay} symbol={sym(p.reward)} priceUsd={p.reward.priceUsd} /></dd></div>
        <div><dt className="text-white/45">Active stakers</dt><dd className="mt-0.5 tabular-nums text-white/90">{fmtNum(p.stakerCount)}</dd></div>
      </dl>

      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-[11.5px] text-white/50">
          <span>Time left</span><span className="tabular-nums">{now ? fmtDuration(p.endTime - now) : '-'}</span>
        </div>
        <ProgressBar value={now ? elapsedFrac(p, now) : 0} />
      </div>

      <div className="mt-4 flex min-h-10 items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-[12px]">
        {connected ? (
          <>
            <div>
              <p className="text-white/50">Your stake</p>
              <AmountUsd amount={staked} symbol={sym(p.stake)} priceUsd={p.stake.priceUsd} />
            </div>
            <div className="text-right">
              <p className="text-white/50">Your rewards</p>
              <AmountUsd amount={earned} symbol={sym(p.reward)} priceUsd={p.reward.priceUsd} accent />
            </div>
          </>
        ) : <span className="flex items-center gap-1.5 text-white/45"><Wallet className="h-3.5 w-3.5" strokeWidth={1.5} /> Connect a wallet to see your stake</span>}
      </div>
    </>
  );
  const btn = 'mt-4 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[14px] font-semibold transition-colors';
  const btnCls = cn(btn, cta === 'Stake' ? 'bg-polydash-green text-black hover:bg-polydash-green-light' : 'bg-white/[0.07] text-white hover:bg-white/[0.12]');
  return (
    <article className={cn('stk-glass stk-lift flex flex-col p-5', p.featured && 'ring-1 ring-polydash-green/25')}>
      {(p.featured || p.verified || hpTier || rotation) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {p.featured && <TextPill>Featured</TextPill>}
          {p.verified && <span title="Checked by the Polypad team"><TextPill>Verified</TextPill></span>}
          {rotation && <TextPill>Eligible for featured rotation</TextPill>}
          {hpTier && <HpChipView tier={hpTier} />}
        </div>
      )}
      {p.verified && (
        <p className="mb-3 text-[11.5px] leading-relaxed text-white/50">Verified = Polypad checked this token&apos;s address. It is not a safety guarantee — anyone can create a pool.</p>
      )}
      {body}
      {mobile ? (
        <button type="button" onClick={() => onOpen(p, exitAction)} className={btnCls}>{cta}</button>
      ) : (
        <Link href={href} className={btnCls}>{cta} <ArrowRight className="h-4 w-4" strokeWidth={1.75} /></Link>
      )}
    </article>
  );
}

function CardSkeleton() {
  return (
    <div className="stk-glass h-[468px] p-5" aria-hidden>
      <div className="flex items-center gap-3"><Shimmer className="h-[34px] w-[54px] rounded-full" /><div className="space-y-2"><Shimmer className="h-4 w-32" /><Shimmer className="h-3 w-24" /></div></div>
      <Shimmer className="mt-6 h-3 w-28" /><Shimmer className="mt-2 h-7 w-24" />
      <div className="mt-6 grid grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <Shimmer key={i} className="h-9" />)}</div>
      <Shimmer className="mt-6 h-2" /><Shimmer className="mt-5 h-10" /><Shimmer className="mt-4 h-11" />
    </div>
  );
}

export function StakeExplore() {
  const params = useSearchParams();
  const router = useRouter();
  const tokenFilter = params.get('token')?.toLowerCase() || null;
  const validToken = tokenFilter && /^0x[0-9a-f]{40}$/.test(tokenFilter) ? tokenFilter : null;
  const q = useStakePools(validToken);
  const data = q.data && !('pending' in q.data) ? q.data : null;
  const loading = !data && !q.error;
  const pools = data?.pools ?? [];
  const { positions, connected } = usePositions(pools);
  const now = useNowSec(30_000);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<PoolSummary | null>(null);
  const [openAction, setOpenAction] = useState<'unstake' | 'claim' | undefined>(undefined);
  const onOpenPool = (p: PoolSummary, action?: 'unstake' | 'claim') => { setOpenAction(action); setOpen(p); };
  const [hpTier, setHpTier] = useState<Tier>(null);
  const [hpSort, setHpSort] = useState(false);
  const { map: hpMap } = useHolderProtectionsAll();

  // Holder Protections per pool: tier of the staked/reward launch token, and the tier again
  // when this pool is an active creator pool of a silver+ token (label + sort first).
  const poolHp = useMemo(() => {
    const byToken = new Map<string, { tier: Tier; passed: number; creatorPools: string[] }>();
    for (const v of Object.values(hpMap ?? {})) byToken.set(v.token, v);
    const out = new Map<string, PoolHp>();
    for (const p of pools) {
      const h = byToken.get(p.stake.address.toLowerCase()) ?? byToken.get(p.reward.address.toLowerCase());
      if (!h) continue;
      const isCreatorPool = (h.creatorPools ?? []).includes(p.address.toLowerCase());
      out.set(p.address.toLowerCase(), { tier: h.tier, passed: h.passed, creatorTier: isCreatorPool && tierRank(h.tier) >= 2 ? h.tier : null });
    }
    return out;
  }, [hpMap, pools]);
  const hpOf = (p: PoolSummary) => poolHp.get(p.address.toLowerCase());

  // One rotating slot (changes daily) for a live creator pool of a silver+ token. Never above pinned pools.
  const rotationAddr = useMemo(() => {
    const eligible = pools.filter((p) => !p.featured && isLive(p) && hpOf(p)?.creatorTier).map((p) => p.address).sort();
    if (!eligible.length) return null;
    return eligible[(now ? Math.floor(now / 86400) : 0) % eligible.length];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, poolHp, now]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = pools.filter((p) => {
      if (hpTier && tierRank(hpOf(p)?.tier) < tierRank(hpTier)) return false;
      if (tab === 'active' && !isLive(p)) return false;
      if (tab === 'ended' && isLive(p)) return false;
      if (tab === 'mine') {
        const pos = positions.get(p.address.toLowerCase());
        if (!pos || (pos.staked === Z && pos.claimable === Z)) return false;
      }
      if (!s) return true;
      return [p.name, p.address, p.stake.symbol, p.stake.name, p.stake.address, p.reward.symbol, p.reward.name, p.reward.address]
        .some((v) => (v || '').toLowerCase().includes(s));
    });
    // Pinned first, then the rotation slot, then creator pools of silver+ tokens; the rest keeps its order.
    const rank = (p: PoolSummary) => (p.featured ? 3 : p.address === rotationAddr ? 2 : hpOf(p)?.creatorTier ? 1 : 0);
    const idx = new Map(list.map((p, i) => [p.address, i]));
    return [...list].sort((a, b) => (rank(b) - rank(a))
      || (hpSort ? (tierRank(hpOf(b)?.tier) - tierRank(hpOf(a)?.tier)) || ((hpOf(b)?.passed ?? 0) - (hpOf(a)?.passed ?? 0)) : 0)
      || ((idx.get(a.address) ?? 0) - (idx.get(b.address) ?? 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, tab, search, positions, hpTier, hpSort, poolHp, rotationAddr]);

  const t = data?.totals;
  const staked = totalFigure(t?.staked ?? []);
  const paid = totalFigure(t?.rewardsPaid ?? []);
  const filterToken = validToken ? pools.find((p) => p.stake.address.toLowerCase() === validToken || p.reward.address.toLowerCase() === validToken) : null;
  const filterSym = filterToken ? sym(filterToken.stake.address.toLowerCase() === validToken ? filterToken.stake : filterToken.reward) : null;
  // Ended pools where the connected wallet still has money in them.
  const endedWithStake = useMemo(() => pools.filter((p) => {
    if (p.status !== 'ended') return false;
    const pos = positions.get(p.address.toLowerCase());
    return !!pos && (pos.staked > Z || pos.claimable > Z);
  }), [pools, positions]);

  return (
    <div className="mx-auto w-full max-w-container px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <BeginnerStart className="mb-6" />
      {/* hero */}
      <section className="relative isolate -mx-4 overflow-hidden px-4 pb-8 pt-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="stk-hero-glow -z-10" aria-hidden />
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-white sm:text-[44px]">Stake. Earn every second.</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/60">Lock tokens in a pool and earn rewards while they are staked. Permissionless pools on Robinhood Chain. Non-custodial: you sign everything.</p>
        <BuyEthButton className="mt-5" />

        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Total value staked" value={staked.value} format={staked.format} sub={staked.sub} loading={loading} />
          <StatTile label="Active pools" value={t?.active ?? 0} format={(v) => String(Math.round(v))} sub={t ? `of ${t.pools} pools` : null} loading={loading} />
          <StatTile label="Rewards paid" value={paid.value} format={paid.format} sub={paid.sub} loading={loading} />
          <StatTile label="Unique stakers" value={t?.stakers ?? 0} format={(v) => String(Math.round(v))}
            sub={t?.stakers != null ? 'wallets with an active stake' : 'Counting stakers…'} loading={loading} unavailable={t?.stakers == null} />
        </div>
      </section>

      <div className="mt-2"><HowItWorks /></div>

      {connected && endedWithStake.length > 0 && (
        <div className="mt-6 rounded-2xl bg-amber-400/[0.08] p-4 ring-1 ring-amber-400/30 sm:p-5" role="status">
          <p className="text-[14px] font-semibold text-amber-200">Ended pools where you still have a stake</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/65">These pools ended, so rewards have stopped — but your stake is still there. Withdraw it from the pool page.</p>
          <ul className="mt-3 space-y-2">
            {endedWithStake.map((p) => {
              const pos = positions.get(p.address.toLowerCase());
              const staked = pos ? Number(formatUnits(pos.staked, p.stake.decimals)) : 0;
              const claimable = pos ? Number(formatUnits(pos.claimable, p.reward.decimals)) : 0;
              return (
                <li key={p.address} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2.5">
                  <span className="text-[13px] text-white/85">{p.name} — {fmtNum(staked)} {sym(p.stake)} staked{claimable > 0 ? `, ${fmtNum(claimable)} ${sym(p.reward)} to claim` : ''}</span>
                  <Link href={`/stake/${p.address}?action=${staked > 0 ? 'unstake' : 'claim'}`} className="inline-flex h-9 items-center rounded-lg bg-white/[0.08] px-3 text-[13px] font-medium text-white hover:bg-white/[0.14]">Withdraw</Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {q.error && (
        <div className="mt-8"><EmptyState icon={<Layers className="h-5 w-5" strokeWidth={1.5} />} text="Could not load staking pools right now. Try again in a moment." action={<button onClick={() => q.refetch()} className="h-10 rounded-xl bg-white/[0.07] px-4 text-[13px] text-white hover:bg-white/[0.12]">Try again</button>} /></div>
      )}

      <div className="mt-10">
        {loading ? (
          <div className="space-y-3"><Shimmer className="h-6 w-40" /><Shimmer className="h-[260px] w-full rounded-2xl" /></div>
        ) : pools.length > 0 ? <Leaderboard pools={pools} now={now} /> : null}
      </div>

      {/* pools */}
      <section aria-labelledby="all-pools" className="mt-12">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 id="all-pools" className="text-[18px] font-semibold text-white">Pools</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="w-full sm:w-auto">
              <label className="relative block">
                <span className="sr-only">Search pools</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" strokeWidth={1.5} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name — e.g. POLYDASH — or paste a token code (0x…)"
                  className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-[14px] text-white placeholder:text-white/35 focus:border-polydash-green/40 focus:outline-none sm:w-72" />
              </label>
              <p className="mt-1.5 text-[11.5px] text-white/45">Search by token name or symbol — or paste a token&rsquo;s address (0x…), which you&rsquo;ll find on the token&rsquo;s page or the chain explorer.</p>
            </div>
            <div role="tablist" aria-label="Filter pools" className="grid grid-cols-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
              {([['all', 'All'], ['active', 'Active'], ['ended', 'Ended'], ['mine', 'My stakes']] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn('h-9 whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors', tab === k ? 'bg-white/[0.09] text-white' : 'text-white/55 hover:text-white')}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
          <HpTierFilter value={hpTier} onChange={setHpTier} />
          <button type="button" aria-pressed={hpSort} onClick={() => setHpSort((v) => !v)} title={HP_TOOLTIP}
            className={cn('inline-flex h-10 items-center rounded-full px-3 font-medium transition-colors sm:h-8', hpSort ? 'bg-white/[0.1] text-white' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
            Sort: Holder Protections
          </button>
        </div>

        {validToken && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-white/60">
            <span>Showing pools for</span>
            <span className="inline-flex h-8 items-center gap-2 rounded-full bg-white/[0.06] pl-1 pr-1 ring-1 ring-white/10">
              {filterToken && <TokenLogo token={filterToken.stake.address.toLowerCase() === validToken ? filterToken.stake : filterToken.reward} size={22} />}
              <span className="px-1 text-white">{filterSym ?? `${validToken.slice(0, 6)}…${validToken.slice(-4)}`}</span>
              <button onClick={() => router.replace('/stake')} aria-label="Clear token filter" className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" strokeWidth={1.75} /></button>
            </span>
          </div>
        )}

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loading && [0, 1, 2].map((i) => <CardSkeleton key={i} />)}
          {!loading && visible.map((p) => (
            <PoolCard key={p.address} p={p} pos={positions.get(p.address.toLowerCase())} connected={connected} now={now} onOpen={onOpenPool} mobile={mobile} hpTier={hpOf(p)?.creatorTier ?? null} rotation={p.address === rotationAddr} />
          ))}
        </div>

        {!loading && !q.error && visible.length === 0 && (
          <div className="mt-2">
            {tab === 'mine' && !connected ? (
              <EmptyState icon={<Wallet className="h-5 w-5" strokeWidth={1.5} />} text="Connect your wallet to see the pools you have staked in." />
            ) : tab === 'mine' ? (
              <EmptyState icon={<Coins className="h-5 w-5" strokeWidth={1.5} />} text="You have not staked in any pool yet. Pick an active pool to start." action={<button onClick={() => setTab('active')} className="h-10 rounded-xl bg-polydash-green px-4 text-[13px] font-semibold text-black hover:bg-polydash-green-light">See active pools</button>} />
            ) : hpTier ? (
              <EmptyState icon={<Layers className="h-5 w-5" strokeWidth={1.5} />} text="No tokens meet these Holder Protections checks yet." action={<button onClick={() => setHpTier(null)} className="h-10 rounded-xl bg-white/[0.07] px-4 text-[13px] text-white hover:bg-white/[0.12]">Clear filter</button>} />
            ) : pools.length === 0 ? (
              <EmptyState icon={<Layers className="h-5 w-5" strokeWidth={1.5} />} text={validToken ? 'No staking pools for this token yet. Token creators can set one up with the Staking pool builder.' : 'No staking pools yet. Token creators can set one up with the Staking pool builder.'} action={<Link href="/docs" className="inline-flex h-10 items-center rounded-xl bg-white/[0.07] px-4 text-[13px] text-white hover:bg-white/[0.12]">Learn how to create a pool</Link>} />
            ) : (
              <EmptyState icon={<Search className="h-5 w-5" strokeWidth={1.5} />} text="No pools match this search. Try a token symbol or paste a token address." action={<button onClick={() => { setSearch(''); setTab('all'); }} className="h-10 rounded-xl bg-white/[0.07] px-4 text-[13px] text-white hover:bg-white/[0.12]">Clear filters</button>} />
            )}
          </div>
        )}
      </section>

      <GlossaryBox
        className="mt-12"
        terms={[
          { term: 'Stake', def: 'Locking your tokens in a pool so they can earn rewards. You keep owning them and can withdraw them.' },
          { term: 'APR', def: 'Yearly reward rate — what you would earn in a year if the current reward rate never changed. It changes all the time, so it is not a promise.' },
          { term: 'Claim fee', def: 'A small cut taken from your rewards when you claim them. It is shown on the pool page before you claim.' },
          { term: 'Ended pool', def: 'A pool whose reward period is over. No new rewards are paid, but any stake and unclaimed rewards already there are still yours to withdraw and claim.' },
        ]}
      />

      <p className="mt-14 border-t border-white/[0.06] pt-6 text-center text-[12px] leading-relaxed text-white/45">{FOOTER_NOTE}</p>

      <Drawer open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DrawerContent className="max-h-[92vh] border-white/10 bg-[#0B0B0B]">
          {open && (
            <div className="overflow-y-auto px-4 pb-6 pt-3">
              <div className="mb-4 flex items-center gap-3">
                <TokenPair stake={open.stake} reward={open.reward} size={30} />
                <div className="min-w-0 flex-1">
                  <DrawerTitle className="truncate text-[16px] font-semibold text-white">{open.name}</DrawerTitle>
                  <p className="text-[12px] text-white/55">{open.aprKind === 'ended' ? 'Ended — no new rewards are paid' : open.aprKind === 'new' ? 'No rewards yet — be the first to stake' : `${fmtApr(open)} current APR (variable)`}</p>
                </div>
                <StatusPill status={open.status} />
              </div>
              <ActionPanel pool={open} initialTab={openAction} />
              <Link href={`/stake/${open.address}`} className="mt-4 flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 text-[14px] text-white/80 hover:bg-white/[0.05]">
                Full details and charts <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
