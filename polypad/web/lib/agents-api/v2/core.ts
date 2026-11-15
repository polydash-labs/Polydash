/**
 * Shared plumbing for the v2 agent API: typed errors, input parsing, abuse guards, and the context
 * every handler receives. No handler in this folder reads an environment variable that holds a key.
 */
import { BaseError, createPublicClient, getAddress, http, isAddress, isHex, zeroAddress, type PublicClient } from 'viem';
import { robinhoodChain } from '../../chain';
import { createRateLimiter, clientIp } from '../../logo-upload';
import { containsKeyMaterial } from '../../agent-launch';
import { ADDR, CHAIN_ID, LIMITS, rpcUrl } from './config';

export type Addr = `0x${string}`;

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Remove anything that could carry an RPC endpoint, credential, or key lookalike from an outgoing message. */
export function scrub(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>)\]]+/gi, (m) => (/^https:\/\/(polypad\.family|robinhoodchain\.blockscout\.com|polydash\.gitbook\.io)(\/|$)/i.test(m) ? m : '[url]'))
    .replace(/0x[0-9a-fA-F]{64}\b/g, '[hex32]')
    .replace(/\b(?:api[_-]?key|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 400);
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof BaseError) {
    const short = (err as BaseError & { shortMessage?: string }).shortMessage ?? 'Chain read failed.';
    return new ApiError(503, 'rpc_unavailable', scrub(short));
  }
  return new ApiError(500, 'internal_error', 'Unexpected error. Nothing was signed or sent.');
}

// ---------------------------------------------------------------- context

export type RateBuckets = Record<'read' | 'prepare' | 'perWalletPrepare' | 'intent', { allow: (key: string) => boolean }>;

export function createRateBuckets(now?: () => number): RateBuckets {
  const r = LIMITS.rate;
  return {
    read: createRateLimiter(r.read.limit, r.read.windowMs, now),
    prepare: createRateLimiter(r.prepare.limit, r.prepare.windowMs, now),
    perWalletPrepare: createRateLimiter(r.perWalletPrepare.limit, r.perWalletPrepare.windowMs, now),
    intent: createRateLimiter(r.intent.limit, r.intent.windowMs, now),
  };
}

export type ActionRecord = {
  at: number;
  action: string;
  ref: string;
  client: string | null;
  from: string | null;
  ok: boolean;
  /** keccak of the unsigned transaction, so a later on-chain match can be counted. */
  txHash32?: string;
};

export interface ActionSink {
  record(row: ActionRecord): void;
  summary(): Record<string, unknown>;
}

/** In-memory sink. Per process. A database-backed sink is specified in the Abacus prompt. */
export function memorySink(max = 2000): ActionSink {
  const rows: ActionRecord[] = [];
  return {
    record(row) {
      rows.push(row);
      if (rows.length > max) rows.splice(0, rows.length - max);
      // One JSON line per prepared action, no wallet address, so hosting logs can be counted.
      console.log(JSON.stringify({ evt: 'polypad_agent_action', at: row.at, action: row.action, ref: row.ref, client: row.client, ok: row.ok }));
    },
    summary() {
      const byAction: Record<string, number> = {};
      const byRef: Record<string, number> = {};
      const wallets = new Set<string>();
      let okCount = 0;
      for (const r of rows) {
        byAction[r.action] = (byAction[r.action] ?? 0) + 1;
        byRef[r.ref] = (byRef[r.ref] ?? 0) + 1;
        if (r.from) wallets.add(r.from.toLowerCase());
        if (r.ok) okCount += 1;
      }
      return { window: 'this process, last ' + max + ' actions', total: rows.length, prepared: okCount, uniqueWallets: wallets.size, byAction, byRef };
    },
  };
}

export type Ctx = {
  client: PublicClient;
  limits: RateBuckets;
  sink: ActionSink;
  now: () => number;
  /** Seconds since epoch, overridable in tests. */
  nowSec: () => number;
  cache: Map<string, { at: number; value: unknown }>;
};

/** Small TTL cache for chain reads that are the same for every caller (listings, templates). */
export async function cached<T>(ctx: Ctx, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = ctx.cache.get(key);
  const t = ctx.now();
  if (hit && t - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  ctx.cache.set(key, { at: t, value });
  if (ctx.cache.size > 400) ctx.cache.clear();
  return value;
}

let sharedClient: PublicClient | undefined;
export function defaultClient(): PublicClient {
  if (!sharedClient) {
    sharedClient = createPublicClient({
      chain: robinhoodChain,
      transport: http(rpcUrl(), { timeout: 12_000, retryCount: 1 }),
      batch: { multicall: true },
    }) as PublicClient;
  }
  return sharedClient;
}

let sharedCtx: Ctx | undefined;
export function defaultCtx(): Ctx {
  if (!sharedCtx) {
    sharedCtx = {
      client: defaultClient(),
      limits: createRateBuckets(),
      sink: memorySink(),
      now: Date.now,
      nowSec: () => Math.floor(Date.now() / 1000),
      cache: new Map(),
    };
  }
  return sharedCtx;
}

export function makeCtx(client: PublicClient, extra: Partial<Ctx> = {}): Ctx {
  return {
    client,
    limits: createRateBuckets(),
    sink: memorySink(),
    now: Date.now,
    nowSec: () => Math.floor(Date.now() / 1000),
    cache: new Map(),
    ...extra,
  };
}

// ---------------------------------------------------------------- request meta

export type Meta = { ip: string; client: string | null; ref: string };

const CLIENT_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const REF_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export function metaOf(req: Request | null, input: Record<string, unknown> = {}): Meta {
  const header = req?.headers.get('x-polypad-client')?.trim() ?? '';
  const client = CLIENT_RE.test(header) ? header : null;
  const wanted = typeof input.ref === 'string' ? input.ref.trim().toLowerCase() : '';
  return { ip: req ? clientIp(req) : 'mcp', client, ref: REF_RE.test(wanted) ? wanted : 'grok' };
}

export function takeLimit(ctx: Ctx, bucket: keyof RateBuckets, meta: Meta, wallet?: string | null): void {
  if (!ctx.limits[bucket].allow(`${bucket}:${meta.ip}`)) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Wait a minute and try again.', {
      retryAfter: 60,
      limit: LIMITS.rate[bucket].limit,
      window: '1m',
    });
  }
  if (bucket === 'prepare' && wallet && !ctx.limits.perWalletPrepare.allow(`w:${wallet.toLowerCase()}`)) {
    throw new ApiError(429, 'rate_limited_wallet', 'Too many prepared actions for this wallet. Wait a minute and try again.', {
      retryAfter: 60,
      limit: LIMITS.rate.perWalletPrepare.limit,
      window: '1m',
    });
  }
}

// ---------------------------------------------------------------- input parsing

export function bodyGuard(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'invalid_json', 'Expected a JSON object.');
  }
  if (containsKeyMaterial(input) || hasKeyLookalike(input)) {
    throw new ApiError(400, 'key_material_rejected', 'Do not send private keys or seed phrases. Polypad never needs them. Nothing was processed.');
  }
  return input as Record<string, unknown>;
}

function hasKeyLookalike(value: unknown): boolean {
  if (typeof value === 'string') return /^(0x)?[0-9a-fA-F]{64}$/.test(value.trim());
  if (Array.isArray(value)) return value.some(hasKeyLookalike);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasKeyLookalike);
  return false;
}

export function reqAddress(input: Record<string, unknown>, field: string, opts: { allowZero?: boolean } = {}): Addr {
  const v = input[field];
  if (typeof v !== 'string' || !isAddress(v.trim(), { strict: false })) {
    throw new ApiError(400, 'invalid_params', `${field} must be a 0x address.`, { field });
  }
  const out = getAddress(v.trim());
  if (!opts.allowZero && out === zeroAddress) throw new ApiError(400, 'invalid_params', `${field} cannot be the zero address.`, { field });
  return out;
}

export function optAddress(input: Record<string, unknown>, field: string): Addr | undefined {
  const v = input[field];
  if (v === undefined || v === null || v === '') return undefined;
  return reqAddress(input, field);
}

/** Wei or token base units as a decimal string. Floats and negatives are rejected. */
export function parseUnits10(v: unknown, field: string): bigint {
  if (typeof v === 'string' && /^\d{1,40}$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new ApiError(400, 'invalid_params', `${field} must be a whole number of base units as a decimal string (wei for ETH).`, { field });
}

export function optUint(v: unknown, field: string, def: number, min: number, max: number): number {
  if (v === undefined || v === null || v === '') return def;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(400, 'invalid_params', `${field} must be an integer from ${min} to ${max}.`, { field });
  }
  return n;
}

export function slippageOf(input: Record<string, unknown>): number {
  const n = optUint(input.slippageBps, 'slippageBps', LIMITS.defaultSlippageBps, 0, LIMITS.maxSlippageBps);
  return n;
}

export function reqTxHash(input: Record<string, unknown>, field = 'hash'): `0x${string}` {
  const v = input[field];
  if (typeof v !== 'string' || !isHex(v.trim()) || v.trim().length !== 66) throw new ApiError(400, 'invalid_params', `${field} must be a 32-byte 0x transaction hash.`, { field });
  return v.trim() as `0x${string}`;
}

/** Large-amount guard. Returns a human note when the amount is above the confirm threshold. */
export function guardAmountWei(wei: bigint, input: Record<string, unknown>, label = 'amount'): void {
  if (wei <= 0n) throw new ApiError(400, 'invalid_params', `${label} must be above zero.`);
  if (wei > LIMITS.maxActionWei) {
    throw new ApiError(400, 'amount_too_large', `${label} is above the ${LIMITS.maxActionWei / 10n ** 18n} ETH cap for one prepared action. Split it into smaller actions.`);
  }
  if (wei > LIMITS.confirmLargeWei && input.confirmLarge !== true) {
    throw new ApiError(400, 'confirm_large_required', `${label} is above ${LIMITS.confirmLargeWei / 10n ** 18n} ETH. Ask the user to confirm the amount, then resend with "confirmLarge": true.`);
  }
}

export function assertNotFeeWallet(from: Addr): void {
  if (from === ADDR.feeWallet) {
    throw new ApiError(400, 'invalid_params', 'This API does not prepare actions for the Polydash fee wallet.');
  }
}

export const E18 = 10n ** 18n;

/** Decimal ETH string for display. Never used inside a transaction. */
export function ethDisplay(wei: bigint, digits = 6): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / E18;
  const frac = (abs % E18).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

export function unitsDisplay(base: bigint, decimals = 18, digits = 4): string {
  const d = 10n ** BigInt(decimals);
  const whole = base / d;
  const frac = (base % d).toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
}

export function chainIdOk(): number {
  return CHAIN_ID;
}

export const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
