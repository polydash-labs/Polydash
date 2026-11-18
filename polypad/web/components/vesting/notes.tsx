'use client';

import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Circle, Copy, ExternalLink, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HOW_IT_WORKS, NO_ADMIN_WARNING, VESTING_CONTRACT_URL, VESTING_NOTE, VESTING_NOT_LIVE } from '@/lib/vesting';

export function VestingNote({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4', className)} role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.5} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[13px] font-medium text-amber-200">{VESTING_NOTE}</p>
        <a
          href={VESTING_CONTRACT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-amber-200/80 underline-offset-2 hover:text-white hover:underline"
        >
          View contract <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export function NoAdminWarning({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4', className)} role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white/70" strokeWidth={1.5} />
      <p className="text-[13px] text-white/80">{NO_ADMIN_WARNING}</p>
    </div>
  );
}

export function VestingNotLive({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card p-5 text-center', className)}>
      <Lock className="mx-auto h-5 w-5 text-white/50" strokeWidth={1.5} />
      <p className="mt-2 text-[14px] font-medium text-white">{VESTING_NOT_LIVE}</p>
      <p className="mt-1 text-[12px] text-white/55">Actions are disabled until the vesting factory is deployed.</p>
    </div>
  );
}

export function HowItWorks({ className }: { className?: string }) {
  return (
    <ul className={cn('space-y-1.5 text-[13px] text-white/75', className)}>
      {HOW_IT_WORKS.map((t) => (
        <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-polydash-green" strokeWidth={1.75} />{t}</li>
      ))}
    </ul>
  );
}

export function BadgePill({ met, className }: { met: boolean; className?: string }) {
  return met ? (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full bg-polydash-green/10 px-2.5 text-[11px] font-medium text-polydash-green ring-1 ring-inset ring-polydash-green/30', className)}>
      <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} /> Badge minimum met
    </span>
  ) : (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-medium text-white/65 ring-1 ring-inset ring-white/15', className)}>
      <Circle className="h-3 w-3" strokeWidth={1.75} /> Badge minimum not met
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
      <p className="text-[11px] text-white/55">{label}</p>
      <p className="mt-1 break-words font-mono text-[15px] text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-white/50">{sub}</p>}
    </div>
  );
}

export function CopyRow({ label, value, href }: { label: string; value: string; href: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <p className="text-[11px] text-white/55">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-white">{value}</code>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch((e) => console.error('copy failed', e)); }}
          className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-4 w-4 text-polydash-green" strokeWidth={1.75} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
        </button>
        <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Open in explorer">
          <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
        </a>
      </div>
    </div>
  );
}
