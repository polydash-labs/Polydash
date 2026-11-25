'use client';

import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { parseEther, type Abi } from 'viem';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEth, shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { NftMarketABI, getNftMarketAddress } from '@/lib/contracts/nft-market-abis';
import { useOwnedTokenIds } from '@/lib/hooks/use-curve-collections';
import type { MarketData } from '@/lib/nft-market/indexer';
import { EXPIRY_OPTIONS, useEnsureApproval, useTokenMeta } from './holdings';
import { useContractTx } from './use-tx';
import { ViaAgentBadge } from '@/components/via-agent-badge';

const KIND: Record<string, string> = { list: 'Listed', cancel: 'Delisted', sale: 'Sale', offer: 'Offer', offer_cancel: 'Offer cancelled', offer_accept: 'Offer accepted' };

function ago(ts: number, now: number | null) {
  if (!now || !ts) return '-';
  const s = Math.max(0, now - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function useMarketData(collection: `0x${string}`) {
  return useQuery({
    queryKey: ['nft-market', collection.toLowerCase()],
    refetchInterval: 20_000,
    queryFn: async (): Promise<MarketData> => {
      const r = await fetch(`/api/nfts/market/${collection}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Market request failed (${r.status})`);
      return r.json();
    },
  });
}

export function MarketPanel({ collection, name, royaltyBps, curve, now }: { collection: `0x${string}`; name: string; royaltyBps: bigint; curve: boolean; now: number | null }) {
  const market = getNftMarketAddress();
  const { address: user } = useAccount();
  const { data, isLoading, error } = useMarketData(collection);
  const { data: owned } = useOwnedTokenIds(collection, user, curve);
  const { call, pending } = useContractTx();
  const ensureApproval = useEnsureApproval();
  const [tab, setTab] = useState<'listings' | 'offers' | 'activity'>('listings');
  const [offerPrice, setOfferPrice] = useState('');
  const [offerToken, setOfferToken] = useState('');
  const [offerExpiry, setOfferExpiry] = useState(EXPIRY_OPTIONS[1][1]);
  const [acceptPick, setAcceptPick] = useState<Record<number, string>>({});
  const { data: owed } = useReadContract({
    address: market ?? undefined, abi: NftMarketABI, functionName: 'pendingWithdrawals', args: user ? [user] : undefined, chainId: robinhoodChain.id,
    query: { enabled: !!market && !!user, refetchInterval: 30_000 },
  });
  const listings = data?.listings ?? [];
  const { data: meta } = useTokenMeta(collection, listings.slice(0, 48).map((l) => BigInt(l.tokenId)));

  if (!market) {
    return (
      <div className="glass-card p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-white">Marketplace</h2>
        <p className="mt-2 text-[12px] text-white/50">The Polypad marketplace contracts are not deployed yet. Listings and offers will appear here once they are.</p>
      </div>
    );
  }

  const me = user?.toLowerCase();
  const ownedSet = new Set((owned ?? []).map(String));
  let offerWei: bigint | null = null;
  try { offerWei = offerPrice && Number(offerPrice) > 0 ? parseEther(offerPrice as `${number}`) : null; } catch { offerWei = null; }
  const tokenOk = offerToken === '' || /^\d+$/.test(offerToken);
  const m = { address: market, abi: NftMarketABI as Abi };
  const s = data?.stats;

  const makeOffer = async () => {
    if (!offerWei || !tokenOk) return;
    const any = offerToken === '';
    const exp = BigInt(Math.floor(Date.now() / 1000) + offerExpiry);
    if (await call({ ...m, key: 'offer', functionName: 'makeOffer', args: [collection, any ? BigInt(0) : BigInt(offerToken), any, exp], value: offerWei, success: 'Offer placed' })) {
      setOfferPrice(''); setOfferToken('');
    }
  };
  const accept = async (id: number, tokenId: string) => {
    if (!user || !tokenId) return;
    if (!(await ensureApproval(collection, user, market))) return;
    await call({ ...m, key: `accept-${id}`, functionName: 'acceptOffer', args: [BigInt(id), BigInt(tokenId)], success: `Sold #${tokenId}` });
  };

  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-white">Marketplace</h2>
        <div className="flex gap-1 rounded-full bg-white/[0.04] p-1">
          {(['listings', 'offers', 'activity'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn('rounded-full px-3 py-1 text-[12px] font-medium capitalize', tab === t ? 'bg-white text-black' : 'text-white/60 hover:text-white')}>{t}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Lowest listing', s?.floor ? `${formatEth(BigInt(s.floor), 5)} ETH` : '-'],
          ['Top offer', s?.topOffer ? `${formatEth(BigInt(s.topOffer), 5)} ETH` : '-'],
          ['Listed', s ? String(s.listed) : '-'],
          ['Volume', s ? `${s.volumeEth.toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH` : '-'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/[0.03] px-3 py-2">
            <p className="text-[11px] text-white/50">{k}</p>
            <p className="mt-0.5 font-mono text-[13px] font-semibold text-white">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/40">Every marketplace sale pays the {(Number(royaltyBps) / 100).toFixed(1)}% creator royalty. It cannot be skipped.</p>

      {owed && (owed as bigint) > BigInt(0) && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-polydash-green/10 px-3 py-2">
          <span className="text-[12px] text-white/80">{formatEth(owed as bigint, 6)} ETH is waiting for you.</span>
          <Button size="sm" disabled={!!pending} onClick={() => call({ ...m, key: 'withdraw', functionName: 'withdraw', success: 'Withdrawn' })}>Withdraw</Button>
        </div>
      )}

      {isLoading ? (
        <p className="mt-4 text-[12px] text-white/50">Loading...</p>
      ) : error ? (
        <p className="mt-4 text-[12px] text-red-300">Could not load marketplace data.</p>
      ) : tab === 'listings' ? (
        listings.length === 0 ? (
          <p className="mt-4 text-[12px] text-white/50">No active listings. Holders can list from Your NFTs.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {listings.slice(0, 48).map((l) => {
              const mt = meta?.[l.tokenId];
              const mine = l.seller === me;
              return (
                <div key={l.id} className="overflow-hidden rounded-xl border border-white/10">
                  <div className="aspect-square w-full bg-white/[0.04]">
                    {mt?.image && <img src={mt.image} alt={mt.name ?? `${name} #${l.tokenId}`} className="h-full w-full object-cover" loading="lazy" />}
                  </div>
                  <div className="space-y-2 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px] text-white/70">{mt?.name ?? `#${l.tokenId}`}</span>
                      <span className="font-mono text-[12px] font-semibold text-white">{formatEth(BigInt(l.price), 5)}</span>
                    </div>
                    {mine ? (
                      <Button size="sm" variant="secondary" className="h-8 w-full" disabled={!!pending} onClick={() => call({ ...m, key: `cancel-${l.id}`, functionName: 'cancelListing', args: [BigInt(l.id)], success: 'Listing cancelled' })}>
                        {pending === `cancel-${l.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cancel
                      </Button>
                    ) : (
                      <Button size="sm" className="h-8 w-full" disabled={!user || !!pending} onClick={() => call({ ...m, key: `buy-${l.id}`, functionName: 'buy', args: [BigInt(l.id)], value: BigInt(l.price), success: `Bought #${l.tokenId}` })}>
                        {pending === `buy-${l.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {user ? 'Buy' : 'Connect wallet'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'offers' ? (
        <div className="mt-4 space-y-4">
          {user && (
            <div className="space-y-2 rounded-xl bg-white/[0.03] p-3">
              <p className="text-[12px] font-medium text-white">Make an offer</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <div className="relative">
                  <Input inputMode="decimal" placeholder="Price" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value.replace(/[^0-9.]/g, ''))} className="pr-12" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-white/40">ETH</span>
                </div>
                <Input inputMode="numeric" placeholder="Token id (blank = any)" value={offerToken} onChange={(e) => setOfferToken(e.target.value.replace(/\D/g, ''))} />
                <select value={offerExpiry} onChange={(e) => setOfferExpiry(Number(e.target.value))} className="col-span-2 h-9 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white sm:col-span-1">
                  {EXPIRY_OPTIONS.map(([l, sec]) => <option key={sec} value={sec} className="bg-[#0A0A0A]">{l}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-white/40">The ETH is held by the marketplace contract until the offer is accepted or you cancel it.</p>
              <Button className="w-full gap-2" disabled={!offerWei || !tokenOk || !!pending} onClick={makeOffer}>
                {pending === 'offer' && <Loader2 className="h-4 w-4 animate-spin" />}
                {offerToken ? `Offer on #${offerToken}` : 'Offer on any NFT'}
              </Button>
            </div>
          )}
          {(data?.offers ?? []).length === 0 ? (
            <p className="text-[12px] text-white/50">No active offers.</p>
          ) : (
            <div className="divide-y divide-white/5">
              {data!.offers.map((o) => {
                const mine = o.buyer === me;
                const eligible = o.anyToken ? (owned ?? []).map(String) : ownedSet.has(o.tokenId) ? [o.tokenId] : [];
                const pick = acceptPick[o.id] ?? eligible[0] ?? '';
                return (
                  <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-[13px] font-semibold text-white">{formatEth(BigInt(o.price), 5)} ETH</p>
                      <p className="text-[11px] text-white/50">{o.anyToken ? 'Any NFT' : `#${o.tokenId}`} · from <a href={getExplorerAddressUrl(o.buyer)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-white">{shortenAddress(o.buyer)}</a></p>
                    </div>
                    <div className="flex items-center gap-2">
                      {mine && (
                        <Button size="sm" variant="secondary" disabled={!!pending} onClick={() => call({ ...m, key: `ocancel-${o.id}`, functionName: 'cancelOffer', args: [BigInt(o.id)], success: 'Offer cancelled' })}>Cancel</Button>
                      )}
                      {!mine && eligible.length > 0 && (
                        <>
                          {o.anyToken && eligible.length > 1 && (
                            <select value={pick} onChange={(e) => setAcceptPick((p) => ({ ...p, [o.id]: e.target.value }))} className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-2 text-[12px] text-white">
                              {eligible.map((id) => <option key={id} value={id} className="bg-[#0A0A0A]">#{id}</option>)}
                            </select>
                          )}
                          <Button size="sm" disabled={!!pending} onClick={() => accept(o.id, pick)}>
                            {pending === `accept-${o.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Accept{eligible.length === 1 || !o.anyToken ? ` #${pick}` : ''}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (data?.activity ?? []).length === 0 ? (
        <p className="mt-4 text-[12px] text-white/50">No marketplace activity yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12px]">
            <thead className="text-white/40">
              <tr><th className="pb-2 font-normal">Event</th><th className="pb-2 font-normal">Item</th><th className="pb-2 font-normal">Price</th><th className="pb-2 font-normal">From</th><th className="pb-2 font-normal">To</th><th className="pb-2 text-right font-normal">Time</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data!.activity.map((a) => (
                <tr key={a.id} className="text-white/80">
                  <td className="py-2">{KIND[a.kind] ?? a.kind}<ViaAgentBadge hash={a.txHash} /></td>
                  <td className="py-2 font-mono">{a.tokenId ? `#${a.tokenId}` : 'Any'}</td>
                  <td className="py-2 font-mono">{a.price !== '0' ? `${formatEth(BigInt(a.price), 5)}` : '-'}</td>
                  <td className="py-2 font-mono">{a.fromAddr ? shortenAddress(a.fromAddr) : '-'}</td>
                  <td className="py-2 font-mono">{a.toAddr ? shortenAddress(a.toAddr) : '-'}</td>
                  <td className="py-2 text-right">
                    <a href={getExplorerTxUrl(a.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-white/50 hover:text-white">{ago(a.ts, now)} <ExternalLink className="h-3 w-3" /></a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
