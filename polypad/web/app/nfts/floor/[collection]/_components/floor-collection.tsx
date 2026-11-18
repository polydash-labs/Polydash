'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Minus, Plus } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatEther } from 'viem';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTokens, shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { formatCountdown, useNow } from '@/lib/hooks/use-nft-collections';
import { useFloorCollection, useFloorTx, useFloorUser, type FloorDetail, type FloorUser } from '@/lib/hooks/use-floor-vault';
import { BUY_EXPLAIN, BUY_WHAT, SHARE_ENDED, fmtDateTime, floorStep, isAddr, switchAvailableAt } from '@/lib/floorVault';
import { FloorContractLinks, FloorRiskNote } from '@/components/floor-vault/notes';
import { BurnPanel, CreatorPanel, PlatformRow } from './floor-panels';

export const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5';
export const eth = (v: bigint) => `${formatEther(v)} ETH`;
export const tok = (v: bigint, d: FloorDetail) => `${formatTokens(v, d.tokenDecimals)} ${d.tokenSymbol}`.trim();

export function FloorCollection({ collection }: { collection: string }) {
  const valid = isAddr(collection);
  const q = useFloorCollection(valid ? collection : null);
  const d = q.data;
  const user = useFloorUser(d ? d.address : undefined);

  if (!valid) return <Empty text="Not a valid collection address." />;
  if (q.isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (q.error) return <Empty text="Could not load this collection. Try again." />;
  if (!d) return <Empty text="Not a token-backed floor collection." />;

  return (
    <div className="mx-auto max-w-[900px] space-y-5 px-5 py-8 sm:py-12">
      <HeaderCard d={d} />
      <MintPanel d={d} u={user.data} />
      <VaultCard d={d} />
      <VaultBuyPanel d={d} />
      <SwitchPanel d={d} />
      <BurnPanel d={d} u={user.data} />
      <CreatorPanel d={d} />
      <PlatformRow d={d} />
      <FloorRiskNote symbol={d.tokenSymbol} />
      <FloorContractLinks />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mx-auto max-w-md px-5 py-24 text-center text-[14px] text-muted-foreground">{text}</div>;
}

export function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-secondary/30 p-3">
      <p className="text-[11px] text-muted-foreground">{k}</p>
      <p className="mt-0.5 break-all font-mono text-[13px]">{v}</p>
    </div>
  );
}

function HeaderCard({ d }: { d: FloorDetail }) {
  const pct = d.maxSupply > BigInt(0) ? Number((d.totalMinted * BigInt(10000)) / d.maxSupply) / 100 : 0;
  return (
    <div className={card}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-white/5">
          {d.imageUri && <img src={d.imageUri} alt={`${d.name} cover`} className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[20px] font-semibold">{d.name}</h1>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Token-backed floor</span>
          </div>
          <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{d.symbol}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Linked token{' '}
            <Link href={`/token/${d.token}`} className="text-primary hover:underline">{d.tokenSymbol || shortenAddress(d.token)}</Link>
            {' · '}by token creator{' '}
            <a href={getExplorerAddressUrl(d.creator)} target="_blank" rel="noreferrer" className="font-mono hover:underline">{shortenAddress(d.creator)}</a>
          </p>
        </div>
      </div>
      {d.description && <p className="mt-4 whitespace-pre-line text-[13px] text-muted-foreground">{d.description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat k="Minted" v={`${d.totalMinted.toString()} / ${d.maxSupply.toString()}`} />
        <Stat k="Mint price" v={eth(d.price)} />
        <Stat k="Token share of vault" v={`${d.tokenShareBps / 100}%`} />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-polydash-green" style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Contract <a href={getExplorerAddressUrl(d.address)} target="_blank" rel="noreferrer" className="font-mono hover:underline">{shortenAddress(d.address)}</a>
      </p>
    </div>
  );
}

function QtyPicker({ qty, setQty, max }: { qty: number; setQty: (n: number) => void; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="icon" variant="secondary" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty(Math.max(1, qty - 1))}><Minus className="h-4 w-4" /></Button>
      <span className="w-10 text-center font-mono text-[15px]">{qty}</span>
      <Button type="button" size="icon" variant="secondary" aria-label="Increase quantity" disabled={qty >= max} onClick={() => setQty(Math.min(max, qty + 1))}><Plus className="h-4 w-4" /></Button>
    </div>
  );
}

function MintPanel({ d, u }: { d: FloorDetail; u?: FloorUser }) {
  const { isConnected } = useAccount();
  const tx = useFloorTx();
  const now = useNow();
  const [qty, setQty] = useState(1);
  const supplyLeft = Number(d.maxSupply - d.totalMinted);
  if (supplyLeft <= 0) return <div className={cn(card, 'text-[13px] text-muted-foreground')}>Every NFT has been minted.</div>;
  const started = now != null && now >= d.startTime;
  const walletLeft = d.maxPerWallet > 0 ? d.maxPerWallet - (u?.walletMinted ?? 0) : supplyLeft;
  const remaining = Math.max(0, Math.min(walletLeft, supplyLeft));
  const q = Math.min(Math.max(1, qty), Math.max(1, remaining));
  const mint = () => tx.send({
    key: 'mint', address: d.address, abi: 'collection', functionName: 'mint',
    args: [BigInt(q)], value: d.price * BigInt(q), success: `Minted ${q} NFT${q === 1 ? '' : 's'}`,
  });
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Mint</h3>
      {now != null && !started ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Mint starts in {formatCountdown(Math.max(0, d.startTime - now))} ({fmtDateTime(d.startTime)}).</p>
      ) : !isConnected ? (
        <div className="mt-3"><ConnectButton.Custom>{({ openConnectModal }) => <Button onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom></div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-muted-foreground">
            You can mint {remaining} more{d.maxPerWallet > 0 ? ` (limit ${d.maxPerWallet} per wallet)` : ''}. {formatEther(d.price)} ETH each.
          </p>
          {remaining > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <QtyPicker qty={q} setQty={setQty} max={remaining} />
              <Button onClick={mint} disabled={!!tx.pending || !u || !started} className="gap-2">
                {tx.pending === 'mint' && <Loader2 className="h-4 w-4 animate-spin" />}
                Mint {q} for {formatEther(d.price * BigInt(q))} ETH
              </Button>
            </div>
          )}
          {tx.lastError?.key === 'mint' && <p className="text-[12px] text-red-400">{tx.lastError.text}</p>}
        </div>
      )}
    </div>
  );
}

interface HistoryItem { type: string; txHash: string; blockNumber: string; ethIn?: string; tokensOut?: string }

function useBuyHistory(c: string) {
  return useQuery({
    queryKey: ['floor', 'history', c.toLowerCase()],
    refetchInterval: 30_000,
    queryFn: async (): Promise<HistoryItem[]> => {
      const r = await fetch(`/api/floor-vault/${c}`);
      if (!r.ok) throw new Error(`history ${r.status}`);
      const j = await r.json();
      return Array.isArray(j.history) ? j.history : [];
    },
  });
}

function VaultCard({ d }: { d: FloorDetail }) {
  const h = useBuyHistory(d.address);
  const buys = (h.data ?? []).filter((x) => x.type === 'TokenBought');
  const last = buys[0];
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Floor vault</h3>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat k="ETH in vault" v={eth(d.ethFloor)} />
        <Stat k="ETH waiting to swap" v={eth(d.pendingEth)} />
        <Stat k={`${d.tokenSymbol || 'Token'} held`} v={tok(d.tokenReserve, d)} />
      </div>
      <div className="mt-2 rounded-xl bg-secondary/30 p-3">
        <p className="text-[11px] text-muted-foreground">Burn value per NFT right now</p>
        <p className="mt-0.5 font-mono text-[14px]">{formatEther(d.perNftEth)} ETH + {tok(d.perNftToken, d)}</p>
      </div>
      <p className={cn('mt-3 text-[13px]', d.graduated ? 'text-polydash-green' : 'text-muted-foreground')}>
        {d.graduated ? 'Token graduated, vault buys open' : 'Waiting for graduation; waiting ETH is paid out as ETH on burn'}
      </p>
      {!d.tokenShareActive && <p className="mt-1 text-[13px] text-muted-foreground">{SHARE_ENDED}</p>}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Stat k="Total ETH swapped" v={eth(d.totalEthSwapped)} />
        <Stat k={`Total ${d.tokenSymbol || 'tokens'} bought`} v={tok(d.totalTokensBought, d)} />
      </div>
      <div className="mt-3 text-[12px] text-muted-foreground">
        {d.lastBuyTime > 0 ? (
          <p>
            Last vault buy {fmtDateTime(d.lastBuyTime)}
            {last?.ethIn && last?.tokensOut && <> · {formatEther(BigInt(last.ethIn))} ETH in, {tok(BigInt(last.tokensOut), d)} out</>}
            {last?.txHash && (
              <> · <a href={getExplorerTxUrl(last.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">tx <ExternalLink className="h-3 w-3" /></a></>
            )}
          </p>
        ) : <p>No vault buys yet.</p>}
      </div>
    </div>
  );
}

function VaultBuyPanel({ d }: { d: FloorDetail }) {
  const now = useNow();
  const tx = useFloorTx();
  const { isConnected } = useAccount();
  if (!d.graduated || !d.tokenShareActive || d.pendingEth <= BigInt(0) || now == null) return null;
  const s = floorStep({ graduated: d.graduated, tokenShareActive: d.tokenShareActive, pendingEth: d.pendingEth, obsTime: d.obsTime, lastBuyTime: d.lastBuyTime }, now);
  const amount = d.pendingEth < d.maxBuyEth ? d.pendingEth : d.maxBuyEth;
  const left = (t: number | null) => (t == null ? '' : formatCountdown(Math.max(0, t - now)));
  const err = tx.lastError && (tx.lastError.key === 'observe' || tx.lastError.key === 'buy') ? tx.lastError.text : null;
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Run vault buy</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">{BUY_WHAT}</p>
      <p className="mt-2 text-[12px] text-muted-foreground">{BUY_EXPLAIN}</p>
      <p className="mt-3 text-[13px]">Next batch: <span className="font-mono">{formatEther(amount)} ETH</span> (max {formatEther(d.maxBuyEth)} ETH per buy, slippage limit {d.maxSlippageBps / 100}%)</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-secondary/30 p-3">
          <p className="text-[11px] text-muted-foreground">Step 1</p>
          <p className="text-[13px] font-medium">Record price</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {s.recordReady ? 'Ready now.' : `Recorded ${fmtDateTime(d.obsTime)}. A new one can be recorded in ${left(s.obsExpiresAt != null ? s.obsExpiresAt + 1 : null)}.`}
          </p>
          <Button size="sm" className="mt-2 gap-2" disabled={!isConnected || !s.recordReady || !!tx.pending}
            onClick={() => tx.send({ key: 'observe', address: d.address, abi: 'collection', functionName: 'observePrice', success: 'Price recorded' })}>
            {tx.pending === 'observe' && <Loader2 className="h-4 w-4 animate-spin" />} Record price
          </Button>
        </div>
        <div className="rounded-xl bg-secondary/30 p-3">
          <p className="text-[11px] text-muted-foreground">Step 2</p>
          <p className="text-[13px] font-medium">Buy</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {s.buyReady
              ? `Open now, closes in ${left(s.obsExpiresAt)}.`
              : s.step === 'wait' && s.upcoming === 'buy' ? `Opens in ${left(s.buyOpensAt)}.` : 'Record a price first.'}
          </p>
          <Button size="sm" className="mt-2 gap-2" disabled={!isConnected || !s.buyReady || !!tx.pending}
            onClick={() => tx.send({ key: 'buy', address: d.address, abi: 'collection', functionName: 'buyToken', success: 'Vault buy complete' })}>
            {tx.pending === 'buy' && <Loader2 className="h-4 w-4 animate-spin" />} Buy
          </Button>
        </div>
      </div>
      {!isConnected && <p className="mt-2 text-[12px] text-muted-foreground">Connect a wallet to run a step. The caller pays gas.</p>}
      {err && <p className="mt-2 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}

function SwitchPanel({ d }: { d: FloorDetail }) {
  const now = useNow();
  const tx = useFloorTx();
  const { isConnected } = useAccount();
  if (d.graduated || !d.tokenShareActive || now == null || now < switchAvailableAt(d.createdAt)) return null;
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Switch to ETH-only</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">
        The token has not graduated within 180 days of this collection. Anyone can end the token share; ETH waiting to swap then stays in the vault as ETH and new mints add ETH only.
      </p>
      <Button variant="secondary" className="mt-3 gap-2" disabled={!isConnected || !!tx.pending}
        onClick={() => tx.send({ key: 'switch', address: d.address, abi: 'collection', functionName: 'endTokenShare', success: 'Switched to ETH-only' })}>
        {tx.pending === 'switch' && <Loader2 className="h-4 w-4 animate-spin" />} Switch to ETH-only
      </Button>
      {tx.lastError?.key === 'switch' && <p className="mt-2 text-[12px] text-red-400">{tx.lastError.text}</p>}
    </div>
  );
}
