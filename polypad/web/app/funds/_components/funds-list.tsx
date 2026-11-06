'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search } from 'lucide-react';
import { useAccount } from 'wagmi';
import { TokenAvatar } from '@/components/token-avatar';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useFunds, type FundSummary } from '@/lib/fund/use-funds';
import {
  FUND_STATUS_LABEL,
  filterFunds,
  formatFundEth,
  ratioPercent,
  sortFunds,
  type FundFilter,
  type FundSort,
} from '@/lib/fund/model';
import { cn } from '@/lib/utils';
import { FundNotice } from './fund-notice';

const FILTERS: { key: FundFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting on manager' },
  { key: 'closed', label: 'Closed' },
  { key: 'mine', label: 'My funds' },
];

const SORTS: { key: FundSort; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'raised', label: 'Most raised' },
];

const chip = 'inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[12px] font-medium transition-colors sm:text-[13px]';

export function FundsList() {
  const { address } = useAccount();
  const { data, isLoading, isError } = useFunds();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FundFilter>('all');
  const [sort, setSort] = useState<FundSort>('newest');

  const visible = useMemo(() => {
    const filtered = filterFunds(data ?? [], filter, query, address);
    return sortFunds(filtered, sort);
  }, [data, filter, query, address, sort]);

  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <h1 className="text-[28px] font-semibold tracking-tight text-white sm:text-[36px]">Funds</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/60 sm:text-[15px]">
            A fund raises ETH by minting NFTs at a fixed price. Each NFT is one equal unit and the ownership claim on the ETH in the vault.
          </p>
        </div>
        <Link
          href="/funds/create"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-polydash-green px-4 text-[13px] font-medium text-black transition-colors hover:bg-polydash-green-light"
        >
          Create a fund
        </Link>
      </div>

      <FundNotice className="mt-4 max-w-xl" />

      <div className="mt-6 flex flex-col gap-3">
        <div className="relative sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, ticker, or address"
            aria-label="Search funds"
            className="h-10 rounded-full border-white/10 bg-white/[0.03] pl-9"
          />
        </div>
        <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Fund status">
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
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading funds from Robinhood Chain
          </div>
        ) : isError ? (
          <div className="py-20 text-center text-white/50">
            <p className="text-lg">Could not read the fund factory</p>
            <p className="mt-1 text-sm">Check the connection and try again.</p>
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="py-20 text-center text-white/50">
            <p className="text-lg text-white">No funds yet</p>
            <p className="mt-1 text-sm">Create one to open a raise. You sign the transaction in your wallet.</p>
            <Link href="/funds/create" className="mt-4 inline-flex h-9 items-center rounded-full bg-polydash-green px-4 text-[13px] font-medium text-black hover:bg-polydash-green-light">
              Create a fund
            </Link>
          </div>
        ) : filter === 'mine' && !address ? (
          <div className="py-20 text-center text-white/50">
            <p className="text-lg text-white">Connect a wallet to see your funds</p>
            <p className="mt-1 text-sm">My funds lists raises where that wallet is the manager.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-20 text-center text-white/50">
            <p className="text-lg text-white">No funds match</p>
            <p className="mt-1 text-sm">Try another filter or search.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((fund) => (
              <li key={fund.address}>
                <FundRow fund={fund} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FundRow({ fund }: { fund: FundSummary }) {
  const progress = ratioPercent(fund.raised, fund.raiseCap);
  return (
    <Link href={`/funds/${fund.address}`} className="glass-card block p-4 transition-colors sm:p-5">
      <div className="flex items-start gap-3">
        <TokenAvatar name={fund.name} symbol={fund.symbol} imageUri={fund.imageUri} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-white">{fund.name}</h2>
            <span className="font-mono text-[12px] text-white/45">{fund.symbol}</span>
            <StatusPill status={fund.status} />
          </div>
          <p className="mt-1 font-mono text-[12px] text-white/55">
            {formatFundEth(fund.raised)} / {formatFundEth(fund.raiseCap)} ETH
            <span className="mx-2 text-white/25">·</span>
            {fund.totalMinted.toString()} / {fund.maxSupply.toString()} NFTs
            <span className="mx-2 text-white/25">·</span>
            {formatFundEth(fund.mintPrice)} ETH
          </p>
          <Progress value={progress} className="mt-3 h-1.5 bg-white/10" />
        </div>
      </div>
    </Link>
  );
}

function StatusPill({ status }: { status: FundSummary['status'] }) {
  const tone = status === 'open'
    ? 'bg-polydash-green/15 text-polydash-green'
    : status === 'waiting'
      ? 'bg-yellow-400/10 text-yellow-200'
      : 'bg-white/10 text-white/60';
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', tone)}>
      {FUND_STATUS_LABEL[status]}
    </span>
  );
}
