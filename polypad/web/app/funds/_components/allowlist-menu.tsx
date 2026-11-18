'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SafeDate } from '@/components/safe-format';
import { FUND_ALLOWLIST } from '@/lib/fund/phase3';
import { useAllowlistTokens } from '@/lib/fund/use-allowlist';
import { shortenAddress } from '@/lib/format';
import { EXPLORER_ADDRESS } from '@/lib/trust';

/** Browsable menu of the tokens a manager may invest in, read live from the FundAllowlist contract. */
export function AllowlistMenu({ title = 'Tokens a manager can invest in', compact }: { title?: string; compact?: boolean }) {
  const { data, isLoading, isError, refetch } = useAllowlistTokens();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = data ?? [];
    return s ? all.filter((t) => t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.address.toLowerCase().includes(s)) : all;
  }, [data, q]);
  const approved = (data ?? []).filter((t) => t.status === 'approved').length;

  return (
    <div id="approved-tokens" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          <p className="mt-0.5 text-[12px] text-white/50">
            The approved list of tokens a tokenized fund may buy (the allowlist), read live from Robinhood Chain. A manager can only add a token from this list, after a 2-day public wait.
          </p>
        </div>
        {data && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-white/80">{approved} approved</span>}
      </div>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, ticker or address" className="pl-8" aria-label="Search approved tokens" />
      </div>
      <div className={compact ? 'mt-3 max-h-56 overflow-auto' : 'mt-3 max-h-80 overflow-auto'}>
        {isLoading ? (
          <p className="flex items-center gap-2 py-4 text-[12px] text-white/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the approved list from Robinhood Chain…</p>
        ) : isError ? (
          <p className="py-4 text-[12px] text-white/60">The approved list could not be read right now. <button type="button" onClick={() => refetch()} className="underline hover:text-white">Try again</button></p>
        ) : list.length === 0 ? (
          <p className="py-4 text-[12px] text-white/55">{q ? 'No approved token matches your search.' : 'No tokens are on the approved list yet.'}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map((t) => (
              <li key={t.address} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-white">{t.symbol}{t.name && t.name !== t.symbol && <span className="ml-1.5 font-normal text-white/50">{t.name}</span>}</p>
                  <a href={`${EXPLORER_ADDRESS}${t.address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-white/45 hover:text-white">
                    {shortenAddress(t.address)} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {t.status === 'approved' ? (
                  <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-200">Approved</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-100">Waiting — ready <SafeDate date={t.readyAt * 1000} options={{ dateStyle: 'medium' }} localize /></span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <a href={`${EXPLORER_ADDRESS}${FUND_ALLOWLIST}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-white">
        Approved list contract (FundAllowlist) {shortenAddress(FUND_ALLOWLIST)} <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
