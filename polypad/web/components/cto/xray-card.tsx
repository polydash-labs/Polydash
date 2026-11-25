'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronDown, Copy, Info, X } from 'lucide-react';
import type { XrayClusterOut, XrayStats } from '@/lib/xray/scan';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { card } from '@/app/agents/_components/ui';
import { cn } from '@/lib/utils';

export interface XrayView {
  level: string; flaggedPct: number; stats: XrayStats; clusters: XrayClusterOut[]; partial: boolean; updatedAt: string; lastScannedBlock: number;
}

const TIPS = {
  sniper: 'A wallet that bought in the first few seconds after trading opened, usually with a bot.',
  bundle: 'A group of wallets that look controlled by one person, for example funded from the same place right before buying.',
  creator: "Wallets that got ETH or tokens from the token's creator.",
  committers: "People who joined the commitment window; everyone there gets the same price, so they're not flagged.",
  held: "How much of the supply these wallets still have, and how much of what they got they've sold.",
};

const LEVELS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'grey' }> = {
  clean: { label: 'Clean', tone: 'green' }, some: { label: 'Some early buyers', tone: 'amber' }, heavy: { label: 'Heavy bundling', tone: 'red' },
  partial: { label: 'Partial scan', tone: 'grey' }, scanning: { label: 'Scanning', tone: 'grey' }, waiting: { label: 'Waiting for trading', tone: 'grey' },
};
const TONE = {
  green: 'bg-polydash-green/15 text-polydash-green', amber: 'bg-yellow-400/10 text-yellow-300', red: 'bg-[#FF5252]/15 text-[#FF8A80]', grey: 'bg-white/[0.07] text-white/70',
};
const SEGMENTS: { key: keyof XrayStats['segments']; label: string; color: string; tip?: string }[] = [
  { key: 'snipers', label: 'Snipers', color: '#FFD54F', tip: TIPS.sniper },
  { key: 'bundles', label: 'Bundles', color: '#FF9800', tip: TIPS.bundle },
  { key: 'creator', label: 'Creator-linked', color: '#FF5252', tip: TIPS.creator },
  { key: 'dev', label: 'Creator dev buy', color: '#448AFF' },
  { key: 'committers', label: 'Fair-launch committers', color: '#9E9E9E', tip: TIPS.committers },
  { key: 'pools', label: 'Pools & contracts', color: '#4A4A4A' },
  { key: 'others', label: 'Everyone else', color: '#00E676' },
];
const TYPE_LABEL: Record<string, string> = { sniper: 'Sniper', bundle: 'Bundle', creator: 'Creator-linked' };
const TYPE_TONE: Record<string, keyof typeof TONE> = { sniper: 'amber', bundle: 'amber', creator: 'red' };
const STATUS: Record<string, { label: string; tone: keyof typeof TONE }> = {
  holding: { label: 'Holding', tone: 'grey' }, trimming: { label: 'Trimming', tone: 'amber' }, mostly_sold: { label: 'Mostly sold', tone: 'amber' }, exited: { label: 'Exited', tone: 'grey' },
};

const pct = (p: number) => (p > 0 && p < 0.1 ? '<0.1' : (p ?? 0).toFixed(1));
const amt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n > 0 && n < 1 ? 2 : 0));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Chip({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[tone])}>{children}</span>;
}

/** Small (i) popover: opens on hover, focus or tap; closes on outside tap / Escape. */
export function Tip({ text, label = 'What does this mean?' }: { text: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const r = tipRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    setShift(r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex" onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
        className="relative inline-flex h-4 w-4 items-center justify-center rounded-full text-white/40 before:absolute before:-inset-3 before:content-[''] hover:text-white/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40">
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span ref={tipRef} role="tooltip" style={{ marginLeft: shift }} className="absolute bottom-full left-1/2 z-30 mb-2 w-60 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#141414] p-2.5 text-left text-[12px] font-normal leading-snug text-white/80 shadow-xl before:absolute before:inset-x-0 before:-bottom-2 before:h-2 before:content-['']">
          {text}
        </span>
      )}
    </span>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label="Copy address" title="Copy address"
      onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch((e) => console.error('copy failed', e)); }}
      className="-my-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-white/45 hover:bg-white/[0.06] hover:text-white">
      {done ? <Check className="h-3.5 w-3.5 text-polydash-green" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Dots({ n }: { n: number }) {
  const label = n >= 3 ? 'High confidence' : n === 2 ? 'Medium confidence' : 'Low confidence';
  return (
    <span className="inline-flex items-center gap-1" title={label} aria-label={label}>
      {[1, 2, 3].map((i) => <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i <= Math.min(n, 3) ? 'bg-white/80' : 'bg-white/15')} />)}
    </span>
  );
}

function useAgo(iso?: string) {
  const [s, setS] = useState<string | null>(null);
  useEffect(() => {
    if (!iso) return;
    const f = () => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)); setS(m < 1 ? 'Updated just now' : m < 60 ? `Updated ${m} min ago` : `Updated ${Math.round(m / 60)} h ago`); };
    f();
    const id = setInterval(f, 30_000);
    return () => clearInterval(id);
  }, [iso]);
  return s;
}

function ClusterRow({ c }: { c: XrayClusterOut }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[c.status] ?? STATUS.holding;
  return (
    <li className="rounded-xl bg-white/[0.03]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full p-3 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={TYPE_TONE[c.type] ?? 'grey'}>{TYPE_LABEL[c.type] ?? c.type}</Chip>
          <Dots n={c.confidence} />
          <span className="text-[11px] text-white/40">{c.walletCount} wallet{c.walletCount === 1 ? '' : 's'}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {c.dumping && <Chip tone="red">Selling now</Chip>}
            <Chip tone={st.tone}>{st.label}</Chip>
            <ChevronDown className={cn('h-4 w-4 text-white/40 transition-transform', open && 'rotate-180')} />
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-white/80">{c.reason}</p>
        <p className="mt-1 text-[12px] text-white/50">Held now {pct(c.heldPct)}% · Sold {pct(c.soldPct)}%</p>
      </button>
      {open && (
        <div className="border-t border-white/[0.06] px-3 pb-3 pt-2">
          <ul className="space-y-2">
            {c.wallets.map((w) => (
              <li key={w.address} className="text-[12px]">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-mono text-white/85">{short(w.address)}</span>
                  <CopyBtn value={w.address} />
                  <a href={getExplorerAddressUrl(w.address)} target="_blank" rel="noopener noreferrer" aria-label="View wallet on explorer"
                    className="-my-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-white/45 hover:bg-white/[0.06] hover:text-white">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                  <span className="w-full break-words font-mono text-white/50 sm:ml-auto sm:w-auto">got {amt(w.bought)} · holds {amt(w.held)} · sold {amt(w.sold)}</span>
                </div>
                {(w.fundingTx || w.creatorTx) && (
                  <div className="mt-0.5 flex flex-wrap gap-x-4 text-[11px]">
                    {w.fundingTx && <a href={getExplorerTxUrl(w.fundingTx)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-0.5 text-white/50 hover:text-white">Funding tx <ArrowUpRight className="h-3 w-3" /></a>}
                    {w.creatorTx && w.creatorTx !== w.fundingTx && <a href={getExplorerTxUrl(w.creatorTx)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-0.5 text-white/50 hover:text-white">Creator tx <ArrowUpRight className="h-3 w-3" /></a>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {c.walletCount > c.wallets.length && <p className="mt-2 text-[11px] text-white/40">Showing {c.wallets.length} of {c.walletCount} wallets.</p>}
          {c.lastSellTx && <a href={getExplorerTxUrl(c.lastSellTx)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-10 items-center gap-0.5 text-[11px] text-white/50 hover:text-white">Latest sale <ArrowUpRight className="h-3 w-3" /></a>}
        </div>
      )}
    </li>
  );
}

function HowModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="How X-ray works" onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-[#111] p-5 text-[13px] text-white/75 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-white">How X-ray works</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.06] hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p>PolyCTO looks at public on-chain activity around the moment trading opened and checks a few simple rules.</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li><b className="text-white">Snipers:</b> bought in the opening block or within about 30 seconds of trading opening, or paid the anti-sniper tax.</li>
          <li><b className="text-white">Bundles:</b> 3 or more wallets bought in the same block early on, several buys in one transaction, or 2 or more wallets funded by the same address within an hour before buying. Similar buy sizes and brand-new wallets add confidence.</li>
          <li><b className="text-white">Creator-linked:</b> wallets that got ETH from the creator before buying, or received tokens from the creator&apos;s wallet.</li>
          <li><b className="text-white">Never flagged:</b> commitment-window participants, the creator&apos;s own dev buy (shown separately), pools and platform contracts.</li>
          <li><b className="text-white">Confidence:</b> each independent signal adds a dot. Only medium and high confidence flags count toward the verdict; single signals are listed under Weak signals.</li>
          <li><b className="text-white">Verdict:</b> Clean when flagged wallets hold under 3% of supply, Heavy bundling above 15% (or one group above 5%, or creator-linked wallets above 3%), otherwise Some early buyers.</li>
        </ul>
        <h4 className="mt-4 text-[13px] font-semibold text-white">Limits</h4>
        <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
          <li>Money moved through exchanges, bridges or several hops can&apos;t be traced.</li>
          <li>Unrelated people can share a funder (for example the same exchange wallet).</li>
          <li>Funding checks use the block explorer and may be pending; until they finish the scan is marked partial and is never shown as Clean.</li>
        </ul>
        <p className="mt-4 text-[12px] text-white/45">Heuristic, based on on-chain data. Flags are signals, not proof. Scans are not audits. Not financial advice.</p>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-hidden>
      <div className="h-6 w-28 rounded-full bg-white/[0.06]" />
      <div className="h-3.5 w-4/5 rounded bg-white/[0.06]" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className={cn('h-16 rounded-xl bg-white/[0.06]', i === 2 && 'col-span-2 sm:col-span-1')} />)}</div>
      <div className="h-3 rounded-full bg-white/[0.06]" />
    </div>
  );
}

export function XrayCard({ xray, symbol, className }: { xray: XrayView | null | undefined; symbol: string; className?: string }) {
  const [how, setHow] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [weakOpen, setWeakOpen] = useState(false);
  const ago = useAgo(xray?.updatedAt);
  const level = xray?.level ?? 'scanning';
  const meta = LEVELS[level] ?? LEVELS.scanning;
  const s = xray?.stats;
  const ready = !!xray && !!s && level !== 'scanning' && level !== 'waiting' && !!s.segments;
  const strong = (xray?.clusters ?? []).filter((c) => c.confidence >= 2);
  const weak = (xray?.clusters ?? []).filter((c) => c.confidence < 2);
  const shown = showAll ? strong : strong.slice(0, 3);
  const meterIdx = level === 'clean' ? 0 : level === 'some' ? 1 : level === 'heavy' ? 2 : -1;

  return (
    <div className={cn(card, 'p-4 sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Bundle &amp; Sniper X-ray <span className="font-normal text-white/45">· by PolyCTO</span></h3>
        <div className="flex items-center gap-2">
          {ago && ready && <span className="text-[11px] text-white/40">{ago}</span>}
          <button type="button" onClick={() => setHow(true)} aria-label="How X-ray works" className="-my-2 -mr-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-white/45 hover:bg-white/[0.06] hover:text-white"><Info className="h-4 w-4" /></button>
        </div>
      </div>

      {!xray || level === 'scanning' ? (
        <>
          <p className="mb-3 text-[13px] text-white/60">PolyCTO is scanning launch activity…</p>
          <Skeleton />
        </>
      ) : level === 'waiting' ? (
        <p className="text-[13px] text-white/60">Trading has not opened yet. PolyCTO will scan the first trades once it does.</p>
      ) : !ready ? <Skeleton /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={meta.tone}>{meta.label}</Chip>
            {s!.dumping && <Chip tone="red">Flagged wallets selling now</Chip>}
          </div>
          <p className="mt-2 text-[14px] leading-snug text-white/90">{s!.sentence}</p>
          {xray.partial && <p className="mt-1 text-[12px] text-white/50">Some funding checks are pending; showing what PolyCTO could verify.</p>}

          <div className="mt-3 grid grid-cols-3 gap-1" aria-label="Verdict meter">
            {['Clean', 'Some early buyers', 'Heavy bundling'].map((l, i) => (
              <div key={l}>
                <div className={cn('h-1.5 rounded-full', i === meterIdx ? ['bg-polydash-green', 'bg-yellow-300', 'bg-[#FF5252]'][i] : 'bg-white/[0.08]')} />
                <div className={cn('mt-1 text-[11px] leading-tight', i === meterIdx ? 'text-white/80' : 'text-white/35')}>{l}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { v: `${pct(s!.sniperPct)}%`, l: 'Snipers hold of supply', tip: TIPS.sniper },
              { v: String(s!.bundleCount), l: s!.bundleCount === 1 ? 'Bundle found' : 'Bundles found', tip: TIPS.bundle },
              { v: String(s!.creatorLinkedCount), l: 'Creator-linked wallets', tip: TIPS.creator },
            ].map((t, i) => (
              <div key={t.l} className={cn('rounded-xl bg-white/[0.03] p-3', i === 2 && 'col-span-2 sm:col-span-1')}>
                <div className="font-mono text-[18px] font-semibold">{t.v}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-white/55">{t.l} <Tip text={t.tip} /></div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 text-[12px] text-white/55">Who holds the supply now</div>
            <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
              {SEGMENTS.map((g) => { const v = s!.segments[g.key] ?? 0; return v > 0 ? <div key={g.key} title={`${g.label} ${pct(v)}%`} style={{ width: `${Math.max(v, 0.6)}%`, background: g.color }} /> : null; })}
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
              {SEGMENTS.map((g) => (
                <li key={g.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color }} />
                  <span className="text-white/65">{g.label}</span>
                  {g.tip && <Tip text={g.tip} />}
                  <span className="ml-auto font-mono text-white/80">{pct(s!.segments[g.key] ?? 0)}%</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1 text-[12px] text-white/55">Flagged groups <Tip text={TIPS.held} label="What do Held now and Sold mean?" /></div>
            {strong.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-3 text-[13px] text-white/75">
                <Check className="h-4 w-4 shrink-0 text-polydash-green" /> No snipers or bundles detected
              </div>
            ) : (
              <>
                <ul className="space-y-2">{shown.map((c) => <ClusterRow key={c.id} c={c} />)}</ul>
                {strong.length > 3 && (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 inline-flex min-h-10 items-center text-[12px] text-polydash-green hover:underline">
                    {showAll ? 'Show fewer' : `Show all ${strong.length}`}
                  </button>
                )}
              </>
            )}
          </div>

          {weak.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setWeakOpen((v) => !v)} aria-expanded={weakOpen} className="flex min-h-10 w-full items-center gap-1 text-[12px] text-white/50 hover:text-white/80">
                Weak signals ({weak.length}) <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', weakOpen && 'rotate-180')} />
              </button>
              {weakOpen && (
                <>
                  <p className="mt-1 text-[11px] text-white/40">One signal only. Not counted in the verdict.</p>
                  <ul className="mt-2 space-y-2">{weak.map((c) => <ClusterRow key={c.id} c={c} />)}</ul>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-4 border-t border-white/[0.06] pt-3 text-[11px] text-white/40">
        Heuristic, based on on-chain data. Flags are signals, not proof. Scans are not audits. Not financial advice.{' '}
        <button type="button" onClick={() => setHow(true)} className="inline-flex min-h-10 items-center text-white/60 underline-offset-2 hover:text-white hover:underline">How X-ray works</button>
      </div>
      {how && <HowModal onClose={() => setHow(false)} />}
      <span className="sr-only">{`$${symbol}`}</span>
    </div>
  );
}
