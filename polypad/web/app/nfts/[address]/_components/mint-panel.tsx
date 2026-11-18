'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatEth } from '@/lib/format';
import { collectionStatus, formatCountdown, useNftUser, type NftCollection } from '@/lib/hooks/use-nft-collections';
import { useCollectionTx } from './use-tx';
import { OnrampInline } from '@/components/onramp/buy-eth';

const Z = BigInt(0);

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

export function MintPanel({ c, now }: { c: NftCollection; now: number | null }) {
  const { address: user, isConnected } = useAccount();
  const { data: u } = useNftUser(c.address, user);
  const { send, pending } = useCollectionTx(c.address);
  const [qty, setQty] = useState(1);
  const [wqty, setWqty] = useState(1);
  const st = collectionStatus(c, now);
  const committed = u?.committed ?? Z;
  const remainingCommit = Number(c.maxPerWallet - committed);
  const remainingMint = Number(c.maxPerWallet - (u?.walletMinted ?? Z));
  const oversub = c.totalCommitted > c.maxSupply;
  const refund = u ? (u.committed - u.allocation) * c.mintPrice : Z;
  const busy = (k: string) => pending === k;

  return (
    <div className="glass-card space-y-4 p-4 sm:p-5">
      {st === 'commit' && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">Commit</h2>
            {now != null && <span className="font-mono text-[12px] text-white/60">Ends in {formatCountdown(Number(c.commitEnd) - now)}</span>}
          </div>
          <div className="space-y-1.5">
            <Row k="Committed" v={`${c.totalCommitted.toString()} / ${c.maxSupply.toString()}`} />
            <Row k="Committers" v={c.committerCount.toString()} />
            {oversub && <Row k="Oversubscribed" v={`${(Number(c.totalCommitted) / Number(c.maxSupply)).toFixed(2)}x`} />}
          </div>
          {isConnected && (
            <div className="space-y-1.5 rounded-xl bg-white/[0.04] p-3">
              <Row k="You committed" v={committed.toString()} />
              <Row k="You would get now" v={u ? u.allocation.toString() : '-'} />
              {refund > Z && <Row k="Refund at claim" v={`${formatEth(refund, 6)} ETH`} />}
            </div>
          )}
          {!isConnected ? <Connect /> : remainingCommit > 0 ? (
            <div className="flex items-center gap-2">
              <Qty value={Math.min(qty, remainingCommit)} onChange={setQty} max={remainingCommit} />
              <Button className="flex-1 gap-2" disabled={!!pending} onClick={async () => { const n = Math.min(qty, remainingCommit); if (await send('commit', 'commit', [BigInt(n)], c.mintPrice * BigInt(n), 'Committed')) setQty(1); }}>
                {busy('commit') && <Loader2 className="h-4 w-4 animate-spin" />}
                Commit {formatEth(c.mintPrice * BigInt(Math.min(qty, remainingCommit)), 6)} ETH
              </Button>
            </div>
          ) : (
            <p className="text-[12px] text-white/50">You reached the per-wallet limit of {c.maxPerWallet.toString()}.</p>
          )}
          {committed > Z && (
            <div className="flex items-center gap-2">
              <Qty value={Math.min(wqty, Number(committed))} onChange={setWqty} max={Number(committed)} />
              <Button variant="secondary" className="flex-1 gap-2" disabled={!!pending} onClick={() => send('withdraw', 'withdrawCommit', [BigInt(Math.min(wqty, Number(committed)))], undefined, 'Withdrawn')}>
                {busy('withdraw') && <Loader2 className="h-4 w-4 animate-spin" />}
                Withdraw
              </Button>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-white/40">
            Everyone pays {formatEth(c.mintPrice, 6)} ETH per NFT. If more than {c.maxSupply.toString()} are committed, each committer gets the same share rounded down and the rest is refunded when claiming. You can withdraw until the window ends.
          </p>
        </>
      )}

      {st !== 'commit' && isConnected && u && committed > Z && (
        <div className="space-y-3">
          <h2 className="text-[15px] font-semibold text-white">Your commitment</h2>
          <div className="space-y-1.5 rounded-xl bg-white/[0.04] p-3">
            <Row k="Committed" v={committed.toString()} />
            <Row k="Allocation" v={u.allocation.toString()} />
            <Row k="Refund" v={`${formatEth(refund, 6)} ETH`} />
          </div>
          {u.claimed ? (
            <p className="text-[12px] text-polydash-green">Claimed.</p>
          ) : (
            <Button className="w-full gap-2" disabled={!!pending} onClick={() => send('claim', 'claim', [], undefined, 'Claimed')}>
              {busy('claim') && <Loader2 className="h-4 w-4 animate-spin" />}
              Claim {u.allocation.toString()} NFT{u.allocation === BigInt(1) ? '' : 's'}{refund > Z ? ` + ${formatEth(refund, 6)} ETH refund` : ''}
            </Button>
          )}
        </div>
      )}

      {(st === 'mint' || st === 'claim' || st === 'minted-out') && (
        <div className="space-y-3">
          <h2 className="text-[15px] font-semibold text-white">Mint</h2>
          <Row k="Available now" v={`${c.publicAvailable.toString()} of ${c.maxSupply.toString()}`} />
          {st === 'claim' && <p className="text-[12px] text-white/50">Committers are still claiming. Leftover supply opens once every committer has claimed.</p>}
          {st === 'minted-out' && <p className="text-[12px] text-white/50">Minted out.</p>}
          {st === 'mint' && (!isConnected ? <Connect /> : remainingMint > 0 ? (
            <div className="flex items-center gap-2">
              <Qty value={Math.min(qty, remainingMint, Number(c.publicAvailable))} onChange={setQty} max={Math.min(remainingMint, Number(c.publicAvailable))} />
              <Button className="flex-1 gap-2" disabled={!!pending} onClick={async () => {
                const n = Math.min(qty, remainingMint, Number(c.publicAvailable));
                if (await send('mint', 'mint', [BigInt(n)], c.mintPrice * BigInt(n), 'Minted')) setQty(1);
              }}>
                {busy('mint') && <Loader2 className="h-4 w-4 animate-spin" />}
                Mint for {formatEth(c.mintPrice * BigInt(Math.min(qty, remainingMint, Number(c.publicAvailable))), 6)} ETH
              </Button>
            </div>
          ) : (
            <p className="text-[12px] text-white/50">You reached the per-wallet limit of {c.maxPerWallet.toString()}.</p>
          ))}
          {st === 'mint' && <OnrampInline />}
        </div>
      )}
    </div>
  );
}

function Connect() {
  return (
    <ConnectButton.Custom>
      {({ openConnectModal }) => <Button className="w-full" onClick={openConnectModal}>Connect wallet</Button>}
    </ConnectButton.Custom>
  );
}
