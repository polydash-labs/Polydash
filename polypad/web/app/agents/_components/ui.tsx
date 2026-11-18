'use client';

import { ArrowUpRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FlowRow, HolderReport, PoolStats, RewardRate, ScamResult, SecurityReport, TokenAnalysis } from '@/lib/agents/tools';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { formatCompact, shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

export const card = 'rounded-2xl border border-white/10 bg-white/[0.03]';

export const na = (v: unknown) => v == null || (typeof v === 'number' && !Number.isFinite(v));
export const num = (v: number | null | undefined) => (na(v) ? 'n/a' : formatCompact(v as number));
export const fmtDate = (s: number | null | undefined) =>
  na(s) || !s ? 'n/a' : `${new Date(s * 1000).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`;

export function timeLeft(end: number | null, nowSec: number) {
  if (!end) return 'n/a';
  const d = end - nowSec;
  if (d <= 0) return 'Ended';
  const days = Math.floor(d / 86400), h = Math.floor((d % 86400) / 3600), m = Math.floor((d % 3600) / 60);
  return days > 0 ? `${days}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function AddrLink({ address, className }: { address: string | null | undefined; className?: string }) {
  if (!address) return <span>n/a</span>;
  return (
    <a href={getExplorerAddressUrl(address)} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-0.5 font-mono hover:text-white', className)}>
      {shortenAddress(address)} <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a href={getExplorerTxUrl(hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono text-polydash-green hover:text-polydash-green-light">
      {shortenAddress(hash)} <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

export function Loading({ label = 'Reading Robinhood Chain' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-4 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> {label}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-xl border border-[#FF5252]/30 bg-[#FF5252]/[0.06] px-3 py-2 text-[13px] text-[#FF8A80]">{message}</div>;
}

export function Panel({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn(card, 'p-4 sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {note && <span className="text-[11px] text-white/40">{note}</span>}
      </div>
      {children}
    </div>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2">
          <dt className="text-white/50">{k}</dt>
          <dd className="min-w-0 truncate text-right text-white/90">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'green' | 'neutral' | 'yellow' | 'red' }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
      tone === 'green' && 'bg-polydash-green/15 text-polydash-green',
      tone === 'neutral' && 'bg-white/[0.07] text-white/70',
      tone === 'yellow' && 'bg-yellow-400/10 text-yellow-300',
      tone === 'red' && 'bg-[#FF5252]/15 text-[#FF8A80]')}>{children}</span>
  );
}

// ---------- Poly Agent ----------
export function poolStatus(p: PoolStats): { label: string; tone: 'green' | 'neutral' | 'yellow' | 'red' } {
  if (p.ended) return { label: 'Ended', tone: 'neutral' };
  if (p.full) return { label: 'Full', tone: 'yellow' };
  if (p.isActive) return { label: 'Open', tone: 'green' };
  if (p.isActive === false) return { label: 'Inactive', tone: 'neutral' };
  return { label: 'n/a', tone: 'neutral' };
}

export function RateText({ rate }: { rate: RewardRate }) {
  if (rate.kind === 'ratio') return <span>{rate.perThousandPerDay.toLocaleString('en-US', { maximumFractionDigits: rate.perThousandPerDay < 1 ? 4 : 2 })} {rate.rewardSymbol} / day per 1,000 {rate.stakeSymbol}</span>;
  if (rate.kind === 'ended') return <span>0</span>;
  if (rate.kind === 'undefined') return <span>undefined</span>;
  return <span>n/a</span>;
}

export const RATE_LABEL = 'Token-denominated, at current total staked, changes as stake changes, not a promise of returns.';

export function PoolsTable({ pools, onSelect, empty }: { pools: PoolStats[]; onSelect?: (a: string) => void; empty: string }) {
  if (pools.length === 0) return <p className="py-3 text-[13px] text-white/50">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="text-[11px] uppercase tracking-wide text-white/40">
          <tr>{['Pool', 'Stake / reward', 'Total staked', 'Stakers', 'Reward rate', 'Status', ''].map((h) => <th key={h} className="px-4 py-2 font-medium sm:px-3">{h}</th>)}</tr>
        </thead>
        <tbody>
          {pools.map((p) => {
            const s = poolStatus(p);
            return (
              <tr key={p.address} className="border-t border-white/[0.06]">
                <td className="px-4 py-2.5 sm:px-3">
                  <div className="flex items-center gap-1.5 font-medium">{p.name || shortenAddress(p.address)} {p.verified && <Pill tone="green">Verified</Pill>}</div>
                  <div className="text-[11px] text-white/40">{p.version} · <AddrLink address={p.address} /></div>
                </td>
                <td className="px-4 py-2.5 text-white/70 sm:px-3">{p.stakeSymbol} / {p.rewardSymbol}</td>
                <td className="px-4 py-2.5 sm:px-3">{num(p.totalStaked)}</td>
                <td className="px-4 py-2.5 sm:px-3">{p.stakerCount ?? 'n/a'}</td>
                <td className="px-4 py-2.5 sm:px-3"><RateText rate={p.rewardRate} /></td>
                <td className="px-4 py-2.5 sm:px-3"><Pill tone={s.tone}>{s.label}</Pill></td>
                <td className="px-4 py-2.5 text-right sm:px-3">
                  {onSelect && <button onClick={() => onSelect(p.address)} className="text-[12px] text-polydash-green hover:text-polydash-green-light">Details</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PoolStatsCard({ p, nowSec }: { p: PoolStats; nowSec: number }) {
  const s = poolStatus(p);
  return (
    <Panel title={p.name || 'Pool stats'} note={<span className="inline-flex items-center gap-1.5">{p.verified ? <Pill tone="green">Verified</Pill> : p.version === 'v2' ? <Pill>Not verified</Pill> : null}<Pill tone={s.tone}>{s.label}</Pill></span>}>
      {p.description && <p className="mb-3 text-[13px] text-white/60">{p.description}</p>}
      <KV rows={[
        ['Pool', <AddrLink key="a" address={p.address} />],
        ['Version', p.version],
        ['Stake token', <span key="s">{p.stakeSymbol} · <AddrLink address={p.stakeToken} /></span>],
        ['Reward token', <span key="r">{p.rewardSymbol} · <AddrLink address={p.rewardToken} /></span>],
        ['Total staked', `${num(p.totalStaked)} ${p.stakeSymbol}`],
        ['Total rewards', `${num(p.totalRewards)} ${p.rewardSymbol}`],
        ['Rewards paid', `${num(p.totalRewardsPaid)} ${p.rewardSymbol}`],
        ['Stakers', p.stakerCount ?? 'n/a'],
        ['Start', fmtDate(p.startTime)],
        ['End', fmtDate(p.endTime)],
        ['Time left', timeLeft(p.endTime, nowSec)],
        ['Cap', p.maxTotalStake == null ? 'n/a' : p.maxTotalStake === 0 ? 'No cap' : `${num(p.maxTotalStake)} ${p.stakeSymbol}`],
        ['Claim fee', p.claimFeeBps == null ? 'n/a' : `${(p.claimFeeBps / 100).toFixed(2)}%`],
        ['Funded', p.funded == null ? 'n/a' : p.funded ? 'Yes' : 'No'],
      ]} />
      <RateBlock p={p} />
    </Panel>
  );
}

export function RateBlock({ p }: { p: PoolStats }) {
  return (
    <div className="mt-4 rounded-xl bg-white/[0.04] p-3">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-white/50">Reward rate</span>
        <span className="font-semibold"><RateText rate={p.rewardRate} /></span>
      </div>
      <p className="mt-1 text-[11px] text-white/40">
        {p.rewardRate.kind === 'ended' ? 'Pool has ended.' : p.rewardRate.kind === 'undefined' ? 'Nothing is staked, so the rate is undefined.' : RATE_LABEL}
      </p>
    </div>
  );
}

export function FlowsTable({ rows, symbol, blocks }: { rows: FlowRow[]; symbol: string; blocks: number }) {
  return (
    <Panel title="Recent stake / withdraw flows" note={`Last ${blocks.toLocaleString('en-US')} blocks`}>
      {rows.length === 0 ? <p className="text-[13px] text-white/50">No stakes or withdrawals in this range.</p> : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-white/40">
              <tr>{['Type', 'Wallet', 'Amount', 'Time', 'Tx'].map((h) => <th key={h} className="px-4 py-2 font-medium sm:px-3">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.txHash}-${r.type}-${r.user}`} className="border-t border-white/[0.06]">
                  <td className={cn('px-4 py-2 sm:px-3', r.type === 'Stake' ? 'text-polydash-green' : 'text-[#FF8A80]')}>{r.type}</td>
                  <td className="px-4 py-2 text-white/70 sm:px-3"><AddrLink address={r.user} /></td>
                  <td className="px-4 py-2 sm:px-3">{num(r.amount)} {symbol}</td>
                  <td className="px-4 py-2 text-white/60 sm:px-3">{fmtDate(r.time)}</td>
                  <td className="px-4 py-2 sm:px-3"><TxLink hash={r.txHash} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------- PolyCTO ----------
export function TokenCard({ t }: { t: TokenAnalysis }) {
  return (
    <Panel title={t.name ? `${t.name}${t.symbol ? ` (${t.symbol})` : ''}` : 'Token analysis'} note={t.isContract ? <Pill tone="green">Contract</Pill> : <Pill tone="red">Not a contract</Pill>}>
      <KV rows={[
        ['Address', <AddrLink key="a" address={t.address} className="min-h-10 sm:min-h-0" />],
        ['Name', t.name ?? 'n/a'],
        ['Symbol', t.symbol ?? 'n/a'],
        ['Decimals', t.decimals ?? 'n/a'],
        ['Total supply', num(t.totalSupply)],
        ['Owner', t.owner ? (t.renounced ? 'Ownership renounced' : <AddrLink key="o" address={t.owner} className="min-h-10 sm:min-h-0" />) : 'No owner() function'],
      ]} />
    </Panel>
  );
}

export function HoldersCard({ h }: { h: HolderReport }) {
  return (
    <Panel title="Holders & flows" note={`Estimated from recent transfers (last ${h.blocks.toLocaleString('en-US')} blocks)`}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        {[['Transfers', h.transfers.toLocaleString('en-US')], ['Top-10 share', h.top10Pct == null ? 'n/a' : `${h.top10Pct.toFixed(2)}%`], ['Burned', `${num(h.burned)}`]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/[0.04] p-2.5"><div className="text-[11px] text-white/45">{k}</div><div className="text-[14px] font-semibold">{v}</div></div>
        ))}
      </div>
      {h.top.length === 0 ? <p className="text-[13px] text-white/50">No transfers in this range.</p> : (
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th className="py-1.5 font-medium">#</th><th className="py-1.5 font-medium">Wallet</th><th className="py-1.5 text-right font-medium">Net received</th><th className="py-1.5 text-right font-medium">% supply</th></tr></thead>
          <tbody>
            {h.top.map((r, i) => (
              <tr key={r.address} className="border-t border-white/[0.06]">
                <td className="py-1.5 text-white/40">{i + 1}</td>
                <td className="py-1.5 text-white/70"><AddrLink address={r.address} /></td>
                <td className="py-1.5 text-right">{num(r.balance)} {h.symbol}</td>
                <td className="py-1.5 text-right">{r.pct == null ? 'n/a' : `${r.pct.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function SecurityCard({ r }: { r: SecurityReport }) {
  const tone = (s: string) => (s === 'high' ? 'red' : s === 'medium' ? 'yellow' : 'neutral') as 'red' | 'yellow' | 'neutral';
  return (
    <Panel title="Security check" note={r.verified ? <Pill tone="green">Verified on Sourcify</Pill> : <Pill>Not verified</Pill>}>
      <p className="mb-3 rounded-xl bg-yellow-400/[0.06] px-3 py-2 text-[12px] text-yellow-200/90">Heuristic scan only. This is NOT a security audit.</p>
      {r.flags.length === 0 ? <p className="text-[13px] text-white/60">No heuristic flags matched.</p> : (
        <ul className="space-y-2">
          {r.flags.map((f) => (
            <li key={f.id} className="rounded-xl bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2 break-words text-[13px] font-medium"><Pill tone={tone(f.severity)}>{f.severity}</Pill>{f.title}</div>
              <p className="mt-1 break-words text-[12px] text-white/55">{f.meaning}</p>
              {f.files && <p className="mt-1 break-all font-mono text-[11px] text-white/35">{f.files.slice(0, 3).join(', ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ScamCard({ r }: { r: ScamResult }) {
  const tone = r.action === 'delete + warn' ? 'red' : r.action === 'review' ? 'yellow' : 'green';
  return (
    <Panel title="Scam message check" note="Suggestion only">
      <div className="flex items-center gap-4">
        <div><div className="text-[11px] text-white/45">Risk score</div><div className="text-[24px] font-semibold">{r.score}<span className="text-[13px] text-white/40">/100</span></div></div>
        <div><div className="text-[11px] text-white/45">Suggested action</div><Pill tone={tone}>{r.action}</Pill></div>
        <div><div className="text-[11px] text-white/45">Links</div><div className="text-[14px] font-semibold">{r.links}</div></div>
      </div>
      {r.matches.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{r.matches.map((m) => <li key={m}><Pill>{m}</Pill></li>)}</ul>}
    </Panel>
  );
}
