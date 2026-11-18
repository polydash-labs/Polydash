'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Minus, Plus } from 'lucide-react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatEther } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatTokens, shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { formatCountdown, useNow } from '@/lib/hooks/use-nft-collections';
import { useGatedCollection, useGatedTx, useGatedUser, type GatedDetail, type GatedUser } from '@/lib/hooks/use-gated-mint';
import {
  EOA_NOTE, PHASE_ENDED, PHASE_HOLDER, PHASE_NOT_STARTED, PHASE_PUBLIC, fmtDateTime, isAddr, phaseLabel, sameAddr, type Addr,
} from '@/lib/gatedMint';
import { GatedNote, HolderCheckNote } from '@/components/gated/notes';

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5';
const eth = (v: bigint) => `${formatEther(v)} ETH`;

export function HolderCollection({ collection }: { collection: string }) {
  const valid = isAddr(collection);
  const q = useGatedCollection(valid ? collection : null);
  const d = q.data;
  const user = useGatedUser(d ? d.address : undefined, d?.gated ? d.gateToken : undefined);

  if (!valid) return <Empty text="Not a valid collection address." />;
  if (q.isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (q.error) return <Empty text="Could not load this collection. Try again." />;
  if (!d) return <Empty text="Not a holder mint collection." />;

  return (
    <div className="mx-auto max-w-[900px] space-y-5 px-5 py-8 sm:py-12">
      <HeaderCard d={d} />
      <PhaseBanner d={d} />
      <MintPanel d={d} u={user.data} />
      <BurnPanel d={d} u={user.data} />
      <CreatorPanel d={d} />
      <PlatformRow d={d} />
      {d.gated && <HolderCheckNote />}
      <GatedNote />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mx-auto max-w-md px-5 py-24 text-center text-[14px] text-muted-foreground">{text}</div>;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-secondary/30 p-3">
      <p className="text-[11px] text-muted-foreground">{k}</p>
      <p className="mt-0.5 font-mono text-[13px]">{v}</p>
    </div>
  );
}

function HeaderCard({ d }: { d: GatedDetail }) {
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
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Holder mint</span>
          </div>
          <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{d.symbol}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Linked token{' '}
            <Link href={`/token/${d.gateToken}`} className="text-primary hover:underline">{d.tokenSymbol || shortenAddress(d.gateToken)}</Link>
            {' · '}by token creator{' '}
            <a href={getExplorerAddressUrl(d.creator)} target="_blank" rel="noreferrer" className="font-mono hover:underline">{shortenAddress(d.creator)}</a>
          </p>
        </div>
      </div>
      {d.description && <p className="mt-4 whitespace-pre-line text-[13px] text-muted-foreground">{d.description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat k="Minted" v={`${d.totalMinted.toString()} / ${d.maxSupply.toString()}`} />
        <Stat k="Floor per NFT" v={eth(d.floorPerToken)} />
        <Stat k="Floor vault" v={eth(d.floorReserve)} />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-polydash-green" style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Contract <a href={getExplorerAddressUrl(d.address)} target="_blank" rel="noreferrer" className="font-mono hover:underline">{shortenAddress(d.address)}</a>
      </p>
    </div>
  );
}

function PhaseBanner({ d }: { d: GatedDetail }) {
  const now = useNow();
  const left = (t: number) => (now == null ? '' : formatCountdown(Math.max(0, t - now)));
  const minBal = `${formatTokens(d.minBalance, d.tokenDecimals)} ${d.tokenSymbol}`.trim();
  let title = phaseLabel(d.phase);
  let body = '';
  if (d.phase === PHASE_NOT_STARTED) {
    body = d.gated
      ? `Holder phase starts in ${left(d.holderStart)} (${fmtDateTime(d.holderStart)}).`
      : `Mint starts in ${left(d.holderStart)} (${fmtDateTime(d.holderStart)}).`;
    if (!d.gated) title = 'Not started';
  } else if (d.phase === PHASE_HOLDER) {
    body = `Holders of at least ${minBal} can mint at ${formatEther(d.holderPrice)} ETH, up to ${d.holderMaxPerWallet} per wallet. ${d.publicPrice > BigInt(0) ? 'Public mint' : 'Holder phase ends'} in ${left(d.publicStart)}.`;
  } else if (d.phase === PHASE_PUBLIC) {
    title = d.gated ? 'Public mint' : 'Open mint';
    body = `${formatEther(d.publicPrice)} ETH, up to ${d.maxPerWallet} per wallet total.`;
  } else if (d.phase === PHASE_ENDED) {
    body = d.totalMinted >= d.maxSupply ? 'Every NFT has been minted.' : 'The holder phase has ended and this collection has no public mint.';
  }
  return (
    <div className={cn(card, 'flex flex-col gap-1')}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Phase</p>
      <p className="text-[16px] font-semibold">{title}</p>
      {body && <p className="text-[13px] text-muted-foreground">{body}</p>}
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

function MintPanel({ d, u }: { d: GatedDetail; u?: GatedUser }) {
  const { isConnected } = useAccount();
  const tx = useGatedTx();
  const [qty, setQty] = useState(1);
  const holderPhase = d.phase === PHASE_HOLDER;
  if (!holderPhase && d.phase !== PHASE_PUBLIC) return null;

  const supplyLeft = Number(d.maxSupply - d.totalMinted);
  const walletLeft = d.maxPerWallet - (u?.walletMinted ?? 0);
  const remaining = Math.max(0, holderPhase
    ? Math.min(d.holderMaxPerWallet - (u?.holderMinted ?? 0), walletLeft, supplyLeft)
    : Math.min(walletLeft, supplyLeft));
  const unit = holderPhase ? d.holderPrice : d.publicPrice;
  const q = Math.min(Math.max(1, qty), Math.max(1, remaining));
  const blocked = holderPhase && (!u?.isHolder || u?.isContract);

  const mint = () => tx.send({
    key: 'mint', address: d.address, abi: 'collection', functionName: holderPhase ? 'holderMint' : 'mint',
    args: [BigInt(q)], value: unit * BigInt(q), success: `Minted ${q} NFT${q === 1 ? '' : 's'}`,
  });

  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">{holderPhase ? 'Holder mint' : d.gated ? 'Public mint' : 'Mint'}</h3>
      {!isConnected ? (
        <div className="mt-3"><ConnectButton.Custom>{({ openConnectModal }) => <Button onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom></div>
      ) : (
        <div className="mt-3 space-y-3">
          {holderPhase && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Stat k={`Your ${d.tokenSymbol || 'token'} balance`} v={formatTokens(u?.tokenBalance ?? BigInt(0), d.tokenDecimals)} />
              <Stat k="Minimum balance" v={formatTokens(d.minBalance, d.tokenDecimals)} />
            </div>
          )}
          {holderPhase && u && (
            <p className={cn('text-[12px]', u.isHolder ? 'text-polydash-green' : 'text-muted-foreground')}>
              {u.isHolder ? 'This wallet meets the minimum balance right now.' : 'This wallet does not meet the minimum balance right now.'}
            </p>
          )}
          {holderPhase && u?.isContract && (
            <p className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-2.5 text-[12px] text-yellow-200">{EOA_NOTE}</p>
          )}
          <p className="text-[12px] text-muted-foreground">You can mint {remaining} more{holderPhase ? ' in the holder phase' : ''}. {formatEther(unit)} ETH each.</p>
          {remaining > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <QtyPicker qty={q} setQty={setQty} max={remaining} />
              <Button onClick={mint} disabled={!!tx.pending || blocked || !u} className="gap-2">
                {tx.pending === 'mint' && <Loader2 className="h-4 w-4 animate-spin" />}
                Mint {q} for {formatEther(unit * BigInt(q))} ETH
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BurnPanel({ d, u }: { d: GatedDetail; u?: GatedUser }) {
  const tx = useGatedTx();
  const [sel, setSel] = useState<string[]>([]);
  const ids = u?.tokenIds ?? [];
  if (!ids.length) return null;
  const chosen = ids.filter((id) => sel.includes(id.toString()));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const redeem = async () => {
    const r = await tx.send({ key: 'redeem', address: d.address, abi: 'collection', functionName: 'redeem', args: [chosen], success: 'Burned for floor' });
    if (r) setSel([]);
  };
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Burn for floor</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">Burn an NFT to receive {formatEther(d.floorPerToken)} ETH from the floor vault. Burned NFTs cannot be recovered.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ids.map((id) => {
          const k = id.toString();
          return (
            <button key={k} type="button" onClick={() => toggle(k)}
              className={cn('h-8 rounded-full border px-3 font-mono text-[12px]', sel.includes(k) ? 'border-primary bg-primary/10 text-primary' : 'border-white/10 bg-secondary/40 text-muted-foreground')}>
              #{k}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={redeem} disabled={!chosen.length || !!tx.pending} className="gap-2">
          {tx.pending === 'redeem' && <Loader2 className="h-4 w-4 animate-spin" />}
          Burn {chosen.length || ''} for {formatEther(d.floorPerToken * BigInt(chosen.length))} ETH
        </Button>
      </div>
    </div>
  );
}

function CreatorPanel({ d }: { d: GatedDetail }) {
  const { address } = useAccount();
  const tx = useGatedTx();
  const [payout, setPayout] = useState('');
  const [uri, setUri] = useState('');
  if (!sameAddr(address, d.creator)) return null;
  const uriOk = /^(https:\/\/|ipfs:\/\/|ar:\/\/).+\/$/.test(uri.trim()) && uri.trim().length <= 512;
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Creator</h3>
      <div className="mt-3 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Creator balance</p>
            <p className="font-mono text-[14px]">{eth(d.creatorBalance)}</p>
          </div>
          <Button onClick={() => tx.send({ key: 'withdraw', address: d.address, abi: 'collection', functionName: 'withdrawCreator', success: 'Withdrawn' })}
            disabled={d.creatorBalance === BigInt(0) || !!tx.pending} className="gap-2">
            {tx.pending === 'withdraw' && <Loader2 className="h-4 w-4 animate-spin" />} Withdraw
          </Button>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Payout wallet (now {shortenAddress(d.payoutWallet)})</label>
          <div className="flex gap-2">
            <Input value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0x…" className="bg-secondary/50 font-mono" />
            <Button variant="secondary" disabled={!isAddr(payout.trim()) || !!tx.pending}
              onClick={async () => { if (await tx.send({ key: 'payout', address: d.address, abi: 'collection', functionName: 'setPayoutWallet', args: [payout.trim() as Addr], success: 'Payout wallet updated' })) setPayout(''); }}>
              Update
            </Button>
          </div>
        </div>
        {!d.revealed && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Base URI (can be changed until the first mint, must end with /)</label>
            <div className="flex gap-2">
              <Input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="ipfs://bafy.../" className="bg-secondary/50 font-mono" />
              <Button variant="secondary" disabled={!uriOk || !!tx.pending}
                onClick={async () => { if (await tx.send({ key: 'uri', address: d.address, abi: 'collection', functionName: 'setBaseURI', args: [uri.trim()], success: 'Base URI updated' })) setUri(''); }}>
                Update
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlatformRow({ d }: { d: GatedDetail }) {
  const { isConnected } = useAccount();
  const tx = useGatedTx();
  if (d.platformBalance == null) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/20 px-4 py-2.5 text-[12px] text-muted-foreground">
      <span>Platform fee: <span className="font-mono">{eth(d.platformBalance)}</span></span>
      {isConnected && d.platformBalance > BigInt(0) && (
        <button type="button" disabled={!!tx.pending} className="text-primary hover:underline disabled:opacity-50"
          onClick={() => tx.send({ key: 'platform', address: d.address, abi: 'collection', functionName: 'withdrawPlatform', success: 'Platform fee sent' })}>
          Send to fee wallet
        </button>
      )}
    </div>
  );
}
