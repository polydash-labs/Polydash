'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { ArrowUpRight, Loader2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTokens, shortenAddress } from '@/lib/format';
import { BOND_NOTE, BOND_NOT_LIVE, bondFactory, fmtDate, sameAddr } from '@/lib/bond';
import { useBondsByToken } from '@/lib/hooks/use-bond';
import { BadgePill, Limitations, StatusPill } from './notes';

export function CreatorBondCard({ token, symbol, decimals = 18, creator }: { token: string; symbol: string; decimals?: number; creator?: string | null }) {
  const live = !!bondFactory();
  const { address: user } = useAccount();
  const isCreator = sameAddr(user, creator);
  const { data: rows = [], isLoading, isError } = useBondsByToken(live ? token : null);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-white/70" strokeWidth={1.5} />
          <h3 className="text-[14px] font-semibold text-white">Creator bond</h3>
        </div>
        {isCreator && (live ? (
          <Button asChild size="sm" className="h-8 rounded-full px-3 text-[12px]">
            <Link href={`/bond/create?token=${token}`}>Post a bond</Link>
          </Button>
        ) : (
          <Button size="sm" className="h-8 rounded-full px-3 text-[12px]" disabled>Post a bond</Button>
        ))}
      </div>

      {!live ? (
        <p className="mt-3 text-[13px] text-white/60">{BOND_NOT_LIVE}.</p>
      ) : isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-white/55"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading bonds…</p>
      ) : isError ? (
        <p className="mt-3 text-[12px] text-white/55">Could not load creator bonds right now.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-[12px] text-white/55">No creator bonds for this token yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.address}>
              <Link href={`/bond/${r.address}`} className="block rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.05]">
                <div className="flex items-center justify-between gap-2">
                  <StatusPill status={r.status} />
                  <span className="flex items-center gap-1 font-mono text-[11px] text-white/50">{shortenAddress(r.address)} <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} /></span>
                </div>
                <p className="mt-2 font-mono text-[14px] text-white">{formatEther(r.bondAmount)} ETH</p>
                <p className="mt-1 text-[11px] text-white/60">
                  Floor {formatTokens(r.floor, decimals)} {symbol} · Current {formatTokens(r.aggregate, decimals)} {symbol}
                </p>
                <p className="mt-0.5 text-[11px] text-white/55">{r.endTime ? `Ends ${fmtDate(r.endTime)}` : 'Not active yet'}</p>
                <BadgePill met={r.meetsBadge} className="mt-2" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Limitations compact className="mt-3" />
      <p className="mt-2 text-[11px] text-amber-200/80">{BOND_NOTE}</p>
    </div>
  );
}
