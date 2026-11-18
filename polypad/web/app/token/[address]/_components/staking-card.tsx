'use client';

import Link from 'next/link';
import { ArrowRight, Layers } from 'lucide-react';
import { useStakePools } from '@/app/stake/_components/use-stake';
import type { LaunchToken } from '@/lib/token-types';

/** Small CTO-tab card linking to this token's staking pools. Renders nothing when there are none. */
export function StakingCard({ token }: { token: LaunchToken }) {
  const addr = token.tokenAddress?.toLowerCase();
  const q = useStakePools(addr);
  const d = q.data && !('pending' in q.data) ? q.data : null;
  const pools = d?.pools ?? [];
  if (!addr || pools.length === 0) return null;
  const live = pools.filter((p) => p.status !== 'ended').length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-polydash-green/10 text-polydash-green ring-1 ring-polydash-green/25">
          <Layers className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-white">Staking</p>
          <p className="text-[12.5px] text-white/55">Stake ${token.symbol} · {pools.length} pool{pools.length === 1 ? '' : 's'}{live !== pools.length ? ` (${live} active)` : ''}</p>
        </div>
      </div>
      <Link href={`/stake?token=${addr}`} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-polydash-green px-4 text-[13px] font-semibold text-black hover:bg-polydash-green-light">
        Stake now <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Link>
    </div>
  );
}
