'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search } from 'lucide-react';
import { useAccount } from 'wagmi';
import { TokenAvatar } from '@/components/token-avatar';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useFunds, type FundSummary } from '@/lib/fund/use-funds';
import { useV3Funds } from '@/lib/fund/use-v3';
import { useV2Funds } from '@/lib/fund/use-phase6';
import { usePhase3Funds } from '@/lib/fund/use-phase3';
import {
  FUND_STATUS_LABEL,
  REFUND_STATUS_LABEL,
  filterFunds,
  fundStatus,
  fundStatusText,
  formatFundEth,
  ratioPercent,
  sortFunds,
  type FundFilter,
  type FundSort,
} from '@/lib/fund/model';
import type { Phase3Summary } from '@/lib/fund/use-phase3';
import { cn } from '@/lib/utils';
import { FundNotice } from './fund-notice';
import { TotalTvlCard } from './total-tvl-card';
import { Phase3FundsSection } from './phase3-funds-section';
import { V2FundsSection } from './v2-funds-section';

/** Cube logo shown when a fund has no image of its own (same fallback as the fund detail page). */
const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';
import { V3FundsSection } from './v3-funds-section';

/** The Polyfund — the live raise featured under the hero. */
const POLYFUND_ADDRESS = '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef';
/** Fallback raise end (Dec 16, 2026) used only until the live deadline loads. */
const POLYFUND_RAISE_END = new Date('2026-12-16T22:20:00-08:00').getTime();

const FILTERS: { key: FundFilter; label: string; explain: string }[] = [
  { key: 'all', label: 'All tokenized funds', explain: 'Every tokenized fund created on Polypad.' },
  { key: 'open', label: FUND_STATUS_LABEL.open, explain: 'Tokenized funds you can join now by buying shares with ETH.' },
  { key: 'waiting', label: FUND_STATUS_LABEL.waiting, explain: 'Nobody else can join until the manager buys their own shares.' },
  { key: 'investing', label: FUND_STATUS_LABEL.investing, explain: 'The raise is over and the manager is buying tokens from the approved list.' },
  { key: 'refund', label: REFUND_STATUS_LABEL, explain: 'The raise missed its goal in time. Holders can return their shares and get their ETH back.' },
  { key: 'closed', label: FUND_STATUS_LABEL.closed, explain: 'No longer taking new money. This includes tokenized funds with a refund available.' },
  { key: 'mine', label: 'My funds', explain: 'Tokenized funds where your connected wallet is the manager.' },
];

const SORTS: { key: FundSort; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'raised', label: 'Most ETH raised' },
];

const HOW_IT_WORKS = [  { title: 'Launch your tokenized fund', text: 'Pick a strategy, set your performance fee. Your tokenized fund is an NFT collection: each share is an equal part of it.' },
  { title: 'Raise from anyone', text: "People buy shares with ETH. The money sits in your tokenized fund's vault — never in your pocket." },
  { title: 'Invest in public', text: 'Propose every move, wait 2 days while anyone can see it and exit, then execute. Your track record is live on the terminal.' },
];

/** A V2 / V3 / Phase 3 section fund, normalized to the legacy FundSummary shape the searchable directory renders. Fields the sections don't carry are zeroed: a list row never shows them. */
function toFundSummary(f: Phase3Summary & { raiseDeadline?: number }): FundSummary {
  return {
    address: f.address,
    index: f.index,
    name: f.name,
    symbol: f.symbol,
    imageUri: f.imageUri,
    manager: f.manager,
    vault: f.vault,
    mintPrice: f.mintPrice,
    maxSupply: f.maxSupply,
    totalMinted: f.totalMinted,
    managerMinted: 0n,
    publicOpen: f.publicOpen,
    entryFeeBps: 0,
    skinRequired: 0n,
    minSkinBps: 0,
    raiseCap: f.raiseCap,
    raised: f.raised,
    vaultStatus: f.status,
    raiseDeadline: f.raiseDeadline ?? 0,
    status: fundStatus(f.status, f.publicOpen),
    balance: 0n,
    generation: 2,
  };
}

const chip = 'inline-flex min-h-[44px] shrink-0 items-center rounded-full px-3.5 text-[12px] font-medium transition-colors sm:text-[13px]';

export function FundsList() {
  const { address } = useAccount();
  const { data, isError, refetch } = useFunds();
  const { data: v3Funds, isError: v3Error } = useV3Funds();
  const { data: v2Funds, isError: v2Error } = useV2Funds();
  const { data: p3Funds, isError: p3Error } = usePhase3Funds();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FundFilter>('all');
  const [sort, setSort] = useState<FundSort>('newest');
  const activeFilter = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];

  // The searchable directory: every fund from every factory, deduplicated
  // by address. The search box and status tabs used to filter only the
  // legacy useFunds() list, which is empty on production, so typing
  // "Polycat" filtered nothing and the tabs changed nothing — while the
  // Polyfund and Polycat lived in the V3 / V2 / Phase 3 sections above,
  // invisible to the search (round 7). V2 / V3 / Phase 3 summaries are
  // normalized to FundSummary (status from fundStatus: raw vault status
  // 0/1/2/3 + publicOpen); fields the sections don't carry are zeroed —
  // a list row never shows them.
  const allFunds = useMemo(() => {
    const byAddr = new Map<string, FundSummary>();
    for (const f of data ?? []) byAddr.set(f.address.toLowerCase(), f);
    for (const list of [v2Funds, v3Funds, p3Funds]) {
      for (const f of list ?? []) {
        const key = f.address.toLowerCase();
        if (!byAddr.has(key)) byAddr.set(key, toFundSummary(f));
      }
    }
    return [...byAddr.values()];
  }, [data, v2Funds, v3Funds, p3Funds]);

  const visible = useMemo(() => {
    const filtered = filterFunds(allFunds, filter, query, address);
    return sortFunds(filtered, sort);
  }, [allFunds, filter, query, address, sort]);

  // Searching or picking a status tab hides the featured card and the
  // per-factory sections above, so the directory below is the only list:
  // searching "Polycat" also hides the Polyfund card, instead of leaving
  // it visible above a filtered list.
  const isFiltering = query.trim() !== '' || filter !== 'all';

  // Every factory list has answered (with data or an error). Until then the
  // directory shows its loading state instead of "no funds yet".
  const listsSettled =
    (data !== undefined || isError) &&
    (v2Funds !== undefined || v2Error) &&
    (v3Funds !== undefined || v3Error) &&
    (p3Funds !== undefined || p3Error);
  const anyListError = isError || v2Error || v3Error || p3Error;

  const showMore = true;

  const polyfund = v3Funds?.find((f) => f.address.toLowerCase() === POLYFUND_ADDRESS);
  const polyfundDeadlineMs = polyfund && polyfund.raiseDeadline > 0 ? polyfund.raiseDeadline * 1000 : POLYFUND_RAISE_END;
  const polyfundDaysLeft = Math.max(0, Math.ceil((polyfundDeadlineMs - Date.now()) / 86_400_000));

  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-polydash-green">Tokenized Funds</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-white sm:text-[36px]">Start your own on-chain tokenized fund.</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/60 sm:text-[15px]">
            Venture capital used to be a closed room. Now anyone can open a tokenized fund, raise from anyone, invest in public, and earn performance fees — with a live value per share and a live terminal proving every move.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <Link
            href="/funds/create"
            className="inline-flex h-9 items-center justify-center rounded-full bg-polydash-green px-4 text-[13px] font-medium text-black transition-colors hover:bg-polydash-green-light"
          >
            Create your tokenized fund
          </Link>
          <p className="max-w-xs text-[13px] leading-relaxed text-white/60 sm:text-right">
            Not ready to run one? Buy a share in a live Tokenized Fund and earn fees from the trading pool + staking rewards as dividends. Buying a share is called minting — you get an NFT share in your wallet.
          </p>
          <a href="#live-funds" className="text-[13px] text-white/60 transition-colors hover:text-white">
            Or back a live fund — see the live tokenized funds below ↓
          </a>
          <TotalTvlCard />
        </div>
      </div>

      {!isFiltering && (polyfund || v3Funds === undefined) && (
        <section className="mt-6 rounded-2xl border border-polydash-green/30 bg-polydash-green/[0.06] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-polydash-green">Featured — the live raise</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[18px] font-semibold text-white">Polydash Growth Fund (the Polyfund)</h2>
              <p className="mt-1 text-[13px] text-white/60">
                {polyfund ? `${polyfund.totalMinted.toString()} / ${polyfund.maxSupply.toString()} shares sold` : '1 / 200 shares sold'}
                <span className="mx-2 text-white/25">·</span>
                {polyfund ? `${formatFundEth(polyfund.mintPrice)} ETH per share` : '0.01 ETH per share'}
                <span className="mx-2 text-white/25">·</span>
                {polyfundDaysLeft} {polyfundDaysLeft === 1 ? 'day' : 'days'} left
              </p>
            </div>
            <Link
              href={`/funds/${POLYFUND_ADDRESS}`}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-polydash-green px-5 text-[14px] font-medium text-black transition-colors hover:bg-polydash-green-light"
            >
              Buy a share
            </Link>
          </div>
        </section>
      )}

      <FundNotice className="mt-4 max-w-xl" />

      <section className="mt-10">
        <h2 className="text-[20px] font-semibold text-white sm:text-[24px]">You run it like a VC. The chain keeps you honest.</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <div key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[12px] font-semibold text-polydash-green">Step {index + 1}</p>
              <h3 className="mt-2 text-[16px] font-semibold text-white">{step.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{step.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-white/50">Locked rules · 2-day public wait · Holders can exit any time · Manager puts in their own money first · Live value per share on the Terminal</p>
      </section>

      {!isFiltering && (
        <>
          <V3FundsSection />

          <V2FundsSection />

          <Phase3FundsSection />
        </>
      )}

      {showMore && (
        <>
          <h2 className="mt-10 text-[18px] font-semibold text-white">All tokenized funds</h2>

      <div className="mt-4 flex flex-col gap-3">
        <div className="relative sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, ticker or address"
            aria-label="Search tokenized funds"
            className="h-10 rounded-full border-white/10 bg-white/[0.03] pl-9"
          />
        </div>
        <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Tokenized fund status">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn(chip, filter === item.key ? 'bg-polydash-green text-black' : 'border border-white/15 text-white/70 hover:bg-white/5 hover:text-white')}
            >
              {item.label}
            </button>
          ))}
          <span className="mx-1 hidden h-8 w-px bg-white/10 sm:inline-block" aria-hidden />
          {SORTS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSort(item.key)}
              className={cn(chip, sort === item.key ? 'bg-white text-black' : 'border border-white/15 text-white/70 hover:bg-white/5 hover:text-white')}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-white/50" aria-live="polite">
          <span className="text-white/75">{activeFilter.label}:</span> {activeFilter.explain}
        </p>
      </div>

      <div className="mt-6">
        {/* Loaded funds win over a failed background refetch (placeholderData
            keeps the last good list): the error only appears when there is
            nothing to show. Error text unchanged. */}
        {allFunds.length > 0 ? (
          filter === 'mine' && !address ? (
            <div className="py-20 text-center text-white/50">
              <p className="text-lg text-white">Connect a wallet to see your tokenized funds</p>
              <p className="mt-1 text-sm">My tokenized funds shows the tokenized funds where your connected wallet is the manager.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-20 text-center text-white/50">
              <p className="text-lg text-white">No tokenized funds match</p>
              <p className="mt-1 text-sm">Try another filter or a different search.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((fund) => (
                <li key={fund.address}>
                  <FundRow fund={fund} />
                </li>
              ))}
            </ul>
          )
        ) : !listsSettled ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tokenized funds…
          </div>
        ) : anyListError ? (
          <div className="py-20 text-center text-white/50">
            <p className="text-lg">Could not load tokenized funds right now</p>
            <p className="mt-1 text-sm">Check your connection and refresh the page.</p>
            <button type="button" onClick={() => refetch()} className="mt-4 inline-flex h-11 items-center rounded-full border border-white/15 px-4 text-[13px] font-medium text-white/85 hover:bg-white/[0.06]">Try again</button>
          </div>
        ) : (
          <div className="py-20 text-center text-white/50">
            <p className="text-lg text-white">No tokenized funds here yet</p>
            <p className="mt-1 text-sm">Create a tokenized fund. You set the share price, goal and deadline, then sign 1 transaction in your wallet (no ETH sent).</p>
            <Link href="/funds/create" className="mt-4 inline-flex h-9 items-center rounded-full bg-polydash-green px-4 text-[13px] font-medium text-black hover:bg-polydash-green-light">
              Create your tokenized fund
            </Link>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function FundRow({ fund }: { fund: FundSummary }) {
  const progress = ratioPercent(fund.raised, fund.raiseCap);
  return (
    <Link href={`/funds/${fund.address}`} className="glass-card block p-4 transition-colors sm:p-5">
      <div className="flex items-start gap-3">
        <TokenAvatar name={fund.name} symbol={fund.symbol} imageUri={fund.imageUri || FUND_PLACEHOLDER_LOGO} className={fund.imageUri ? undefined : 'bg-black ring-1 ring-white/20 [&>img]:object-contain [&>img]:p-2'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-white">{fund.name}</h2>
            <span className="font-mono text-[12px] text-white/45">{fund.symbol}</span>
            <StatusPill fund={fund} />
          </div>
          <p className="mt-1 font-mono text-[12px] text-white/55">
            {formatFundEth(fund.raised)} of {formatFundEth(fund.raiseCap)} ETH raised
            <span className="mx-2 text-white/25">·</span>
            {fund.totalMinted.toString()} / {fund.maxSupply.toString()} shares sold
            <span className="mx-2 text-white/25">·</span>
            {formatFundEth(fund.mintPrice)} ETH per share
          </p>
          <Progress value={progress} className="mt-3 h-1.5 bg-white/10" />
        </div>
      </div>
    </Link>
  );
}

function StatusPill({ fund }: { fund: FundSummary }) {
  const { status } = fund;
  const text = fundStatusText(status, fund.vaultStatus);
  const tone = text.refund
    ? 'bg-polydash-green/15 text-polydash-green'
    : status === 'open'
    ? 'bg-polydash-green/15 text-polydash-green'
    : status === 'waiting'
      ? 'bg-yellow-400/10 text-yellow-200'
      : status === 'investing'
        ? 'bg-sky-400/10 text-sky-100'
        : 'bg-white/10 text-white/60';
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', tone)}>
      {text.label}
    </span>
  );
}
