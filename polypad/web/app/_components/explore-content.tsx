'use client';

import { useState, useMemo } from 'react';
import { Search, ArrowUpRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TokenCard } from '@/components/token-card';
import { ContractsBanner } from '@/components/contracts-banner';
import { useLaunches } from '@/lib/hooks/use-launches';
import Link from 'next/link';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/animate';
import { cn } from '@/lib/utils';

type SortMode = 'newest' | 'trending' | 'near-grad' | 'graduated';

export function ExploreContent() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const { data: launches, isLoading } = useLaunches();

  const filtered = useMemo(() => {
    let list = [...(launches ?? [])];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t: any) =>
        (t?.name ?? '').toLowerCase().includes(q) ||
        (t?.symbol ?? '').toLowerCase().includes(q)
      );
    }
    switch (sort) {
      case 'newest': list.sort((a: any, b: any) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0)); break;
      case 'trending': list.sort((a: any, b: any) => (b?.volumeUsd ?? 0) - (a?.volumeUsd ?? 0)); break;
      case 'near-grad': list = list.filter((t: any) => !(t?.graduated)).sort((a: any, b: any) => (b?.curveProgress ?? 0) - (a?.curveProgress ?? 0)); break;
      case 'graduated': list = list.filter((t: any) => t?.graduated); break;
    }
    return list;
  }, [search, sort, launches]);

  const sortOptions: { key: SortMode; label: string }[] = [
    { key: 'newest', label: 'Newest' },
    { key: 'trending', label: 'Trending' },
    { key: 'near-grad', label: 'Near graduation' },
    { key: 'graduated', label: 'Graduated' },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto grid max-w-container items-center gap-8 px-5 pb-10 pt-10 sm:gap-12 sm:px-8 sm:pb-20 sm:pt-24 lg:grid-cols-2">
          <FadeIn>
            <h1 className="text-display font-semibold text-white">
              Launch tokens on<br />
              <span className="text-polydash-green">Robinhood Chain.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/60 sm:mt-6 sm:text-lg">
              Tokens trade on a bonding curve and move to Uniswap V4 when the curve fills.
              Creators can open a commitment window before trading starts.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5 sm:mt-8 sm:gap-3">
              <Link href="/create" className="inline-flex items-center justify-center gap-1.5 rounded-full bg-polydash-green px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-polydash-green-light">
                Launch a token <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <a href="#tokens" className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                Explore tokens
              </a>
            </div>
          </FadeIn>
          <FadeIn>
            <div className="flex justify-center lg:justify-end">
              <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="p-4 font-mono text-[11px] leading-relaxed sm:p-5 sm:text-[12px]">
                  <div className="space-y-2 text-white/70">
                    <div className="flex justify-between border-b border-white/5 pb-2"><span className="text-white/40">Network</span><span>Robinhood Chain · 4663</span></div>
                    <div className="flex justify-between border-b border-white/5 pb-2"><span className="text-white/40">Tokens launched</span><span>{launches?.length ?? 0}</span></div>
                    <div className="flex justify-between border-b border-white/5 pb-2"><span className="text-white/40">Graduated</span><span>{(launches ?? []).filter((t: any) => t?.graduated).length}</span></div>
                    <div className="flex justify-between border-b border-white/5 pb-2"><span className="text-white/40">Liquidity</span><span className="text-right">Curve → Uniswap V4</span></div>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Content */}
      <section id="tokens" className="mx-auto max-w-container scroll-mt-20 px-5 py-10 sm:px-8 sm:py-16">
        <h2 className="mb-5 text-lg font-semibold text-white sm:text-xl">Tokens</h2>
        <div className="mb-6">
          <ContractsBanner />
        </div>

        {/* Search & filters */}
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

        {/* Grid */}
        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">Loading tokens from Robinhood Chain…</div>
        ) : (launches?.length ?? 0) === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg">No tokens launched yet</p>
            <p className="text-sm mt-1 mb-4">Launch a token on Polypad.</p>
            <Link href="/create"><Button>Create a token</Button></Link>
          </div>
        ) : (filtered?.length ?? 0) === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg">No tokens found</p>
            <p className="text-sm mt-1">Try adjusting your search or filters</p>
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
