'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { shortenAddress } from '@/lib/format';
import { useFloorTx, type FloorDetail, type FloorUser } from '@/lib/hooks/use-floor-vault';
import { BURN_NOTE, CREATOR_NOTE, OWED_NOTE, isAddr, sameAddr, type Addr } from '@/lib/floorVault';
import { FloorRiskNote } from '@/components/floor-vault/notes';
import { card, eth, tok } from './floor-collection';

export function BurnPanel({ d, u }: { d: FloorDetail; u?: FloorUser }) {
  const tx = useFloorTx();
  const [sel, setSel] = useState<string[]>([]);
  const ids = u?.tokenIds ?? [];
  const owed = u?.tokenOwed ?? BigInt(0);
  if (!ids.length && owed <= BigInt(0)) return null;
  const chosen = ids.filter((id) => sel.includes(id.toString()));
  const n = BigInt(chosen.length);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const redeem = async () => {
    const r = await tx.send({ key: 'redeem', address: d.address, abi: 'collection', functionName: 'redeem', args: [chosen], success: 'Burned' });
    if (r) setSel([]);
  };
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Burn for vault share</h3>
      {ids.length > 0 && (
        <>
          <p className="mt-1 text-[12px] text-muted-foreground">Select NFTs to burn. Burned NFTs cannot be recovered.</p>
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
          <p className="mt-3 text-[13px]">
            You receive about <span className="font-mono">{formatEther(d.perNftEth * n)} ETH + {tok(d.perNftToken * n, d)}</span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{BURN_NOTE}</p>
          <Button variant="secondary" onClick={redeem} disabled={!chosen.length || !!tx.pending} className="mt-3 gap-2">
            {tx.pending === 'redeem' && <Loader2 className="h-4 w-4 animate-spin" />}
            Burn {chosen.length || ''} NFT{chosen.length === 1 ? '' : 's'}
          </Button>
          {tx.lastError?.key === 'redeem' && <p className="mt-2 text-[12px] text-red-400">{tx.lastError.text}</p>}
        </>
      )}
      {owed > BigInt(0) && (
        <div className="mt-4 rounded-xl bg-secondary/30 p-3">
          <p className="text-[13px]">Tokens owed to you: <span className="font-mono">{tok(owed, d)}</span></p>
          <p className="mt-1 text-[11px] text-muted-foreground">{OWED_NOTE}</p>
          <Button size="sm" className="mt-2 gap-2" disabled={!!tx.pending}
            onClick={() => tx.send({ key: 'claim', address: d.address, abi: 'collection', functionName: 'claimOwedToken', success: 'Tokens claimed' })}>
            {tx.pending === 'claim' && <Loader2 className="h-4 w-4 animate-spin" />} Claim tokens
          </Button>
          {tx.lastError?.key === 'claim' && <p className="mt-2 text-[12px] text-red-400">{tx.lastError.text}</p>}
        </div>
      )}
      <FloorRiskNote symbol={d.tokenSymbol} className="mt-4" />
    </div>
  );
}

export function CreatorPanel({ d }: { d: FloorDetail }) {
  const { address } = useAccount();
  const tx = useFloorTx();
  const [payout, setPayout] = useState('');
  const [uri, setUri] = useState('');
  if (!sameAddr(address, d.creator)) return null;
  const uriOk = /^(https:\/\/|ipfs:\/\/|ar:\/\/).+\/$/.test(uri.trim()) && uri.trim().length <= 512;
  return (
    <div className={card}>
      <h3 className="text-[14px] font-semibold">Creator</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">{CREATOR_NOTE}</p>
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
        {d.totalMinted === BigInt(0) && (
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
        {tx.lastError && ['withdraw', 'payout', 'uri'].includes(tx.lastError.key) && <p className="text-[12px] text-red-400">{tx.lastError.text}</p>}
      </div>
    </div>
  );
}

export function PlatformRow({ d }: { d: FloorDetail }) {
  const { isConnected } = useAccount();
  const tx = useFloorTx();
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
