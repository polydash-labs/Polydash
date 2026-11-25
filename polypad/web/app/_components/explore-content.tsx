'use client';

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { Search, ArrowUpRight, Github } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TokenCard } from '@/components/token-card';
import { ContractsBanner } from '@/components/contracts-banner';
import { useLaunches } from '@/lib/hooks/use-launches';
import Link from 'next/link';
import { Stagger, StaggerItem } from '@/components/ui/animate';
import { cn } from '@/lib/utils';
import type { LaunchToken } from '@/lib/token-types';
import { isAgentLaunched, useAgentLaunched } from '@/components/agent-badge';
import { isHiddenLaunch } from '@/lib/hidden-launches';
import { TotalTvlCard } from '../funds/_components/total-tvl-card';
import { useHolderProtectionsAll, tierRank, HpTierFilter } from '@/components/holder-protections';
import type { Tier } from '@/lib/holder-protections';
import { NftTab } from './nft-tab';

type SortMode = 'newest' | 'trending' | 'near-grad' | 'graduated' | 'hp';
type ViewMode = 'standard' | 'agent' | 'all' | 'nfts';

type PulseUsage = {
  status: 'ok' | 'error';
  total: number | null;
  pro: number | null;
  free: number | null;
  mlo: number | null;
  last24h: number | null;
};

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function ExploreContent({ initial, intro }: { initial?: LaunchToken[] | null; intro?: ReactNode }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [view, setViewState] = useState<ViewMode>('standard');
  const [hpTier, setHpTier] = useState<Tier>(null);
  const hpOnly = hpTier !== null;
  const { data: launches, isError, refetch } = useLaunches(initial);
  const { set: agentSet } = useAgentLaunched();
  const { map: hpMap } = useHolderProtectionsAll();
  const loading = !launches;
  const isNfts = view === 'nfts';

  // Live usage for the "Live on Polypad" card — same /api/pulse payload as
  // the PlatformUsageStrip. Numbers load after the page paints; a failed
  // check shows "–", never a stale number.
  const [usage, setUsage] = useState<PulseUsage | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    fetch('/api/pulse', { signal: ctrl.signal, cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ usage: PulseUsage }>;
      })
      .then((json) => {
        if (!cancelled) setUsage(json.usage);
      })
      .catch(() => {
        if (!cancelled) setUsageFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);
  const usageOk = usage?.status === 'ok' && usage.total !== null;

  // ?tab=nfts opens the NFTs tab; Standard stays the default.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'nfts') setViewState('nfts');
  }, []);
  const setView = (v: ViewMode) => {
    setViewState(v);
    const url = new URL(window.location.href);
    if (v === 'nfts') url.searchParams.set('tab', 'nfts');
    else url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url.toString());
  };

  const filtered = useMemo(() => {
    const hp = (t: LaunchToken) => hpMap?.[(t?.launchAddress ?? '').toLowerCase()];
    let list = (launches ?? []).filter((t) => !isHiddenLaunch(t));
    if (hpTier) list = list.filter((t) => tierRank(hp(t)?.tier) >= tierRank(hpTier));
    // Agent-launched tokens are hidden by default and shown under their own filter (or All).
    if (view !== 'all') {
      list = list.filter((t) => isAgentLaunched(agentSet, t?.launchAddress, t?.tokenAddress) === (view === 'agent'));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t: any) =>
        (t?.name ?? '').toLowerCase().includes(q) ||
        (t?.symbol ?? '').toLowerCase().includes(q)
      );
    }
    switch (sort) {
      case 'newest': list.sort((a: any, b: any) => ((b?.createdAt ?? 0) - (a?.createdAt ?? 0)) || (tierRank(hp(b)?.tier) - tierRank(hp(a)?.tier))); break;
      case 'hp': list.sort((a: any, b: any) => (tierRank(hp(b)?.tier) - tierRank(hp(a)?.tier)) || ((hp(b)?.passed ?? 0) - (hp(a)?.passed ?? 0)) || ((b?.createdAt ?? 0) - (a?.createdAt ?? 0))); break;
      case 'trending': list.sort((a: any, b: any) => (b?.volumeUsd ?? 0) - (a?.volumeUsd ?? 0)); break;
      case 'near-grad': list = list.filter((t: any) => !(t?.graduated)).sort((a: any, b: any) => (b?.curveProgress ?? 0) - (a?.curveProgress ?? 0)); break;
      case 'graduated': list = list.filter((t: any) => t?.graduated); break;
    }
    return list;
  }, [search, sort, launches, view, agentSet, hpTier, hpMap]);

  const viewOptions: { key: ViewMode; label: string }[] = [
    { key: 'standard', label: 'Standard' },
    { key: 'agent', label: 'Agent-launched' },
    { key: 'all', label: 'All' },
    { key: 'nfts', label: 'NFTs' },
  ];

  const sortOptions: { key: SortMode; label: string }[] = [
    { key: 'newest', label: 'Newest' },
    { key: 'trending', label: 'Trending' },
    { key: 'near-grad', label: 'Near graduation' },
    { key: 'graduated', label: 'Graduated' },
    { key: 'hp', label: 'Holder Protections' },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto grid max-w-container items-center gap-8 px-5 pb-10 pt-10 sm:gap-12 sm:px-8 sm:pb-20 sm:pt-24 lg:grid-cols-2">
          <div>
            <h1 className="text-display font-semibold text-white">
              The Premiere<br />
              <span className="text-polydash-green">Agentic Marketplace.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[16px] font-medium leading-relaxed text-white/85 sm:text-xl">
              Take your agent from creation to full-stack utility — a secure wallet, token launches, tokenized funds, staking, and pay-per-call, all in one place on Robinhood Chain.
            </p>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-white/60 sm:mt-6 sm:text-lg">
              Create your agent and give it a wallet with limits you set. Then it can launch, invest, stake, and pay — all in one marketplace, with you in control.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5 sm:mt-8 sm:gap-3">
              <Link href="/funds/0x7c1d31629ac68aebe83f230edbc7eacfc26285ef" className="inline-flex items-center justify-center gap-1.5 rounded-full bg-polydash-green px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-polydash-green-light">
                Buy a Polyfund share — 0.01 ETH <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/create" className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                Launch a token <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <a href="#tokens" className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                Explore tokens
              </a>
              <Link href="/about" className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                How it works
              </Link>
              <a href="https://github.com/polydash-labs/Polydash" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                <Github className="h-3.5 w-3.5" /> GitHub
              </a>
            </div>
            <p className="mt-4 text-[13px] text-white/60">
              Not sure where to start?{' '}
              <Link href="/start" className="font-medium text-polydash-green hover:underline">
                Pick what you want to do →
              </Link>
            </p>
            <Link
              href="/funds/0x7c1d31629ac68aebe83f230edbc7eacfc26285ef"
              className="mt-5 block rounded-2xl border border-polydash-green/30 bg-polydash-green/[0.06] p-5 transition-colors hover:border-polydash-green/50 sm:mt-6"
            >
              <p className="text-[14px] font-semibold text-white">New here? Buy 1 Polyfund share for 0.01 ETH</p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/70">
                Own a share of the Polydash Growth Fund, a live tokenized fund that buys POLYDASH and earns trading fees.
                No experience needed — you just need a wallet and a little ETH.
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-polydash-green">
                Buy a Polyfund share <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </div>
          <div>
            <div className="flex flex-col items-center gap-4 lg:items-end">
              <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-white">Live on Polypad</p>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-polydash-green">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-polydash-green opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-polydash-green" />
                      </span>
                      Live
                    </span>
                  </div>
                  <div className="mt-4">
                    <p className="text-[32px] font-semibold leading-none tracking-tight text-white">
                      {usageOk ? fmtInt(usage.total!) : '–'}
                    </p>
                    <p className="mt-1.5 text-[13px] text-white/60">API calls, all time · every call counts</p>
                  </div>
                  <div className="mt-4 space-y-2 text-[12px] leading-relaxed sm:text-[13px]">
                    <div className="flex justify-between gap-3 border-b border-white/5 pb-2"><span className="text-white/40">Calls in the last 24 hours</span><span className="text-white/80">{usageOk ? fmtInt(usage.last24h ?? 0) : '–'}</span></div>
                    <div className="flex justify-between gap-3 border-b border-white/5 pb-2"><span className="text-white/40">Pro calls</span><span className="text-white/80">{usageOk ? fmtInt(usage.pro ?? 0) : '–'}</span></div>
                    <div className="flex justify-between gap-3 border-b border-white/5 pb-2"><span className="text-white/40">Free calls</span><span className="text-white/80">{usageOk ? fmtInt(usage.free ?? 0) : '–'}</span></div>
                    {(usageOk && (usage.mlo ?? 0) > 0) && (
                      <div className="flex justify-between gap-3 border-b border-white/5 pb-2"><span className="text-white/40">From commercial clients</span><span className="text-white/80">{fmtInt(usage.mlo!)}</span></div>
                    )}
                    <div className="flex justify-between gap-3 border-b border-white/5 pb-2"><span className="text-white/40">Runs on</span><span className="text-white/80">Robinhood Chain</span></div>
                    <div className="flex justify-between gap-3 border-b border-white/5 pb-2"><span className="text-white/40">Tokens launched</span><span className="text-white/80">{loading ? '–' : launches.length}</span></div>
                    <div className="flex justify-between gap-3 border-b border-white/5 pb-2"><span className="text-white/40">Trading on a public exchange</span><span className="text-white/80">{loading ? '–' : launches.filter((t: any) => t?.graduated).length}</span></div>
                    <div className="flex justify-between gap-3 pb-1"><span className="shrink-0 text-white/40">How a token starts</span><span className="text-right text-white/80">Rises as people buy in, then lists publicly</span></div>
                  </div>
                  <p className="mt-3 text-[12px] leading-relaxed text-white/45">
                    {usageFailed
                      ? 'Live usage is unavailable right now — check Pulse for the latest.'
                      : 'Free calls count too: that\u2019s the product working, no key needed.'}{' '}
                    <Link href="/pulse" className="font-medium text-polydash-green hover:underline">
                      See all numbers on Pulse ↗
                    </Link>
                  </p>
                </div>
              </div>
              <TotalTvlCard className="max-w-md sm:w-full" />
            </div>
          </div>
        </div>
        {/* Four doors: the agent journey — wallet first, then fund, launch, build. */}
        <div className="relative mx-auto grid max-w-container gap-3 px-5 pb-10 sm:grid-cols-2 lg:grid-cols-4 sm:px-8 sm:pb-16">
          <Link
            href="/agents/wallets/new"
            className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-polydash-green/40"
          >
            <p className="text-[14px] font-semibold text-white">Give my agent a wallet</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">A wallet your AI agent can spend from, with a daily limit you set — you can freeze it any time.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-polydash-green">Create a wallet <ArrowUpRight className="h-3.5 w-3.5" /></span>
          </Link>
          <Link
            href="/funds/0x7c1d31629ac68aebe83f230edbc7eacfc26285ef"
            className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-polydash-green/40"
          >
            <p className="text-[14px] font-semibold text-white">Buy a tokenized fund share</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Own a share of a live tokenized fund from 0.01 ETH — the fund invests, you share the returns.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-polydash-green">Buy a share <ArrowUpRight className="h-3.5 w-3.5" /></span>
          </Link>
          <Link
            href="/create"
            className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-polydash-green/40"
          >
            <p className="text-[14px] font-semibold text-white">Launch a token</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Your agent can launch a token in minutes — or you can. It moves to Uniswap V4 when the curve fills.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-polydash-green">Launch a token <ArrowUpRight className="h-3.5 w-3.5" /></span>
          </Link>
          <Link
            href="/build"
            className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-polydash-green/40"
          >
            <p className="text-[14px] font-semibold text-white">Build with the agent API</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Connect your AI agent to Polypad in one command — launch, trade, and join tokenized funds.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-polydash-green">Start building <ArrowUpRight className="h-3.5 w-3.5" /></span>
          </Link>
        </div>
      </section>

      {/* Poly credits — free starter. Big white commercial card. */}
      <div className="relative mx-auto max-w-container px-5 pb-10 sm:px-8 sm:pb-16">
        <Link
          href="/agents/credits"
          className="group block overflow-hidden rounded-3xl bg-white p-6 text-black shadow-2xl transition-transform hover:scale-[1.01] sm:p-8"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[12px] font-bold tracking-widest text-neutral-500 uppercase">✦ Poly credits</p>
              <p className="mt-2 text-4xl leading-none font-extrabold tracking-tight sm:text-5xl">
                Get your free <span className="text-[#00a651]">$25</span> today!!
              </p>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-neutral-600">
                Free starter credits for pay-per-call agent tools — that&apos;s 2,500 token reports or
                500 CTO reports. No crypto needed. One $25 starter per wallet, good for 6 months.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-semibold text-neutral-700">1 · Connect your wallet</span>
                <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-semibold text-neutral-700">2 · Claim $25 free</span>
                <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-semibold text-neutral-700">3 · Spend on agent tools</span>
              </div>
            </div>
            <div className="shrink-0 text-center lg:text-right">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#00E676] px-6 py-3.5 text-[15px] font-bold text-black shadow-lg transition-colors group-hover:bg-[#00d166]">
                Claim your free $25 <ArrowUpRight className="h-4 w-4" />
              </span>
              <p className="mt-2 text-[12px] font-medium text-neutral-500">100 credits = $1 · $0.01 per report</p>
            </div>
          </div>
        </Link>
      </div>

      {intro && <div className="mx-auto max-w-container px-5 pt-2 sm:px-8">{intro}</div>}

      {/* Content */}
      <section id="tokens" className="mx-auto max-w-container scroll-mt-20 px-5 py-10 sm:px-8 sm:py-16">
        <h2 className="mb-5 text-lg font-semibold text-white sm:text-xl">{isNfts ? 'NFT collections' : 'Tokens'}</h2>
        <div className="mb-6">
          <ContractsBanner />
        </div>

        {/* Search & filters (token tabs only) */}
        {!isNfts && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tokens..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e?.target?.value ?? '')}
              className="h-9 rounded-full border-white/10 bg-white/[0.03] pl-9 sm:h-10"
            />
          </div>
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 scrollbar-none sm:mx-0 sm:px-0">
            {sortOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSort(opt.key)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[12px] font-medium transition-colors sm:h-10 sm:px-4 sm:text-[13px]',
                  sort === opt.key
                    ? 'bg-polydash-green text-black'
                    : 'border border-white/15 text-white/70 hover:bg-white/5 hover:text-white'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        )}
        <div className="-mx-5 mb-6 -mt-2 flex items-center gap-1 overflow-x-auto px-5 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="Launch source">
          <span className="mr-1.5 shrink-0 text-[12px] text-white/55">Show</span>
          {viewOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              aria-pressed={view === opt.key}
              onClick={() => setView(opt.key)}
              className={cn(
                'inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[12px] font-medium transition-colors sm:h-8',
                view === opt.key ? 'bg-white/[0.1] text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
              )}
            >
              {opt.label}
            </button>
          ))}
          {!isNfts && (
            <>
              <span className="mx-1.5 h-4 w-px shrink-0 bg-white/10" aria-hidden />
              <HpTierFilter value={hpTier} onChange={setHpTier} />
            </>
          )}
        </div>

        {/* Grid */}
        {isNfts ? (
          <NftTab />
        ) : loading ? (
          isError ? (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-lg text-white">Couldn&apos;t load tokens right now</p>
              <p className="text-sm mt-1 mb-4">The token list couldn&apos;t be loaded. Try again.</p>
              <Button onClick={() => refetch()}>Try again</Button>
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading tokens">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="glass-card h-[178px] animate-pulse p-4 sm:h-[186px] sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-white/[0.06]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded bg-white/[0.06]" />
                    <div className="h-3 w-14 rounded bg-white/[0.06]" />
                  </div>
                </div>
                <div className="mt-5 h-2 rounded-full bg-white/[0.06]" />
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="h-11 rounded-lg bg-white/[0.05]" />
                  <div className="h-11 rounded-lg bg-white/[0.05]" />
                </div>
              </div>
            ))}
          </div>
          )
        ) : launches.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg">No tokens launched yet</p>
            <p className="text-sm mt-1 mb-4">Be the first to launch a token on Polypad.</p>
            <Link href="/create"><Button>Create a token</Button></Link>
          </div>
        ) : (filtered?.length ?? 0) === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            {hpOnly ? (
              <p className="text-lg">No tokens meet these Holder Protections checks yet.</p>
            ) : (
              <>
                <p className="text-lg">No tokens found</p>
                <p className="text-sm mt-1">Try adjusting your search or filters</p>
              </>
            )}
          </div>
        ) : (
          <Stagger staggerDelay={0.05}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((token: any) => (
                <StaggerItem key={token?.launchAddress}>
                  <TokenCard token={token} />
                </StaggerItem>
              ))}
            </div>
          </Stagger>
        )}
      </section>
    </>
  );
}
