'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FUND_WETH } from '@/lib/fund/phase3';
import { ALLOWLIST_DATE, THIN_POOL_USD, dedupeAssets, isBlockedName, POLYDASH_TOKEN, RNJ_ALLOWLIST_AT, RNJ_TOKEN, changeLabel, ethLabel, ptDateTime, usdLabel, type FundAsset } from '@/lib/fund/phase6';
import { useFundAssets } from '@/lib/fund/use-phase6';
import { cn } from '@/lib/utils';

export type AssetStatus = 'ready' | 'in' | 'waiting';
const STATUS_LABEL: Record<AssetStatus, string> = {
  ready: 'Ready to propose',
  in: 'Already in this tokenized fund',
  waiting: 'Already proposed — waiting',
};
const SORTS = [
  { id: 'pool', label: 'Pool size' },
  { id: 'volume', label: '24h volume' },
  { id: 'change', label: '24h change' },
  { id: 'newest', label: 'Newest' },
] as const;
type SortId = (typeof SORTS)[number]['id'];
const COLS = 'md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_repeat(3,minmax(0,0.9fr))_minmax(0,1.6fr)] md:items-center md:gap-3';

/** One line explaining when the token can actually be bought. */
export function allowlistNote(a: FundAsset): string {
  if (a.allowed) return 'On the approved list (allowlist).';
  if (a.allowlistAt) return `Allowlist executes ${ptDateTime(a.allowlistAt)}, after its own 2-day public wait. Buyable only after that.`;
  if (a.address === POLYDASH_TOKEN) return `Allowlist executes ${ALLOWLIST_DATE}, after its own 2-day public wait. Buyable only after that.`;
  if (a.address === RNJ_TOKEN) return `Allowlist executes ${ptDateTime(RNJ_ALLOWLIST_AT)}, after its own 2-day public wait. Buyable only after that.`;
  return 'Not on the approved list (allowlist) yet. It must pass its own 2-day public wait there before it can be bought.';
}

function useAgo(updatedAt: number | null | undefined): string {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!updatedAt || !now) return '';
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  return s < 90 ? `${s} seconds ago` : `${Math.round(s / 60)} minutes ago`;
}

export function AssetPicker({ excluded, inFund, waiting, pickedAddress, onPick }: {
  /** Addresses never listed (the tokenized fund's own share token). WETH is always excluded. */
  excluded: string[];
  inFund: Set<string>;
  /** token address → unix seconds the pending proposal's 2-day wait ends. */
  waiting: Map<string, number>;
  pickedAddress?: string | null;
  onPick: (a: FundAsset) => void;
}) {
  const feed = useFundAssets(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortId>('pool');
  const [onlyNew, setOnlyNew] = useState(false);
  const [status, setStatus] = useState<'all' | AssetStatus>('all');
  const [minPool, setMinPool] = useState(0);
  const ago = useAgo(feed.data?.updatedAt);
  const stale = !!feed.data && (feed.data.stale || feed.isError);

  const shown = useMemo(() => {
    const skip = new Set([FUND_WETH, '0x0000000000000000000000000000000000000000', ...excluded.map((e) => e.toLowerCase())]);
    const s = q.trim().toLowerCase();
    const all = dedupeAssets(feed.data?.assets ?? []).filter((a) => !skip.has(a.address) && !isBlockedName(a));
    const rows = all.filter((a) => (!onlyNew || a.isNew) && a.poolUsd >= minPool
      && (status === 'all' || (inFund.has(a.address) ? 'in' : waiting.has(a.address) ? 'waiting' : 'ready') === status)
      && (!s || a.symbol.toLowerCase().includes(s) || a.name.toLowerCase().includes(s)));
    const v = (n: number | null) => n ?? -Infinity;
    rows.sort((a, b) => sort === 'volume' ? v(b.volume24h) - v(a.volume24h)
      : sort === 'change' ? v(b.change24h) - v(a.change24h)
      : sort === 'newest' ? v(b.createdAt) - v(a.createdAt)
      : b.poolUsd - a.poolUsd);
    return { rows: rows.slice(0, 100), total: all.length, matched: rows.length };
  }, [feed.data, excluded, q, sort, onlyNew, status, minPool, inFund, waiting]);

  const statusOf = (a: FundAsset): AssetStatus => (inFund.has(a.address) ? 'in' : waiting.has(a.address) ? 'waiting' : 'ready');

  return (
    <div className="space-y-3" data-testid="asset-picker">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by token name or symbol" className="pl-9" aria-label="Search tokens" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-white/55">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as SortId)} className="rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-[12px] text-white" aria-label="Sort tokens">
              {SORTS.map((o) => <option key={o.id} value={o.id} className="bg-neutral-900">{o.label}</option>)}
            </select>
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | AssetStatus)} className="rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-[12px] text-white" aria-label="Filter by status">
            <option value="all" className="bg-neutral-900">All statuses</option>
            <option value="ready" className="bg-neutral-900">Ready (has cap room)</option>
            <option value="waiting" className="bg-neutral-900">Waiting</option>
            <option value="in" className="bg-neutral-900">Already in this tokenized fund</option>
          </select>
          <select value={minPool} onChange={(e) => setMinPool(Number(e.target.value))} className="rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-[12px] text-white" aria-label="Minimum pool size">
            <option value={0} className="bg-neutral-900">Any pool size</option>
            <option value={1000} className="bg-neutral-900">Pool ≥ $1K</option>
            <option value={10000} className="bg-neutral-900">Pool ≥ $10K</option>
            <option value={100000} className="bg-neutral-900">Pool ≥ $100K</option>
          </select>
          <button type="button" aria-pressed={onlyNew} onClick={() => setOnlyNew((x) => !x)}
            className={cn('rounded-full border px-3 py-1.5 text-[12px]', onlyNew ? 'border-white/60 bg-white/10 text-white' : 'border-white/15 text-white/60 hover:bg-white/5')}>
            New launches
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/45">
        <span>Robinhood Chain tokens with a Uniswap V4 or V3 pool, Pons launches included. Live from GeckoTerminal, refreshed every minute.</span>
        <span suppressHydrationWarning>{feed.data ? `${shown.matched} of ${shown.total} tokens · ` : ''}{feed.isFetching && !feed.data ? 'Loading live token list…' : ago ? `● Live · updated ${ago}` : ''}</span>
      </div>
      {stale && <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">Data may be stale. The live price feed did not answer, so you are seeing the last loaded prices.</p>}

      {feed.isLoading ? (
        <p className="flex items-center gap-2 py-6 text-[12px] text-white/45"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading live token list…</p>
      ) : !feed.data ? (
        <div className="py-6 text-[12px] text-white/55">The live token list is not available right now. <button type="button" onClick={() => feed.refetch()} className="underline">Try again</button></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <div className={cn('hidden bg-white/[0.03] px-3 py-2 text-[11px] uppercase tracking-wide text-white/40', COLS)}>
            <span>Token</span><span className="text-right">Price (USD / ETH)</span><span className="text-right">Pool size</span><span className="text-right">24h volume</span><span className="text-right">24h change</span><span className="text-right">Status</span>
          </div>
          {shown.rows.length === 0 ? <p className="px-3 py-6 text-[13px] text-white/45">No tokens match.</p> : (
            <div className="max-h-[28rem] divide-y divide-white/5 overflow-y-auto" role="listbox" aria-label="Tokens">
              {shown.rows.map((a) => {
                const st = statusOf(a);
                const on = pickedAddress?.toLowerCase() === a.address;
                const wait = waiting.get(a.address);
                return (
                  <div key={a.address} role="option" tabIndex={0} aria-selected={on} aria-disabled={st !== 'ready'} data-symbol={a.symbol}
                    onClick={() => st === 'ready' && onPick(a)}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && st === 'ready') { e.preventDefault(); onPick(a); } }}
                    className={cn('block w-full px-3 py-2.5 text-left text-[13px] outline-none focus-visible:bg-white/5', COLS, on ? 'bg-white/10' : st === 'ready' ? 'cursor-pointer hover:bg-white/5' : 'cursor-default opacity-80')}>
                    <span className="block min-w-0">
                      <span className="font-medium text-white">{a.name || a.symbol}</span> <span className="text-white/50">{a.symbol}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        <Tag>{a.dexLabel}</Tag>
                        {a.isPons && <Tag>Pons launch</Tag>}
                        {a.isPolypad && <Tag>Polypad</Tag>}
                        {a.isNew && <Tag>New</Tag>}
                        {a.poolUsd < THIN_POOL_USD && <Tag>Thin pool — small trades move the price</Tag>}
                        {a.pairUrl && (
                          <a href={a.pairUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[10px] text-white/45 hover:text-white">
                            Pool <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </span>
                    </span>
                    <span className="mt-1 flex justify-between gap-2 md:mt-0 md:block md:text-right">
                      <span className="text-white/40 md:hidden">Price</span>
                      <span><span className="block text-white">{usdLabel(a.priceUsd)}</span><span className="block text-[11px] text-white/45">{ethLabel(a.priceEth)}</span></span>
                    </span>
                    <Cell label="Pool size" value={usdLabel(a.poolUsd)} />
                    <Cell label="24h volume" value={usdLabel(a.volume24h)} />
                    <Cell label="24h change" value={changeLabel(a.change24h)} tone={a.change24h === null ? undefined : a.change24h >= 0 ? 'up' : 'down'} />
                    <span className="mt-1 block md:mt-0 md:text-right">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px]', st === 'ready' ? 'bg-emerald-400/15 text-emerald-200' : st === 'in' ? 'bg-white/10 text-white/80' : 'bg-amber-400/15 text-amber-100')}>{STATUS_LABEL[st]}</span>
                      {st === 'waiting' && wait ? <span className="mt-0.5 block text-[11px] text-white/45">Wait ends {ptDateTime(wait)}</span> : null}
                      <span className="mt-0.5 block text-[11px] leading-snug text-white/45">{allowlistNote(a)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <span className="mt-1 flex justify-between gap-2 md:mt-0 md:block md:text-right">
      <span className="text-white/40 md:hidden">{label}</span>
      <span className={cn(tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-red-300' : 'text-white/80')}>{value}</span>
    </span>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/15 px-1.5 py-px text-[10px] text-white/60">{children}</span>;
}
