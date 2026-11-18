'use client';

import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { formatEther, parseEther } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatFundEth } from '@/lib/fund/model';
import { pct } from '@/lib/fund/phase3';
import {
  GLOSS, PROPOSAL_DELAY_SECONDS, PROPOSAL_KIND, THESIS_LINES, capOf, checkThesisUri, clampThesis, ipfsToHttp, proposalStage, ptDateTime, type ProposalView,
} from '@/lib/fund/phase6';
import { cn } from '@/lib/utils';
import { Tip } from '../../_components/phase3-ui';
import { EmptyLine, Gloss } from './command-center';

const pad = (n: number) => String(n).padStart(2, '0');

/** Ticking d/h/m/s countdown with progress bar and the exact time the proposal can be executed. */
export function ProposalCountdown({ readyAt, now, showGloss = true }: { readyAt: number; now: number; showGloss?: boolean }) {
  const left = now ? Math.max(0, readyAt - now) : PROPOSAL_DELAY_SECONDS;
  const done = !!now && left === 0;
  const progress = now ? Math.min(100, Math.max(0, ((PROPOSAL_DELAY_SECONDS - left) / PROPOSAL_DELAY_SECONDS) * 100)) : 0;
  const parts = [
    { v: Math.floor(left / 86_400), u: 'days' },
    { v: Math.floor((left % 86_400) / 3600), u: 'hours' },
    { v: Math.floor((left % 3600) / 60), u: 'min' },
    { v: Math.floor(left % 60), u: 'sec' },
  ];
  return (
    <div className="space-y-2" data-testid="proposal-countdown">
      {done ? (
        <p className="rounded-lg bg-emerald-400/15 px-3 py-2 text-[13px] font-medium text-emerald-100">Wait is over — ready to execute</p>
      ) : (
        <div className="flex gap-2" suppressHydrationWarning>
          {parts.map((p) => (
            <div key={p.u} className="min-w-[56px] rounded-lg bg-white/[0.06] px-2 py-1.5 text-center ring-1 ring-white/10">
              <p className="font-mono text-[20px] leading-none text-white" suppressHydrationWarning>{now ? (p.u === 'days' ? p.v : pad(p.v)) : '–'}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-white/45">{p.u}</p>
            </div>
          ))}
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={cn('h-full rounded-full transition-all', done ? 'bg-emerald-400' : 'bg-amber-300')} style={{ width: `${progress}%` }} /></div>
      <p className="text-[12px] text-white/60" suppressHydrationWarning>
        {progress.toFixed(0)}% of the 2-day wait done · executable from <span className="text-white">{ptDateTime(readyAt)}</span>
      </p>
      {showGloss && <Gloss text={GLOSS.allowlist} />}
    </div>
  );
}

export type PickedAsset = { symbol: string; name?: string; note?: string; templateCapBps?: number };
export type ProposalDraft = { capBps: number; reason: string; uri: string };

/** Proposal form with a live cap check. onSubmit undefined = read-only preview. */
export function ProposalForm({ picked, aumEth, spendableEth, tradeCapBps, onSubmit, pending, previewNote, onClose }: {
  picked: PickedAsset;
  aumEth: bigint | null;
  spendableEth: bigint | null;
  tradeCapBps: number;
  onSubmit?: (d: ProposalDraft) => void;
  pending?: boolean;
  previewNote?: string;
  onClose?: () => void;
}) {
  const [capPct, setCapPct] = useState(30);
  const [amount, setAmount] = useState('');
  const [sharePct, setSharePct] = useState('');
  const [reason, setReason] = useState('');
  const [uri, setUri] = useState('');

  const aum = aumEth !== null && aumEth > 0n ? Number(formatEther(aumEth)) : 0;
  const setFromAmount = (v: string) => {
    setAmount(v);
    const n = Number(v);
    setSharePct(aum && v.trim() && Number.isFinite(n) ? String(Math.round((n / aum) * 10_000) / 100) : '');
  };
  const setFromPct = (v: string) => {
    setSharePct(v);
    const n = Number(v);
    setAmount(aum && v.trim() && Number.isFinite(n) ? String(Math.round(((n / 100) * aum) * 1e6) / 1e6) : '');
  };

  let wei: bigint | null = null;
  try { wei = /^\d+(\.\d{1,18})?$/.test(amount.trim()) ? parseEther(amount.trim()) : null; } catch { wei = null; }
  const share = Number(sharePct);
  const tradePct = tradeCapBps / 100;
  let capError: string | null = null;
  if (amount.trim() && wei === null) capError = 'Enter the amount in ETH, for example 0.25.';
  else if (sharePct.trim() && (!Number.isFinite(share) || share <= 0)) capError = 'Enter a share above 0%.';
  else if (share > capPct) capError = `Rejected: ${share}% of the tokenized fund is above the ${capPct}% most this token may make up. Lower the amount or raise the cap (30% at most).`;
  else if (tradePct > 0 && share > tradePct) capError = `Rejected: one buy can move at most ${tradePct}% of the tokenized fund. Split it into buys of ${tradePct}% or less.`;
  else if (wei !== null && spendableEth !== null && wei > spendableEth) capError = `Rejected: the tokenized fund has only ${formatFundEth(spendableEth)} ETH free to spend right now.`;
  const capOk = !capError && !!sharePct.trim();
  const uriError = uri ? checkThesisUri(uri) : null;
  const canSend = !!onSubmit && !capError && !checkThesisUri(uri) && reason.trim().length > 0 && !pending;
  const lines = reason ? reason.split('\n').length : 0;

  return (
    <div id="proposal-form" className="space-y-4 rounded-xl border border-white/20 bg-white/[0.03] p-4" data-testid="proposal-form">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[15px] text-white">Propose <span className="font-semibold">{picked.symbol}</span>{picked.name && picked.name !== picked.symbol ? <span className="text-white/50"> · {picked.name}</span> : null}</p>
          {picked.note && <p className="mt-0.5 text-[12px] text-white/50">{picked.note}</p>}
        </div>
        {onClose && <button type="button" onClick={onClose} className="text-[12px] text-white/50 underline hover:text-white">Pick another token</button>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-white/60">Planned first buy (ETH)</span>
          <Input inputMode="decimal" placeholder="0.25" value={amount} onChange={(e) => setFromAmount(e.target.value)} aria-label="Planned buy in ETH" />
          <Gloss text={aum ? `The tokenized fund holds ${formatFundEth(aumEth as bigint)} ETH in total.` : 'The share is worked out once the tokenized fund holds ETH.'} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-white/60">% of the tokenized fund</span>
          <Input inputMode="decimal" placeholder="10" value={sharePct} onChange={(e) => setFromPct(e.target.value)} aria-label="Share of the tokenized fund in percent" />
          <Gloss text="Type either box; the other fills in." />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="flex items-center gap-1.5 text-xs text-white/60">Most of the tokenized fund this token may ever take (per-asset cap): <span className="font-semibold text-white">{capPct}%</span> <Tip text="The default is 30%. You can pick less, not more. Strategy assets use their strategy's own cap." /></span>
        <input type="range" min={1} max={30} step={1} value={capPct} onChange={(e) => setCapPct(Number(e.target.value))} className="w-full accent-white" aria-label="Per-asset cap" />
        <Gloss text={GLOSS.assetCap} />
      </label>

      <div aria-live="polite" className={cn('rounded-lg px-3 py-2 text-[12px]', capError ? 'border border-red-400/30 bg-red-400/10 text-red-100' : capOk ? 'border border-emerald-400/25 bg-emerald-400/10 text-emerald-100' : 'bg-white/5 text-white/55')} data-testid="cap-check">
        {capError ?? (capOk ? `Within limits: ${share}% is under the ${capPct}% cap${tradePct ? ` and the ${tradePct}% per-trade cap` : ''}.` : `Live cap check: enter an amount or a %. Limits: ${capPct}% per asset${tradePct ? `, ${tradePct}% per trade` : ''}.`)}
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-white/60">Thesis shown on the card (up to {THESIS_LINES} lines · {lines}/{THESIS_LINES})</span>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(clampThesis(e.target.value))} placeholder={'Why this token fits the tokenized fund, in plain words.\nWhat would make you sell it.\nHow big the position should get.'} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-white/60">Link to the full write-up (IPFS)</span>
        <Input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="ipfs://bafy…" aria-invalid={!!uriError} />
        {uriError ? <span className="text-[11px] text-red-200">{uriError}</span> : ipfsToHttp(uri) ? <a href={ipfsToHttp(uri)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-white/55 underline">Check the link <ExternalLink className="h-3 w-3" /></a> : null}
      </label>

      <p className="text-[11px] text-white/45">The proposal records the token, its cap, the thesis and the link on Robinhood Chain. The planned buy is only used for the check above; buying happens after the 2-day public wait, inside the per-trade cap.</p>
      <Button onClick={() => onSubmit?.({ capBps: capPct * 100, reason: clampThesis(reason), uri: uri.trim() })} disabled={!canSend} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {onSubmit ? 'Start the 2-day public wait (sign 1 transaction)' : previewNote ?? 'Submitting is turned off here'}
      </Button>
    </div>
  );
}

const STAGE_STYLE: Record<string, string> = {
  Waiting: 'bg-amber-400/15 text-amber-100',
  Executable: 'bg-sky-400/15 text-sky-100',
  Executed: 'bg-emerald-400/15 text-emerald-200',
  Cancelled: 'bg-white/10 text-white/60',
};

export function ProposalHistory({ list, now, nameOf, weightOf, title = 'Your proposals' }: { list: ProposalView[]; now: number; nameOf: (a: string) => string; weightOf?: (a: string) => number | null; title?: string }) {
  return (
    <div data-testid="proposal-history">
      <h3 className="mb-2 text-[14px] font-semibold text-white">{title}</h3>
      {list.length === 0 ? <EmptyLine text="No proposals yet — the first one appears here with its thesis and outcome." /> : (
        <ul className="divide-y divide-white/5">
          {list.map((p) => {
            const stage = proposalStage(p, now);
            const w = weightOf?.(p.asset) ?? null;
            const outcome = stage === 'Executed' ? (p.kind === 0 ? `Added with a ${pct(capOf(p.capBps))} cap${w !== null ? ` · now ${pct(w)} of the tokenized fund` : ''}` : 'Removed')
              : stage === 'Cancelled' ? 'Cancelled before the wait ended'
              : stage === 'Executable' ? 'Wait is over — can be executed now'
              : `Executable from ${ptDateTime(p.readyAt)}`;
            return (
              <li key={p.id} className="space-y-1 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] text-white">#{p.id} {PROPOSAL_KIND[p.kind] ?? 'Change'} <span className="font-semibold">{nameOf(p.asset)}</span></span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px]', STAGE_STYLE[stage])} suppressHydrationWarning>{stage}</span>
                </div>
                {p.reason && <p className="line-clamp-3 whitespace-pre-line text-[12px] text-white/60">{p.reason}</p>}
                <p className="text-[11px] text-white/45" suppressHydrationWarning>Outcome: {outcome}{ipfsToHttp(p.thesisUri) && <> · <a href={ipfsToHttp(p.thesisUri)} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">full write-up</a></>}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
