// Promise Ledger presets: shared by the Manage page (client) and the API (server). No free text.
import { getAddress, isAddress } from 'viem';

export type PromiseKind = 'no_sell' | 'hold' | 'staking_live' | 'staking_rewards' | 'payout_fixed';
export type PromiseStatus = 'active' | 'kept' | 'broken' | 'needs_review';
export const KINDS: PromiseKind[] = ['no_sell', 'hold', 'staking_live', 'staking_rewards', 'payout_fixed'];

export const DAYS = {
  no_sell: [7, 14, 30, 60, 90],
  long: [30, 60, 90, 180, 365],
  grad: [7, 14, 30],
} as const;
export const HOLD_PCTS = [50, 75, 90, 100] as const;
export const MAX_LINKED = 3;
export const MAX_ACTIVE = 10;
export const MAX_REWARD_TOKENS = 1_000_000_000_000;

export const PRESET_TITLES: Record<PromiseKind, string> = {
  no_sell: 'No selling',
  hold: 'Hold',
  staking_live: 'Staking live',
  staking_rewards: 'Staking rewards',
  payout_fixed: 'Payout wallet fixed',
};

export interface PromiseParams {
  days: number;
  pct?: number;
  mode?: 'grad' | 'date';
  amount?: string;
  wallets: string[];
}

const DAY = 86_400;

export function fmtUtcDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** endsAt for a preset; 0 for "graduation + N days" (the deadline is known only after graduation). */
export function endsAtFor(kind: PromiseKind, p: PromiseParams, startsAt: number) {
  if (kind === 'staking_live' && p.mode === 'grad') return 0;
  return startsAt + p.days * DAY;
}

/** Deadline used for evaluation: endsAt, or graduation time + N days for P3 graduation mode (null until graduation). */
export function deadlineFor(kind: string, p: PromiseParams, endsAt: number, gradTs: number | null): number | null {
  if (kind === 'staking_live' && p.mode === 'grad') return gradTs ? gradTs + p.days * DAY : null;
  return endsAt;
}

export function sentence(kind: string, p: PromiseParams, symbol: string, endsAt: number) {
  const s = `$${symbol}`;
  const date = fmtUtcDate(endsAt);
  switch (kind) {
    case 'no_sell': return `I won't sell ${s} for ${p.days} days.`;
    case 'hold': return `I'll keep at least ${p.pct}% of my current ${s} until ${date}.`;
    case 'staking_live': return p.mode === 'grad' ? `A ${s} staking pool will be live by graduation + ${p.days} days.` : `A ${s} staking pool will be live by ${date}.`;
    case 'staking_rewards': return `I'll put at least ${Number(p.amount ?? 0).toLocaleString('en-US')} tokens into ${s} staking rewards by ${date}.`;
    case 'payout_fixed': return `My creator payout wallet won't change until ${date}.`;
    default: return 'Unknown promise.';
  }
}

/** Deterministic JSON with sorted keys (the signed `params` string). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export type ParamResult = { ok: true; params: PromiseParams } | { ok: false; error: string };

/** Validates and normalizes raw params; `exclude` are addresses that may not be linked wallets. */
export function validateParams(kind: string, raw: any, exclude: string[] = []): ParamResult {
  if (!KINDS.includes(kind as PromiseKind)) return { ok: false, error: 'Unknown promise type.' };
  const days = Number(raw?.days);
  const walletsRaw: unknown[] = Array.isArray(raw?.wallets) ? raw.wallets : [];
  if (walletsRaw.length > MAX_LINKED) return { ok: false, error: `Up to ${MAX_LINKED} other wallets.` };
  const wallets: string[] = [];
  const ex = new Set(exclude.map((a) => a.toLowerCase()));
  for (const w of walletsRaw) {
    const a = String(w ?? '').trim();
    if (!a) continue;
    if (!isAddress(a, { strict: false })) return { ok: false, error: `Not a valid wallet address: ${a.slice(0, 50)}` };
    const l = getAddress(a).toLowerCase();
    if (ex.has(l) || /^0x0{40}$/.test(l) || l === '0x000000000000000000000000000000000000dead') return { ok: false, error: 'That address cannot be listed as one of your wallets.' };
    if (!wallets.includes(l)) wallets.push(l);
  }
  wallets.sort();
  const p: PromiseParams = { days, wallets };
  const daysIn = (list: readonly number[]) => list.includes(days);
  switch (kind as PromiseKind) {
    case 'no_sell':
      if (!daysIn(DAYS.no_sell)) return { ok: false, error: 'Pick a listed duration.' };
      break;
    case 'hold': {
      const pct = Number(raw?.pct);
      if (!(HOLD_PCTS as readonly number[]).includes(pct) || !daysIn(DAYS.long)) return { ok: false, error: 'Pick a listed share and duration.' };
      p.pct = pct;
      break;
    }
    case 'staking_live': {
      const mode = raw?.mode === 'grad' ? 'grad' : raw?.mode === 'date' ? 'date' : null;
      if (!mode || !daysIn(mode === 'grad' ? DAYS.grad : DAYS.long)) return { ok: false, error: 'Pick a listed deadline.' };
      p.mode = mode;
      break;
    }
    case 'staking_rewards': {
      const amount = String(raw?.amount ?? '').trim();
      if (!/^[1-9]\d{0,12}$/.test(amount) || Number(amount) > MAX_REWARD_TOKENS) return { ok: false, error: 'Enter a whole token amount.' };
      if (!daysIn(DAYS.long)) return { ok: false, error: 'Pick a listed duration.' };
      p.amount = amount;
      break;
    }
    case 'payout_fixed':
      if (!daysIn(DAYS.long)) return { ok: false, error: 'Pick a listed duration.' };
      break;
  }
  return { ok: true, params: p };
}

export const PROMISE_TYPES = {
  Promise: [
    { name: 'launch', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'kind', type: 'string' },
    { name: 'params', type: 'string' },
    { name: 'startsAt', type: 'uint256' },
    { name: 'endsAt', type: 'uint256' },
    { name: 'nonce', type: 'string' },
  ],
} as const;

export function promiseTypedData(input: { launch: string; token: string; kind: string; params: string; startsAt: number; endsAt: number; nonce: string; chainId: number }) {
  return {
    domain: { name: 'Polypad Promise Ledger', version: '1', chainId: input.chainId, verifyingContract: getAddress(input.launch) },
    types: PROMISE_TYPES,
    primaryType: 'Promise' as const,
    message: {
      launch: getAddress(input.launch), token: getAddress(input.token), kind: input.kind, params: input.params,
      startsAt: BigInt(input.startsAt), endsAt: BigInt(input.endsAt), nonce: input.nonce,
    },
  };
}

export const PROMISE_CONFIRM = 'This is public and permanent. You can add promises later but cannot edit or delete them. Promises are tracked from on-chain data. They are not guarantees.';
export const PROMISE_FOOTER = 'Promises are creator self-commitments tracked from on-chain data. They are not guarantees. Not financial advice.';

export interface PromiseView {
  id: number; kind: string; params: PromiseParams; sentence: string; startsAt: number; endsAt: number; deadline: number | null;
  status: PromiseStatus; statusAt: string | null; evidenceTx: string | null; evidenceNote: string | null; createdAt: string;
  signer: string; signature: string; typedData: unknown; tokenAddress: string;
}

export interface PromiseSummary { total: number; kept: number; broken: number; active: number; review: number }
