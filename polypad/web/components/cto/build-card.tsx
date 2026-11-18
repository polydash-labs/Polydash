'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileCode, GitCommitHorizontal, Info, Link2, Package, Tag, Unlink, Layers } from 'lucide-react';
import { Panel, Pill } from '@/app/agents/_components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tip } from '@/components/cto/xray-card';
import { BUILD_DISCLAIMER, BUILD_POINTS, STATUS_LABEL, timeAgo, type BuildStatus, type BuildView, type ShipKind, type ShipView } from '@/lib/buildact/shared';
import { cn } from '@/lib/utils';

const TONE: Record<BuildStatus, 'green' | 'yellow' | 'neutral'> = { shipping: 'green', slowing: 'yellow', quiet: 'neutral', none: 'neutral', pending: 'neutral' };
const ICON: Record<ShipKind, typeof Tag> = { commit: GitCommitHorizontal, batch: Layers, release: Package, tag: Tag, contract: FileCode, link: Link2, unlink: Unlink };
const KIND_LABEL: Record<ShipKind, string> = { commit: 'Commit', batch: 'Commit batch', release: 'Release', tag: 'Tag', contract: 'Contract', link: 'Linked', unlink: 'Unlinked' };
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

export function BuildPill({ status }: { status: BuildStatus }) {
  return <Pill tone={TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
      <div className="text-[11px] text-white/55">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-white/55">{sub}</div>}
    </div>
  );
}

function ShipRow({ s }: { s: ShipView }) {
  const Icon = ICON[s.kind] ?? GitCommitHorizontal;
  const source = s.url.includes('github.com') ? 'GitHub' : 'Explorer';
  return (
    <li className="flex items-start gap-2.5 border-b border-white/[0.06] py-2 last:border-0">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/55" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13px] text-white/80">{s.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/55">
          <span>{KIND_LABEL[s.kind]}</span>
          <span>{fmtDay(s.at)}</span>
          {s.reason && <span className="text-white/55">Filtered: {s.reason}</span>}
        </div>
      </div>
      <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-polydash-green hover:underline">
        {source} <ArrowUpRight className="h-3 w-3" />
      </a>
    </li>
  );
}

export function HowBuildWorks({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-[#0F0F0F] text-white sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[16px]">How build activity works</DialogTitle>
          <DialogDescription className="text-[13px] text-white/60">A shipping record from public GitHub and Robinhood Chain data, refreshed in the background.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-[13px] leading-relaxed text-white/70">
          <p><span className="text-white">Sources.</span> The creator links up to 3 GitHub repos and up to 3 extra deployer wallets by signing a message (free, no transaction). Adding a <span className="font-mono">polypad.json</span> file with the chain id and token address to the repo root upgrades the proof to Repo confirmed. Contracts deployed on Robinhood Chain by the creator and linked wallets are read from the explorer.</p>
          <p><span className="text-white">What counts.</span> Commits in the last 90 days, releases, contracts deployed (verified source earns a little more) and distinct contributors. Every item links to its source.</p>
          <p><span className="text-white">What is filtered.</span> Merge commits, bot authors, trivial messages, tiny or docs-only changes, more than 10 commits per author per day, bursts of 30+ commits in an hour, inherited fork history, new commits in archived repos and repeated identical contract deploys. Filtered items stay visible with the reason.</p>
          <p><span className="text-white">Score.</span> Up to {BUILD_POINTS} of the 100 health points. Recent code 0 to 6, releases 0 to 3, on-chain deploys 0 to 4, contributors 0 to 2, reduced after 14 quiet days and zero after 180. Signature-only repos are capped at 10, confirmed repos at 15, and repos created after launch that are under 30 days old at 8. Without a repo only on-chain deploys count. While checking, the score is a neutral 7. Price and volume are never used.</p>
          <p><span className="text-white">Status.</span> Shipping: something shipped in the last 14 days. Slowing: 15 to 60 days. Quiet: more than 60 days. No record: nothing found yet.</p>
          <p className="text-[12px] text-white/55">{BUILD_DISCLAIMER}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BuildCard({ build, className }: { build: BuildView | null | undefined; className?: string }) {
  const [showFiltered, setShowFiltered] = useState(false);
  const [how, setHow] = useState(false);
  const b = build;
  const m = b?.metrics ?? null;
  const confirmed = !!b?.repos.some((r) => r.proof === 'confirmed');
  return (
    <Panel title="Build activity" className={className} note={
      <span className="inline-flex items-center gap-2">
        {b && <BuildPill status={b.status} />}
        <button type="button" onClick={() => setHow(true)} className="inline-flex items-center gap-1 text-[11px] text-white/55 hover:text-white">
          <Info className="h-3 w-3" strokeWidth={1.5} /> How build activity works
        </button>
      </span>
    }>
      <HowBuildWorks open={how} onOpenChange={setHow} />
      {!b ? <p className="text-[13px] text-white/55">Build activity could not be loaded right now.</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {b.repos.length > 0 ? (
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', confirmed ? 'bg-polydash-green/15 text-polydash-green' : 'bg-white/[0.07] text-white/70')}>
                {confirmed ? 'Repo confirmed' : 'Signature'}
              </span>
            ) : <span className="text-white/55">No GitHub repo linked. On-chain deploys only.</span>}
            {b.repos.map((r) => (
              <a key={r.fullName} href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[12px] text-white/75 hover:text-white">
                {r.fullName} <ArrowUpRight className="h-3 w-3" />
              </a>
            ))}
            {b.flags.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-white/70">
                {f.label}<Tip label={f.label} text={f.detail} />
              </span>
            ))}
          </div>

          {b.pending ? (
            <p className="text-[13px] text-white/60">Checking the shipping record. This runs in the background; the score is a neutral 7 of {BUILD_POINTS} until it finishes.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Last commit" value={m?.lastCommitAt ? timeAgo(m.lastCommitAt) : 'none'} />
              <Tile label="Commits 7d / 30d" value={`${m?.commits7 ?? 0} / ${m?.commits30 ?? 0}`} />
              <Tile label="Contributors" value={String(m?.contributors ?? 0)} sub="last 90 days" />
              <Tile label="Contracts deployed" value={String(m?.contracts ?? 0)} sub={`${m?.contractsVerified ?? 0} verified`} />
            </div>
          )}

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h4 className="text-[12px] font-medium text-white/70">Shipping record</h4>
              {!b.pending && <span className="font-mono text-[11px] text-white/55">+{Math.round(b.earned)} / {BUILD_POINTS}</span>}
            </div>
            {b.ships.length === 0 ? <p className="text-[13px] text-white/55">No ships recorded yet.</p> : (
              <ul className="max-h-[360px] overflow-y-auto pr-1">{b.ships.map((s, i) => <ShipRow key={`${s.url}-${i}`} s={s} />)}</ul>
            )}
            {b.filteredCount > 0 && (
              <div className="mt-2">
                <button type="button" onClick={() => setShowFiltered((v) => !v)} className="text-[12px] text-white/60 underline-offset-2 hover:text-white hover:underline">
                  {showFiltered ? 'Hide filtered items' : `Show filtered items (${b.filteredCount})`}
                </button>
                {showFiltered && <ul className="mt-1 max-h-[300px] overflow-y-auto pr-1 opacity-80">{b.filtered.map((s, i) => <ShipRow key={`f-${s.url}-${i}`} s={s} />)}</ul>}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/55">
            <span>{b.updatedAt ? `Updated ${timeAgo(b.updatedAt)}` : 'Not checked yet'}{b.partial ? ' · partial data' : ''}</span>
            {b.heyUrl && (
              <a href={b.heyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-white/70 hover:text-white">
                Also tracked by HEY Research Lab <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="text-[11px] text-white/55">{BUILD_DISCLAIMER}</p>
        </div>
      )}
    </Panel>
  );
}

/** Compact token-page card. Shares the CTO report query (same key), so it adds no extra request. */
export function BuildCompact({ launch }: { launch: string }) {
  const [how, setHow] = useState(false);
  const q = useQuery<{ build?: BuildView | null; pending?: boolean; report?: unknown }>({
    queryKey: ['cto', launch],
    queryFn: async () => {
      const res = await fetch(`/api/cto/${launch}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Same as CtoSection: a 503/500 "report not available" answer is data,
        // not an error — this query is shared by key with the CTO section, so
        // it must behave identically or whichever component mounts first can
        // throw the shared query into an error state. A 404 still throws.
        if (res.status === 404) throw new Error(data?.error ?? 'Could not load the CTO report.');
        const body = data && typeof data === 'object' ? data : {};
        return { ...body, report: null, pending: false };
      }
      return data;
    },
    staleTime: 30_000,
  });
  const b = q.data?.build ?? null;
  const m = b?.metrics ?? null;
  // No build data because the report is unavailable or the load errored: say
  // so instead of pulsing forever.
  const unavailable = q.isError || (q.data != null && q.data.report === null && q.data.pending === false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <HowBuildWorks open={how} onOpenChange={setHow} />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Build activity</h3>
        {b ? <BuildPill status={b.status} /> : unavailable ? <span className="text-[11px] text-white/40">Not available</span> : <span className="h-5 w-16 animate-pulse rounded-full bg-white/[0.06]" />}
      </div>
      <div className="mt-3 min-h-[44px] text-[13px]">
        {!b ? <div className="h-4 w-3/4 animate-pulse rounded bg-white/[0.06]" /> : b.pending ? (
          <p className="text-white/60">Checking the shipping record.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-white/55">Last ship</dt><dd className="text-right font-mono">{m?.lastShipAt ? timeAgo(m.lastShipAt) : 'none'}</dd>
            <dt className="text-white/55">Commits 30d</dt><dd className="text-right font-mono">{m?.commits30 ?? 0}</dd>
            <dt className="text-white/55">Contracts</dt><dd className="text-right font-mono">{m?.contracts ?? 0} ({m?.contractsVerified ?? 0} verified)</dd>
          </dl>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <a href="#cto-build" className="text-polydash-green hover:underline">Full shipping record</a>
        <button type="button" onClick={() => setHow(true)} className="text-white/55 hover:text-white">How it works</button>
      </div>
    </div>
  );
}
