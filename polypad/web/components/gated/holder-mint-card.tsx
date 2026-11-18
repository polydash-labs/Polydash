'use client';

import Link from 'next/link';
import { Layers, Loader2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { Button } from '@/components/ui/button';
import { useGatedCollectionsOfToken } from '@/lib/hooks/use-gated-mint';
import { PHASE_HOLDER, PHASE_PUBLIC, gatedLive, isPolydashToken, phaseLabel, sameAddr } from '@/lib/gatedMint';
import { GatedNote } from './notes';

/** Token page card: holder mint collections linked to this token. Hidden while the factory is not set. */
export function HolderMintCard({ token, symbol, creator }: { token: string; symbol: string; creator?: string | null }) {
  const { address } = useAccount();
  const live = gatedLive() && !isPolydashToken(token);
  const q = useGatedCollectionsOfToken(live ? token : null);
  const isCreator = sameAddr(address, creator);
  const list = q.data ?? [];
  if (!live) return null;
  if (!list.length && !isCreator) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" strokeWidth={1.5} />
        <h3 className="text-[14px] font-semibold">Holder mint</h3>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">NFT collections linked to {symbol}. Holders of a minimum balance can mint first.</p>
      {q.isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : list.length > 0 ? (
        <div className="mt-3 space-y-2">
          {list.map((c) => (
            <Link key={c.address} href={`/nfts/holder/${c.address}`} className="block rounded-xl bg-secondary/30 p-3 transition-colors hover:bg-secondary/50">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{c.name}</span>
                <span className={c.phase === PHASE_HOLDER || c.phase === PHASE_PUBLIC ? 'text-[11px] text-polydash-green' : 'text-[11px] text-muted-foreground'}>
                  {!c.gated && c.phase === PHASE_PUBLIC ? 'Open mint' : phaseLabel(c.phase)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                {c.gated && <span>Holder {formatEther(c.holderPrice)} ETH</span>}
                <span>{c.publicPrice > BigInt(0) ? `Public ${formatEther(c.publicPrice)} ETH` : 'No public mint'}</span>
                <span>{c.totalMinted.toString()} / {c.maxSupply.toString()}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted-foreground">No holder mint collections yet.</p>
      )}
      {isCreator && (
        <Button asChild size="sm" className="mt-3 w-full">
          <Link href={`/nfts/create?type=holder&token=${token}`}>Create holder mint</Link>
        </Button>
      )}
      <GatedNote className="mt-3" />
    </div>
  );
}
