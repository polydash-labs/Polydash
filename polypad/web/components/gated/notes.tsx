import { AlertTriangle, ExternalLink, Info, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GATED_CONTRACT_URL, GATED_NOT_LIVE, HOLDER_CHECK_NOTE, NOT_AUDITED_NOTE, gatedLive } from '@/lib/gatedMint';

export function GatedNote({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-3.5', className)} role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.5} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[12px] font-medium text-amber-200">{NOT_AUDITED_NOTE}</p>
        {gatedLive() && <GatedContractLink />}
      </div>
    </div>
  );
}

export function GatedContractLink({ className }: { className?: string }) {
  return (
    <a href={GATED_CONTRACT_URL} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 text-[12px] text-amber-200/80 underline-offset-2 hover:text-white hover:underline', className)}>
      View contract <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function HolderCheckNote({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5', className)} role="note">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-white/60" strokeWidth={1.5} />
      <p className="text-[12px] text-white/75">{HOLDER_CHECK_NOTE}</p>
    </div>
  );
}

export function GatedNotLive({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card mx-auto max-w-md p-6 text-center', className)}>
      <Lock className="mx-auto h-5 w-5 text-white/50" strokeWidth={1.5} />
      <p className="mt-2 text-[15px] font-medium text-white">{GATED_NOT_LIVE}</p>
      <p className="mt-1 text-[12px] text-white/55">Holder mint collections open once the factory is deployed on Robinhood Chain.</p>
    </div>
  );
}
