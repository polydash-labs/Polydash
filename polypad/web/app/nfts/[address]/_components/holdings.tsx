'use client';

import { useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { parseEther, type Abi } from 'viem';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { robinhoodChain } from '@/lib/chain';
import { NftCollectionABI } from '@/lib/contracts/nft-abis';
import { Erc721ApprovalABI, NftMarketABI, getNftMarketAddress } from '@/lib/contracts/nft-market-abis';
import { useOwnedTokenIds } from '@/lib/hooks/use-curve-collections';
import { useContractTx } from './use-tx';

const SHOW = 60;
export const EXPIRY_OPTIONS: [string, number][] = [['1 day', 86400], ['7 days', 7 * 86400], ['30 days', 30 * 86400], ['90 days', 90 * 86400]];

export function toHttp(uri: string) {
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

export function useTokenMeta(collection: `0x${string}`, ids: bigint[]) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['nft-meta', collection.toLowerCase(), ids.map(String).join(',')],
    enabled: !!client && ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const uris = await client!.multicall({
        contracts: ids.map((id) => ({ address: collection, abi: NftCollectionABI, functionName: 'tokenURI', args: [id] })) as any,
        allowFailure: true,
      });
      const out: Record<string, { name?: string; image?: string }> = {};
      await Promise.all(ids.map(async (id, i) => {
        const uri = uris[i]?.status === 'success' ? String(uris[i].result) : '';
        if (!uri) return;
        try {
          const j = await (await fetch(toHttp(uri))).json();
          out[id.toString()] = { name: typeof j?.name === 'string' ? j.name : undefined, image: typeof j?.image === 'string' ? toHttp(j.image) : undefined };
        } catch { /* metadata unavailable */ }
      }));
      return out;
    },
  });
}

/** Returns true once the wallet has approved `operator` for all NFTs of `collection` (sends the approval if needed). */
export function useEnsureApproval() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { call } = useContractTx();
  return async (collection: `0x${string}`, owner: `0x${string}`, operator: `0x${string}`) => {
    const ok = await client!.readContract({ address: collection, abi: Erc721ApprovalABI, functionName: 'isApprovedForAll', args: [owner, operator] });
    if (ok) return true;
    return call({ key: 'approve', address: collection, abi: Erc721ApprovalABI as Abi, functionName: 'setApprovalForAll', args: [operator, true], success: 'Marketplace approved' });
  };
}

export interface HoldingsTarget {
  address: `0x${string}`;
  name: string;
  floorPerToken: bigint;
  curve: boolean;
  /** Burning for the floor is open (always for fixed collections, after graduation for curves). */
  burnOpen: boolean;
}

export function Holdings({ c }: { c: HoldingsTarget }) {
  const { address: user } = useAccount();
  const market = getNftMarketAddress();
  const { data: owned, isLoading } = useOwnedTokenIds(c.address, user, c.curve);
  const ids = (owned ?? []).slice(0, SHOW);
  const { data: meta } = useTokenMeta(c.address, ids);
  const { call, pending } = useContractTx();
  const ensureApproval = useEnsureApproval();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'burn' | 'list'>(c.burnOpen ? 'burn' : 'list');
  const [confirm, setConfirm] = useState(false);
  const [price, setPrice] = useState('');
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[1][1]);
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  const toggle = (id: string) => {
    setConfirm(false);
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const chosen = ids.filter((id) => sel.has(id.toString()));
  const payout = c.floorPerToken * BigInt(chosen.length);
  const modes = [c.burnOpen && 'burn', market && 'list'].filter(Boolean) as ('burn' | 'list')[];
  const active = modes.includes(mode) ? mode : modes[0];
  let priceWei: bigint | null = null;
  try { priceWei = price && Number(price) > 0 ? parseEther(price as `${number}`) : null; } catch { priceWei = null; }

  const list = async () => {
    if (!market || !priceWei) return;
    setBusy(true);
    try {
      if (!(await ensureApproval(c.address, user, market))) return;
      const exp = BigInt(Math.floor(Date.now() / 1000) + expiry);
      for (const id of chosen) {
        const ok = await call({ key: 'list', address: market, abi: NftMarketABI as Abi, functionName: 'list', args: [c.address, id, priceWei, exp], success: `Listed #${id}` });
        if (!ok) return;
      }
      setSel(new Set());
      setPrice('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-white">Your NFTs</h2>
        <span className="font-mono text-[12px] text-white/50">{owned ? owned.length : '-'}</span>
      </div>
      {isLoading ? (
        <p className="mt-3 text-[12px] text-white/50">Loading...</p>
      ) : !owned || owned.length === 0 ? (
        <p className="mt-3 text-[12px] text-white/50">You do not hold any NFTs from this collection.</p>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-white/50">
            Select NFTs to {[c.burnOpen && `burn for ${formatEth(c.floorPerToken, 6)} ETH each`, market && 'list for sale'].filter(Boolean).join(' or ') || 'view'}.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {ids.map((id) => {
              const k = id.toString();
              const m = meta?.[k];
              const on = sel.has(k);
              return (
                <button key={k} type="button" onClick={() => toggle(k)} className={cn('relative overflow-hidden rounded-xl border text-left transition-colors', on ? 'border-polydash-green' : 'border-white/10 hover:border-white/25')}>
                  <div className="aspect-square w-full bg-white/[0.04]">
                    {m?.image && <img src={m.image} alt={m.name ?? `${c.name} #${k}`} className="h-full w-full object-cover" loading="lazy" />}
                  </div>
                  <p className="truncate px-2 py-1 font-mono text-[11px] text-white/70">{m?.name ?? `#${k}`}</p>
                  {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-polydash-green text-black"><Check className="h-3 w-3" /></span>}
                </button>
              );
            })}
          </div>
          {owned.length > SHOW && <p className="mt-2 text-[11px] text-white/40">Showing the first {SHOW}.</p>}
          {chosen.length > 0 && modes.length > 0 && (
            <div className="mt-4 space-y-3">
              {modes.length > 1 && (
                <div className="flex gap-1 rounded-full bg-white/[0.04] p-1">
                  {modes.map((m) => (
                    <button key={m} type="button" onClick={() => { setMode(m); setConfirm(false); }} className={cn('flex-1 rounded-full px-3 py-1.5 text-[12px] font-medium', active === m ? 'bg-white text-black' : 'text-white/60 hover:text-white')}>
                      {m === 'burn' ? 'Burn for floor' : 'List for sale'}
                    </button>
                  ))}
                </div>
              )}
              {active === 'burn' ? (
                <>
                  {confirm && <p className="text-[12px] text-yellow-200">Burning is permanent. The selected NFTs are destroyed and you receive {formatEth(payout, 6)} ETH.</p>}
                  <Button
                    variant={confirm ? 'destructive' : 'secondary'}
                    className="w-full gap-2"
                    disabled={!!pending}
                    onClick={async () => {
                      if (!confirm) return setConfirm(true);
                      // redeem(uint256[]) has the same signature on fixed and curve collections.
                      if (await call({ key: 'redeem', address: c.address, abi: NftCollectionABI as Abi, functionName: 'redeem', args: [chosen], success: 'Redeemed' })) { setSel(new Set()); setConfirm(false); }
                    }}
                  >
                    {pending === 'redeem' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {confirm ? `Confirm burn of ${chosen.length}` : `Burn ${chosen.length} for ${formatEth(payout, 6)} ETH`}
                  </Button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="relative">
                      <Input inputMode="decimal" placeholder="Price each" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} className="pr-12" />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-white/40">ETH</span>
                    </div>
                    <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} className="h-9 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white">
                      {EXPIRY_OPTIONS.map(([l, s]) => <option key={s} value={s} className="bg-[#0A0A0A]">{l}</option>)}
                    </select>
                  </div>
                  <p className="text-[11px] text-white/40">The creator royalty is paid from the sale price. The first listing asks you to approve the marketplace for this collection. Each NFT is listed in its own transaction.</p>
                  <Button className="w-full gap-2" disabled={busy || !priceWei} onClick={list}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {`List ${chosen.length} ${chosen.length === 1 ? 'NFT' : 'NFTs'}`}
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
