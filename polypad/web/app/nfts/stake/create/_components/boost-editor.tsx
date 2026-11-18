'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { MAX_TIERS, MAX_TIER_BPS, MAX_SET_BONUS_BPS, BOOST_NOTE } from '@/lib/nftStaking';

export interface TierRow { days: string; mult: string }

const input = 'h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 font-mono text-[13px] text-white outline-none focus:border-polydash-green/50';

export function validateTiers(rows: TierRow[]): string | null {
  if (!rows.length || rows.length > MAX_TIERS) return `Use 1 to ${MAX_TIERS} tiers.`;
  let prevDays = -1, prevMult = 0;
  for (let i = 0; i < rows.length; i++) {
    const d = Number(rows[i].days), m = Number(rows[i].mult);
    if (!Number.isFinite(d) || d < 0 || !Number.isFinite(m)) return 'Enter numbers for every tier.';
    if (i === 0 && d !== 0) return 'The first tier starts at day 0.';
    if (i > 0 && d <= prevDays) return 'Each tier must start later than the one before.';
    if (m < 1 || m * 10_000 > MAX_TIER_BPS) return `Multipliers must be between 1.0x and ${MAX_TIER_BPS / 10_000}.0x.`;
    if (m < prevMult) return 'Multipliers cannot go down in later tiers.';
    prevDays = d; prevMult = m;
  }
  return null;
}

export function validateSet(min: string, pct: string): string | null {
  const n = Number(min), p = Number(pct);
  if (!Number.isInteger(n) || n < 2 || n > 1000) return 'Set size must be a whole number from 2.';
  if (!Number.isFinite(p) || p <= 0 || p * 100 > MAX_SET_BONUS_BPS) return `Set bonus must be above 0% and at most ${MAX_SET_BONUS_BPS / 100}%.`;
  return null;
}

export function BoostEditor(props: {
  loyalty: boolean; setLoyalty: (v: boolean) => void; tiers: TierRow[]; setTiers: (t: TierRow[]) => void;
  setOn: boolean; setSetOn: (v: boolean) => void; setMin: string; setSetMin: (v: string) => void; setPct: string; setSetPct: (v: string) => void;
}) {
  const { loyalty, setLoyalty, tiers, setTiers, setOn, setSetOn, setMin, setSetMin, setPct, setSetPct } = props;
  const tierErr = loyalty ? validateTiers(tiers) : null;
  const setErr = setOn ? validateSet(setMin, setPct) : null;
  const upd = (i: number, k: keyof TierRow, v: string) => setTiers(tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-white">Loyalty boost</p>
            <p className="text-[12px] text-white/55">NFTs earn a higher weight the longer they stay staked. Up to {MAX_TIERS} tiers, max {MAX_TIER_BPS / 10_000}.0x.</p>
          </div>
          <Switch checked={loyalty} onCheckedChange={setLoyalty} aria-label="Loyalty boost" />
        </div>
        {loyalty && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-[1fr_1fr_32px] gap-2 text-[11px] text-white/55"><span>After (days)</span><span>Multiplier (x)</span><span /></div>
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
                <input className={input} inputMode="decimal" value={t.days} disabled={i === 0} onChange={(e) => upd(i, 'days', e.target.value)} aria-label={`Tier ${i + 1} days`} />
                <input className={input} inputMode="decimal" value={t.mult} onChange={(e) => upd(i, 'mult', e.target.value)} aria-label={`Tier ${i + 1} multiplier`} />
                {i > 0 ? (
                  <button type="button" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white" aria-label={`Remove tier ${i + 1}`}>
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                ) : <span />}
              </div>
            ))}
            {tiers.length < MAX_TIERS && (
              <button type="button" onClick={() => { const last = tiers[tiers.length - 1]; setTiers([...tiers, { days: String(Number(last?.days ?? 0) + 7), mult: last?.mult ?? '1' }]); }}
                className="inline-flex items-center gap-1 text-[12px] text-polydash-green hover:underline">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />Add tier
              </button>
            )}
            {tierErr && <p className="text-[12px] text-red-400">{tierErr}</p>}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-white">Set bonus</p>
            <p className="text-[12px] text-white/55">Extra weight for wallets staking several NFTs. Max +{MAX_SET_BONUS_BPS / 100}%.</p>
          </div>
          <Switch checked={setOn} onCheckedChange={setSetOn} aria-label="Set bonus" />
        </div>
        {setOn && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-white/55">Minimum NFTs<input className={input} inputMode="numeric" value={setMin} onChange={(e) => setSetMin(e.target.value)} /></label>
            <label className="space-y-1 text-[11px] text-white/55">Bonus (%)<input className={input} inputMode="decimal" value={setPct} onChange={(e) => setSetPct(e.target.value)} /></label>
            {setErr && <p className="col-span-2 text-[12px] text-red-400">{setErr}</p>}
          </div>
        )}
      </div>
      <p className="text-[12px] text-white/55">{BOOST_NOTE}</p>
    </div>
  );
}
