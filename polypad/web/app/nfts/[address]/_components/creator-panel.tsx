'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEth, shortenAddress } from '@/lib/format';
import type { NftCollection } from '@/lib/hooks/use-nft-collections';
import { useCollectionTx } from './use-tx';

export function CreatorPanel({ c, now }: { c: NftCollection; now: number | null }) {
  const { address } = useAccount();
  const { send, pending } = useCollectionTx(c.address);
  const [uri, setUri] = useState('');
  if (!address || address.toLowerCase() !== c.creator.toLowerCase()) return null;
  const open = now != null && BigInt(now) < c.commitEnd;
  const uriOk = /^(https:\/\/|ipfs:\/\/|ar:\/\/).+\/$/.test(uri.trim()) && uri.trim().length <= 512;

  return (
    <div className="glass-card space-y-4 p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-white">Creator</h2>
      <div className="space-y-1.5 text-[12px]">
        <div className="flex justify-between"><span className="text-white/50">Proceeds available</span><span className="font-mono text-white">{formatEth(c.creatorBalance, 6)} ETH</span></div>
        <div className="flex justify-between"><span className="text-white/50">Paid to</span><span className="font-mono text-white">{shortenAddress(c.payoutWallet)}</span></div>
      </div>
      <Button className="w-full gap-2" disabled={!!pending || c.creatorBalance === BigInt(0)} onClick={() => send('withdraw-creator', 'withdrawCreator', [], undefined, 'Proceeds withdrawn')}>
        {pending === 'withdraw-creator' && <Loader2 className="h-4 w-4 animate-spin" />}
        Withdraw proceeds
      </Button>
      {open && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <label className="block text-[12px] text-white/50">Update metadata base URI (until the window ends)</label>
          <Input value={uri} onChange={(e) => setUri(e.target.value)} placeholder={c.baseURI || 'ipfs://.../'} className="bg-secondary/50 font-mono" />
          <Button variant="secondary" className="w-full gap-2" disabled={!!pending || !uriOk} onClick={async () => { if (await send('base-uri', 'setBaseURI', [uri.trim()], undefined, 'Base URI updated')) setUri(''); }}>
            {pending === 'base-uri' && <Loader2 className="h-4 w-4 animate-spin" />}
            Save base URI
          </Button>
        </div>
      )}
    </div>
  );
}
