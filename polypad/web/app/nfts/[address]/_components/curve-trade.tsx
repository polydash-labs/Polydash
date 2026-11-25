'use client';

import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { type Abi } from 'viem';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatEth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { robinhoodChain } from '@/lib/chain';
import { CurveCollectionABI } from '@/lib/contracts/nft-market-abis';
import { useOwnedTokenIds, type CurveCollection } from '@/lib/hooks/use-curve-collections';
import { useContractTx } from './use-tx';
import { OnrampInline } from '@/components/onramp/buy-eth';

const MAX_PER_TX = 50;
const SLIPPAGE_BPS = BigInt(200);
const BPS = BigInt(10_000);

function Qty({ value, onChange, max }: { value: number; onChange: (n: number) => void; max: number }) {
  const set = (n: number) => onChange(Math.max(1, Math.min(Math.max(1, max), n)));
  return (
    <div className="flex h-9 items-center rounded-full border border-white/10 bg-white/[0.03]">
      <button type="button" aria-label="Decrease" onClick={() => set(value - 1)} className="h-full w-9 text-white/60 hover:text-white">-</button>
      <input
        type="number" inputMode="numeric" value={value}
        onChange={(e) => set(Number(e.target.value) || 1)}
        className="h-full w-12 bg-transparent text-center font-mono text-[16px] text-white focus:outline-none sm:text-[13px]"
      />
      <button type="button" aria-label="Increase" onClick={() => set(value + 1)} className="h-full w-9 text-white/60 hover:text-white">+</button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[12px]">
      <span className="text-white/50">{k}</span>
      <span className="text-right font-mono text-white">{v}</span>
    </div>
  );
}

export function CurveTradePanel({ c }: { c: CurveCollection }) {
  const { address: user } = useAccount();
  const { data: owned } = useOwnedTokenIds(c.address, user, true);
  const { call, pending } = useContractTx();
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState(1);
  const left = Number(c.maxSupply - c.circulating);
  const held = owned?.length ?? 0;
  const max = tab === 'buy' ? Math.min(MAX_PER_TX, left) : Math.min(MAX_PER_TX, held, Number(c.circulating));
  const q = Math.max(1, Math.min(qty, Math.max(1, max)));
  const base = { address: c.address, abi: CurveCollectionABI, chainId: robinhoodChain.id } as const;
  const { data: buyQ } = useReadContract({ ...base, functionName: 'quoteBuy', args: [BigInt(q)], query: { enabled: tab === 'buy' && !c.graduated && left > 0, refetchInterval: 10_000 } });
  const { data: sellQ } = useReadContract({ ...base, functionName: 'quoteSell', args: [BigInt(q)], query: { enabled: tab === 'sell' && !c.graduated && held > 0, refetchInterval: 10_000 } });
  const feePct = Number(c.creatorFeeBps) / 100;

  if (c.graduated) {
    return (
      <div className="glass-card space-y-2 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-white">Graduated</h2>
        <p className="text-[12px] leading-relaxed text-white/60">
          All {c.maxSupply.toString()} NFTs sold and the curve is closed. Each NFT can be burned for {formatEth(c.floorPerToken, 6)} ETH from the floor vault, or traded on the marketplace.
        </p>
      </div>
    );
  }

  const buy = async () => {
    if (!buyQ) return;
    const total = (buyQ as readonly bigint[])[0];
    const maxTotal = total + (total * SLIPPAGE_BPS) / BPS;
    if (await call({ key: 'curve-buy', address: c.address, abi: CurveCollectionABI as Abi, functionName: 'buy', args: [BigInt(q), maxTotal], value: maxTotal, success: `Bought ${q}` })) setQty(1);
  };
  const sell = async () => {
    if (!sellQ || !owned) return;
    const net = (sellQ as readonly bigint[])[0];
    const ids = owned.slice(-q);
    if (await call({ key: 'curve-sell', address: c.address, abi: CurveCollectionABI as Abi, functionName: 'sell', args: [ids, net - (net * SLIPPAGE_BPS) / BPS], success: `Sold ${q} to the pool` })) setQty(1);
  };

  return (
    <div className="glass-card space-y-4 p-4 sm:p-5">
      <div className="flex gap-1 rounded-full bg-white/[0.04] p-1">
        {(['buy', 'sell'] as const).map((t) => (
          <button key={t} type="button" onClick={() => { setTab(t); setQty(1); }} className={cn('flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium capitalize', tab === t ? 'bg-white text-black' : 'text-white/60 hover:text-white')}>{t}</button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-white/50">Quantity</span>
        <Qty value={q} onChange={setQty} max={max} />
      </div>

      {tab === 'buy' ? (
        <div className="space-y-1.5">
          <Row k="Next NFT" v={`${formatEth(c.nextPrice, 6)} ETH`} />
          <Row k="Price" v={buyQ ? `${formatEth((buyQ as readonly bigint[])[1], 6)} ETH` : '-'} />
          <Row k="You pay (incl. fees)" v={buyQ ? `${formatEth((buyQ as readonly bigint[])[0], 6)} ETH` : '-'} />
          <p className="pt-1 text-[11px] text-white/40">Includes a {feePct}% creator fee. Each purchase raises the price of the next NFT. Up to 2% price movement is allowed; anything unused is refunded.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Row k="You hold" v={String(held)} />
          <Row k="Curve value" v={sellQ ? `${formatEth((sellQ as readonly bigint[])[1], 6)} ETH` : '-'} />
          <Row k="You receive (after fees)" v={sellQ ? `${formatEth((sellQ as readonly bigint[])[0], 6)} ETH` : '-'} />
          <p className="pt-1 text-[11px] text-white/40">Selling returns NFTs to the pool at the current curve price, minus fees including a {feePct}% creator fee. Your highest token ids are sold first.</p>
        </div>
      )}

      {!user ? (
        <ConnectButton.Custom>{({ openConnectModal }) => <Button className="w-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
      ) : tab === 'buy' ? (
        <Button className="w-full gap-2" disabled={!buyQ || left <= 0 || !!pending} onClick={buy}>
          {pending === 'curve-buy' && <Loader2 className="h-4 w-4 animate-spin" />} {left <= 0 ? 'Sold out' : `Buy ${q}`}
        </Button>
      ) : (
        <Button className="w-full gap-2" disabled={!sellQ || held === 0 || !!pending} onClick={sell}>
          {pending === 'curve-sell' && <Loader2 className="h-4 w-4 animate-spin" />} {held === 0 ? 'Nothing to sell' : `Sell ${q} to pool`}
        </Button>
      )}
      {tab === 'buy' && <OnrampInline />}
    </div>
  );
}

export function CurveCreatorPanel({ c }: { c: CurveCollection }) {
  const { address: user } = useAccount();
  const { call, pending } = useContractTx();
  if (!user || user.toLowerCase() !== c.creator.toLowerCase()) return null;
  return (
    <div className="glass-card space-y-3 p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-white">Creator</h2>
      <Row k="Available to withdraw" v={`${formatEth(c.creatorBalance, 6)} ETH`} />
      <p className="text-[11px] text-white/40">Creator fees from every curve trade, plus the reserve share not sent to the floor vault at graduation. Paid to {c.payoutWallet.slice(0, 6)}...{c.payoutWallet.slice(-4)}.</p>
      <Button variant="secondary" className="w-full gap-2" disabled={c.creatorBalance === BigInt(0) || !!pending} onClick={() => call({ key: 'curve-withdraw', address: c.address, abi: CurveCollectionABI as Abi, functionName: 'withdrawCreator', success: 'Withdrawn' })}>
        {pending === 'curve-withdraw' && <Loader2 className="h-4 w-4 animate-spin" />} Withdraw
      </Button>
    </div>
  );
}
