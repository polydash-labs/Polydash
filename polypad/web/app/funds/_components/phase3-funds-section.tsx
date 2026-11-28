'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { TokenAvatar } from '@/components/token-avatar';
import { Progress } from '@/components/ui/progress';
import { formatFundEth, ratioPercent } from '@/lib/fund/model';
import { FUND_FACTORY_PHASE3, p3StatusText } from '@/lib/fund/phase3';
import { templateTitle } from '@/lib/fund/phase6';
import { usePhase3Funds, type Phase3Summary } from '@/lib/fund/use-phase3';
import { FUND_PHASE4, P4_COPY, phase4Live } from '@/lib/fund/phase4';
import { FUND_PHASE5, P5_COPY, phase5Live } from '@/lib/fund/phase5';
import { ContractLink, P3Note } from './phase3-ui';
import { DARK_CARD, EMERALD_CARD, H2, KICKER, PLAIN_CARD, SUB } from '@/lib/ui/template';

/** Cube logo shown when a fund has no image of its own (same fallback as the fund detail page). */
const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';

export function Phase3FundsSection() {
  const { data, isLoading, isError, refetch } = usePhase3Funds();
  return (
    <section className="py-14 sm:py-20">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className={KICKER}>Locked strategy</p>
          <h2 className={H2}>Tokenized Funds</h2>
          <p className={SUB}>Each one follows a locked strategy, charges its performance fee only on new gains, and locks part of the manager&apos;s own shares.</p>
        </div>
        <ContractLink label="Tokenized fund factory" address={FUND_FACTORY_PHASE3} />
      </div>
      <div className="mt-8">
        {/* Loaded funds win over a failed background refetch (placeholderData
            keeps the last good list): the error only appears when there is
            nothing to show. Error text unchanged. */}
        {data && data.length > 0 ? (
          <ul className="space-y-3">
            {data.map((f) => <li key={f.address}><Phase3Row fund={f} /></li>)}
          </ul>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading tokenized funds…</div>
        ) : isError ? (
          <div className="py-10 text-center text-[13px] text-white/55">
            Could not load tokenized funds right now.{' '}
            <button type="button" onClick={() => refetch()} className="underline hover:text-white">Try again</button>
          </div>
        ) : (
          <div className={`${DARK_CARD} py-10 text-center`}>
            <p className="text-white">No tokenized funds here yet</p>
            <p className="mt-1 text-[13px] text-white/50">Start one with the step-by-step wizard.</p>
            <Link href="/funds/create" className="mt-4 inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90">Create your tokenized fund</Link>
          </div>
        )}
      </div>
      <div className={`mt-4 ${PLAIN_CARD}`}>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-white">
          Extra fund features
        </h3>
        {phase4Live() ? (
          <p className="mt-1 text-[13px] text-white/55">Each tokenized fund page now has a report card, Copy this mandate, a trading agent for the manager, per-share wallets, and offers to buy one share. Open a tokenized fund to use them. Not audited. Not financial advice.</p>
        ) : (
          <p className="mt-1 text-[13px] text-white/55">{P4_COPY.notLive}</p>
        )}
        {FUND_PHASE4 && <div className="mt-3"><ContractLink label="FundPhase4" address={FUND_PHASE4} /></div>}
      </div>
      <div className={`mt-4 ${PLAIN_CARD}`}>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-white">
          Extra share features
        </h3>
        {phase5Live() ? (
          <ul className="mt-2 space-y-1 text-[13px] text-white/55">
            <li>List a share / buy a listed share</li>
            <li>Share art that follows the fund&apos;s value</li>
            <li>Lock for conviction (30, 90, or 180 days)</li>
            <li>Carry NFT — one NFT that collects the manager&apos;s fees; whoever holds it claims them</li>
            <li>Queue a value-floor exit — put one share in a one-day queue to exit at the fund&apos;s value per share; you can cancel and take the share back before it pays out</li>
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-white/55">{P5_COPY.notLive}</p>
        )}
        <p className="mt-2 text-[12px] text-white/40">Open a tokenized fund to use them. Not audited. Not financial advice.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {data && data.length > 0 && <Link href={`/funds/${data[0].address}`} className="text-[12px] text-white underline hover:text-white/80">Open a tokenized fund</Link>}
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
    <Link href={`/funds/${fund.address}`} className={`${EMERALD_CARD} block transition-colors hover:border-emerald-500/40`}>
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
