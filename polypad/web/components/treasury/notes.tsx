import { AlertTriangle, ArrowUpRight, Info, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NOT_AUDITED_NOTE, TREASURY_CONTRACT_URL, TREASURY_NOT_LIVE } from '@/lib/treasury';

export function TreasuryNote({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-3.5', className)} role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.5} />
      <p className="text-[12px] font-medium text-amber-200">
        {NOT_AUDITED_NOTE}{' '}
        <a href={TREASURY_CONTRACT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 whitespace-nowrap underline underline-offset-2 hover:text-amber-100">
          View contract <ArrowUpRight className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}

export function InfoNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5', className)} role="note">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-white/60" strokeWidth={1.5} />
      <p className="text-[12px] text-white/75">{children}</p>
    </div>
  );
}

export function TreasuryNotLive({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card mx-auto max-w-md p-6 text-center', className)}>
      <Lock className="mx-auto h-5 w-5 text-white/50" strokeWidth={1.5} />
      <p className="mt-2 text-[15px] font-medium text-white">{TREASURY_NOT_LIVE}</p>
      <p className="mt-1 text-[12px] text-white/55">Treasury rules open once the factory is deployed on Robinhood Chain.</p>
    </div>
  );
}
