'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { ArrowUpRight, Check, Circle, HelpCircle, Layers, Share2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CheckId, CheckStatus, HolderProtections, HpLite, Tier } from '@/lib/holder-protections';

export const HP_TOOLTIP = "Tier based on Polypad's live on-chain checks. Checks can change and are not a guarantee. Scans are not audits. Not financial advice.";
export const tierName = (t: Tier) => (t ? t[0].toUpperCase() + t.slice(1) : '');
export const TIER_RANK: Record<string, number> = { gold: 3, silver: 2, bronze: 1 };
export const tierRank = (t?: Tier | null) => (t ? TIER_RANK[t] ?? 0 : 0);

/** Batch for lists. Keys are lowercase launch addresses. */
export function useHolderProtectionsAll() {
  const q = useQuery({
    queryKey: ['holder-protections-all'],
    queryFn: async (): Promise<Record<string, HpLite> | null> => {
      const res = await fetch('/api/holder-protections');
      if (!res.ok) throw new Error(`holder-protections ${res.status}`);
      return ((await res.json()) as { items: Record<string, HpLite> | null }).items;
    },
    staleTime: 120_000,
    refetchInterval: 300_000,
  });
  return { map: q.data ?? null, ready: q.isSuccess && !!q.data };
}

/** Full checklist for one launch. null while loading, for non-factory tokens, or on error. */
export function useHolderProtections(launch?: string | null) {
  const q = useQuery({
    queryKey: ['holder-protections', launch?.toLowerCase()],
    enabled: !!launch,
    queryFn: async (): Promise<HolderProtections | null> => {
      const res = await fetch(`/api/holder-protections/${launch}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`holder-protections ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });
  return q.data ?? null;
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M8 1.5 13 3.4v4.1c0 3.1-2.1 5.8-5 7-2.9-1.2-5-3.9-5-7V3.4L8 1.5Z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="m5.6 8.1 1.7 1.7 3.1-3.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const HP_SIZE = {
  sm: { box: 'h-5 gap-1 px-2 text-[9.5px]', icon: 'h-3 w-3' },
  md: { box: 'h-7 gap-1.5 px-3 text-[11px]', icon: 'h-3.5 w-3.5' },
  lg: { box: 'h-9 gap-2 px-4 text-[12.5px]', icon: 'h-4 w-4' },
} as const;

export function HpChipView({ passed, tier, size = 'sm' }: { passed?: number | null; tier?: Tier; size?: 'sm' | 'md' | 'lg' }) {
  if (!tier && !passed) return null;
  const s = HP_SIZE[size];
  const right = tier ? tierName(tier) : `${passed}/5`;
  return (
    <span
      title={HP_TOOLTIP}
      aria-label={`Holder Protections ${right}`}
      className={cn('hp-badge', tier ? `hp-badge--${tier}` : 'hp-badge--none', s.box)}
    >
      <ShieldIcon className={cn('shrink-0', s.icon)} />
      <span>Holder Protections</span>
      <span className="hp-badge__dot" aria-hidden>·</span>
      <span>{right}</span>
    </span>
  );
}

/** Card chip (batch data): tier only. */
export function HpChip({ launch }: { launch?: string }) {
  const { map } = useHolderProtectionsAll();
  if (!launch || !map) return null;
  const t = map[launch.toLowerCase()]?.tier;
  return t ? <HpChipView tier={t} /> : null;
}

/** Header chip (single-launch data). */
export function HpChipFull({ launch }: { launch?: string }) {
  const hp = useHolderProtections(launch);
  return <HpChipView passed={hp?.passed} tier={hp?.tier ?? null} size="md" />;
}

const LABEL: Record<CheckId, string> = {
  liquidity_locked: 'Liquidity locked',
  creator_staking_pool: 'Creator staking pool',
  security_clean: 'Security check clean',
  creator_vesting: 'Creator vesting',
  creator_bond: 'Creator bond',
};
const CREATE: Partial<Record<CheckId, (t: string) => string>> = {
  creator_staking_pool: (t) => `/stake/create?token=${t}`,
  creator_vesting: (t) => `/vesting/create?token=${t}`,
  creator_bond: (t) => `/bond/create?token=${t}`,
};
const STATUS: Record<CheckStatus, { label: string; cls: string; Icon: typeof Check }> = {
  pass: { label: 'Pass', cls: 'bg-polydash-green/15 text-polydash-green', Icon: Check },
  pending: { label: 'Pending', cls: 'bg-yellow-400/10 text-yellow-300', Icon: Circle },
  unknown: { label: 'Unknown', cls: 'bg-white/[0.07] text-white/70', Icon: HelpCircle },
  fail: { label: 'Broken', cls: 'bg-red-500/15 text-red-300', Icon: X },
};

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function hpShareUrl(name: string, tier: Tier, passed: number, tokenAddress: string) {
  const text = `${name} meets Polypad Holder Protections ${tierName(tier)} (${passed}/5 on-chain checks). polypad.family/token/${tokenAddress} Not financial advice.`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** PolyCTO tab checklist block. Renders nothing for non-factory tokens. */
export function HpChecklist({ launch, tokenAddress, creator, name }: { launch?: string; tokenAddress?: string; creator?: string; name?: string }) {
  const hp = useHolderProtections(launch);
  const { address } = useAccount();
  if (!hp) return null;
  const isCreator = !!address && !!creator && address.toLowerCase() === creator.toLowerCase();
  const tokenAddr = tokenAddress ?? launch ?? '';
  return (
    <div className="rounded-2xl bg-white/[0.03] p-5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hp.tier ? (
          <h3 className="flex items-center gap-2">
            <HpChipView tier={hp.tier} size="lg" />
            <span className="text-xs font-normal text-white/60">{hp.passed}/{hp.total}</span>
          </h3>
        ) : (
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white" title={HP_TOOLTIP}>
            <Layers className="h-4 w-4 text-polydash-green" strokeWidth={1.5} aria-hidden />
            Holder Protections
            <span className="text-xs font-normal text-white/60">{hp.passed}/{hp.total}</span>
          </h3>
        )}
        <div className="flex items-center gap-3">
          {hp.tier && (
            <a href={hpShareUrl(name ?? 'This token', hp.tier, hp.passed, tokenAddr)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-white/80 hover:text-polydash-green">
              <Share2 className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Share
            </a>
          )}
          {hp.tier && launch && (
            <a href={`/api/holder-protections/${launch}/og`} target="_blank" rel="noopener noreferrer" className="text-xs text-white/60 hover:text-polydash-green">
              Share card
            </a>
          )}
          <span className="text-xs text-white/55" suppressHydrationWarning>Checked {relTime(hp.checkedAt)}</span>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {hp.checks.map((c) => {
          const st = STATUS[c.status] ?? STATUS.unknown;
          const create = isCreator && c.status === 'pending' ? CREATE[c.id] : undefined;
          return (
            <li key={c.id} className="flex items-start gap-3">
              <span className={cn('mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', st.cls)}>
                <st.Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                {st.label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white/85">{LABEL[c.id] ?? c.id}</p>
                <p className="text-xs text-white/60">{c.detail}</p>
                {create && <a href={create(tokenAddr)} className="mt-1 inline-block text-xs text-polydash-green hover:underline">Set this up as the creator</a>}
              </div>
              {c.evidence && (
                <a href={c.evidence} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-xs text-white/60 hover:text-polydash-green">
                  Evidence <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {!!hp.history?.length && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <p className="text-xs font-medium text-white/70">Tier history</p>
          <ul className="mt-2 space-y-1">
            {hp.history.map((h) => (
              <li key={h.at} className="flex justify-between text-[11px] text-white/60">
                <span>{h.from ? tierName(h.from) : 'No tier'} → {h.to ? tierName(h.to) : 'No tier'}</span>
                <span suppressHydrationWarning>{relTime(h.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-[11px] text-white/55">Scans are not audits. Not financial advice.</p>
    </div>
  );
}
/** "Holder Protections" filter (bronze+ by default) with a tier selector. */
export function HpTierFilter({ value, onChange }: { value: Tier; onChange: (t: Tier) => void }) {
  const on = value !== null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={HP_TOOLTIP}>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(on ? null : 'bronze')}
        className={cn(
          'inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-colors sm:h-8',
          on ? 'bg-polydash-green/15 text-polydash-green' : 'text-white/60 hover:bg-white/5 hover:text-white',
        )}
      >
        <Layers className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        Holder Protections
      </button>
      {on && (
        <select
          aria-label="Minimum Holder Protections tier"
          value={value ?? 'bronze'}
          onChange={(e) => onChange(e.target.value as Tier)}
          className="h-10 shrink-0 rounded-full border border-white/10 bg-[#0b0b0b] px-2.5 text-[12px] text-white sm:h-8"
        >
          <option value="bronze">Bronze+</option>
          <option value="silver">Silver+</option>
          <option value="gold">Gold</option>
        </select>
      )}
    </span>
  );
}
