'use client';

import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Clock3, Loader2, Plus, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { formatEther } from 'viem';
import { TokenAvatar } from '@/components/token-avatar';
import { AgentScoreBadge } from '@/components/agent-score-badge';
import { formatEth, formatUsd, shortenAddress } from '@/lib/format';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { p3StatusText } from '@/lib/fund/phase3';
import { useEthPrice, useLaunches } from '@/lib/hooks/use-launches';
import { useAllowlistTokens } from '@/lib/fund/use-allowlist';
import { strategyLabel, useTerminalActivity, useTerminalFunds, type ActivityRow } from '@/lib/terminal/use-terminal';
import { cn } from '@/lib/utils';

const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';

function timeAgo(tsMs: number): string {
  if (!tsMs) return '';
  const s = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function readyIn(readyAtSec: number): string {
  const s = readyAtSec - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'Ready now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `Ready in ${d}d ${h}h`;
  if (h > 0) return `Ready in ${h}h ${m}m`;
  return `Ready in ${m}m`;
}

const sectionTitle = 'text-[18px] font-semibold text-white';
const retryBtn = 'underline hover:text-white';

export function TerminalContent() {
  const funds = useTerminalFunds();
  const activity = useTerminalActivity(funds.fundAddresses);
  const { data: launches } = useLaunches();
  const { data: ethUsd } = useEthPrice();
  const allowlist = useAllowlistTokens();

  const tokenByLaunch = useMemo(() => {
    const m = new Map<string, { name: string; symbol: string; imageUri: string; tokenAddress: string }>();
    for (const t of launches ?? []) m.set(t.launchAddress.toLowerCase(), { name: t.name, symbol: t.symbol, imageUri: t.imageUri, tokenAddress: t.tokenAddress });
    return m;
  }, [launches]);
  const fundByAddress = useMemo(() => {
    const m = new Map<string, { name: string; symbol: string }>();
    for (const f of funds.funds) m.set(f.address.toLowerCase(), { name: f.name, symbol: f.symbol });
    return m;
  }, [funds.funds]);

  const waiting = (allowlist.data ?? []).filter((t) => t.status === 'waiting');
  const ticker = (activity.data?.ticker ?? []).slice(0, 5);
  const usd = (wei: bigint) => (ethUsd ? Number(formatEther(wei)) * ethUsd : null);

  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight text-white">
            Terminal
            <span className="inline-flex items-center gap-1.5 rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-polydash-green" /> Live
            </span>
          </h1>
          <p className="mt-1 max-w-[640px] text-[13px] text-white/55">
            What is happening on Polypad right now — Tokenized Fund values, the newest trades, share mints and staking pools.
            Everything here is read live from Robinhood Chain, and refreshes every 30 seconds.
          </p>
        </div>
        <p className="text-[12px] text-white/40">
          {activity.data ? `Updated ${timeAgo(activity.data.updatedAt)}` : activity.isFetching ? 'Updating…' : 'Robinhood Chain · 4663'}
        </p>
      </div>

      {/* Trending ticker */}
      <section className="mt-6">
        <h2 className={cn(sectionTitle, 'flex items-center gap-2')}><TrendingUp className="h-4 w-4 text-polydash-green" /> Trending now</h2>
        {activity.isLoading ? (
          <div className="mt-3 flex gap-3 overflow-hidden"><div className="h-[64px] w-[220px] animate-pulse rounded-2xl bg-white/[0.04]" /><div className="h-[64px] w-[220px] animate-pulse rounded-2xl bg-white/[0.04]" /></div>
        ) : activity.isError ? (
          <p className="mt-3 text-[13px] text-white/55">Trending tokens are not available right now.{' '}<button type="button" onClick={() => void activity.refetch()} className={retryBtn}>Try again</button></p>
        ) : ticker.length === 0 ? (
          <p className="mt-3 text-[13px] text-white/55">No trades in the last 24 hours.</p>
        ) : (
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {ticker.map((t, i) => {
              const meta = tokenByLaunch.get(t.launch.toLowerCase());
              return (
                <Link key={t.launch} href={`/token/${t.launch}`} className="glass-card flex shrink-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.06]">
                  <span className="font-mono text-[13px] text-white/40">#{i + 1}</span>
                  <TokenAvatar name={meta?.name ?? 'Token'} symbol={meta?.symbol ?? '?'} imageUri={meta?.imageUri} size="sm" />
                  <span>
                    <span className="block text-[13px] font-medium text-white">{meta?.symbol ?? t.launch.slice(0, 8)} <span className="font-normal text-white/50">{meta?.name}</span></span>
                    <span className="block text-[12px] text-white/50">{t.volumeEth < 0.01 && t.volumeEth > 0 ? '<0.01' : t.volumeEth.toFixed(2)} ETH in 24h · {t.trades} trade{t.trades === 1 ? '' : 's'}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* NAV leaderboard */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={sectionTitle}>Tokenized Fund leaderboard</h2>
          <p className="text-[12px] text-white/40">Ranked by value per share (NAV). A share is worth what the fund holds, divided by its shares.</p>
        </div>
        {funds.isLoading ? (
          <div className="mt-4 space-y-3">
            <div className="h-[92px] animate-pulse rounded-2xl bg-white/[0.04]" />
            <div className="h-[92px] animate-pulse rounded-2xl bg-white/[0.04]" />
          </div>
        ) : funds.isError ? (
          <p className="mt-4 text-[13px] text-white/55">Could not load the leaderboard right now.{' '}<button type="button" onClick={funds.refetch} className={retryBtn}>Try again</button></p>
        ) : funds.rows.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center text-[13px] text-white/55">No Tokenized Funds yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {funds.rows.map((f, i) => {
              const status = p3StatusText(f.status, f.publicOpen);
              const navUsd = usd(f.navPerNft);
              const totalUsd = usd(f.totalNav);
              return (
                <li key={f.address}>
                  <Link href={`/funds/${f.address}`} className="glass-card block p-4 transition-colors hover:bg-white/[0.06] sm:p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="w-6 text-center font-mono text-[15px] font-semibold text-white/50">#{i + 1}</span>
                      <TokenAvatar name={f.name} symbol={f.symbol} imageUri={f.imageUri || FUND_PLACEHOLDER_LOGO} size="md" className={f.imageUri ? undefined : 'bg-black ring-1 ring-white/20 [&>img]:object-contain [&>img]:p-2'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-white">{f.name} <span className="font-mono text-[13px] font-normal text-white/45">{f.symbol}</span></p>
                        <p className="mt-0.5 text-[12px] text-white/50">{strategyLabel(f.templateId)} · {f.generation} Tokenized Fund · {status.label}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-[16px] font-semibold text-white">{formatEth(f.navPerNft, 4)} ETH</p>
                        <p className="text-[12px] text-white/50">per share{navUsd != null ? ` · ${formatUsd(navUsd)}` : ''}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-white/55">
                      <span>Total value {formatEth(f.totalNav, 4)} ETH{totalUsd != null ? ` (${formatUsd(totalUsd)})` : ''}</span>
                      <span>{Number(f.totalMinted)} of {Number(f.maxSupply)} shares sold</span>
                      <span>Raised {formatEth(f.raised, 4)} of {formatEth(f.raiseCap, 4)} ETH</span>
                      <span className="inline-flex items-center gap-1.5">Manager {shortenAddress(f.manager)} <AgentScoreBadge address={f.manager} /></span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {/* Live activity feed */}
        <section className="lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={cn(sectionTitle, 'flex items-center gap-2')}><Sparkles className="h-4 w-4 text-polydash-green" /> Live activity</h2>
            {activity.isFetching && !activity.isLoading && <p className="inline-flex items-center gap-1.5 text-[12px] text-white/40"><RefreshCw className="h-3 w-3 animate-spin" /> Updating…</p>}
          </div>
          {activity.data?.degraded && <p className="mt-2 text-[12px] text-white/40">Some activity may be missing right now — the chain is slow to answer.</p>}
          {activity.isLoading ? (
            <div className="mt-4 space-y-2.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[52px] animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
          ) : activity.isError ? (
            <p className="mt-4 text-[13px] text-white/55">Could not load live activity right now.{' '}<button type="button" onClick={() => void activity.refetch()} className={retryBtn}>Try again</button></p>
          ) : (activity.data?.rows.length ?? 0) === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center text-[13px] text-white/55">No activity in the last 24 hours. Trades, share mints and new staking pools show up here as they happen.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {(activity.data?.rows ?? []).map((row, i) => <ActivityRowView key={`${row.kind}-${i}`} row={row} tokenByLaunch={tokenByLaunch} fundByAddress={fundByAddress} />)}
            </ul>
          )}
        </section>

        {/* Waiting proposals */}
        <section>
          <h2 className={cn(sectionTitle, 'flex items-center gap-2')}><Clock3 className="h-4 w-4 text-polydash-green" /> Waiting to join funds</h2>
          <p className="mt-1 text-[12px] text-white/45">A manager proposes an asset in public, then waits 2 days before a fund can buy it. Holders can leave any time during the wait.</p>
          {allowlist.isLoading ? (
            <div className="mt-4 h-[52px] animate-pulse rounded-2xl bg-white/[0.04]" />
          ) : allowlist.isError ? (
            <p className="mt-4 text-[13px] text-white/55">Could not load proposals right now.{' '}<button type="button" onClick={() => void allowlist.refetch()} className={retryBtn}>Try again</button></p>
          ) : waiting.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-[13px] text-white/55">No assets are waiting right now.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {waiting.map((t) => (
                <li key={t.address} className="glass-card flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-white">{t.symbol} <span className="font-normal text-white/50">{t.name}</span></p>
                    <p className="text-[12px] text-white/45">{shortenAddress(t.address)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/70">{readyIn(t.readyAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 rounded-2xl bg-white/[0.03] p-4 text-[12px] leading-relaxed text-white/50">
            How to read this page: NAV per share is what one share is worth right now. It moves with the market — it is not a promise of future returns. Not financial advice.
          </p>
        </section>
      </div>
    </div>
  );
}

function ActivityRowView({ row, tokenByLaunch, fundByAddress }: {
  row: ActivityRow;
  tokenByLaunch: Map<string, { name: string; symbol: string; imageUri: string; tokenAddress: string }>;
  fundByAddress: Map<string, { name: string; symbol: string }>;
}) {
  if (row.kind === 'trade') {
    const meta = tokenByLaunch.get(row.launch.toLowerCase());
    return (
      <li className="glass-card flex items-center gap-3 px-4 py-3">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', row.isBuy ? 'bg-polydash-green/15 text-polydash-green' : 'bg-red-500/15 text-red-300')}>
          {row.isBuy ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-white">
            {row.isBuy ? 'Bought' : 'Sold'} {row.tokens.toLocaleString('en-US', { maximumFractionDigits: 0 })} {meta?.symbol ?? 'tokens'} for {row.eth < 0.01 && row.eth > 0 ? '<0.01' : row.eth.toFixed(3)} ETH
          </p>
          <p className="mt-0.5 text-[12px] text-white/45">
            {shortenAddress(row.trader)} · {timeAgo(row.timestamp)}
            {meta ? <> · <Link href={`/token/${row.launch}`} className="text-white/60 hover:text-white">{meta.symbol}</Link></> : null}
          </p>
        </div>
        <a href={getExplorerTxUrl(row.txHash)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[12px] text-white/50 hover:text-white">View</a>
      </li>
    );
  }
  if (row.kind === 'mint') {
    const fund = fundByAddress.get(row.fund.toLowerCase());
    return (
      <li className="glass-card flex items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70"><Plus className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-white">Minted 1 {fund?.symbol ?? 'Tokenized Fund'} share{fund ? ` — ${fund.name}` : ''}</p>
          <p className="mt-0.5 text-[12px] text-white/45">{shortenAddress(row.to)} · {timeAgo(row.timestamp)}</p>
        </div>
        <a href={getExplorerTxUrl(row.txHash)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[12px] text-white/50 hover:text-white">View</a>
      </li>
    );
  }
  return (
    <li className="glass-card flex items-center gap-3 px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-polydash-green/15 text-polydash-green"><Sparkles className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-white">New staking pool: {row.name}</p>
        <p className="mt-0.5 text-[12px] text-white/45">Stake {row.stakeSymbol}, earn {row.rewardSymbol} · {timeAgo(row.timestamp)}</p>
      </div>
      <Link href="/stake" className="shrink-0 text-[12px] text-white/50 hover:text-white">Stake</Link>
    </li>
  );
}
