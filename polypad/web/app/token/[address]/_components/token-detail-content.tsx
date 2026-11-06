'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Copy, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { TokenAvatar } from '@/components/token-avatar';
import { ContractsBanner } from '@/components/contracts-banner';
import { useLaunch, useTrades } from '@/lib/hooks/use-launches';
import { PHASE } from '@/lib/token-types';
import type { LaunchToken } from '@/lib/token-types';
import { formatUsd, shortenAddress, bpsToPercent, formatCompact } from '@/lib/format';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { MarketCapChart, GraduatedChartPanel, dexScreenerUrl } from './bonding-curve-chart';
import { TradePanel } from './trade-panel';
import { cn } from '@/lib/utils';
import { partitionLaunchLinks } from '@/lib/agent-mark';
import { AgentLaunchedBadge } from '@/components/agent-launched-badge';

const card = 'rounded-2xl border border-white/10 bg-white/[0.03]';

function hostOf(link: string) {
  try { return new URL(link).hostname.replace('www.', ''); } catch { return link; }
}

export function TokenDetailContent({ address }: { address: string }) {
  const { data: token, isLoading } = useLaunch(address);
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-container items-center justify-center gap-2 px-5 py-20 text-[13px] text-white/50 sm:px-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading token from Robinhood Chain
      </div>
    );
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-container px-5 py-20 text-center sm:px-8">
        <p className="text-white/50">Token not found</p>
        <Link href="/" className="mt-2 inline-block text-[13px] text-polydash-green">Back to tokens</Link>
      </div>
    );
  }

  const handleCopy = () => {
    navigator?.clipboard?.writeText?.(token.tokenAddress ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const graduated = token.graduated || token.phase === PHASE.Graduated;
  const isPre = token.phase === PHASE.Pending || token.phase === PHASE.Processing;
  const phaseLabel = graduated ? 'Graduated' : token.phase === PHASE.Pending ? 'Commitments open' : token.phase === PHASE.Processing ? 'Processing' : 'Bonding curve';
  const pct = Math.min(100, Math.max(0, token.curveProgress ?? 0));
  const links = partitionLaunchLinks(token.socialLinks);

  return (
    <div className="mx-auto max-w-container space-y-4 px-4 py-5 sm:space-y-5 sm:px-8 sm:py-8">
      <ContractsBanner />

      <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-white/50 transition-colors hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Tokens
      </Link>

      {/* Token header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <TokenAvatar name={token.name} symbol={token.symbol} imageUri={token.imageUri} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate text-[22px] font-semibold tracking-tight sm:text-[28px]">{token.name}</h1>
              <span className="font-mono text-[13px] text-white/45">${token.symbol}</span>
              <span className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                graduated ? 'bg-polydash-green/15 text-polydash-green' : isPre ? 'bg-yellow-400/10 text-yellow-300' : 'bg-white/[0.07] text-white/80'
              )}>
                {!graduated && <span className={cn('h-1.5 w-1.5 rounded-full', isPre ? 'bg-yellow-300' : 'bg-polydash-green animate-pulse')} />}
                {phaseLabel}
              </span>
              {links.agentLaunched && <AgentLaunchedBadge />}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/45">
              <button onClick={handleCopy} className="inline-flex items-center gap-1 font-mono transition-colors hover:text-white">
                {shortenAddress(token.tokenAddress)}
                {copied ? <Check className="h-3 w-3 text-polydash-green" /> : <Copy className="h-3 w-3" />}
              </button>
              <a href={getExplorerAddressUrl(token.tokenAddress)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 transition-colors hover:text-white">
                Explorer <ArrowUpRight className="h-3 w-3" />
              </a>
              {graduated && (
                <a href={dexScreenerUrl(token.tokenAddress)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-polydash-green hover:text-polydash-green-light">
                  DexScreener <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
              {links.buildUrl && (
                <a href={links.buildUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 transition-colors hover:text-white">
                  Build <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
              {links.links.map((link) => (
                <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 transition-colors hover:text-white">
                  {hostOf(link)} <ArrowUpRight className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stat strip */}
      <div className={cn(card, 'grid grid-cols-2 divide-white/10 sm:grid-cols-4 sm:divide-x')}>
        {[
          { label: 'Market cap', value: formatUsd(token.marketCapUsd) },
          { label: 'Volume', value: formatUsd(token.volumeUsd) },
          { label: 'ETH raised', value: `${(token.ethRaised ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH` },
          { label: 'Creator fee', value: bpsToPercent(token.creatorFeeBps) },
        ].map((s, i) => (
          <div key={s.label} className={cn('px-4 py-3 sm:px-5 sm:py-4', i < 2 && 'border-b border-white/10 sm:border-b-0', i % 2 === 0 && 'border-r border-white/10 sm:border-r-0')}>
            <div className="text-[11px] text-white/45">{s.label}</div>
            <div className="mt-0.5 font-mono text-[15px] font-semibold sm:text-[17px]">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4 sm:space-y-5">
          {/* Chart */}
          <div className={cn(card, 'overflow-hidden')}>
            {graduated ? <GraduatedChartPanel token={token} /> : <MarketCapChart token={token} />}
          </div>

          {/* Curve progress */}
          {!graduated && (
            <div className={cn(card, 'p-4 sm:p-5')}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] font-semibold">Bonding curve</h2>
                <span className="font-mono text-[13px] text-polydash-green">{pct.toFixed(1)}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-polydash-green transition-all duration-500" style={{ width: `${Math.max(pct, pct > 0 ? 1 : 0)}%` }} />
              </div>
              <p className="mt-2.5 text-[12px] text-white/45">
                {(token.ethRaised ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 })} of {token.graduationThreshold ?? 0} ETH raised. At {token.graduationThreshold ?? 0} ETH the token graduates and liquidity moves to Uniswap V4.
              </p>
            </div>
          )}

          {/* Trades */}
          <div className={cn(card, 'overflow-hidden')}>
            <div className="px-4 pb-2 pt-4 sm:px-5">
              <h2 className="text-[15px] font-semibold">Trades</h2>
            </div>
            <TradesTable token={token} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 sm:space-y-5 lg:sticky lg:top-20 lg:self-start">
          <TradePanel token={token} />

          <div className={cn(card, 'p-4 sm:p-5')}>
            <h3 className="text-[15px] font-semibold">About {token.symbol}</h3>
            {token.description && <p className="mt-2 break-words text-[13px] leading-relaxed text-white/60">{token.description}</p>}
            <dl className="mt-3 divide-y divide-white/5 text-[13px]">
              {[
                ['Creator', (
                  <a key="c" href={getExplorerAddressUrl(token.creator)} target="_blank" rel="noopener noreferrer" className="font-mono text-polydash-green hover:underline">
                    {shortenAddress(token.creator)}
                  </a>
                )],
                ['Total supply', <span key="s" className="font-mono">{Number(token.totalSupply ?? 0).toLocaleString('en-US')}</span>],
                ['Graduates at', <span key="g" className="font-mono">{token.graduationThreshold ?? 0} ETH</span>],
                ['Creator fee', <span key="f" className="font-mono">{bpsToPercent(token.creatorFeeBps)}</span>],
                ['Launch contract', (
                  <a key="l" href={getExplorerAddressUrl(token.launchAddress)} target="_blank" rel="noopener noreferrer" className="font-mono text-white/80 hover:text-white">
                    {shortenAddress(token.launchAddress)}
                  </a>
                )],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between py-2">
                  <dt className="text-white/45">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function timeAgo(ts: number, now: number): string {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function TradesTable({ token }: { token: LaunchToken }) {
  const { data: trades, isLoading, dataUpdatedAt } = useTrades(token.launchAddress);
  if (isLoading) return <p className="px-4 py-6 text-center text-[12px] text-white/40">Loading trades</p>;
  if (!trades?.length) return <p className="px-4 py-6 text-center text-[12px] text-white/40">No trades yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] sm:text-[13px]">
        <thead>
          <tr className="border-b border-white/10 text-left text-[11px] text-white/40">
            <th className="px-4 py-2 font-normal sm:px-5">Type</th>
            <th className="px-2 py-2 font-normal">Account</th>
            <th className="px-2 py-2 text-right font-normal">ETH</th>
            <th className="hidden px-2 py-2 text-right font-normal sm:table-cell">{token.symbol}</th>
            <th className="px-4 py-2 text-right font-normal sm:px-5">Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 50).map((t) => (
            <tr key={`${t.txHash}-${t.isBuy}`} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
              <td className={cn('px-4 py-2.5 font-medium sm:px-5', t.isBuy ? 'text-polydash-green' : 'text-[#FF5252]')}>{t.isBuy ? 'Buy' : 'Sell'}</td>
              <td className="px-2 py-2.5">
                <a href={getExplorerAddressUrl(t.trader)} target="_blank" rel="noopener noreferrer" className="font-mono text-white/70 hover:text-white">{shortenAddress(t.trader)}</a>
              </td>
              <td className="px-2 py-2.5 text-right font-mono">{t.eth.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
              <td className="hidden px-2 py-2.5 text-right font-mono text-white/70 sm:table-cell">{formatCompact(t.tokens)}</td>
              <td className="px-4 py-2.5 text-right sm:px-5">
                <a href={getExplorerTxUrl(t.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-white/45 hover:text-white">
                  {timeAgo(t.timestamp, dataUpdatedAt)} <ArrowUpRight className="h-3 w-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
