'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Tip } from '@/components/cto/xray-card';
import { cn } from '@/lib/utils';
import { fmtNum, type PoolStatus, type TokenInfo } from '@/lib/staking/shared';

export const APR_LABEL = 'Current APR (variable)';
export const APR_TIP = 'Estimated from the current reward rate and amount staked. It changes as people stake or withdraw. Not a guarantee.';
export const FOOTER_NOTE = 'Not financial advice. Staking pools are created by anyone; check the token address. Staking contract reviewed by the Bevor AI team, with findings fixed. Scans are not audits.';

export const sym = (t: { symbol: string }) => (t.symbol || 'n/a').toUpperCase();

export function useNowSec(stepMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

export function TokenLogo({ token, size = 28, className }: { token: Pick<TokenInfo, 'symbol' | 'logo'>; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const s = { width: size, height: size };
  if (token.logo && !broken) {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black ring-1 ring-white/15', className)} style={s}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={token.logo} alt={`${sym(token)} logo`} className="h-full w-full object-cover" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-semibold text-white/80 ring-1 ring-white/15', className)} style={{ ...s, fontSize: Math.max(9, size * 0.36) }}>
      {sym(token).slice(0, 2)}
    </span>
  );
}

export function TokenPair({ stake, reward, size = 28 }: { stake: TokenInfo; reward: TokenInfo; size?: number }) {
  return (
    <span className="inline-flex items-center">
      <TokenLogo token={stake} size={size} />
      <TokenLogo token={reward} size={size} className="-ml-2 ring-2 ring-[#0A0A0A]" />
    </span>
  );
}

export function PairLabel({ stake, reward }: { stake: TokenInfo; reward: TokenInfo }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-white/55">
      Stake {sym(stake)} <ArrowRight className="h-3 w-3" strokeWidth={1.5} /> earn {sym(reward)}
    </span>
  );
}

const STATUS: Record<PoolStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-polydash-green/12 text-polydash-green ring-polydash-green/25' },
  ending: { label: 'Ending soon', cls: 'bg-amber-400/10 text-amber-300 ring-amber-300/25' },
  ended: { label: 'Ended', cls: 'bg-white/[0.06] text-white/60 ring-white/10' },
  upcoming: { label: 'Starts soon', cls: 'bg-sky-400/10 text-sky-300 ring-sky-300/25' },
  new: { label: 'New', cls: 'bg-sky-400/10 text-sky-300 ring-sky-300/25' },
};

export function StatusPill({ status }: { status: PoolStatus }) {
  const s = STATUS[status];
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium ring-1 ring-inset', s.cls)}>{s.label}</span>;
}

export function TextPill({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'neutral' }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium ring-1 ring-inset',
      tone === 'green' ? 'bg-polydash-green/10 text-polydash-green ring-polydash-green/30' : 'bg-white/[0.06] text-white/70 ring-white/10')}>
      {children}
    </span>
  );
}

export function AprLabel({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] text-white/50', className)}>
      {APR_LABEL} <Tip text={APR_TIP} label="About the APR" />
    </span>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('stk-shimmer rounded-lg', className)} aria-hidden />;
}

/** Animates from 0 to `value` once (or when it changes). Respects reduced motion. */
export function CountUp({ value, format = (v: number) => fmtNum(v), ms = 900 }: { value: number; format?: (v: number) => string; ms?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced || !Number.isFinite(value)) { setShown(value); from.current = value; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, ms]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

export function Sparkline({ data, width = 72, height = 22, className }: { data: number[]; width?: number; height?: number; className?: string }) {
  if (data.length < 2) return <svg width={width} height={height} className={className} aria-hidden><line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="rgba(255,255,255,0.15)" strokeWidth="1" /></svg>;
  const max = Math.max(...data), min = Math.min(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke="#00E676" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className="h-full rounded-full bg-gradient-to-r from-polydash-green to-sky-400" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function EmptyState({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="stk-glass flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.05] text-white/60 ring-1 ring-white/10">{icon}</span>
      <p className="max-w-sm text-[14px] text-white/65">{text}</p>
      {action}
    </div>
  );
}
