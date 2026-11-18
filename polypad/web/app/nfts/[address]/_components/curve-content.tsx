'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react';
import { formatEth, shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { useNow } from '@/lib/hooks/use-nft-collections';
import { useCurveCollection } from '@/lib/hooks/use-curve-collections';
import { Holdings } from './holdings';
import { MarketPanel } from './market-panel';
import { TokenRewards } from './token-rewards';
import { CurveCreatorPanel, CurveTradePanel } from './curve-trade';
import { CollectionStakeSection } from '@/components/nft-staking/collection-stake-section';
import { CollectionTabs } from '@/components/nft-staking/collection-tabs';

export function CurveContent({ address }: { address: string }) {
  const { data: c, isLoading, error } = useCurveCollection(address);
  const now = useNow();
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return <div className="mx-auto max-w-container px-5 py-10 sm:px-6"><div className="glass-card h-[420px] animate-pulse" /></div>;
  }
  if (error || !c) {
    return (
      <div className="mx-auto max-w-container px-5 py-16 text-center sm:px-6">
        <p className="text-[15px] text-white/70">{error ? 'Could not load this collection from the chain.' : 'This address is not a Polypad NFT collection.'}</p>
        <Link href="/nfts" className="mt-4 inline-block text-[13px] text-polydash-green hover:underline">Back to collections</Link>
      </div>
    );
  }

  const max = Number(c.maxSupply) || 1;
  const circ = Number(c.circulating);
  const pct = c.graduated ? 100 : Math.min(100, (circ / max) * 100);
  const stats: [string, string][] = [
    [c.graduated ? 'Floor per NFT' : 'Next price', `${formatEth(c.graduated ? c.floorPerToken : c.nextPrice, 6)} ETH`],
    ['Held', `${circ} / ${c.maxSupply}`],
    [c.graduated ? 'Floor vault' : 'Curve reserve', `${formatEth(c.graduated ? c.floorVault : c.reserve, 4)} ETH`],
    ['Curve volume', `${formatEth(c.volume, 4)} ETH`],
  ];
  const copy = async () => {
    try { await navigator.clipboard.writeText(c.address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { console.error('copy failed', e); }
  };

  return (
    <div className="mx-auto max-w-container px-5 py-6 sm:px-6 sm:py-10">
      <Link href="/nfts" className="inline-flex items-center gap-1.5 text-[13px] text-white/50 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Collections</Link>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/[0.04] sm:h-24 sm:w-24">
          {c.imageUri && <img src={c.imageUri} alt={`${c.name} cover`} className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[24px] font-semibold tracking-tight text-white sm:text-[30px]">{c.name}</h1>
            <span className="font-mono text-[13px] text-white/40">{c.symbol}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', c.graduated ? 'bg-white/10 text-white/70' : 'bg-polydash-green/15 text-polydash-green')}>{c.graduated ? 'Graduated' : 'Bonding curve'}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/50">
            <button onClick={copy} className="inline-flex items-center gap-1 font-mono hover:text-white">
              {shortenAddress(c.address)} {copied ? <Check className="h-3 w-3 text-polydash-green" /> : <Copy className="h-3 w-3" />}
            </button>
            <a href={getExplorerAddressUrl(c.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-white">Explorer <ExternalLink className="h-3 w-3" /></a>
            <span>Creator <a href={getExplorerAddressUrl(c.creator)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-white">{shortenAddress(c.creator)}</a></span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="glass-card px-4 py-3">
            <p className="text-[11px] text-white/50">{k}</p>
            <p className="mt-0.5 font-mono text-[14px] font-semibold text-white">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <CollectionTabs stake={<CollectionStakeSection collection={c.address as `0x${string}`} name={c.name} />}>
          <div className="glass-card p-4 sm:p-5">
            <div className="flex justify-between text-[12px] text-white/50">
              <span>{c.graduated ? 'Graduated' : 'Progress to graduation'}</span>
              <span className="font-mono">{pct.toFixed(1)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-polydash-green" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-white/40">
              {c.graduated
                ? `${c.totalRedeemed.toString()} burned for the floor so far.`
                : `Graduates when all ${c.maxSupply.toString()} NFTs are held. ${c.poolSize.toString()} sold back and waiting in the pool.`}
            </p>
          </div>

          <Holdings c={{ address: c.address, name: c.name, floorPerToken: c.floorPerToken, curve: true, burnOpen: c.graduated }} />

          <MarketPanel collection={c.address} name={c.name} royaltyBps={c.royaltyBps} curve now={now} />

          <div className="glass-card space-y-3 p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-white">About {c.name}</h2>
            {c.description && <p className="whitespace-pre-line text-[13px] leading-relaxed text-white/70">{c.description}</p>}
            <div className="space-y-1.5 text-[12px]">
              {[
                ['Supply', c.maxSupply.toLocaleString('en-US')],
                ['Start price', `${formatEth(c.startPrice, 6)} ETH`],
                ['Price step', `${formatEth(c.priceStep, 8)} ETH per NFT`],
                ['Creator fee', `${Number(c.creatorFeeBps) / 100}% per curve trade`],
                ['Floor share', `${Number(c.floorBps) / 100}% of the reserve at graduation`],
                ['Creator royalty', `${(Number(c.royaltyBps) / 100).toFixed(1)}%`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><span className="text-white/50">{k}</span><span className="font-mono text-white">{v}</span></div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-white/40">
              The price of each NFT rises by the price step for every NFT held. Holders can sell back to the pool at the curve price at any time before graduation. At graduation, {Number(c.floorBps) / 100}% of the reserve is locked in a floor vault that any holder can redeem by burning an NFT; the rest goes to the creator.
            </p>
          </div>
          </CollectionTabs>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <CurveTradePanel c={c} />
          <CurveCreatorPanel c={c} />
          <TokenRewards collection={c.address} creator={c.creator} maxSupply={c.maxSupply} curve now={now} />
        </div>
      </div>
    </div>
  );
}
