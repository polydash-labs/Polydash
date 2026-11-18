'use client';

import { useEffect, type ReactNode } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { blockscoutAddr, blockscoutTx, short, sourcifyUrl } from '@/lib/buyback';
import { cn } from '@/lib/utils';

export function Card({ title, children, className, action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn('rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold text-white">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, testId }: { label: string; value: ReactNode; sub?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-testid={testId}>
      <p className="text-[12px] text-white/55">{label}</p>
      <p className="mt-1 font-mono text-[18px] font-semibold text-white">{value}</p>
      {sub && <div className="mt-1 text-[11px] text-white/55">{sub}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-[12px]">
      <span className="text-white/55">{label}</span>
      <span className="break-all text-right font-mono text-white">{children}</span>
    </div>
  );
}

export function Note({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'muted' }) {
  return (
    <div className={cn('flex gap-2 rounded-xl p-3 text-[12px]', tone === 'amber' ? 'border border-amber-300/25 bg-amber-400/[0.06] text-amber-100/90' : 'bg-white/[0.04] text-white/65')}>
      {tone === 'amber' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function AddrLink({ address, label }: { address?: string | null; label?: string }) {
  if (!address) return <span>-</span>;
  return (
    <a href={blockscoutAddr(address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-white hover:text-polydash-green">
      {label ?? short(address)} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a href={blockscoutTx(hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-white/80 hover:text-polydash-green">
      {short(hash)} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function ContractLinks({ name, address }: { name: string; address: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-[12px]">
      <span className="text-white/55">{name}</span>
      <span className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-white">{short(address)}</span>
        <a href={sourcifyUrl(address)} target="_blank" rel="noopener noreferrer" className="text-white/70 underline-offset-2 hover:text-white hover:underline">Sourcify</a>
        <a href={blockscoutAddr(address)} target="_blank" rel="noopener noreferrer" className="text-white/70 underline-offset-2 hover:text-white hover:underline">Blockscout</a>
      </span>
    </div>
  );
}

export function TxButton({ onClick, disabled, busy, children, variant, testId }: { onClick: () => void; disabled?: boolean; busy?: boolean; children: ReactNode; variant?: 'default' | 'outline'; testId?: string }) {
  return (
    <Button className="rounded-full" variant={variant} onClick={onClick} disabled={disabled || busy} data-testid={testId}>
      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {children}
    </Button>
  );
}

export function ConnectOr({ children }: { children: ReactNode }) {
  return (
    <ConnectButton.Custom>
      {({ account, mounted, openConnectModal }) =>
        mounted && account ? <>{children}</> : <Button className="rounded-full" variant="outline" onClick={openConnectModal}>Connect wallet</Button>
      }
    </ConnectButton.Custom>
  );
}

export function ConfirmModal({ open, title, body, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111] p-5 shadow-2xl">
        <h3 className="text-[16px] font-semibold text-white">{title}</h3>
        <div className="mt-2 text-[13px] text-white/70">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" className="rounded-full" onClick={onClose}>Cancel</Button>
          <Button className="rounded-full" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
