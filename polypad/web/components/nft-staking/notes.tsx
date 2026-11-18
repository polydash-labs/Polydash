import { AlertTriangle, BadgeCheck, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NOT_AUDITED_NOTE, OUTSIDE_LABEL, POLYPAD_LABEL, STAKED_LOCK_NOTE, type PoolStatus } from '@/lib/nftStaking';

export function RiskNote({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4', className)} role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.5} />
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-amber-200">{NOT_AUDITED_NOTE}</p>
        {!compact && <p className="text-[12px] text-white/65">{STAKED_LOCK_NOTE}</p>}
      </div>
    </div>
  );
}

export function CollectionTag({ polypad }: { polypad: boolean }) {
  return polypad ? (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-polydash-green/10 px-2.5 text-[11px] font-medium text-polydash-green ring-1 ring-inset ring-polydash-green/30">
      <BadgeCheck className="h-3 w-3" strokeWidth={1.75} /> {POLYPAD_LABEL}
    </span>
  ) : (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-medium text-white/70 ring-1 ring-inset ring-white/15">
      <Globe className="h-3 w-3" strokeWidth={1.75} /> {OUTSIDE_LABEL}
    </span>
  );
}

const STATUS: Record<PoolStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-polydash-green/12 text-polydash-green ring-polydash-green/25' },
  ending: { label: 'Ending soon', cls: 'bg-amber-400/10 text-amber-300 ring-amber-300/25' },
  ended: { label: 'Ended', cls: 'bg-white/[0.06] text-white/60 ring-white/10' },
  upcoming: { label: 'Starts soon', cls: 'bg-sky-400/10 text-sky-300 ring-sky-300/25' },
};

export function PoolStatusPill({ status }: { status: PoolStatus }) {
  const s = STATUS[status];
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium ring-1 ring-inset', s.cls)}>{s.label}</span>;
}

export function FactoryMissing({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card p-5 text-center', className)}>
      <p className="text-[14px] font-medium text-white">NFT staking is not live yet</p>
      <p className="mt-1 text-[12px] text-white/55">The staking factory has not been deployed. Pools will appear here once it is.</p>
    </div>
  );
}
