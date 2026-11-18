'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react';
import { formatEth, shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { useNftCollection, useNow, collectionStatus, STATUS_LABEL } from '@/lib/hooks/use-nft-collections';
import { MintPanel } from './mint-panel';
import { Holdings } from './holdings';
import { CreatorPanel } from './creator-panel';
import { MarketPanel } from './market-panel';
import { TokenRewards } from './token-rewards';
import { CurveContent } from './curve-content';
import { CollectionStakeSection } from '@/components/nft-staking/collection-stake-section';
import { CollectionTabs } from '@/components/nft-staking/collection-tabs';

export function CollectionContent({ address }: { address: string }) {
  const { data: c, isLoading, error } = useNftCollection(address);
  const now = useNow();
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return <div className="mx-auto max-w-container px-5 py-10 sm:px-6"><div className="glass-card h-[420px] animate-pulse" /></div>;
  }
  if (!error && c === null) return <CurveContent address={address} />;
  if (error || !c) {
    return (
      <div className="mx-auto max-w-container px-5 py-16 text-center sm:px-6">
        <p className="text-[15px] text-white/70">{error ? 'Could not load this collection from the chain.' : 'This address is not a Polypad NFT collection.'}</p>
        <Link href="/nfts" className="mt-4 inline-block text-[13px] text-polydash-green hover:underline">Back to collections</Link>
      </div>
    );
  }

  const st = collectionStatus(c, now);
  const max = Number(c.maxSupply) || 1;
  const minted = Number(c.totalMinted);
  const committedPct = Math.min(100, (Number(c.totalCommitted) / max) * 100);
  const mintedPct = Math.min(100, (minted / max) * 100);
  const stats: [string, string][] = [
    ['Mint price', `${formatEth(c.mintPrice, 6)} ETH`],
    ['Floor per NFT', `${formatEth(c.floorPerToken, 6)} ETH`],
    [st === 'commit' ? 'Committed' : 'Minted', st === 'commit' ? `${c.totalCommitted} / ${c.maxSupply}` : `${minted} / ${c.maxSupply}`],
    ['Floor vault', `${formatEth(c.floorReserve, 4)} ETH`],
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
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', st === 'commit' ? 'bg-polydash-green/15 text-polydash-green' : 'bg-white/10 text-white/70')}>{STATUS_LABEL[st]}</span>
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
              <span>{st === 'commit' ? 'Committed' : 'Minted'}</span>
              <span className="font-mono">{(st === 'commit' ? committedPct : mintedPct).toFixed(1)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-polydash-green" style={{ width: `${st === 'commit' ? committedPct : mintedPct}%` }} />
            </div>
            {Number(c.totalRedeemed) > 0 && <p className="mt-2 text-[11px] text-white/40">{c.totalRedeemed.toString()} burned for the floor so far.</p>}
          </div>

          <Holdings c={{ address: c.address, name: c.name, floorPerToken: c.floorPerToken, curve: false, burnOpen: true }} />

          <MarketPanel collection={c.address} name={c.name} royaltyBps={c.royaltyBps} curve={false} now={now} />

          <div className="glass-card space-y-3 p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-white">About {c.name}</h2>
            {c.description && <p className="whitespace-pre-line text-[13px] leading-relaxed text-white/70">{c.description}</p>}
            <div className="space-y-1.5 text-[12px]">
              {[
                ['Supply', c.maxSupply.toLocaleString('en-US')],
                ['Floor share', `${Number(c.floorBps) / 100}% of mint price`],
                ['Creator royalty', `${(Number(c.royaltyBps) / 100).toFixed(1)}%`],
                ['Max per wallet', c.maxPerWallet.toString()],
                ['Window ends', new Date(Number(c.commitEnd) * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><span className="text-white/50">{k}</span><span className="font-mono text-white">{v}</span></div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-white/40">
              The floor vault holds {formatEth(c.floorPerToken, 6)} ETH for every NFT in circulation. Any holder can burn an NFT to receive that amount. Nobody can withdraw it otherwise.
            </p>
          </div>
          </CollectionTabs>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <MintPanel c={c} now={now} />
          <CreatorPanel c={c} now={now} />
          <TokenRewards collection={c.address} creator={c.creator} maxSupply={c.maxSupply} curve={false} now={now} />
        </div>
      </div>
    </div>
  );
}
