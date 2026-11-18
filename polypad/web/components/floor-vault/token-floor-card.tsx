'use client';

import Link from 'next/link';
import { Landmark, Loader2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { Button } from '@/components/ui/button';
import { formatTokens } from '@/lib/format';
import { useFloorCollectionsOfToken, useFloorToken } from '@/lib/hooks/use-floor-vault';
import { floorLive, isPolydashToken, sameAddr } from '@/lib/floorVault';
import { FloorRiskNote } from './notes';

/** Token page card: token-backed floor collections for this token. Hidden while the factory is not set. */
export function TokenFloorCard({ token, symbol, creator }: { token: string; symbol: string; creator?: string | null }) {
  const { address } = useAccount();
  const live = floorLive() && !isPolydashToken(token);
  const q = useFloorCollectionsOfToken(live ? token : null);
  const t = useFloorToken(live && address ? token : null);
  const isCreator = !!address && (t.data?.isCreator || sameAddr(address, creator));
  const list = q.data ?? [];
  if (!live) return null;
  if (!list.length && !isCreator) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Landmark className="h-4 w-4 text-primary" strokeWidth={1.5} />
        <h3 className="text-[14px] font-semibold">Token-backed collections</h3>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">NFT collections whose floor vault holds ETH and {symbol}.</p>
      {q.isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : list.length > 0 ? (
        <div className="mt-3 space-y-2">
          {list.map((c) => (
            <Link key={c.address} href={`/nfts/floor/${c.address}`} className="block rounded-xl bg-secondary/30 p-3 transition-colors hover:bg-secondary/50">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{c.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{c.totalMinted.toString()} / {c.maxSupply.toString()}</span>
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <span>Token share {c.tokenShareBps / 100}%</span>
                <span>Vault {formatEther(c.ethFloor + c.pendingEth)} ETH</span>
                <span>{formatTokens(c.tokenReserve, c.tokenDecimals)} {c.tokenSymbol || symbol} held</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted-foreground">No token-backed collections yet.</p>
      )}
      {isCreator && (
        <Button asChild size="sm" className="mt-3 w-full">
          <Link href={`/nfts/create?type=floor&token=${token}`}>Create token-backed collection</Link>
        </Button>
      )}
      <FloorRiskNote symbol={symbol} className="mt-3" />
    </div>
  );
}
