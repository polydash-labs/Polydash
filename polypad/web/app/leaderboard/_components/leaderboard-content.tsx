'use client';

import { useState, useMemo } from 'react';
import { formatEther } from 'viem';
import { TokenAvatar } from '@/components/token-avatar';
import { ContractsBanner } from '@/components/contracts-banner';
import { useLaunches, useEthPrice } from '@/lib/hooks/use-launches';
import { formatUsd, formatSmall, formatNavEth } from '@/lib/format';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/animate';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { isHiddenLaunch } from '@/lib/hidden-launches';
import { strategyLabel, useTerminalFunds } from '@/lib/terminal/use-terminal';

type LeaderboardTab = 'volume' | 'mcap' | 'gainers' | 'funds';

const FUND_PLACEHOLDER_LOGO = '/polydash-mark-white.png';

/**
 * formatSmall renders tiny prices as "0.0₈188", but the subscript digits
 * (₀–₉) come out at full size in the leaderboard's mono font, reading as
 * "0.0.188" (round 7). Split the subscript run out and render it small.
 */
function SubPrice({ value }: { value: number }) {
  const s = formatSmall(value);
  const parts = s.split(/([₀₁₂₃₄₅₆₇₈₉]+)/);
  return (
    <>
      {parts.map((p, i) =>
        /^[₀₁₂₃₄₅₆₇₈₉]+$/.test(p) ? (
          <span key={i} className="text-[0.7em]">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Market caps here cluster within a few dollars of each other
 * ($3,069.80–$3,073.84 at ETH ~$1,637): every launch starts at the same
 * bonding-curve price (1.875e-9 ETH) with the same 1B total supply, so
 * mcap = price x supply x ETH price is nearly identical by construction
 * (verified on-chain Nov 25 — three untraded tokens are genuinely
 * $3,069.80 each). formatUsd's $X.XXK rounding collapses all five rows
 * to "$3.07K" and hides even the real $4 differences, so show full
 * dollars below $1M; keep the compact form above it.
 */
function formatMcap(val: number | undefined | null): string {
  if (val == null) return '$0';
  if (val >= 1_000_000) return formatUsd(val);
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function LeaderboardContent() {
  const [tab, setTab] = useState<LeaderboardTab>('volume');
  const { data: launches, isLoading, isFetching, isError: launchesError, refetch: refetchLaunches } = useLaunches();
  const funds = useTerminalFunds();
  const { data: ethUsd } = useEthPrice();

  const sorted = useMemo(() => {
    const list = (launches ?? []).filter((t) => !isHiddenLaunch(t));
    switch (tab) {
      case 'volume': list.sort((a: any, b: any) => (b?.volumeUsd ?? 0) - (a?.volumeUsd ?? 0)); break;
      case 'mcap': list.sort((a: any, b: any) => (b?.marketCapUsd ?? 0) - (a?.marketCapUsd ?? 0)); break;
      case 'gainers': list.sort((a: any, b: any) => (b?.curveProgress ?? 0) - (a?.curveProgress ?? 0)); break;
    }
    return list;
  }, [tab, launches]);

  const fundRows = useMemo(
    () => funds.rows ?? [],
    [funds.rows],
  );

  const tabs: { key: LeaderboardTab; label: string }[] = [
    { key: 'volume', label: 'Volume' },
    { key: 'mcap', label: 'Market cap' },
    { key: 'gainers', label: 'Curve progress' },
    { key: 'funds', label: 'Tokenized Funds' },
  ];

  const usd = (wei: bigint | null | undefined) => (wei == null || !ethUsd ? null : Number(formatEther(wei)) * ethUsd);

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
              'inline-flex h-11 min-h-[44px] shrink-0 items-center rounded-full px-3.5 text-[12px] font-medium transition-colors sm:text-[13px]',
              tab === t.key ? 'bg-polydash-green text-black' : 'border border-white/15 text-white/70 hover:bg-white/5 hover:text-white'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'gainers' && (
        <p className="text-[12px] text-muted-foreground">Curve progress is how far a token is toward graduating from its bonding curve — % of the way to graduating, not price gain.</p>
      )}
      {tab === 'funds' && (
        <div className="space-y-1 text-[12px] text-muted-foreground">
          <p>Value per share is what one share is worth right now.</p>
          <p>LP-Dividend means half the money buys POLYDASH, half goes into a trading pool that earns fees.</p>
        </div>
      )}

      {tab === 'funds' ? (
        /* Tokenized Funds ranked by live NAV per share */
        <FadeIn delay={0.05}>
          <div className="glass-card rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-3 sm:px-4 py-3 text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground border-b border-border/40">
              <div className="col-span-1">#</div>
              <div className="col-span-4 sm:col-span-3">Tokenized Fund</div>
              <div className="hidden sm:block col-span-2">Strategy</div>
              <div className="col-span-3 sm:col-span-2 text-right">Value / share</div>
              <div className="hidden sm:block col-span-2 text-right">Total value</div>
              <div className="col-span-4 sm:col-span-2 text-right">Shares &amp; raise</div>
            </div>

            {funds.isLoading ? (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">Loading live Tokenized Fund values…</div>
            ) : funds.isError ? (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                Could not load the Tokenized Fund leaderboard right now.{' '}
                <button type="button" onClick={() => void funds.refetch()} className="underline hover:text-white">Try again</button>
              </div>
            ) : fundRows.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">No Tokenized Funds yet.</div>
            ) : (
              <Stagger staggerDelay={0.03}>
                {fundRows.map((f, i) => {
                  const navUsd = usd(f.navPerNft);
                  const totalUsd = usd(f.totalNav);
                  const raisedEth = Number(formatEther(f.raised));
                  const capEth = Number(formatEther(f.raiseCap));
                  const pct = capEth > 0 ? Math.min(100, (raisedEth / capEth) * 100) : 0;
                  return (
                    <StaggerItem key={f.address}>
                      <Link href={`/funds/${f.address}`}
                        className="grid grid-cols-12 gap-2 px-3 sm:px-4 py-3 items-center hover:bg-secondary/30 transition-colors border-b border-border/20 last:border-0">
                        <div className={cn('col-span-1 text-center font-mono text-xs sm:text-sm', i < 3 ? 'text-white' : 'text-muted-foreground')}>
                          {i + 1}
                        </div>
                        <div className="col-span-4 sm:col-span-3 flex min-w-0 items-center gap-2">
                          <TokenAvatar name={f.name} symbol={f.symbol} imageUri={f.imageUri || FUND_PLACEHOLDER_LOGO} size="sm" className="hidden sm:flex" />
                          <div className="min-w-0">
                            <p className="font-semibold text-[13px] sm:text-sm truncate">{f.name}</p>
                            <p className="text-[11px] sm:text-xs text-muted-foreground font-mono truncate">${f.symbol}</p>
                            <p className="text-[11px] text-muted-foreground sm:hidden truncate">{strategyLabel(f.templateId)}</p>
                          </div>
                        </div>
                        <div className="hidden sm:block col-span-2 text-[12px] sm:text-[13px] text-white/70 truncate">
                          {strategyLabel(f.templateId)}
                        </div>
                        <div className="col-span-3 sm:col-span-2 text-right">
                          <p className="font-mono text-xs sm:text-sm">{formatNavEth(f.navPerNft)} ETH</p>
                          {f.navPerNft == null ? (
                            <p className="text-[11px] sm:text-xs text-muted-foreground">Value unavailable, retrying</p>
                          ) : navUsd != null ? (
                            <p className="text-[11px] sm:text-xs text-muted-foreground">{formatUsd(navUsd)}</p>
                          ) : null}
                          {f.navStale && f.navUpdatedAt ? (
                            <p className="text-[11px] sm:text-xs text-muted-foreground">Last updated {Math.max(0, Math.round((Date.now() - f.navUpdatedAt) / 60_000))} min ago</p>
                          ) : null}
                        </div>
                        <div className="hidden sm:block col-span-2 text-right">
                          <p className="font-mono text-xs sm:text-sm">{formatNavEth(f.totalNav)} ETH</p>
                          {totalUsd != null && (
                            <p className="text-[11px] sm:text-xs text-muted-foreground">{formatUsd(totalUsd)}</p>
                          )}
                        </div>
                        <div className="col-span-4 sm:col-span-2 text-right">
                          <p className="font-mono text-xs sm:text-sm">{Number(f.totalMinted)} / {Number(f.maxSupply)} shares</p>
                          <div className="mt-1.5 ml-auto h-1.5 w-20 rounded-full bg-secondary overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 1)}%` }} />
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">{pct < 0.01 ? '<0.01' : pct.toFixed(2).replace(/\.?0+$/, '')}% raised</p>
                        </div>
                      </Link>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            )}

            <div className="px-4 py-3 text-center text-xs text-muted-foreground">
              {funds.isLoading ? 'Loading live rankings…' : funds.isError ? 'Live data from Robinhood Chain' : fundRows.length === 0 ? 'No Tokenized Funds yet.' : 'Live data from Robinhood Chain · Ranked by value per share'}
            </div>
          </div>
        </FadeIn>
      ) : (
        /* Tokens */
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

            {/* Rows — a background refetch that is still in flight never
                flashes the empty state: while it runs with no rows yet, the
                skeleton stays up (round 7). */}
            {isLoading || (isFetching && sorted.length === 0) ? (
              <div className="space-y-2 px-3 py-3 sm:px-4">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[52px] animate-pulse rounded-xl bg-white/[0.04]" />)}
              </div>
            ) : launchesError ? (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                Could not load the token leaderboard right now.{' '}
                <button type="button" onClick={() => void refetchLaunches()} className="underline hover:text-white">Try again</button>
              </div>
            ) : (
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
                      {formatMcap(token?.marketCapUsd)}
                    </div>
                    <div className="col-span-4 sm:col-span-2 text-right font-mono text-xs sm:text-sm">
                      {token?.volumeUsd == null ? '—' : formatUsd(token.volumeUsd)}
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
                      <SubPrice value={token?.priceEth ?? 0} />
                    </div>
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
            )}

            <div className="px-4 py-3 text-center text-xs text-muted-foreground">
              {isLoading || (isFetching && sorted.length === 0) ? 'Loading live rankings…' : sorted.length === 0 ? (
                <>No tokens launched yet. <Link href="/create" className="text-primary hover:underline">Create the first one</Link></>
              ) : 'Live data from Robinhood Chain · Market cap = curve price × 1B supply — tokens with no trades yet share the launch price'}
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
