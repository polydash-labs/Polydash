'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { TokenAvatar } from '@/components/token-avatar';
import { Progress } from '@/components/ui/progress';
import { SafeDate } from '@/components/safe-format';
import { formatFundEth, ratioPercent } from '@/lib/fund/model';
import { p3StatusText } from '@/lib/fund/phase3';
import { P6_COPY } from '@/lib/fund/phase6';
import { FUND_FACTORY_V3 } from '@/lib/fund/phase7';
import { useV3Funds, type V3FundSummary } from '@/lib/fund/use-v3';
import { ContractLink } from './phase3-ui';

const badge = 'rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Cube logo shown when a fund has no image of its own (same fallback as the fund detail page). */
const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';

export function V3FundsSection() {
  const { data, isLoading, isError, refetch } = useV3Funds();
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-white">Tokenized Funds V3 <span className={badge}>LP-Dividend</span></h2>
          <p className="mt-1 text-[13px] text-white/55">These tokenized funds follow Strategy #6–#9 (LP-Dividend). The manager can add liquidity to the POLYDASH/WETH pool and stake, and the fees earned are shared with share holders. Fees can be small. No guaranteed returns.</p>
        </div>
        <ContractLink label="Tokenized Fund factory V3" address={FUND_FACTORY_V3} />
      </div>
      <div className="mt-4">
        {/* Loaded funds win over a failed background refetch (placeholderData
            keeps the last good list): the error only appears when the query
            has never succeeded (no data at all). An empty list from a prior
            successful load is data — a failed refetch must not flip it to
            the error. Error text unchanged. */}
        {data && data.length > 0 ? (
          <ul className="space-y-3">
            {data.map((f) => <li key={f.address}><V3Row fund={f} /></li>)}
          </ul>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading V3 tokenized funds…</div>
        ) : isError && data === undefined ? (
          <div className="py-10 text-center text-[13px] text-white/55">
            Could not load V3 tokenized funds right now.{' '}
            <button type="button" onClick={() => refetch()} className="underline hover:text-white">Try again</button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center">
            <p className="text-white">No V3 tokenized funds yet</p>
            <Link href="/funds/create" className="mt-4 inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90">Create your tokenized fund</Link>
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-white/40">{P6_COPY.nfa}</p>
    </section>
  );
}

function V3Row({ fund }: { fund: V3FundSummary }) {
  const status = p3StatusText(fund.status, fund.publicOpen);
  return (
    <Link href={`/funds/${fund.address}`} className="glass-card block p-4 transition-colors sm:p-5">
      <div className="flex items-start gap-3">
        <TokenAvatar name={fund.name} symbol={fund.symbol} imageUri={fund.imageUri || FUND_PLACEHOLDER_LOGO} className={fund.imageUri ? undefined : 'bg-black ring-1 ring-white/20 [&>img]:object-contain [&>img]:p-2'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-white">{fund.name}</h3>
            <span className="font-mono text-[12px] text-white/45">{fund.symbol}</span>
            <span className={badge}>Tokenized Fund V3</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">{status.label}</span>
          </div>
          <p className="mt-1 font-mono text-[12px] text-white/55">
            {formatFundEth(fund.raised)} of {formatFundEth(fund.raiseCap)} ETH raised
            <span className="mx-2 text-white/25">·</span>
            {fund.totalMinted.toString()} / {fund.maxSupply.toString()} shares sold
            <span className="mx-2 text-white/25">·</span>
            Strategy #{fund.templateId} (LP-Dividend)
          </p>
          <p className="mt-1 text-[12px] text-white/45">
            {fund.raiseDeadline > 0 && (
              <>Raise ends <SafeDate date={new Date(fund.raiseDeadline * 1000)} options={{ dateStyle: 'medium' }} localize /><span className="mx-2 text-white/25">·</span></>
            )}
            Manager <span className="font-mono">{short(fund.manager)}</span>
          </p>
          <Progress value={ratioPercent(fund.raised, fund.raiseCap)} className="mt-3 h-1.5 bg-white/10" />
        </div>
      </div>
    </Link>
  );
}
