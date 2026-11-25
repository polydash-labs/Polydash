'use client';

import Link from 'next/link';
import { ArrowUpRight, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTokens, shortenAddress } from '@/lib/format';
import { COVERAGE_NOTE, VESTING_NOTE, VESTING_NOT_LIVE, fmtDate, vestingFactory } from '@/lib/vesting';
import { useVaultsByToken } from '@/lib/hooks/use-vesting';
import { BadgePill } from './notes';

export function CreatorVestingCard({ token, symbol }: { token: string; symbol: string }) {
  const live = !!vestingFactory();
  const { data, isLoading, isError } = useVaultsByToken(live ? token : null);
  const rows = data?.rows ?? [];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-white/70" strokeWidth={1.5} />
          <h3 className="text-[14px] font-semibold text-white">Creator vesting</h3>
        </div>
        {live ? (
          <Button asChild size="sm" className="h-8 rounded-full px-3 text-[12px]">
            <Link href={`/vesting/create?token=${token}`}>Lock &amp; stake</Link>
          </Button>
        ) : (
          <Button size="sm" className="h-8 rounded-full px-3 text-[12px]" disabled>Lock &amp; stake</Button>
        )}
      </div>

      {!live ? (
        <p className="mt-3 text-[13px] text-white/60">{VESTING_NOT_LIVE}.</p>
      ) : isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-white/55"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading vaults…</p>
      ) : isError ? (
        <p className="mt-3 text-[12px] text-white/55">Could not load vesting vaults right now.</p>
      ) : (
        <>
          <div className="mt-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
            <p className="text-[11px] text-white/55">Total locked in vaults</p>
            <p className="mt-1 font-mono text-[15px] text-white">{formatTokens(data?.total ?? BigInt(0), rows[0]?.decimals ?? 18)} {symbol}</p>
          </div>
          {rows.length === 0 ? (
            <p className="mt-3 text-[12px] text-white/55">No vesting vaults for this token yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {rows.map((r) => (
                <li key={r.address}>
                  <Link href={`/vesting/${r.address}`} className="block rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.05]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] text-white/80">{shortenAddress(r.beneficiary)}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-white/45" strokeWidth={1.5} />
                    </div>
                    <p className="mt-1 font-mono text-[14px] text-white">{formatTokens(r.locked, r.decimals)} {symbol} locked</p>
                    <p className="mt-1 text-[11px] text-white/55">Cliff ends {fmtDate(r.cliffEnd)} · Vest ends {fmtDate(r.endTime)} · {r.isStaked ? 'Staked' : 'Not staked'}</p>
                    <BadgePill met={r.meetsBadge} className="mt-2" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="mt-3 text-[11px] text-white/50">{COVERAGE_NOTE}</p>
      <p className="mt-1 text-[11px] text-amber-200/80">{VESTING_NOTE}</p>
    </div>
  );
}
