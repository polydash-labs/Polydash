'use client';

import { useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatUnits, parseUnits, type Abi } from 'viem';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { Erc20ABI, TokenLinkABI, getTokenLinkAddress } from '@/lib/contracts/nft-market-abis';
import { useOwnedTokenIds } from '@/lib/hooks/use-curve-collections';
import { useContractTx } from './use-tx';

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 4 });
const isAddr = (a: string): a is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(a);

interface LinkRow {
  id: number; token: `0x${string}`; creator: string; amountPerNft: bigint; deposited: bigint; claimed: bigint; claimDeadline: number; closed: boolean;
  symbol: string; decimals: number; claimable: bigint[];
}

export function TokenRewards({ collection, creator, maxSupply, curve, now }: { collection: `0x${string}`; creator: string; maxSupply: bigint; curve: boolean; now: number | null }) {
  const linkAddr = getTokenLinkAddress();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { address: user } = useAccount();
  const { data: owned } = useOwnedTokenIds(collection, user, curve);
  const { call, pending } = useContractTx();
  const isCreator = !!user && user.toLowerCase() === creator.toLowerCase();
  const ownedKey = (owned ?? []).map(String).join(',');

  const { data: links } = useQuery({
    queryKey: ['nft-links', collection.toLowerCase(), user?.toLowerCase(), ownedKey],
    enabled: !!client && !!linkAddr,
    refetchInterval: 30_000,
    queryFn: async (): Promise<LinkRow[]> => {
      const L = { address: linkAddr!, abi: TokenLinkABI } as const;
      const ids = (await client!.readContract({ ...L, functionName: 'linksOfCollection', args: [collection] })) as bigint[];
      if (!ids.length) return [];
      const rows = await client!.multicall({ contracts: ids.map((id) => ({ ...L, functionName: 'links', args: [id] })) as any, allowFailure: false });
      const tokens = Array.from(new Set(rows.map((r: any) => (r[1] as string).toLowerCase()))) as `0x${string}`[];
      const meta = await client!.multicall({
        contracts: tokens.flatMap((t) => [{ address: t, abi: Erc20ABI, functionName: 'symbol' }, { address: t, abi: Erc20ABI, functionName: 'decimals' }]) as any,
        allowFailure: true,
      });
      const tm = new Map(tokens.map((t, i) => [t, { symbol: meta[i * 2]?.status === 'success' ? String(meta[i * 2].result) : 'TOKEN', decimals: meta[i * 2 + 1]?.status === 'success' ? Number(meta[i * 2 + 1].result) : 18 }]));
      const mine = owned ?? [];
      const unclaimed = mine.length
        ? await client!.multicall({ contracts: ids.map((id) => ({ ...L, functionName: 'unclaimed', args: [id, mine] })) as any, allowFailure: true })
        : [];
      return ids.map((id, i) => {
        const r = rows[i] as any;
        const t = (r[1] as string).toLowerCase() as `0x${string}`;
        const flags = (unclaimed[i] as any)?.status === 'success' ? ((unclaimed[i] as any).result as boolean[]) : [];
        return {
          id: Number(id), token: r[1], creator: r[2], amountPerNft: r[3], deposited: r[4], claimed: r[5], claimDeadline: Number(r[6]), closed: r[7],
          symbol: tm.get(t)!.symbol, decimals: tm.get(t)!.decimals, claimable: mine.filter((_, j) => flags[j]),
        };
      });
    },
  });

  const [token, setToken] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('90');
  const [busy, setBusy] = useState(false);
  const { data: tokenMeta } = useQuery({
    queryKey: ['nft-links', 'erc20', token.toLowerCase(), user?.toLowerCase()],
    enabled: !!client && isAddr(token) && isCreator,
    queryFn: async () => {
      const t = token as `0x${string}`;
      const [symbol, decimals, balance] = await client!.multicall({
        contracts: [{ address: t, abi: Erc20ABI, functionName: 'symbol' }, { address: t, abi: Erc20ABI, functionName: 'decimals' }, { address: t, abi: Erc20ABI, functionName: 'balanceOf', args: [user!] }],
        allowFailure: false,
      });
      return { symbol: symbol as string, decimals: Number(decimals), balance: balance as bigint };
    },
  });

  if (!linkAddr) {
    return isCreator ? (
      <div className="glass-card p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-white">Token rewards</h2>
        <p className="mt-2 text-[12px] text-white/50">Linking a token to this collection becomes available once the token link contract is deployed.</p>
      </div>
    ) : null;
  }
  if (!isCreator && (!links || links.length === 0)) return null;

  let perNft: bigint | null = null;
  try { perNft = tokenMeta && amount && Number(amount) > 0 ? parseUnits(amount, tokenMeta.decimals) : null; } catch { perNft = null; }
  const total = perNft ? perNft * maxSupply : null;
  const d = Number(days);
  const daysOk = Number.isInteger(d) && d >= 7 && d <= 3650;
  const enough = !!total && !!tokenMeta && tokenMeta.balance >= total;

  const create = async () => {
    if (!user || !perNft || !total || !daysOk || !isAddr(token)) return;
    setBusy(true);
    try {
      const allowance = (await client!.readContract({ address: token, abi: Erc20ABI, functionName: 'allowance', args: [user, linkAddr] })) as bigint;
      if (allowance < total && !(await call({ key: 'link-approve', address: token, abi: Erc20ABI as Abi, functionName: 'approve', args: [linkAddr, total], success: 'Token approved' }))) return;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + d * 86400);
      if (await call({ key: 'link-create', address: linkAddr, abi: TokenLinkABI as Abi, functionName: 'createLink', args: [collection, token, perNft, deadline], success: 'Token rewards added' })) {
        setToken(''); setAmount('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-[15px] font-semibold text-white">Token rewards</h2>
        <p className="mt-1 text-[12px] text-white/50">Each NFT can claim a fixed amount of a linked token once, while the claim window is open.</p>
      </div>

      {(links ?? []).map((l) => {
        const left = l.deposited - l.claimed;
        const open = !l.closed && now != null && now < l.claimDeadline;
        const claimIds = l.claimable.slice(0, 100);
        return (
          <div key={l.id} className="space-y-2 rounded-xl bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <a href={getExplorerAddressUrl(l.token)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-white hover:underline">{l.symbol} <ExternalLink className="h-3 w-3 text-white/40" /></a>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{l.closed ? 'Closed' : open ? 'Claimable' : 'Window ended'}</span>
            </div>
            <div className="space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-white/50">Per NFT</span><span className="font-mono text-white">{fmt(l.amountPerNft, l.decimals)} {l.symbol}</span></div>
              <div className="flex justify-between"><span className="text-white/50">Remaining</span><span className="font-mono text-white">{fmt(left, l.decimals)} {l.symbol}</span></div>
              <div className="flex justify-between"><span className="text-white/50">Claim by</span><span className="font-mono text-white">{new Date(l.claimDeadline * 1000).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}</span></div>
            </div>
            {open && claimIds.length > 0 && (
              <Button className="w-full gap-2" disabled={!!pending} onClick={() => call({ key: `claim-${l.id}`, address: linkAddr, abi: TokenLinkABI as Abi, functionName: 'claim', args: [BigInt(l.id), claimIds], success: `Claimed ${l.symbol}` })}>
                {pending === `claim-${l.id}` && <Loader2 className="h-4 w-4 animate-spin" />}
                Claim {fmt(l.amountPerNft * BigInt(claimIds.length), l.decimals)} {l.symbol} for {claimIds.length} NFT{claimIds.length === 1 ? '' : 's'}
              </Button>
            )}
            {isCreator && !l.closed && now != null && now >= l.claimDeadline && (
              <Button variant="secondary" className="w-full gap-2" disabled={!!pending} onClick={() => call({ key: `close-${l.id}`, address: linkAddr, abi: TokenLinkABI as Abi, functionName: 'close', args: [BigInt(l.id)], success: 'Unclaimed tokens returned' })}>
                {pending === `close-${l.id}` && <Loader2 className="h-4 w-4 animate-spin" />} Close and return {fmt(left, l.decimals)} {l.symbol}
              </Button>
            )}
          </div>
        );
      })}

      {isCreator && (
        <div className="space-y-2 border-t border-white/5 pt-4">
          <p className="text-[12px] font-medium text-white">Link a token</p>
          <Input placeholder="Token address (0x...)" value={token} onChange={(e) => setToken(e.target.value.trim())} />
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Input inputMode="decimal" placeholder="Amount per NFT" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className="pr-16" />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-white/40">{tokenMeta?.symbol ?? ''}</span>
            </div>
            <div className="relative">
              <Input inputMode="numeric" placeholder="Claim window" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} className="pr-12" />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-white/40">days</span>
            </div>
          </div>
          {tokenMeta && total && (
            <p className="text-[11px] text-white/50">
              Deposit {fmt(total, tokenMeta.decimals)} {tokenMeta.symbol} ({maxSupply.toString()} NFTs). Your balance: {fmt(tokenMeta.balance, tokenMeta.decimals)}.
              {!enough && <span className="text-red-300"> Not enough balance.</span>}
            </p>
          )}
          {!daysOk && <p className="text-[11px] text-red-300">Claim window must be 7 to 3650 days.</p>}
          <p className="text-[11px] text-white/40">The full amount is deposited up front. After the window ends you can take back whatever was not claimed. Tokens that charge a fee on transfer are rejected.</p>
          <Button className="w-full gap-2" disabled={busy || !enough || !daysOk} onClick={create}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Approve and deposit
          </Button>
        </div>
      )}
    </div>
  );
}
