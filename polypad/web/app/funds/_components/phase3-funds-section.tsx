'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { TokenAvatar } from '@/components/token-avatar';
import { Progress } from '@/components/ui/progress';
import { formatFundEth, ratioPercent } from '@/lib/fund/model';
import { FUND_FACTORY_PHASE3, p3StatusText, templateName } from '@/lib/fund/phase3';
import { usePhase3Funds, type Phase3Summary } from '@/lib/fund/use-phase3';
import { FUND_PHASE4, P4_COPY, phase4Live } from '@/lib/fund/phase4';
import { FUND_PHASE5, P5_COPY, phase5Live } from '@/lib/fund/phase5';
import { ContractLink, P3Badge, P3Note } from './phase3-ui';

/** Cube logo shown when a fund has no image of its own (same fallback as the fund detail page). */
const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';

export function Phase3FundsSection() {
  const { data, isLoading, isError, refetch } = usePhase3Funds();
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-white">Phase 3 tokenized funds <P3Badge /></h2>
          <p className="mt-1 text-[13px] text-white/55">Each one follows a locked strategy, charges its performance fee only on new gains, and locks part of the manager&apos;s own shares.</p>
        </div>
        <ContractLink label="Tokenized fund factory" address={FUND_FACTORY_PHASE3} />
      </div>
      <div className="mt-4">
        {/* Loaded funds win over a failed background refetch (placeholderData
            keeps the last good list): the error only appears when there is
            nothing to show. Error text unchanged. */}
        {data && data.length > 0 ? (
          <ul className="space-y-3">
            {data.map((f) => <li key={f.address}><Phase3Row fund={f} /></li>)}
          </ul>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading Phase 3 tokenized funds…</div>
        ) : isError ? (
          <div className="py-10 text-center text-[13px] text-white/55">
            Could not load Phase 3 tokenized funds right now.{' '}
            <button type="button" onClick={() => refetch()} className="underline hover:text-white">Try again</button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 py-10 text-center">
            <p className="text-white">No Phase 3 tokenized funds yet</p>
            <p className="mt-1 text-[13px] text-white/50">Start one with the step-by-step wizard.</p>
            <Link href="/funds/create" className="mt-4 inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90">Create your tokenized fund</Link>
          </div>
        )}
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-white">
          Phase 4 add-ons
          <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">Phase 4</span>
        </h3>
        {phase4Live() ? (
          <p className="mt-1 text-[13px] text-white/55">Each Phase 3 tokenized fund page now has a report card, Copy this mandate, a trading agent for the manager, per-share wallets, and offers to buy one share. Open a tokenized fund to use them. Not audited. Not financial advice.</p>
        ) : (
          <p className="mt-1 text-[13px] text-white/55">{P4_COPY.notLive}</p>
        )}
        {FUND_PHASE4 && <div className="mt-3"><ContractLink label="FundPhase4" address={FUND_PHASE4} /></div>}
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-white">
          Phase 5 add-ons
          <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">Phase 5</span>
        </h3>
        {phase5Live() ? (
          <ul className="mt-2 space-y-1 text-[13px] text-white/55">
            <li>List a share / buy a listed share</li>
            <li>Share art that follows net value</li>
            <li>Lock for conviction (30, 90, or 180 days)</li>
            <li>Carry NFT</li>
            <li>Queue a nav-floor exit</li>
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-white/55">{P5_COPY.notLive}</p>
        )}
        <p className="mt-2 text-[12px] text-white/40">Open a Phase 3 tokenized fund to use them. Not audited. Not financial advice.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {data && data.length > 0 && <Link href={`/funds/${data[0].address}`} className="text-[12px] text-white underline hover:text-white/80">Open a Phase 3 tokenized fund</Link>}
          {FUND_PHASE5 && <ContractLink label="FundPhase5" address={FUND_PHASE5} />}
        </div>
      </div>
      <P3Note className="mt-3" />
    </section>
  );
}

function Phase3Row({ fund }: { fund: Phase3Summary }) {
  const status = p3StatusText(fund.status, fund.publicOpen);
  return (
    <Link href={`/funds/${fund.address}`} className="glass-card block p-4 transition-colors sm:p-5">
      <div className="flex items-start gap-3">
        <TokenAvatar name={fund.name} symbol={fund.symbol} imageUri={fund.imageUri || FUND_PLACEHOLDER_LOGO} className={fund.imageUri ? undefined : 'bg-black ring-1 ring-white/20 [&>img]:object-contain [&>img]:p-2'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-white">{fund.name}</h3>
            <span className="font-mono text-[12px] text-white/45">{fund.symbol}</span>
            <P3Badge />
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">{status.label}</span>
          </div>
          <p className="mt-1 font-mono text-[12px] text-white/55">
            {formatFundEth(fund.raised)} of {formatFundEth(fund.raiseCap)} ETH raised
            <span className="mx-2 text-white/25">·</span>
            {fund.totalMinted.toString()} / {fund.maxSupply.toString()} shares sold
            <span className="mx-2 text-white/25">·</span>
            {templateName(fund.templateId)}
          </p>
          <Progress value={ratioPercent(fund.raised, fund.raiseCap)} className="mt-3 h-1.5 bg-white/10" />
        </div>
      </div>
    </Link>
  );
}
