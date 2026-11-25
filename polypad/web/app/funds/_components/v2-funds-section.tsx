'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { TokenAvatar } from '@/components/token-avatar';
import { Progress } from '@/components/ui/progress';
import { formatFundEth, ratioPercent } from '@/lib/fund/model';
import { p3StatusText } from '@/lib/fund/phase3';
import { ALLOWLIST_NOTE, FUND_FACTORY_V2, P6_COPY, templateTitle } from '@/lib/fund/phase6';
import { useV2Funds } from '@/lib/fund/use-phase6';
import type { Phase3Summary } from '@/lib/fund/use-phase3';
import { ContractLink } from './phase3-ui';

/** Cube logo shown when a fund has no image of its own (same fallback as the fund detail page). */
const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';

export function V2FundsSection() {
  const { data, isLoading, isError, refetch } = useV2Funds();
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-white">Growth Tokenized Funds</h2>
          <p className="mt-1 text-[13px] text-white/55">The manager proposes each new asset in public and waits 2 days before adding it. A newly proposed asset is capped at 30% of the tokenized fund by default — except a tokenized fund&apos;s own strategy asset, POLYDASH, which can go up to 80%. You can leave at any time during the wait.</p>
        </div>
        <ContractLink label="Tokenized Fund factory" address={FUND_FACTORY_V2} />
      </div>
      <div className="mt-4">
        {/* Loaded funds win over a failed background refetch (placeholderData
            keeps the last good list): the error only appears when the query
            has never succeeded (no data at all). An empty list from a prior
            successful load is data — a failed refetch must not flip it to
            the error. Error text unchanged. */}
        {data && data.length > 0 ? (
          <ul className="space-y-3">
            {data.map((f) => <li key={f.address}><V2Row fund={f} /></li>)}
          </ul>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading tokenized funds…</div>
        ) : isError && data === undefined ? (
          <div className="py-10 text-center text-[13px] text-white/55">
            Could not load tokenized funds right now.{' '}
            <button type="button" onClick={() => refetch()} className="underline hover:text-white">Try again</button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center">
            <p className="text-white">No Growth tokenized funds yet</p>
            <p className="mt-1 text-[13px] text-white/50">No Growth Tokenized Funds (Strategies #2–#5) yet. The live Polyfund is an LP-Dividend Tokenized Fund (Strategy #6), listed above. {ALLOWLIST_NOTE}</p>
            <Link href="/funds/create" className="mt-4 inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90">Create your tokenized fund</Link>
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-white/40">{P6_COPY.nfa}</p>
    </section>
  );
}

function V2Row({ fund }: { fund: Phase3Summary }) {
  const status = p3StatusText(fund.status, fund.publicOpen);
  return (
    <Link href={`/funds/${fund.address}`} className="glass-card block p-4 transition-colors sm:p-5">
      <div className="flex items-start gap-3">
        <TokenAvatar name={fund.name} symbol={fund.symbol} imageUri={fund.imageUri || FUND_PLACEHOLDER_LOGO} className={fund.imageUri ? undefined : 'bg-black ring-1 ring-white/20 [&>img]:object-contain [&>img]:p-2'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-white">{fund.name}</h3>
            <span className="font-mono text-[12px] text-white/45">{fund.symbol}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">{status.label}</span>
          </div>
          <p className="mt-1 font-mono text-[12px] text-white/55">
            {formatFundEth(fund.raised)} of {formatFundEth(fund.raiseCap)} ETH raised
            <span className="mx-2 text-white/25">·</span>
            {fund.totalMinted.toString()} / {fund.maxSupply.toString()} shares sold
            <span className="mx-2 text-white/25">·</span>
            {templateTitle(fund.templateId)}
          </p>
          <Progress value={ratioPercent(fund.raised, fund.raiseCap)} className="mt-3 h-1.5 bg-white/10" />
        </div>
      </div>
    </Link>
  );
}
