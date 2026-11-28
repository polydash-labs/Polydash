'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, BarChart3, Coins, History, SearchX, Users, Wallet } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { cn } from '@/lib/utils';
import { elapsedFrac, fmtApr, fmtDuration, fmtNum, fmtUsd, type DayPoint, type FlowItem, type PoolSummary } from '@/lib/staking/shared';
import { AprLabel, EmptyState, FOOTER_NOTE, PairLabel, ProgressBar, Shimmer, StatusPill, TokenPair, sym, useNowSec } from './primitives';
import { ActionPanel } from './action-panel';
import { usePoolDetail } from './use-stake';
import { DARK_CARD, FlowDiagram, PLAIN_CARD, SectionHead } from '@/lib/ui/template';

type Range = '7d' | '30d' | 'all';
/** `share` is already a percent (0..100). */
const fmtPct = (v: number) => (v > 0 && v < 0.1 ? '<0.1%' : `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
const CHART_TIMEOUT_MS = 15_000;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const dayLabel = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeLabel = (t: number) => new Date(t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

function ExtLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 text-white/70 hover:text-polydash-green', className)}>
      {children}<ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} />
    </a>
  );
}

function KV({ k, v, sub }: { k: React.ReactNode; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className={cn(PLAIN_CARD, 'min-w-0 p-3')}>
      <div className="text-[11.5px] text-white/50">{k}</div>
      <div className="mt-1 truncate text-[15px] font-medium tabular-nums text-white">{v}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-white/45">{sub}</div>}
    </div>
  );
}

function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0D0D0D]/95 px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-1 text-white/50">{dayLabel(label)}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 tabular-nums text-white">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: {fmtNum(Math.abs(p.value))} {unit}
        </div>
      ))}
    </div>
  );
}

function ChartEmpty({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="mt-4 flex h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-white/[0.02] text-center ring-1 ring-white/[0.05]">
      <BarChart3 className="h-5 w-5 text-white/40" strokeWidth={1.5} />
      <p className="text-[13px] text-white/60">{text}</p>
      {onRetry && <button type="button" onClick={onRetry} className="h-9 rounded-lg bg-white/[0.07] px-3 text-[12.5px] text-white hover:bg-white/[0.12]">Try again</button>}
    </div>
  );
}

function Charts({ series, pool, pending, timedOut, onRetry }: { series: DayPoint[]; pool: PoolSummary; pending: boolean; timedOut: boolean; onRetry: () => void }) {
  const [range, setRange] = useState<Range>('30d');
  const data = useMemo(() => {
    const n = range === '7d' ? 7 : range === '30d' ? 30 : series.length;
    return series.slice(-n).map((d) => ({ ...d, outNeg: -d.out }));
  }, [series, range]);
  const S = sym(pool.stake);
  const axis = { stroke: 'rgba(255,255,255,0.35)', fontSize: 11, tickLine: false, axisLine: false } as const;
  return (
    <section className={DARK_CARD} aria-labelledby="charts-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="charts-h" className="text-[15px] font-semibold text-white">Total staked</h2>
        <div role="tablist" aria-label="Chart range" className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          {(['7d', '30d', 'all'] as const).map((r) => (
            <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}
              className={cn('h-9 min-w-[44px] rounded-lg px-3 text-[12.5px] uppercase transition-colors', range === r ? 'bg-white/[0.09] text-white' : 'text-white/55 hover:text-white')}>{r === 'all' ? 'All' : r}</button>
          ))}
        </div>
      </div>
      {pool.totalStaked <= 0 && (pending || !series.some((d) => d.in > 0 || d.out > 0)) ? (
        <ChartEmpty text="No stakes yet" />
      ) : pending && timedOut ? (
        <ChartEmpty text="Chart data is taking longer than usual." onRetry={onRetry} />
      ) : pending ? (
        <div className="mt-4 space-y-4"><Shimmer className="h-[200px] w-full" /><Shimmer className="h-[150px] w-full" /></div>
      ) : data.length < 1 ? (
        <ChartEmpty text="No stakes yet" />
      ) : (
        <>
          <div className="mt-4 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="stkArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00E676" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#00E676" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="t" tickFormatter={dayLabel} minTickGap={28} {...axis} />
                <YAxis tickFormatter={(v) => fmtNum(v)} width={52} {...axis} />
                <Tooltip content={<ChartTip unit={S} />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
                <Area type="monotone" dataKey="staked" name="Staked" stroke="#00E676" strokeWidth={1.75} fill="url(#stkArea)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <h3 className="mt-6 text-[13px] font-medium text-white/80">Daily stake and withdraw flow</h3>
          <div className="mt-2 h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} stackOffset="sign" margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="t" tickFormatter={dayLabel} minTickGap={28} {...axis} />
                <YAxis tickFormatter={(v) => fmtNum(Math.abs(v))} width={52} {...axis} />
                <Tooltip content={<ChartTip unit={S} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="in" name="Staked in" stackId="f" fill="#00E676" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="outNeg" name="Withdrawn" stackId="f" fill="#38BDF8" radius={[0, 0, 3, 3]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}

const FLOW_LABEL: Record<FlowItem['type'], string> = { stake: 'Stake', withdraw: 'Withdraw', emergency: 'Emergency withdraw', claim: 'Claim' };

export function PoolDetail({ address }: { address: string }) {
  const q = usePoolDetail(address);
  const now = useNowSec(30_000);
  // Deep link from the pool list: /stake/<addr>?action=unstake opens the panel on Withdraw.
  const [actionParam, setActionParam] = useState<'stake' | 'unstake' | 'claim' | null>(null);
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get('action');
    if (a === 'unstake' || a === 'claim' || a === 'stake') setActionParam(a);
  }, []);
  const d = q.data && !('pending' in q.data) ? q.data : null;
  // Never show skeletons forever: after CHART_TIMEOUT_MS of pending analytics, show a clean empty state.
  const [timedOut, setTimedOut] = useState(false);
  const analyticsPending = !d || d.analyticsPending;
  useEffect(() => {
    if (!analyticsPending) { setTimedOut(false); return; }
    const id = setTimeout(() => setTimedOut(true), CHART_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [analyticsPending]);
  const notFound = !!q.error && /not a Polypad|not found/i.test(String((q.error as any)?.message));

  if (notFound || (q.error && !d)) {
    return (
      <div className="mx-auto w-full max-w-container px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState icon={<SearchX className="h-5 w-5" strokeWidth={1.5} />} text={notFound ? 'This address is not a Polypad staking pool. Check the link or pick a pool from the list.' : 'Could not load this pool right now. Try again in a moment.'}
          action={<Link href="/stake" className="inline-flex h-10 items-center rounded-xl bg-white/[0.07] px-4 text-[13px] text-white hover:bg-white/[0.12]">See all pools</Link>} />
      </div>
    );
  }

  const p = d?.pool;
  const S = p ? sym(p.stake) : '';
  const R = p ? sym(p.reward) : '';
  const distributed = p && p.totalRewards > 0 ? p.totalRewardsPaid / p.totalRewards : 0;
  const remaining = p && d ? Math.max(0, p.totalRewards - d.emitted) : 0;

  return (
    <div className="bg-black text-white">
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-16">
      <Link href="/stake" className="inline-flex h-10 items-center gap-1.5 text-[13px] text-white/60 hover:text-white"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} />All pools</Link>

      {/* header */}
      <header className="relative isolate mt-2 flex min-h-[92px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {p ? (
          <div className="flex min-w-0 items-center gap-4">
            <TokenPair stake={p.stake} reward={p.reward} size={44} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-[24px] font-semibold text-white sm:text-[30px]">{p.name}</h1><StatusPill status={p.status} /></div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <PairLabel stake={p.stake} reward={p.reward} />
                <ExtLink href={getExplorerAddressUrl(p.address)}>Pool {short(p.address)}</ExtLink>
                <ExtLink href={getExplorerAddressUrl(p.stake.address)}>{S} {short(p.stake.address)}</ExtLink>
                {!p.sameToken && <ExtLink href={getExplorerAddressUrl(p.reward.address)}>{R} {short(p.reward.address)}</ExtLink>}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4"><Shimmer className="h-11 w-[70px] rounded-full" /><div className="space-y-2"><Shimmer className="h-7 w-56" /><Shimmer className="h-4 w-72" /></div></div>
        )}
        {p && (
          <div className="sm:text-right">
            <AprLabel className="sm:justify-end" />
            <p className={cn('mt-1 text-[32px] font-semibold leading-none tabular-nums', p.aprKind === 'value' ? 'text-polydash-green' : 'text-white')}>{fmtApr(p)}</p>
          </div>
        )}
      </header>
      {p?.description && <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-white/60">{p.description}</p>}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* action panel: first on mobile, sticky right column on desktop */}
        <div id="stake-panel" className="scroll-mt-24 lg:order-2">
          <div className="lg:sticky lg:top-24">{p ? <ActionPanel pool={p} initialTab={actionParam ?? undefined} /> : <Shimmer className="h-[460px] w-full rounded-2xl" />}</div>
        </div>

        <div className="min-w-0 space-y-6 lg:order-1">
          {/* stats */}
          <section className={DARK_CARD} aria-labelledby="stats-h">
            <h2 id="stats-h" className="text-[15px] font-semibold text-white">Pool stats</h2>
            {p && d ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-3">
                  <KV k="Total staked" v={`${fmtNum(p.totalStaked)} ${S}`} sub={p.tvlUsd != null ? fmtUsd(p.tvlUsd) : p.maxTotalStake > 0 ? `Cap ${fmtNum(p.maxTotalStake)} ${S}` : 'No cap'} />
                  <KV k="TVL" v={p.tvlUsd != null ? fmtUsd(p.tvlUsd) : `${fmtNum(p.totalStaked)} ${S}`} sub={p.tvlUsd == null ? 'Price unknown' : undefined} />
                  <KV k="Rewards per day" v={`${p.status === 'ended' ? '0' : fmtNum(p.rewardsPerDay)} ${R}`} sub={p.reward.priceUsd != null && p.reward.priceUsd > 0 ? fmtUsd((p.status === 'ended' ? 0 : p.rewardsPerDay) * p.reward.priceUsd) : undefined} />
                  <KV k="Total rewards" v={`${fmtNum(p.totalRewards)} ${R}`} sub={p.reward.priceUsd != null && p.reward.priceUsd > 0 ? fmtUsd(p.totalRewards * p.reward.priceUsd) : undefined} />
                  <KV k="Rewards paid" v={`${fmtNum(p.totalRewardsPaid)} ${R}`} sub={`${(distributed * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}% of rewards distributed${p.reward.priceUsd != null && p.reward.priceUsd > 0 ? ` · ${fmtUsd(p.totalRewardsPaid * p.reward.priceUsd)}` : ''}`} />
                  <KV k="Active stakers" v={fmtNum(p.stakerCount)} sub="Wallets with a stake now" />
                  <KV k="Released by schedule" v={`${fmtNum(d.emitted)} ${R}`} sub={`${fmtNum(remaining)} ${R} still to come${p.reward.priceUsd != null && p.reward.priceUsd > 0 ? ` · ${fmtUsd(d.emitted * p.reward.priceUsd)} released` : ''}`} />
                  <KV k="Claim fee" v={`${(p.claimFeeBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`} sub="Taken from rewards when you claim" />
                  <KV k="Time left" v={now ? fmtDuration(p.endTime - now) : '-'} sub={`Ends ${dayLabel(p.endTime)}`} />
                </div>
                <div className="mt-5">
                  <div className="mb-1.5 flex justify-between text-[11.5px] text-white/50">
                    <span>Started {dayLabel(p.startTime)}</span>
                    <span className="tabular-nums">{now ? `${Math.round(elapsedFrac(p, now) * 100)}% of time elapsed` : ''}</span>
                  </div>
                  <ProgressBar value={now ? elapsedFrac(p, now) : 0} />
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-[11.5px] text-white/50"><span>Rewards distributed</span><span className="tabular-nums">{fmtNum(p.totalRewardsPaid)} / {fmtNum(p.totalRewards)} {R}</span></div>
                  <ProgressBar value={distributed} />
                </div>
              </>
            ) : <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <Shimmer key={i} className="h-[74px]" />)}</div>}
          </section>

          {p && d ? <Charts series={d.series} pool={p} pending={d.analyticsPending} timedOut={timedOut} onRetry={() => { setTimedOut(false); q.refetch(); }} />
            : timedOut ? <section className={DARK_CARD}><h2 className="text-[15px] font-semibold text-white">Total staked</h2><ChartEmpty text="Chart data is taking longer than usual." onRetry={() => { setTimedOut(false); q.refetch(); }} /></section>
            : <Shimmer className="h-[440px] w-full rounded-2xl" />}

          {/* top stakers */}
          <section className={DARK_CARD} aria-labelledby="top-h">
            <h2 id="top-h" className="flex items-center gap-2 text-[15px] font-semibold text-white"><Users className="h-4 w-4 text-white/50" strokeWidth={1.5} />Top stakers</h2>
            {(p && p.totalStaked <= 0) || (d && !d.analyticsPending && d.top.length === 0) ? <p className="mt-4 text-[13px] text-white/60">No stakes yet. Be the first.</p>
              : !d || d.analyticsPending ? (timedOut ? <p className="mt-4 text-[13px] text-white/60">Staker list is still loading. Check back in a moment.</p> : <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Shimmer key={i} className="h-9" />)}</div>) : (
                <table className="mt-3 w-full text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th className="py-2 text-left font-medium">#</th><th className="py-2 text-left font-medium">Wallet</th><th className="py-2 text-right font-medium">Staked</th><th className="py-2 text-right font-medium">Share</th></tr></thead>
                  <tbody>
                    {d.top.map((t, i) => (
                      <tr key={t.user} className="border-t border-white/[0.05]">
                        <td className="py-2.5 tabular-nums text-white/50">{i + 1}</td>
                        <td className="py-2.5"><ExtLink href={getExplorerAddressUrl(t.user)} className="font-mono text-[12.5px]">{short(t.user)}</ExtLink></td>
                        <td className="py-2.5 text-right tabular-nums text-white/85">{fmtNum(t.amount)} {S}</td>
                        <td className="py-2.5 text-right tabular-nums text-white/60">{fmtPct(t.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>

          {/* history */}
          <section className={DARK_CARD} aria-labelledby="hist-h">
            <h2 id="hist-h" className="flex items-center gap-2 text-[15px] font-semibold text-white"><History className="h-4 w-4 text-white/50" strokeWidth={1.5} />History</h2>
            {!d || d.analyticsPending ? (timedOut ? <p className="mt-4 text-[13px] text-white/60">{p && p.totalStaked <= 0 ? 'No activity yet.' : 'History is still loading. Check back in a moment.'}</p> : <div className="mt-4 space-y-2">{[0, 1, 2, 3].map((i) => <Shimmer key={i} className="h-9" />)}</div>)
              : d.flows.length === 0 ? <p className="mt-4 text-[13px] text-white/60">No activity yet.</p> : (
                <>
                  {/* mobile: stacked cards instead of a sideways-scrolling table */}
                  <ul className="mt-3 space-y-2 sm:hidden">
                    {d.flows.map((f) => (
                      <li key={`${f.tx}-${f.type}-${f.user}`} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.05]">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('text-[13px] font-medium', f.type === 'stake' ? 'text-polydash-green' : f.type === 'claim' ? 'text-white/80' : 'text-sky-300')}>{FLOW_LABEL[f.type]}</span>
                          <span className="tabular-nums text-[13px] text-white/85">{fmtNum(f.amount)} {f.type === 'claim' ? R : S}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
                          <ExtLink href={getExplorerAddressUrl(f.user)} className="font-mono text-[12px]">{short(f.user)}</ExtLink>
                          <ExtLink href={getExplorerTxUrl(f.tx)} className="tabular-nums text-[12px]">{f.ts ? timeLabel(f.ts) : 'tx'}</ExtLink>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[480px] text-[13px]">
                    <thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th className="py-2 text-left font-medium">Action</th><th className="py-2 text-left font-medium">Wallet</th><th className="py-2 text-right font-medium">Amount</th><th className="py-2 text-right font-medium">Time (UTC)</th></tr></thead>
                    <tbody>
                      {d.flows.map((f) => (
                        <tr key={`${f.tx}-${f.type}-${f.user}`} className="border-t border-white/[0.05]">
                          <td className="py-2.5"><span className={cn('text-[12.5px]', f.type === 'stake' ? 'text-polydash-green' : f.type === 'claim' ? 'text-white/80' : 'text-sky-300')}>{FLOW_LABEL[f.type]}</span></td>
                          <td className="py-2.5"><ExtLink href={getExplorerAddressUrl(f.user)} className="font-mono text-[12.5px]">{short(f.user)}</ExtLink></td>
                          <td className="py-2.5 text-right tabular-nums text-white/85">{fmtNum(f.amount)} {f.type === 'claim' ? R : S}</td>
                          <td className="py-2.5 text-right"><ExtLink href={getExplorerTxUrl(f.tx)} className="justify-end tabular-nums text-[12px]">{f.ts ? timeLabel(f.ts) : 'tx'}</ExtLink></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </>
              )}
          </section>
        </div>
      </div>

      {/* How this pool works — flow diagram */}
      {p && (
        <section className="mt-14">
          <SectionHead
            kicker="How this pool works"
            title="Stake. Earn. Claim."
            sub={`Stake ${S}, earn ${R} every second while the pool is running, then claim anytime — or withdraw your stake when you like.`}
          />
          <FlowDiagram
            layers={[
              {
                title: `Stake ${S}`,
                body: 'Approve once, then stake. You sign everything.',
                icon: <ArrowDownToLine className="mx-auto h-6 w-6 text-emerald-400" />,
              },
              {
                title: `Earn ${R} every second`,
                body: 'Rewards add up every second while a pool is running. The current APR is variable — it changes as people stake or withdraw.',
                icon: <Coins className="mx-auto h-6 w-6 text-emerald-400" />,
              },
              {
                title: 'Claim anytime — or withdraw',
                body: 'Withdraw when you like. When a pool ends, rewards stop — but your stake is still there to withdraw.',
                emerald: true,
                icon: <Wallet className="mx-auto h-6 w-6 text-emerald-400" />,
              },
            ]}
          />
        </section>
      )}

      <p className="mt-14 border-t border-white/[0.06] pt-6 text-center text-[12px] leading-relaxed text-white/45">{FOOTER_NOTE}</p>

      {/* sticky mobile bar */}
      {p && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0A0A0A]/95 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={() => document.getElementById('stake-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className={cn('flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold', p.status === 'ended' ? 'bg-white/[0.08] text-white' : 'bg-polydash-green text-black')}>
            <BarChart3 className="h-4 w-4" strokeWidth={1.75} />{p.status === 'ended' ? 'Withdraw or claim' : `Stake ${S}`}
          </button>
        </div>
      )}
    </div>
    </div>
  );
}
