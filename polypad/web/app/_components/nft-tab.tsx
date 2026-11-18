'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { formatEth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useNftCollections, useNow, collectionStatus } from '@/lib/hooks/use-nft-collections';
import { useCurveCollections } from '@/lib/hooks/use-curve-collections';

type Card = {
  address: string;
  name: string;
  symbol: string;
  image: string | null;
  minted: bigint;
  max: bigint;
  price: bigint;
  curve: boolean;
  soldOut: boolean;
};

const IMG_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const pickImage = (imageUri?: string, baseURI?: string) =>
  imageUri || (baseURI && IMG_RE.test(baseURI) ? baseURI : null);

export function NftTab() {
  const fixed = useNftCollections();
  const curve = useCurveCollections();
  const now = useNow();
  const loading = fixed.isLoading || curve.isLoading;
  const error = !!(fixed.error || curve.error) && !(fixed.data?.length || curve.data?.length);

  // Both hooks return newest first; curve collections are listed first, as on /nfts.
  const cards = useMemo<Card[]>(() => [
    ...(curve.data ?? []).map((c) => ({
      address: c.address, name: c.name, symbol: c.symbol,
      image: pickImage(c.imageUri, c.baseURI),
      minted: c.totalMinted, max: c.maxSupply, price: c.nextPrice, curve: true,
      soldOut: c.graduated || (c.maxSupply > 0n && c.totalMinted >= c.maxSupply),
    })),
    ...(fixed.data ?? []).map((c) => ({
      address: c.address, name: c.name, symbol: c.symbol,
      image: pickImage(c.imageUri, c.baseURI),
      minted: c.totalMinted, max: c.maxSupply, price: c.mintPrice, curve: false,
      soldOut: collectionStatus(c, now) === 'minted-out',
    })),
  ], [fixed.data, curve.data, now]);

  return (
    <div>
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading collections">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="glass-card h-[300px] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="glass-card p-6 text-center text-[14px] text-white/70">Couldn&apos;t load collections. Try again.</p>
      ) : cards.length === 0 ? (
        <p className="glass-card p-8 text-center text-[14px] text-white/70">No NFT collections yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => <NftCard key={c.address} c={c} />)}
        </div>
      )}
      <p className="mt-6 text-center text-[12px] text-white/55">Not financial advice.</p>
    </div>
  );
}

function NftCard({ c }: { c: Card }) {
  const pct = c.max > 0n ? Math.min(100, (Number(c.minted) / Number(c.max)) * 100) : 0;
  return (
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="relative aspect-[4/3] w-full bg-white/[0.04]">
        {c.image ? (
          <img
            src={c.image}
            alt={`${c.name} collection cover`}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[28px] font-semibold text-white/20">{c.symbol.slice(0, 4)}</div>
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          {c.curve && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">Bonding curve</span>}
          {c.soldOut && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">Sold out</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold text-white">{c.name}</h3>
          <span className="shrink-0 font-mono text-[11px] text-white/55">{c.symbol}</span>
        </div>
        <p className="mt-2 text-[13px] text-white/70">
          {c.curve ? 'Current price' : 'Mint price'} <span className="font-mono text-white">{formatEth(c.price, 5)} ETH</span>
        </p>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-polydash-green" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 font-mono text-[12px] text-white/55">{c.minted.toString()} / {c.max.toString()} minted</p>
        <Link
          href={`/nfts/${c.address}`}
          className={cn(
            'mt-4 inline-flex h-9 items-center justify-center rounded-full text-[13px] font-medium transition-colors',
            c.soldOut ? 'border border-white/15 text-white hover:bg-white/5' : 'bg-polydash-green text-black hover:bg-polydash-green-light',
          )}
        >
          {c.soldOut ? 'View collection' : 'View mint'}
        </Link>
      </div>
    </div>
  );
}
