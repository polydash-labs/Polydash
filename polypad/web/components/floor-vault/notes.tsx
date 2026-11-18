import { AlertTriangle, ExternalLink, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FLOOR_CONTRACT_URL, FLOOR_IMPL_URL, FLOOR_NOT_LIVE, riskCopy } from '@/lib/floorVault';

const linkCls = 'inline-flex items-center gap-1 text-[12px] text-amber-200/80 underline-offset-2 hover:text-white hover:underline';

export function FloorContractLinks({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-4 gap-y-1', className)} data-testid="floor-contract-links">
      <a href={FLOOR_CONTRACT_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>
        Verified on Sourcify <ExternalLink className="h-3 w-3" />
      </a>
      <a href={FLOOR_IMPL_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>
        Implementation on Sourcify <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

export function FloorRiskNote({ symbol, className }: { symbol?: string; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-3.5', className)} role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.5} />
      <p className="text-[12px] leading-relaxed text-amber-100/90">{riskCopy(symbol)}</p>
    </div>
  );
}

export function FloorNotLive({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card mx-auto max-w-md p-6 text-center', className)}>
      <Lock className="mx-auto h-5 w-5 text-white/50" strokeWidth={1.5} />
      <p className="mt-2 text-[15px] font-medium text-white">{FLOOR_NOT_LIVE}</p>
      <p className="mt-1 text-[12px] text-white/55">Token-backed collections open once the factory is deployed on Robinhood Chain.</p>
    </div>
  );
}
