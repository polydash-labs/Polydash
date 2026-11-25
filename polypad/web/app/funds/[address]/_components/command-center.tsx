'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { formatEther } from 'viem';
import { DERIVED_MANDATE_NOTE, bundledMandate, isDerivedMandate } from '@/lib/fund/mandates';
import { formatFundEth } from '@/lib/fund/model';
import { pct } from '@/lib/fund/phase3';
import { GLOSS, usdLabel } from '@/lib/fund/phase6';
import type { FundLedger } from '@/lib/fund/use-fund-ledger';
import { cn } from '@/lib/utils';
import { Tip } from '../../_components/phase3-ui';
import { Card } from './phase3-panels';

export function useSecondTicker(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Gloss({ text, className }: { text: string; className?: string }) {
  return <p className={cn('text-[11px] leading-snug text-white/45', className)}>{text}</p>;
}

const eth = (v: bigint) => Number(formatEther(v));
export function usdOf(v: bigint | null, ethUsd: number | null | undefined): string {
  if (v === null || !ethUsd) return '';
  return usdLabel(eth(v) * ethUsd);
}

export function LiveDot({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/55" suppressHydrationWarning>
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
      {label}
    </span>
  );
}

function StripCell({ label, value, sub, gloss, tone, note }: { label: string; value: string; sub?: string; gloss: string; tone?: 'up' | 'down'; note?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p className={cn('mt-1 break-words font-mono text-[17px] text-white', tone === 'up' && 'text-emerald-300', tone === 'down' && 'text-red-300')}>{value}</p>
      {sub && <p className="text-[11px] text-white/55">{sub}</p>}
      {note && <p className="mt-1 text-[12px] leading-snug text-white/60">{note}</p>}
      <Gloss text={gloss} className="mt-1.5" />
    </div>
  );
}

/** Return of the value per share against the high-water mark, in %. Null when there is no mark yet. */
export function returnVsHwm(nav: bigint | null, hwm: bigint): number | null {
  if (nav === null || hwm <= 0n) return null;
  return (Number(nav - hwm) / Number(hwm)) * 100;
}

export function FundHealthStrip(p: {
  navPerShare: bigint | null;
  hwm: bigint;
  aumEth: bigint | null;
  ethUsd: number | null | undefined;
  holders: number | null;
  sold: bigint;
  max: bigint;
  launched: boolean;
  liveLabel?: string;
  /** True while the raise is still open (NAV is just vault ETH ÷ shares until investing starts). */
  raising?: boolean;
  /** True when the vault status is still Raising but the raise deadline has passed (Polycat, round 7): the badge must say the raise ended, not "Raising — no trades yet". Display only — the on-chain status is unchanged until failRaise is called. */
  raiseEnded?: boolean;
  /** Plain note under the badge explaining shares sold before any trade (e.g. the manager's locked stake). */
  soldNote?: string;
  holdersFallback?: string;
}) {
  const ret = returnVsHwm(p.navPerShare, p.hwm);
  return (
    <section id="fund-health" className="rounded-2xl border border-white/15 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-lg sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold text-white">Tokenized fund health</h2>
          <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', p.launched ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-100')}>
            {p.launched ? 'Launched — investing' : p.raiseEnded ? 'Raise ended — deadline passed' : p.soldNote ? 'Raising — no trades yet' : 'Not yet launched — awaiting first buy'}
          </span>
        </div>
        <LiveDot label={p.liveLabel ?? 'Live from Robinhood Chain · refreshes every 30 s'} />
      </div>
      {!p.launched && p.soldNote && <p className="-mt-1 mb-3 text-[12px] text-white/60" data-testid="sold-note">{p.soldNote}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StripCell label="Value per share" value={p.navPerShare === null ? '—' : `${formatFundEth(p.navPerShare)} ETH`} sub={usdOf(p.navPerShare, p.ethUsd)} gloss={GLOSS.nav} note={p.raising && !p.launched ? 'Right now this is just the ETH in the vault ÷ shares — it only changes once investing starts.' : undefined} />
        <StripCell
          label="Return vs high-water mark"
          value={ret === null ? 'Not set yet' : `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`}
          sub={p.hwm > 0n ? `Mark ${formatFundEth(p.hwm)} ETH per share` : 'Set when investing starts'}
          gloss={GLOSS.hwm}
          tone={ret === null ? undefined : ret >= 0 ? 'up' : 'down'}
        />
        <StripCell label="Assets under management (AUM)" value={p.aumEth === null ? '—' : `${formatFundEth(p.aumEth)} ETH`} sub={usdOf(p.aumEth, p.ethUsd)} gloss={GLOSS.aum} />
        <StripCell label="Holders" value={p.holders === null ? (p.holdersFallback ?? 'Counting…') : p.holders.toLocaleString('en-US')} sub={p.holders === 1 ? '1 wallet' : undefined} gloss={GLOSS.holders} />
        <StripCell label="Shares sold" value={`${p.sold.toString()} / ${p.max.toString()}`} sub={p.max > 0n ? `${((Number(p.sold) / Number(p.max)) * 100).toFixed(2)}% of all shares` : undefined} gloss={GLOSS.shares} />
      </div>
    </section>
  );
}

export type HoldingRowView = { key: string; symbol: string; valueEth: bigint | null; bps: number; capBps: number | null; capNote?: string };

export function HoldingsCapTable({ rows, cashEth, ethUsd, loading, error }: { rows: HoldingRowView[]; cashEth?: bigint | null; ethUsd: number | null | undefined; loading?: boolean; error?: boolean }) {
  return (
    <Card title="Holdings vs caps" subtitle="Each position's live share of the tokenized fund, its dollar value, and the most it may ever be (per-asset cap).">
      <Gloss text={GLOSS.assetCap} className="-mt-2 mb-3" />
      {loading ? <LoadingLine text="Reading holdings from Robinhood Chain…" /> : error ? <EmptyLine text="Holdings could not be read right now. Retrying every 30 s." /> : rows.length === 0 ? (
        <EmptyLine text="No holdings yet — awaiting first buy" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-white/40">
              <tr><th className="py-1.5 font-normal">Asset</th><th className="font-normal">Weight</th><th className="font-normal">Value</th><th className="font-normal">Cap</th><th className="w-[34%] font-normal">Weight vs cap</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const over = r.capBps !== null && r.bps > r.capBps;
                const fill = r.capBps ? Math.min(100, (r.bps / r.capBps) * 100) : 0;
                return (
                  <tr key={r.key} className="border-t border-white/5">
                    <td className="py-2 font-medium text-white">{r.symbol}</td>
                    <td className="font-mono text-white">{pct(r.bps)}</td>
                    <td className="text-white/75">{r.valueEth === null ? 'value unknown' : <>{formatFundEth(r.valueEth)} ETH<span className="block text-[11px] text-white/45">{usdOf(r.valueEth, ethUsd)}</span></>}</td>
                    <td className="text-white/75">{r.capBps === null ? 'No cap' : pct(r.capBps)}{r.capNote && <span className="block text-[11px] text-white/45">{r.capNote}</span>}</td>
                    <td>
                      {r.capBps === null ? <span className="text-[11px] text-white/40">Cash, not capped</span> : (
                        <div className="space-y-1">
                          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={cn('h-full rounded-full', over ? 'bg-red-400' : fill >= 85 ? 'bg-amber-300' : 'bg-emerald-400')} style={{ width: `${fill}%` }} /></div>
                          <p className="text-[11px] text-white/45">{over ? `Over the cap by ${pct(r.bps - r.capBps)}` : `${pct(r.capBps - r.bps)} room left`}</p>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cashEth !== undefined && cashEth !== null && rows.length === 0 && <p className="mt-2 text-[12px] text-white/50">ETH waiting to be invested: {formatFundEth(cashEth)} ETH {usdOf(cashEth, ethUsd) && `(${usdOf(cashEth, ethUsd)})`}</p>}
    </Card>
  );
}

export function RiskMonitor(p: { drawdownBps: number; brakeBps: number; deviationBps: number; tradeCapBps: number; assetCapBps: number; brakeEvents?: number; overCap?: string[] }) {
  const brakeOn = p.brakeBps > 0 && p.drawdownBps >= p.brakeBps;
  const near = p.brakeBps > 0 && !brakeOn && p.drawdownBps >= p.brakeBps * 0.75;
  const alerts: string[] = [];
  if (brakeOn) alerts.push(`Drawdown brake is ON: value per share is ${pct(p.drawdownBps)} below its peak. New buys are paused; selling still works.`);
  if (near) alerts.push(`Close to the brake: ${pct(p.drawdownBps)} drop of the ${pct(p.brakeBps)} limit.`);
  for (const s of p.overCap ?? []) alerts.push(`${s} is above its per-asset cap.`);
  const fill = p.brakeBps ? Math.min(100, (p.drawdownBps / p.brakeBps) * 100) : 0;
  return (
    <Card title="Risk monitor" subtitle="Live checks against the limits written into the tokenized fund contract.">
      {alerts.length > 0 ? (
        <div className="mb-4 space-y-1.5">
          {alerts.map((a) => <p key={a} className="flex gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{a}</p>)}
        </div>
      ) : <p className="mb-4 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[12px] text-emerald-100">No limit breached right now.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <RiskItem label="Drawdown vs brake" value={p.brakeBps ? `${pct(p.drawdownBps)} of ${pct(p.brakeBps)}` : 'No brake in this strategy'} gloss={GLOSS.brake}>
          {p.brakeBps > 0 && <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={cn('h-full rounded-full', brakeOn ? 'bg-red-400' : near ? 'bg-amber-300' : 'bg-emerald-400')} style={{ width: `${fill}%` }} /></div>}
        </RiskItem>
        <RiskItem label="Brake" value={p.brakeBps === 0 ? 'Off (no brake)' : brakeOn ? 'ON — new buys paused' : 'OFF — buys allowed'} gloss={`Times the brake has fired so far: ${p.brakeEvents ?? 0}.`} />
        <RiskItem label="Price vs TWAP limit" value={p.deviationBps ? `Max ${pct(p.deviationBps)} away` : 'No limit'} gloss={`${GLOSS.deviation} Checked at every trade, so a trade that breaks it never goes through.`} />
        <RiskItem label="Per-trade cap" value={p.tradeCapBps ? pct(p.tradeCapBps) : 'None'} gloss={GLOSS.tradeCap} />
        <RiskItem label="Per-asset cap" value={p.assetCapBps ? pct(p.assetCapBps) : 'None'} gloss={GLOSS.assetCap} />
        <RiskItem label="TWAP" value="Used for every price check" gloss={GLOSS.twap} />
      </div>
    </Card>
  );
}

function RiskItem({ label, value, gloss, children }: { label: string; value: string; gloss: string; children?: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[12px] text-white/55">{label}</p>
      <p className="text-[14px] text-white">{value}</p>
      {children}
      <Gloss text={gloss} />
    </div>
  );
}

export function LedgerCards({ ledger, loading, feeBps, earned, payable, ethUsd, symbolOf }: {
  ledger: FundLedger | undefined;
  loading: boolean;
  feeBps: number;
  earned: bigint;
  payable: bigint;
  ethUsd: number | null | undefined;
  symbolOf: (a: string) => string;
}) {
  const trades = ledger?.trades ?? [];
  const dists = ledger?.distributions ?? [];
  const paid = ledger?.feesWithdrawn ?? 0n;
  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card title="Trade blotter" subtitle="Every buy and sell the vault has made, newest first, read from Robinhood Chain.">
        {loading ? <LoadingLine text="Reading trades…" /> : trades.length === 0 ? <EmptyLine text="No trades yet — first buy coming" /> : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-black text-white/45"><tr><th className="py-1.5 font-normal">Side</th><th className="font-normal">Asset</th><th className="font-normal">Size</th><th className="font-normal">Value after</th><th className="font-normal">Block</th></tr></thead>
              <tbody className="text-white/80">
                {trades.slice(0, 50).map((t) => (
                  <tr key={`${t.tx}-${t.asset}-${t.size}`} className="border-t border-white/5">
                    <td className={cn('py-1.5 font-medium', t.side === 'Buy' ? 'text-emerald-300' : 'text-red-300')}>{t.side}</td>
                    <td>{symbolOf(t.asset)}</td>
                    <td className="font-mono">{formatFundEth(t.size)}</td>
                    <td className="font-mono">{formatFundEth(t.navAfter)} ETH</td>
                    <td className="font-mono text-white/50">{t.block.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="space-y-5">
        <Card title="Fees" subtitle={`Performance fee ${feeBps ? pct(feeBps) : 'none'}, only on gains above the high-water mark. 0% management fee.`}>
          <Gloss text={GLOSS.perfFee} className="-mt-2 mb-3" />
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <FeeBox label="Earned (counted)" v={earned} ethUsd={ethUsd} />
            <FeeBox label="Payable now" v={payable} ethUsd={ethUsd} />
            <FeeBox label="Paid out" v={paid} ethUsd={ethUsd} />
          </div>
          {earned === 0n && <p className="mt-2 text-[12px] text-white/45">No fee yet. A fee is only counted once the value per share rises above the high-water mark.</p>}
        </Card>
        <Card title="Distributions paid" subtitle="ETH the manager sent back to all holders.">
          {loading ? <LoadingLine text="Reading distributions…" /> : dists.length === 0 ? <EmptyLine text="First distribution coming after the first buy" /> : (
            <ul className="space-y-1 text-[12px] text-white/70">
              {dists.slice(0, 8).map((d) => <li key={`${d.tx}-${d.roundId}`} className="flex justify-between"><span>Round {d.roundId}</span><span className="font-mono">{formatFundEth(d.pot)} ETH total · {formatFundEth(d.perUnit)} per share</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function FeeBox({ label, v, ethUsd }: { label: string; v: bigint; ethUsd: number | null | undefined }) {
  return <div className="rounded-lg bg-white/5 px-2 py-2"><p className="text-white/45">{label}</p><p className="font-mono text-[13px] text-white">{formatFundEth(v)} ETH</p><p className="text-[11px] text-white/40">{usdOf(v, ethUsd)}</p></div>;
}

export function LoadingLine({ text }: { text: string }) {
  return <p className="flex items-center gap-2 py-4 text-[12px] text-white/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {text}</p>;
}
export function EmptyLine({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-white/15 px-3 py-5 text-center text-[13px] text-white/60">{text}</p>;
}

/** Minimal markdown rendering for strategy write-ups (the published files are
 * markdown). Display-only: the source text is never edited — mandate files
 * are byte-exact and hashed on-chain. Handles headings, quotes, bullets,
 * checklist items, simple tables, and **bold** / `code` inline. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<strong key={`${keyPrefix}-${i}`} className="font-semibold text-white">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) parts.push(<em key={`${keyPrefix}-${i}`}>{tok.slice(1, -1)}</em>);
    else parts.push(<code key={`${keyPrefix}-${i}`} className="rounded bg-white/10 px-1 font-mono text-[11px]">{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MandateText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  let table: string[][] = [];
  const flushList = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(<ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5">{items.map((l, i) => <li key={i}>{renderInline(l, `li-${blocks.length}-${i}`)}</li>)}</ul>);
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const lines = quote;
    quote = [];
    blocks.push(<blockquote key={`q-${blocks.length}`} className="border-l-2 border-white/25 pl-3 text-white/65">{lines.map((l, i) => <p key={i}>{renderInline(l, `q-${blocks.length}-${i}`)}</p>)}</blockquote>);
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table;
    table = [];
    blocks.push(<table key={`t-${blocks.length}`} className="w-full text-left"><tbody>{rows.map((r, i) => (<tr key={i} className="border-t border-white/5">{r.map((c, j) => (<td key={j} className="py-1 pr-3 align-top">{renderInline(c, `t-${blocks.length}-${i}-${j}`)}</td>))}</tr>))}</tbody></table>);
  };
  // The published mandates are hard-wrapped: a bold/italic span can open on one
  // line and close on the next (e.g. "**inside the\nliquidity pool ...**"), which
  // per-line rendering would show literally. Join soft-wrapped continuation lines
  // into the previous block line first; a line that starts a new block, a blank
  // line, and lines after a heading or table row still break the paragraph.
  const isBlockStart = (l: string) =>
    l.startsWith('# ') || l.startsWith('## ') || l.startsWith('> ') ||
    l.startsWith('- ') || l.startsWith('* ') || /^\d+\.\s/.test(l) || /^\|.*\|$/.test(l);
  const logical: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { logical.push(''); continue; }
    const prev = logical[logical.length - 1];
    if (prev && !prev.startsWith('# ') && !prev.startsWith('## ') && !/^\|.*\|$/.test(prev) && !isBlockStart(line)) {
      logical[logical.length - 1] = `${prev} ${line}`;
    } else {
      logical.push(line);
    }
  }
  for (const raw of logical) {
    const line = raw.trim();
    if (!line) { flushList(); flushQuote(); flushTable(); continue; }
    if (line.startsWith('# ')) { flushList(); flushQuote(); flushTable(); blocks.push(<h3 key={`h-${blocks.length}`} className="pt-2 text-[15px] font-semibold text-white">{renderInline(line.slice(2), `h-${blocks.length}`)}</h3>); continue; }
    if (line.startsWith('## ')) { flushList(); flushQuote(); flushTable(); blocks.push(<h4 key={`h-${blocks.length}`} className="pt-2 text-[14px] font-semibold text-white">{renderInline(line.slice(3), `h-${blocks.length}`)}</h4>); continue; }
    if (line.startsWith('> ')) { flushList(); flushTable(); quote.push(line.slice(2)); continue; }
    if (line.startsWith('- ') || line.startsWith('* ')) { flushQuote(); flushTable(); list.push(line.slice(2).replace(/^\[( |x)\]\s*/, '☐ ')); continue; }
    if (/^\|.*\|$/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // table separator row
      flushList(); flushQuote();
      table.push(cells);
      continue;
    }
    flushList(); flushQuote(); flushTable();
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line, `p-${blocks.length}`)}</p>);
  }
  flushList(); flushQuote(); flushTable();
  return <div className="space-y-2 text-[12px] leading-relaxed text-white/75">{blocks}</div>;
}

/** Strategy rules / thesis shown inline from IPFS through a public gateway. Never links a raw ipfs:// address. */
export function MandateCard({ title, uri, httpUrl, lines, hash, tip, fallbackText }: { title: string; uri: string; httpUrl: string; lines?: readonly string[]; hash?: string; tip?: string; fallbackText?: string }) {
  const [state, setState] = useState<{ loading: boolean; text: string | null; reason?: string; source?: string }>({ loading: !!httpUrl, text: null });
  useEffect(() => {
    if (!httpUrl || !uri.startsWith('ipfs://')) { setState({ loading: false, text: null }); return; }
    let live = true;
    const copy = bundledMandate(uri);
    const bundled = copy ?? fallbackText ?? null;
    const src = copy ? 'bundled' : 'summary';
    fetch(`/api/ipfs?uri=${encodeURIComponent(uri)}`, { signal: AbortSignal.timeout(12_000) })
      .then((r) => r.json())
      .then((j: { ok?: boolean; text?: string | null; reason?: string; source?: string }) => {
        if (!live) return;
        if (j.ok && j.text) setState({ loading: false, text: j.text, reason: j.reason, source: j.source });
        else setState(bundled ? { loading: false, text: bundled, reason: j.reason, source: src } : { loading: false, text: null, reason: j.reason });
      })
      .catch(() => { if (live) setState(bundled ? { loading: false, text: bundled, source: src } : { loading: false, text: null }); });
    return () => { live = false; };
  }, [uri, httpUrl, fallbackText]);

  return (
    <Card title={title} subtitle={tip}>
      <Gloss text={GLOSS.strategy} className="-mt-2 mb-3" />
      {lines && lines.length > 0 && (
        <ul className="mb-3 space-y-1.5 text-[13px] text-white/80">{lines.map((l) => <li key={l} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/50" />{l}</li>)}</ul>
      )}
      {state.loading ? <LoadingLine text="Loading the full write-up from IPFS…" /> : state.text ? (
        <div data-testid="mandate-writeup">
          <div className="rounded-lg bg-white/[0.04] p-3"><MandateText text={state.text} /></div>
          {state.source === 'bundled' && <p className="mt-2 text-[11px] text-white/45">{isDerivedMandate(uri) ? DERIVED_MANDATE_NOTE : <>Full write-up shown from the site&apos;s copy of the published file, because no IPFS gateway is serving it right now.</>}</p>}
          {state.source === 'summary' && <p className="mt-2 text-[11px] text-white/45">Full strategy rules shown from the site&apos;s copy, because the published file is not being served by any IPFS gateway right now. The link below opens the published file once it is available.</p>}
        </div>
      ) : httpUrl ? <p className="text-[12px] text-white/50">{state.reason === 'not_hosted'
        ? 'The full write-up cannot be shown yet: no IPFS node is hosting this file right now, so no public gateway can serve it. It will appear here automatically once the file is pinned. The link below is kept as a fallback.'
        : 'The full write-up could not be loaded inline right now. Open it with the link below.'}</p>
        : <p className="text-[12px] text-white/50">No public write-up link was published for this tokenized fund.{hash ? ` Rules fingerprint (mandate hash) ${hash.slice(0, 10)}…${hash.slice(-6)}.` : ''}</p>}
      {httpUrl && (
        <a href={httpUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] text-white/75 underline-offset-4 hover:text-white hover:underline">
          Read the strategy rules (opens a public IPFS gateway) <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </Card>
  );
}

export function ManagerActionsHub({ children, preview }: { children: ReactNode; preview?: boolean }) {
  return (
    <section id="manager-actions" className="space-y-4 rounded-2xl border border-white/25 bg-white/[0.02] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold text-white">Manager actions</h2>
          <p className="mt-0.5 text-[12px] text-white/50">{preview ? 'What the manager wallet sees. Investors never see this hub.' : 'Only you see this, because your wallet manages this tokenized fund. Investor actions are separate above.'}</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-white/80">Manager only <Tip text="Every action here is checked by the contract: it only works from the manager wallet and only inside the tokenized fund's rules." /></span>
      </div>
      {children}
    </section>
  );
}
