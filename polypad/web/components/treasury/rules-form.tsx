'use client';

import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';
import { cn } from '@/lib/utils';
import {
  DAY, DEFAULT_SLIPPAGE_BPS, HOUR, INTERVAL_PRESETS, MAX_INTERVAL, MAX_POOL_DAYS, MAX_POOL_FEE_BPS, MAX_SLIPPAGE_BPS, MIN_POOL_DAYS,
  MIN_POOL_FEE_BPS, MIN_SLIPPAGE_BPS, POOL_NOTE, SLIPPAGE_NOTE, type RulesJson, type RulesTuple,
} from '@/lib/treasury';

export interface RulesFormState {
  maxEthPerDay: string; maxEthPerBuyback: string; minIntervalSec: number; slippagePct: string; minTokensPerEth: string; burnBought: boolean;
  maxPoolReward: string; poolDays: string; poolFeePct: string; poolMinIntervalSec: number; poolMaxTotalStake: string;
  maxAirdropPerRound: string; openExecution: boolean;
}

export const defaultRulesState = (): RulesFormState => ({
  maxEthPerDay: '', maxEthPerBuyback: '', minIntervalSec: DAY, slippagePct: String(DEFAULT_SLIPPAGE_BPS / 100), minTokensPerEth: '', burnBought: true,
  maxPoolReward: '', poolDays: '30', poolFeePct: '1', poolMinIntervalSec: DAY, poolMaxTotalStake: '', maxAirdropPerRound: '', openExecution: false,
});

const tok = (v: string, d: number) => (BigInt(v) === BigInt(0) ? '' : formatUnits(BigInt(v), d));
export const rulesToState = (r: RulesJson, decimals: number): RulesFormState => ({
  maxEthPerDay: BigInt(r.maxEthPerDay) === BigInt(0) ? '' : formatEther(BigInt(r.maxEthPerDay)),
  maxEthPerBuyback: BigInt(r.maxEthPerBuyback) === BigInt(0) ? '' : formatEther(BigInt(r.maxEthPerBuyback)),
  minIntervalSec: r.minInterval, slippagePct: String(r.maxSlippageBps / 100), minTokensPerEth: tok(r.minTokensPerEth, decimals), burnBought: r.burnBought,
  maxPoolReward: tok(r.maxPoolReward, decimals), poolDays: String(Math.max(1, Math.round(r.poolDuration / DAY))), poolFeePct: String(r.poolClaimFeeBps / 100),
  poolMinIntervalSec: r.poolMinInterval, poolMaxTotalStake: tok(r.poolMaxTotalStake, decimals), maxAirdropPerRound: tok(r.maxAirdropPerRound, decimals),
  openExecution: r.openExecution,
});

const ZERO = BigInt(0);
const eth = (v: string) => (v.trim() ? parseEther(v.trim() as `${number}`) : ZERO);
const units = (v: string, d: number) => (v.trim() ? parseUnits(v.trim() as `${number}`, d) : ZERO);

/** Builds the on-chain Rules tuple. Returns field-keyed errors for inline display. */
export function buildRules(s: RulesFormState, decimals: number): { rules?: RulesTuple; errors: Partial<Record<keyof RulesFormState, string>> } {
  const errors: Partial<Record<keyof RulesFormState, string>> = {};
  const safe = <T,>(k: keyof RulesFormState, f: () => T, fallback: T): T => {
    try { return f(); } catch { errors[k] = 'Enter a valid number.'; return fallback; }
  };
  const perDay = safe('maxEthPerDay', () => eth(s.maxEthPerDay), ZERO);
  const perCall = safe('maxEthPerBuyback', () => eth(s.maxEthPerBuyback), ZERO);
  if (perCall > perDay) errors.maxEthPerBuyback = 'Must be less than or equal to max ETH per day.';
  if (perDay > ZERO && perCall === ZERO) errors.maxEthPerBuyback = 'Set a max ETH per buyback.';
  if (s.minIntervalSec <= 0 || s.minIntervalSec > MAX_INTERVAL) errors.minIntervalSec = 'Between 1 hour and 30 days.';
  const slip = Math.round(Number(s.slippagePct) * 100);
  if (!Number.isFinite(slip) || slip < MIN_SLIPPAGE_BPS || slip > MAX_SLIPPAGE_BPS) errors.slippagePct = 'Between 0.1% and 30%.';
  const minTok = safe('minTokensPerEth', () => units(s.minTokensPerEth, decimals), ZERO);
  const poolReward = safe('maxPoolReward', () => units(s.maxPoolReward, decimals), ZERO);
  const days = Number(s.poolDays);
  if (!Number.isInteger(days) || days < MIN_POOL_DAYS || days > MAX_POOL_DAYS) errors.poolDays = 'Between 1 and 3650 days.';
  const fee = Math.round(Number(s.poolFeePct) * 100);
  if (!Number.isFinite(fee) || fee < MIN_POOL_FEE_BPS || fee > MAX_POOL_FEE_BPS) errors.poolFeePct = 'Between 1% and 5%.';
  if (s.poolMinIntervalSec <= 0 || s.poolMinIntervalSec > MAX_INTERVAL) errors.poolMinIntervalSec = 'Between 1 hour and 30 days.';
  const maxStake = safe('poolMaxTotalStake', () => units(s.poolMaxTotalStake, decimals), ZERO);
  const airdrop = safe('maxAirdropPerRound', () => units(s.maxAirdropPerRound, decimals), ZERO);
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    rules: {
      maxEthPerDay: perDay, maxEthPerBuyback: perCall, minInterval: s.minIntervalSec, maxSlippageBps: slip, burnBought: s.burnBought,
      openExecution: s.openExecution, minTokensPerEth: minTok, maxAirdropPerRound: airdrop, maxPoolReward: poolReward,
      poolMinInterval: s.poolMinIntervalSec, poolDuration: days * DAY, poolClaimFeeBps: fee, poolMaxTotalStake: maxStake,
    },
  };
}

export const inputCls = 'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';

export function Field({ label, hint, error, children }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="text-[12px] font-medium text-white/80">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-white/45">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-red-300">{error}</span>}
    </div>
  );
}

export function Segmented<T extends string | number | boolean>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)}
          className={cn('rounded-full border px-3 py-1.5 text-[12px] transition', value === o.value ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-white/60 hover:text-white')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IntervalInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const preset = INTERVAL_PRESETS.some((p) => p.value === value);
  return (
    <div className="space-y-2">
      <Segmented value={preset ? value : -1} options={[...INTERVAL_PRESETS, { value: -1, label: 'Custom' }]} onChange={(v) => onChange(v === -1 ? 2 * DAY : v)} />
      {!preset && (
        <div className="flex items-center gap-2">
          <input className={cn(inputCls, 'max-w-[140px]')} inputMode="decimal" value={String(value / HOUR)} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * HOUR))} />
          <span className="text-[12px] text-white/55">hours (max 720)</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h3 className="text-[14px] font-semibold text-white">{title}</h3>
      {note && <p className="mt-1 text-[12px] text-white/55">{note}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Rule fields shared by the setup page and the creator's queueRules form. */
export function RulesFields({ s, set, errors, symbol, includeExecution = false }: {
  s: RulesFormState; set: (p: Partial<RulesFormState>) => void; errors: Partial<Record<keyof RulesFormState, string>>; symbol: string; includeExecution?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Section title="Buybacks" note="A buyback uses treasury ETH to buy the token on-chain within these limits; bought tokens are burned or kept. Set max ETH per day to 0 to turn buybacks off.">
        <Field label="Max ETH per day" hint="0 disables buybacks" error={errors.maxEthPerDay}>
          <input className={inputCls} inputMode="decimal" placeholder="0" value={s.maxEthPerDay} onChange={(e) => set({ maxEthPerDay: e.target.value })} />
        </Field>
        <Field label="Max ETH per buyback" hint="Less than or equal to the daily max" error={errors.maxEthPerBuyback}>
          <input className={inputCls} inputMode="decimal" placeholder="0" value={s.maxEthPerBuyback} onChange={(e) => set({ maxEthPerBuyback: e.target.value })} />
        </Field>
        <Field label="Minimum time between buybacks" error={errors.minIntervalSec}>
          <IntervalInput value={s.minIntervalSec} onChange={(v) => set({ minIntervalSec: v })} />
        </Field>
        <Field label="Max slippage %" hint={`0.1% to 30%, ${SLIPPAGE_NOTE}`} error={errors.slippagePct}>
          <input className={inputCls} inputMode="decimal" value={s.slippagePct} onChange={(e) => set({ slippagePct: e.target.value })} />
        </Field>
        <Field label={`Buyback price limit: do not buy if 1 ETH buys fewer than X ${symbol || 'tokens'}`} hint="Optional. Leave empty or 0 to turn off." error={errors.minTokensPerEth}>
          <input className={inputCls} inputMode="decimal" placeholder="0" value={s.minTokensPerEth} onChange={(e) => set({ minTokensPerEth: e.target.value })} />
        </Field>
        <Field label="Bought tokens">
          <Segmented value={s.burnBought} onChange={(v) => set({ burnBought: v })} options={[
            { value: true, label: 'Burn (sent to 0x...dEaD)' },
            { value: false, label: 'Keep in the treasury for rewards and airdrops' },
          ]} />
        </Field>
      </Section>

      <Section title="Reward pools" note={`${POOL_NOTE} Set max reward per pool to 0 to turn reward pools off.`}>
        <Field label={`Max reward per pool (${symbol || 'tokens'})`} hint="0 turns reward pools off" error={errors.maxPoolReward}>
          <input className={inputCls} inputMode="decimal" placeholder="0" value={s.maxPoolReward} onChange={(e) => set({ maxPoolReward: e.target.value })} />
        </Field>
        <Field label="Pool duration (days)" hint="1 to 3650 days" error={errors.poolDays}>
          <input className={inputCls} inputMode="numeric" value={s.poolDays} onChange={(e) => set({ poolDays: e.target.value })} />
        </Field>
        <Field label="Pool claim fee %" hint="1% taken from rewards when you claim. Between 1% and 5%." error={errors.poolFeePct}>
          <input className={inputCls} inputMode="decimal" value={s.poolFeePct} onChange={(e) => set({ poolFeePct: e.target.value })} />
        </Field>
        <Field label="Minimum time between reward pools" error={errors.poolMinIntervalSec}>
          <IntervalInput value={s.poolMinIntervalSec} onChange={(v) => set({ poolMinIntervalSec: v })} />
        </Field>
        <Field label={`Pool max total stake (${symbol || 'tokens'})`} hint="Optional. Leave empty for no cap." error={errors.poolMaxTotalStake}>
          <input className={inputCls} inputMode="decimal" placeholder="No cap" value={s.poolMaxTotalStake} onChange={(e) => set({ poolMaxTotalStake: e.target.value })} />
        </Field>
      </Section>

      <Section title="Airdrops">
        <Field label={`Max airdrop per round (${symbol || 'tokens'})`} hint="0 turns airdrops off" error={errors.maxAirdropPerRound}>
          <input className={inputCls} inputMode="decimal" placeholder="0" value={s.maxAirdropPerRound} onChange={(e) => set({ maxAirdropPerRound: e.target.value })} />
        </Field>
      </Section>

      {includeExecution && (
        <Section title="Who can trigger actions">
          <Field label="Execution">
            <Segmented value={s.openExecution} onChange={(v) => set({ openExecution: v })} options={[
              { value: false, label: 'Approved agents only' }, { value: true, label: 'Anyone' },
            ]} />
          </Field>
        </Section>
      )}
    </div>
  );
}
