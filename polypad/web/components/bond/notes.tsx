'use client';

import { AlertTriangle, ExternalLink, Info, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTokens } from '@/lib/format';
import { BOND_CONTRACT_URL, BOND_NOTE, BOND_NOT_LIVE, LIMITATIONS, OUTCOME, statusLabel } from '@/lib/bond';

export { BadgePill, Stat, CopyRow } from '@/components/vesting/notes';

export function BondNote({ className, showContract }: { className?: string; showContract?: boolean }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4', className)} role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.5} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[13px] font-medium text-amber-200">{BOND_NOTE}</p>
        {showContract && <ContractLink />}
      </div>
    </div>
  );
}

export function ContractLink({ className }: { className?: string }) {
  return (
    <a href={BOND_CONTRACT_URL} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 text-[12px] text-amber-200/80 underline-offset-2 hover:text-white hover:underline', className)}>
      View contract <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function BondNotLive({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card p-5 text-center', className)}>
      <Shield className="mx-auto h-5 w-5 text-white/50" strokeWidth={1.5} />
      <p className="mt-2 text-[14px] font-medium text-white">{BOND_NOT_LIVE}</p>
      <p className="mt-1 text-[12px] text-white/55">Actions are disabled until the bond factory is deployed.</p>
    </div>
  );
}

export function Outcome({ className }: { className?: string }) {
  return <p className={cn('text-[13px] leading-relaxed text-white/75', className)}>{OUTCOME}</p>;
}

export function Limitations({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-white/10 bg-white/[0.03]', compact ? 'p-3' : 'p-4', className)} role="note">
      <p className={cn('flex items-center gap-2 font-semibold text-white', compact ? 'text-[12px]' : 'text-[13px]')}>
        <Info className="h-3.5 w-3.5 text-white/60" strokeWidth={1.75} /> Limitations
      </p>
      <ul className={cn('mt-2 space-y-1.5 text-white/65', compact ? 'text-[11px]' : 'text-[12px]')}>
        {LIMITATIONS.map((t) => (
          <li key={t} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/40" />{t}</li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_CLS: Record<number, string> = {
  0: 'bg-yellow-400/10 text-yellow-300 ring-yellow-300/25',
  1: 'bg-polydash-green/10 text-polydash-green ring-polydash-green/30',
  2: 'bg-white/[0.06] text-white/70 ring-white/15',
  3: 'bg-red-500/10 text-red-300 ring-red-400/30',
  4: 'bg-white/[0.06] text-white/60 ring-white/15',
};

export function StatusPill({ status, className }: { status: number; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium ring-1 ring-inset', STATUS_CLS[status] ?? STATUS_CLS[2], className)}>
      {statusLabel(status)}
    </span>
  );
}

/** Bar of the registered wallets' current total against the floor. */
export function FloorBar({ current, floor, decimals, symbol, className }: { current: bigint; floor: bigint; decimals: number; symbol: string; className?: string }) {
  const max = current > floor ? current : floor;
  const pct = max > BigInt(0) ? Number((current * BigInt(1000)) / max) / 10 : 0;
  const floorPct = max > BigInt(0) ? Number((floor * BigInt(1000)) / max) / 10 : 0;
  const below = current < floor;
  return (
    <div className={className}>
      <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={cn('h-full rounded-full', below ? 'bg-red-400' : 'bg-polydash-green')} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `calc(${floorPct}% - 1px)` }} aria-hidden />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-white/60">
        <span>Current {formatTokens(current, decimals)} {symbol}</span>
        <span>Floor {formatTokens(floor, decimals)} {symbol}</span>
      </div>
    </div>
  );
}
