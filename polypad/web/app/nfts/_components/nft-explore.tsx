'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useReadContract } from 'wagmi';
import { parseAbi } from 'viem';
import { Button } from '@/components/ui/button';
import { formatEth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useListings } from '@/lib/fund/use-phase5';
import { phase5Live } from '@/lib/fund/phase5';
import { robinhoodChain } from '@/lib/chain';
import { useNftCollections, useNow, collectionStatus, STATUS_LABEL, formatCountdown, type NftCollection, type NftStatus } from '@/lib/hooks/use-nft-collections';
import { useCurveCollections, type CurveCollection } from '@/lib/hooks/use-curve-collections';
import { useAllGatedCollections, type GatedSummary } from '@/lib/hooks/use-gated-mint';
import { PHASE_HOLDER, PHASE_PUBLIC, phaseLabel } from '@/lib/gatedMint';
import { useAllFloorCollections, type FloorSummary } from '@/lib/hooks/use-floor-vault';
import { useTerminalFunds } from '@/lib/terminal/use-terminal';
import GlossaryBox from '@/components/glossary-box';

type FilterKey = 'all' | NftStatus | 'curve' | 'graduated';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'commit', label: 'Commitments open' },
  { key: 'mint', label: 'Minting' },
  { key: 'minted-out', label: 'Minted out' },
  { key: 'curve', label: 'Bonding curve' },
  { key: 'graduated', label: 'Graduated' },
];

type Item = { kind: 'fixed'; c: NftCollection } | { kind: 'curve'; c: CurveCollection } | { kind: 'holder'; c: GatedSummary } | { kind: 'floor'; c: FloorSummary };

export function NftExplore() {
  const fixed = useNftCollections();
  const curve = useCurveCollections();
  const holder = useAllGatedCollections();
  const floor = useAllFloorCollections();
  const now = useNow();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const isLoading = fixed.isLoading || curve.isLoading;
  const error = fixed.error;

  const all = useMemo<Item[]>(() => [
    ...(floor.data ?? []).map((c) => ({ kind: 'floor' as const, c })),
    ...(holder.data ?? []).map((c) => ({ kind: 'holder' as const, c })),
    ...(curve.data ?? []).map((c) => ({ kind: 'curve' as const, c })),
    ...(fixed.data ?? []).map((c) => ({ kind: 'fixed' as const, c })),
  ], [fixed.data, curve.data, holder.data, floor.data]);
  const data = all;

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((it) => {
      const c = it.c;
      if (s && !c.name.toLowerCase().includes(s) && !c.symbol.toLowerCase().includes(s) && !c.address.toLowerCase().includes(s)) return false;
      if (filter === 'all') return true;
      if (it.kind === 'floor') return filter === 'mint' ? it.c.totalMinted < it.c.maxSupply : filter === 'minted-out' ? it.c.maxSupply > BigInt(0) && it.c.totalMinted >= it.c.maxSupply : false;
      if (it.kind === 'holder') return filter === 'mint' ? it.c.phase === PHASE_HOLDER || it.c.phase === PHASE_PUBLIC : false;
      if (it.kind === 'curve') return filter === 'curve' ? !it.c.graduated : filter === 'graduated' ? it.c.graduated : false;
      if (filter === 'curve' || filter === 'graduated') return false;
      const st = collectionStatus(it.c, now);
      return filter === 'mint' ? st === 'mint' || st === 'claim' : st === filter;
    });
  }, [all, q, filter, now]);

  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-white sm:text-[32px]">NFT collections</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-white/50">
            Two ways to buy. <span className="text-white/75">Fixed-price mint:</span> you commit ETH during a short window, then claim your NFTs — if too many people commit, everyone gets a smaller share and the extra ETH is refunded.
            {' '}<span className="text-white/75">Bonding curve:</span> the price rises as more NFTs are bought, and you can sell back to the pool until the collection graduates. Every collection has a floor vault: a pot of value any holder can trade an NFT back for.
          </p>
        </div>
        <Button asChild className="self-start sm:self-auto">
          <Link href="/nfts/create">Create collection</Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name — e.g. POLYDASH — or paste a token code (0x…)"
              className="h-11 w-full rounded-full border border-white/10 bg-white/[0.03] pl-9 pr-3 text-[16px] text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-polydash-green/60 sm:text-[13px]"
            />
          </div>
          <p className="mt-1.5 text-[11.5px] text-white/45">Where do I find this? A token code looks like 0x… and is shown on the collection&apos;s page or on the chain explorer.</p>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'h-11 min-h-[44px] shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors',
                filter === f.key ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <FundSharesSection />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card h-[320px] animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="glass-card p-6 text-[13px] text-red-300">Could not load collections from the chain. Try again in a moment.</p>
        ) : list.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-[14px] text-white/70">{(data ?? []).length === 0 ? 'No collections yet.' : 'No collections match.'}</p>
            {(data ?? []).length === 0 && (
              <Button asChild size="sm" className="mt-4"><Link href="/nfts/create">Create the first one</Link></Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((it) => it.kind === 'curve'
              ? <CurveCard key={it.c.address} c={it.c} />
              : it.kind === 'holder'
              ? <HolderCard key={it.c.address} c={it.c} />
              : it.kind === 'floor'
              ? <FloorCard key={it.c.address} c={it.c} />
              : <CollectionCard key={it.c.address} c={it.c} now={now} />)}
          </div>
        )}
      </div>
      <GlossaryBox
        className="mt-8"
        terms={[
          { term: 'Commit', def: 'Paying ETH up front during a short window to reserve NFTs. If too many people commit, you get fewer NFTs than you paid for and the extra ETH is refunded when you claim.' },
          { term: 'Mint', def: 'Buying an NFT at its fixed price — it arrives in your wallet right away.' },
          { term: 'Bonding curve', def: 'A pricing rule where each NFT costs a little more than the last one. Early buyers pay less; you can sell back to the pool until the collection graduates.' },
          { term: 'Graduate', def: 'When a bonding-curve collection has sold enough, it moves to normal trading and the curve closes.' },
          { term: 'Floor vault', def: 'A pot of value backing a collection. Any holder can trade an NFT back to the vault for its share of the pot — that share is the floor price.' },
          { term: 'Burn', def: 'Permanently destroying an NFT — for example, trading it to the floor vault. It cannot be undone.' },
        ]}
      />
    </div>
  );
}

const FUND_SHARE_NAV_ABI = parseAbi(['function navPerNft() view returns (uint256)']);

/** Shares of live Tokenized Funds, listed for sale by their holders on the fund secondary market. */
function FundSharesSection() {
  // The fund list comes from the same live-funds hook the Terminal uses, so a
  // new live fund shows up here without a code change.
  const { funds, isLoading } = useTerminalFunds();
  if (!phase5Live()) {
    return (
      <section>
        <h2 className="text-[18px] font-semibold text-white">Tokenized Fund shares for sale</h2>
        <p className="mt-1 max-w-xl text-[13px] text-white/50">Fund shares for sale are not live yet.</p>
      </section>
    );
  }
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-semibold text-white">Tokenized Fund shares for sale</h2>
        <p className="max-w-xl text-[13px] text-white/50">
          Shares of live Tokenized Funds, listed for sale by their holders. You pay the seller&apos;s price. You then own that share and its value. The vault value per share is shown as a reference — a listing price can be above or below it.
        </p>
      </div>
      {isLoading ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="glass-card h-[190px] animate-pulse" />)}
        </div>
      ) : funds.length === 0 ? (
        <p className="mt-4 text-[13px] text-white/55">No Tokenized Funds yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {funds.map((f) => (
            <FundShareCard key={f.address} address={f.address as `0x${string}`} name={f.name} symbol={f.symbol} />
          ))}
        </div>
      )}
    </section>
  );
}

function FundShareCard({ address, name, symbol }: { address: `0x${string}`; name: string; symbol: string }) {
  const { data: nav } = useReadContract({
    address, abi: FUND_SHARE_NAV_ABI, functionName: 'navPerNft', chainId: robinhoodChain.id,
    query: { refetchInterval: 30_000 },
  });
  const { data: market } = useListings(address);
  const listings = market?.listings ?? [];
  const lowest = listings.length ? listings.reduce((a, b) => (a.price < b.price ? a : b)) : null;
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold text-white">{name}</h3>
          <span className="shrink-0 font-mono text-[11px] text-white/40">{symbol}</span>
        </div>
        <span className="mt-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white">Tokenized Fund share</span>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">Vault value per share</span>
            <p className="font-mono font-semibold text-white">{nav != null ? `${formatEth(nav, 5)} ETH` : '—'}</p>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">Lowest listed price</span>
            <p className="font-mono font-semibold text-white">{lowest ? `${formatEth(lowest.price, 5)} ETH` : 'None listed'}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-between text-[11px] text-white/50">
          <span className="font-mono">{listings.length === 0 ? 'No shares listed' : `${listings.length} share${listings.length === 1 ? '' : 's'} listed`}</span>
          <Link href={`/funds/${address}`} className="text-white/70 hover:text-white">View fund →</Link>
        </div>
        {lowest ? (
          <Link href={`/funds/${address}#phase5`} className="mt-3 flex min-h-[44px] items-center justify-center rounded-xl bg-polydash-green px-3 text-center text-[13px] font-semibold text-black transition-colors hover:bg-polydash-green-light">
            Buy lowest listed share — {formatEth(lowest.price, 5)} ETH + network fee
          </Link>
        ) : (
          <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[12px] leading-relaxed text-white/60">
            No shares for sale right now — <Link href={`/funds/${address}`} className="text-polydash-green hover:underline">buy a new share on the fund page</Link>.
          </p>
        )}
      </div>
    </div>
  );
}

/** Cover art: loads right away (not lazily), shows a soft pulse until it arrives, retries once on a failed load. */
function CoverImage({ src, alt, symbol }: { src: string; alt: string; symbol: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'retry' | 'failed'>('loading');
  useEffect(() => { setState('loading'); }, [src]);
  const url = state === 'retry' ? `${src}${src.includes('?') ? '&' : '?'}r=1` : src;
  return (
    <>
      {state !== 'ok' && (
        <div className={cn('absolute inset-0 flex items-center justify-center text-[28px] font-semibold text-white/20', state !== 'failed' && 'animate-pulse bg-white/[0.06]')}>{symbol.slice(0, 4)}</div>
      )}
      {state !== 'failed' && (
        <img src={url} alt={alt} loading="eager" decoding="async" fetchPriority="high"
          className={cn('relative h-full w-full object-cover transition-opacity duration-300', state === 'ok' ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setState('ok')} onError={() => setState((s) => (s === 'loading' ? 'retry' : 'failed'))} />
      )}
    </>
  );
}

function CurveCard({ c }: { c: CurveCollection }) {
  const held = Number(c.circulating);
  const max = Number(c.maxSupply) || 1;
  const pct = c.graduated ? 100 : Math.min(100, (held / max) * 100);
  return (
    <Link href={`/nfts/${c.address}`} className="glass-card group block overflow-hidden transition-colors hover:border-white/20">
      <div className="relative aspect-square w-full bg-white/[0.04]">
        {c.imageUri ? (
          <CoverImage src={c.imageUri} alt={`${c.name} cover`} symbol={c.symbol} />
        ) : (
          <div className="flex h-full items-center justify-center text-[28px] font-semibold text-white/20">{c.symbol.slice(0, 4)}</div>
        )}
        <span className={cn('absolute left-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur', c.graduated ? 'bg-black/70 text-white' : 'bg-polydash-green/90 text-black')}>
          {c.graduated ? 'Graduated' : 'Bonding curve'}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold text-white">{c.name}</h3>
          <span className="shrink-0 font-mono text-[11px] text-white/40">{c.symbol}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">{c.graduated ? 'Curve closed' : 'Next price'}</span>
            <p className="font-mono font-semibold text-white">{c.graduated ? '—' : `${formatEth(c.nextPrice, 5)} ETH`}</p>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">Floor vault</span>
            <p className="font-mono font-semibold text-white">{c.graduated ? `${formatEth(c.floorPerToken, 5)} ETH` : `${Number(c.floorBps) / 100}% of pool`}</p>
          </div>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-polydash-green" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-white/50">
          <span className="font-mono">{held} / {c.maxSupply.toString()} held</span>
        </div>
      </div>
    </Link>
  );
}

function CollectionCard({ c, now }: { c: NftCollection; now: number | null }) {
  const st = collectionStatus(c, now);
  const minted = Number(c.totalMinted);
  const max = Number(c.maxSupply) || 1;
  const committedPct = Math.min(100, (Number(c.totalCommitted) / max) * 100);
  const pct = st === 'commit' ? committedPct : Math.min(100, (minted / max) * 100);
  return (
    <Link href={`/nfts/${c.address}`} className="glass-card group block overflow-hidden transition-colors hover:border-white/20">
      <div className="relative aspect-square w-full bg-white/[0.04]">
        {c.imageUri ? (
          <CoverImage src={c.imageUri} alt={`${c.name} cover`} symbol={c.symbol} />
        ) : (
          <div className="flex h-full items-center justify-center text-[28px] font-semibold text-white/20">{c.symbol.slice(0, 4)}</div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold text-white">{c.name}</h3>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', st === 'commit' || st === 'mint' ? 'bg-polydash-green/90 text-black' : 'bg-white/10 text-white')}>
            {STATUS_LABEL[st]}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-white/40">{c.symbol}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">Price</span>
            <p className="font-mono font-semibold text-white">{formatEth(c.mintPrice, 5)} ETH</p>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">Floor vault</span>
            <p className="font-mono font-semibold text-white">{formatEth(c.floorPerToken, 5)} ETH</p>
          </div>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-polydash-green" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-white/50">
          <span className="font-mono">
            {st === 'commit' ? `${c.totalCommitted.toString()} / ${c.maxSupply.toString()} committed` : `${minted} / ${c.maxSupply.toString()} minted`}
          </span>
          {st === 'commit' && now != null && <span className="font-mono">{formatCountdown(Number(c.commitEnd) - now)}</span>}
        </div>
      </div>
    </Link>
  );
}

function FloorCard({ c }: { c: FloorSummary }) {
  const minted = Number(c.totalMinted);
  const max = Number(c.maxSupply) || 1;
  const pct = Math.min(100, (minted / max) * 100);
  const open = c.totalMinted < c.maxSupply;
  return (
    <Link href={`/nfts/floor/${c.address}`} className="glass-card group block overflow-hidden transition-colors hover:border-white/20">
      <div className="relative aspect-square w-full bg-white/[0.04]">
        {c.imageUri ? (
          <CoverImage src={c.imageUri} alt={`${c.name} cover`} symbol={c.symbol} />
        ) : (
          <div className="flex h-full items-center justify-center text-[28px] font-semibold text-white/20">{c.symbol.slice(0, 4)}</div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">Token-backed floor</span>
        <span className={cn('absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur', open ? 'bg-polydash-green/90 text-black' : 'bg-black/70 text-white')}>{open ? 'Minting' : 'Minted out'}</span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold text-white">{c.name}</h3>
          <span className="shrink-0 font-mono text-[11px] text-white/40">{c.symbol}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">Price</span>
            <p className="font-mono font-semibold text-white">{formatEth(c.price, 5)} ETH</p>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">Token share</span>
            <p className="font-mono font-semibold text-white">{c.tokenShareBps / 100}% {c.tokenSymbol}</p>
          </div>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-polydash-green" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-white/50">
          <span className="font-mono">{minted} / {c.maxSupply.toString()} minted</span>
        </div>
      </div>
    </Link>
  );
}

function HolderCard({ c }: { c: GatedSummary }) {
  const minted = Number(c.totalMinted);
  const max = Number(c.maxSupply) || 1;
  const pct = Math.min(100, (minted / max) * 100);
  const status = !c.gated && c.phase === PHASE_PUBLIC ? 'Open mint' : phaseLabel(c.phase);
  return (
    <Link href={`/nfts/holder/${c.address}`} className="glass-card group block overflow-hidden transition-colors hover:border-white/20">
      <div className="relative aspect-square w-full bg-white/[0.04]">
        {c.imageUri ? (
          <CoverImage src={c.imageUri} alt={`${c.name} cover`} symbol={c.symbol} />
        ) : (
          <div className="flex h-full items-center justify-center text-[28px] font-semibold text-white/20">{c.symbol.slice(0, 4)}</div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">Holder mint</span>
        <span className={cn('absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur', c.phase === PHASE_HOLDER || c.phase === PHASE_PUBLIC ? 'bg-polydash-green/90 text-black' : 'bg-black/70 text-white')}>{status}</span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold text-white">{c.name}</h3>
          <span className="shrink-0 font-mono text-[11px] text-white/40">{c.symbol}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">{c.gated ? 'Holder price' : 'Price'}</span>
            <p className="font-mono font-semibold text-white">{formatEth(c.gated ? c.holderPrice : c.publicPrice, 5)} ETH</p>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <span className="text-white/50">{c.gated ? 'Public price' : 'Floor vault'}</span>
            <p className="font-mono font-semibold text-white">{c.gated ? (c.publicPrice > BigInt(0) ? `${formatEth(c.publicPrice, 5)} ETH` : 'None') : `${formatEth(c.floorPerToken, 5)} ETH`}</p>
          </div>
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-polydash-green" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-white/50">
          <span className="font-mono">{minted} / {c.maxSupply.toString()} minted</span>
        </div>
      </div>
    </Link>
  );
}
