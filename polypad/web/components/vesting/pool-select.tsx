'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { POOL_ENDS_NOTE, ZERO_ADDRESS, fmtDate, type Addr } from '@/lib/vesting';
import type { EligiblePool } from '@/lib/hooks/use-vesting';

/** Radio list: "No pool (lock only)" + eligible V2 pools. value = pool address or ZERO_ADDRESS. */
export function PoolSelect({
  pools, loading, value, onChange, vestEnd, disabled, allowNone = true,
}: {
  pools: EligiblePool[]; loading?: boolean; value: Addr; onChange: (p: Addr) => void; vestEnd: number; disabled?: boolean; allowNone?: boolean;
}) {
  const selected = pools.find((p) => p.address.toLowerCase() === value.toLowerCase());
  const endsEarly = !!selected && vestEnd > 0 && selected.endTime < vestEnd;
  const opts = [
    ...(allowNone ? [{ address: ZERO_ADDRESS, name: 'No pool (lock only)', sub: 'Tokens stay idle in the vault.' }] : []),
    ...pools.map((p) => ({
      address: p.address,
      name: p.name,
      sub: `Ends ${fmtDate(p.endTime)}${p.aprLabel ? ` · Current APR (variable): ${p.aprLabel}` : ''}`,
    })),
  ];
  return (
    <div className="space-y-2">
      <div role="radiogroup" className="space-y-2">
        {opts.map((o) => {
          const on = o.address.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={o.address}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(o.address as Addr)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                on ? 'bg-polydash-green/[0.07] ring-polydash-green/40' : 'bg-white/[0.03] ring-white/[0.08] hover:bg-white/[0.05]',
              )}
            >
              <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1', on ? 'ring-polydash-green' : 'ring-white/30')}>
                {on && <span className="h-2 w-2 rounded-full bg-polydash-green" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-white">{o.name}</span>
                <span className="block text-[12px] text-white/55">{o.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      {loading && <p className="flex items-center gap-2 text-[12px] text-white/55"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for staking pools…</p>}
      {!loading && pools.length === 0 && <p className="text-[12px] text-white/55">No active, funded staking pools for this token right now.</p>}
      {endsEarly && <p className="rounded-lg bg-white/[0.04] p-2.5 text-[12px] text-white/70">{POOL_ENDS_NOTE}</p>}
    </div>
  );
}
