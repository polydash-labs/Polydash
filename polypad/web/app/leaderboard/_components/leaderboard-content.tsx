'use client';

import { useState, useMemo } from 'react';
import { TokenAvatar } from '@/components/token-avatar';
import { ContractsBanner } from '@/components/contracts-banner';
import { useLaunches } from '@/lib/hooks/use-launches';
import { formatUsd } from '@/lib/format';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/animate';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type LeaderboardTab = 'volume' | 'mcap' | 'gainers';

export function LeaderboardContent() {
  const [tab, setTab] = useState<LeaderboardTab>('volume');
  const { data: launches, isLoading } = useLaunches();

  const sorted = useMemo(() => {
    const list = [...(launches ?? [])];
    switch (tab) {
      case 'volume': list.sort((a: any, b: any) => (b?.volumeUsd ?? 0) - (a?.volumeUsd ?? 0)); break;
      case 'mcap': list.sort((a: any, b: any) => (b?.marketCapUsd ?? 0) - (a?.marketCapUsd ?? 0)); break;
      case 'gainers': list.sort((a: any, b: any) => (b?.curveProgress ?? 0) - (a?.curveProgress ?? 0)); break;
    }
    return list;
  }, [tab, launches]);

  const tabs: { key: LeaderboardTab; label: string }[] = [
    { key: 'volume', label: 'Volume' },
    { key: 'mcap', label: 'Market cap' },
    { key: 'gainers', label: 'Curve progress' },
  ];

  return (
    <div className="mx-auto max-w-container px-5 sm:px-8 py-8 sm:py-16 space-y-5 sm:space-y-6">
      <ContractsBanner />

      <h1 className="text-lg sm:text-xl font-semibold">Leaderboard</h1>

      {/* Tabs */}
      <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 scrollbar-none sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[12px] font-medium transition-colors sm:text-[13px]',
              tab === t.key ? 'bg-polydash-green text-black' : 'border border-white/15 text-white/70 hover:bg-white/5 hover:text-white'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <FadeIn delay={0.05}>
        <div className="glass-card rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-3 sm:px-4 py-3 text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground border-b border-border/40">
            <div className="col-span-1">#</div>
            <div className="col-span-4 sm:col-span-3">Token</div>
            <div className="col-span-3 sm:col-span-2 text-right">MCap</div>
            <div className="col-span-4 sm:col-span-2 text-right">Volume</div>
            <div className="hidden sm:block col-span-2 text-right">Curve</div>
            <div className="hidden sm:block col-span-2 text-right">Price (ETH)</div>
          </div>

          {/* Rows */}
          <Stagger staggerDelay={0.03}>
            {sorted.map((token: any, i: number) => (
              <StaggerItem key={token?.launchAddress}>
                <Link href={`/token/${token?.launchAddress ?? ''}`}
                  className="grid grid-cols-12 gap-2 px-3 sm:px-4 py-3 items-center hover:bg-secondary/30 transition-colors border-b border-border/20 last:border-0">
                  <div className={cn('col-span-1 text-center font-mono text-xs sm:text-sm', i < 3 ? 'text-white' : 'text-muted-foreground')}>
                    {i + 1}
                  </div>
                  <div className="col-span-4 sm:col-span-3 flex min-w-0 items-center gap-2">
                    <TokenAvatar name={token?.name} symbol={token?.symbol} imageUri={token?.imageUri} size="sm" className="hidden sm:flex" />
                    <div className="min-w-0">
                      <p className="font-semibold text-[13px] sm:text-sm truncate">{token?.name}</p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground font-mono truncate">${token?.symbol}</p>
                    </div>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-right font-mono text-xs sm:text-sm">
                    {formatUsd(token?.marketCapUsd)}
                  </div>
                  <div className="col-span-4 sm:col-span-2 text-right font-mono text-xs sm:text-sm">
                    {formatUsd(token?.volumeUsd)}
                  </div>
                  <div className="hidden sm:block col-span-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${token?.curveProgress ?? 0}%` }} />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">{token?.curveProgress ?? 0}%</span>
                    </div>
                  </div>
                  <div className="hidden sm:block col-span-2 text-right font-mono text-xs text-muted-foreground">
                    {(token?.priceEth ?? 0) < 0.0001 ? (token?.priceEth ?? 0).toExponential(2) : (token?.priceEth ?? 0).toFixed(6)}
                  </div>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>

          <div className="px-4 py-3 text-center text-xs text-muted-foreground">
            {isLoading ? 'Loading live rankings…' : sorted.length === 0 ? (
              <>No tokens launched yet. <Link href="/create" className="text-primary hover:underline">Create one</Link></>
            ) : 'Live data from Robinhood Chain'}
          </div>
        </div>
      </FadeIn>
    </div>
  );
}
