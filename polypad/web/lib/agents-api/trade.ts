// Polypad for Agents (v1): reads and unsigned transaction builders for existing launches.
// Polypad never holds keys and never signs. Every write is returned unsigned for the caller's own wallet.
import { decodeErrorResult, encodeFunctionData, getAddress, isAddress, zeroAddress, type Hex } from 'viem';
import { PolydashLaunchABI, PolydashTokenABI } from '@/lib/contracts/abis';
import { getLaunchLookup, getLaunchesSnapshot } from '@/lib/launches-server';
import { isAgentLaunched } from '@/lib/agent-mark';
import type { LaunchToken } from '@/lib/token-types';
import { CHAIN_ID, agentClient, allowAttempt, clientIpHash, fail, json, shortReason } from './core';

export type Addr = `0x${string}`;

export const PHASE_NAME: Record<number, string> = { 0: 'uninitialized', 1: 'commit_window', 2: 'processing_commitments', 3: 'trading', 4: 'graduated' };
export const MIN_COMMIT_WEI = BigInt(10) ** BigInt(14); // 0.0001 ETH, same as the token page
export const DEFAULT_SLIPPAGE_BPS = 100;
export const MAX_SLIPPAGE_BPS = 5000;
const TX_LIMIT = 60;
const TX_WINDOW_MS = 60_000;

export const SIGNING_NOTE =
  'Unsigned. Sign each transaction in order with the from address in your own wallet and broadcast it yourself. Polypad does not accept private keys and does not send transactions.';

export function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-polypad-client',
    'access-control-max-age': '86400',
  };
}

export const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) => json(body, status, { ...cors(), ...headers });
export const bad = (status: number, error: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  fail(status, error, message, extra, { ...cors(), ...headers });

/** 60 requests per minute per client IP for quotes and transaction builders. */
export function txLimited(req: Request) {
  if (allowAttempt(`agent-tx:${clientIpHash(req)}`, TX_LIMIT, TX_WINDOW_MS)) return null;
  return bad(429, 'rate_limited', `Limit reached: ${TX_LIMIT} requests per minute per IP.`, { scope: 'ip', limit: TX_LIMIT, window: '1m', retryAfter: 60 }, { 'retry-after': '60' });
}

export function parseAddr(v: unknown): Addr | null {
  if (typeof v !== 'string' || !isAddress(v.trim(), { strict: false })) return null;
  const a = getAddress(v.trim());
  return a === zeroAddress ? null : a;
}

/** Amounts are decimal base-unit strings (wei). Floats are rejected. */
export function parseWei(v: unknown): bigint | null {
  if (typeof v === 'string' && /^\d{1,40}$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return null;
}

export function parseSlippage(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return DEFAULT_SLIPPAGE_BPS;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_SLIPPAGE_BPS) return null;
  return n;
}

const E18 = BigInt(10) ** BigInt(18);
/** Display-only decimal ETH string from a float field of the launch snapshot. */
const ethStr = (n: number) => (Number.isFinite(n) ? n.toFixed(18).replace(/\.?0+$/, '') : '0');
const ethToWeiStr = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const [i, f = ''] = n.toFixed(18).split('.');
  return (BigInt(i) * E18 + BigInt((f + '0'.repeat(18)).slice(0, 18))).toString();
};

/** Public summary of a launch. Base-unit strings for amounts; *Display fields are for display only. */
export function tokenSummary(t: LaunchToken) {
  const launch = t.launchAddress.toLowerCase();
  return {
    chainId: CHAIN_ID,
    launchAddress: launch,
    tokenAddress: t.tokenAddress.toLowerCase(),
    decimals: 18,
    name: t.name,
    symbol: t.symbol,
    imageUri: t.imageUri,
    creator: t.creator.toLowerCase(),
    creatorFeeBps: t.creatorFeeBps,
    phase: t.phase,
    phaseName: PHASE_NAME[t.phase] ?? 'unknown',
    graduated: t.graduated,
    tradeVenue: t.graduated ? 'uniswap_v4' : t.phase === 3 ? 'bonding_curve' : t.phase === 1 ? 'commit_window' : 'not_open',
    curveProgressPct: t.curveProgress,
    ethRaisedWei: ethToWeiStr(t.ethRaised),
    graduationThresholdWei: ethToWeiStr(t.graduationThreshold),
    totalCommittedWei: ethToWeiStr(t.totalCommitted),
    priceEthDisplay: ethStr(t.priceEth),
    totalSupply: t.totalSupply,
    tokensSold: t.tokensSoldWei,
    committers: t.committers,
    launchTime: t.launchTime,
    createdAt: t.createdAt,
    agentLaunched: isAgentLaunched(t.socialLinks),
    url: `https://polypad.family/token/${launch}`,
  };
}

export type TokenQuery = { q: string; phase: string; sort: string; limit: number; agentOnly: boolean };

export async function browseTokens(query: TokenQuery) {
  const all = await getLaunchesSnapshot(6_000);
  if (!all) return null;
  const q = query.q.trim().toLowerCase();
  let list = all.filter((t) => {
    if (q && !(t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.launchAddress.toLowerCase() === q || t.tokenAddress.toLowerCase() === q)) return false;
    if (query.agentOnly && !isAgentLaunched(t.socialLinks)) return false;
    if (query.phase === 'commit') return t.phase === 1;
    if (query.phase === 'trading') return t.phase === 3;
    if (query.phase === 'graduated') return t.phase === 4;
    return true;
  });
  if (query.sort === 'progress') list = [...list].sort((a, b) => b.curveProgress - a.curveProgress);
  else if (query.sort === 'raised') list = [...list].sort((a, b) => b.ethRaised - a.ethRaised);
  else list = [...list].sort((a, b) => b.createdAt - a.createdAt);
  return { total: list.length, items: list.slice(0, query.limit).map(tokenSummary) };
}

/** Resolves a launch or token address to its launch snapshot, or an error response. */
export async function resolveLaunch(v: unknown): Promise<LaunchToken | Response> {
  const a = parseAddr(v);
  if (!a) return bad(400, 'invalid_params', 'token must be a Polypad launch or token address.', { fields: { token: 'Expected a 20-byte hex address.' } });
  const { token, missing } = await getLaunchLookup(a.toLowerCase(), 6_000);
  if (token) return token;
  if (missing) return bad(404, 'not_found', 'Not a Polypad launch or token.');
  return bad(503, 'unavailable', 'Token data is not ready yet. Retry shortly.', {}, { 'retry-after': '5' });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 8192) return bad(413, 'payload_too_large', 'Request body is too large.');
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'invalid_json', 'Send a JSON object.');
  const keys = JSON.stringify(body).toLowerCase();
  if (/privatekey|private_key|mnemonic|seedphrase|seed_phrase/.test(keys)) {
    return bad(400, 'key_material_rejected', 'This API does not accept private keys or seed phrases. Sign the returned transaction in your own wallet.');
  }
  return body as Record<string, unknown>;
}

export type UnsignedTx = { step: number; kind: string; description: string; chainId: number; from: Addr; to: Addr; data: Hex; value: string; gas: string | null };

function revertReason(e: unknown): string {
  const data = (() => {
    let cur: unknown = e;
    for (let i = 0; i < 6 && cur; i++) {
      const d = (cur as { data?: unknown }).data;
      if (typeof d === 'string' && d.startsWith('0x')) return d as Hex;
      cur = (cur as { cause?: unknown }).cause;
    }
    return undefined;
  })();
  if (data && data !== '0x') {
    try {
      return decodeErrorResult({ abi: PolydashLaunchABI, data }).errorName;
    } catch { /* not a launch error */ }
  }
  return shortReason(e);
}

/** eth_call + estimateGas from the signer. Returns gas, or a revert reason, or rpc failure. */
export async function simulate(from: Addr, to: Addr, data: Hex, value: bigint): Promise<{ ok: true; gas: bigint | null } | { ok: false; kind: 'revert' | 'rpc'; reason: string }> {
  try {
    await agentClient.call({ account: from, to, data, value });
  } catch (e) {
    const reason = revertReason(e);
    const rpc = /fetch failed|timeout|timed out|HTTP request failed|ECONN/i.test(String((e as Error)?.message ?? ''));
    return { ok: false, kind: rpc ? 'rpc' : 'revert', reason };
  }
  try {
    return { ok: true, gas: await agentClient.estimateGas({ account: from, to, data, value }) };
  } catch {
    return { ok: true, gas: null };
  }
}

export function txOf(step: number, kind: string, description: string, from: Addr, to: Addr, data: Hex, value: bigint, gas: bigint | null): UnsignedTx {
  return { step, kind, description, chainId: CHAIN_ID, from, to, data, value: value.toString(), gas: gas !== null ? ((gas * BigInt(12)) / BigInt(10)).toString() : null };
}

export const minOut = (v: bigint, bps: number) => (v * BigInt(10_000 - bps)) / BigInt(10_000);

export async function quote(launch: Addr, side: 'buy' | 'sell', amount: bigint) {
  const [out, fees] = (await agentClient.readContract({ address: launch, abi: PolydashLaunchABI, functionName: side === 'buy' ? 'quoteBuy' : 'quoteSell', args: [amount] })) as readonly [bigint, { platform: bigint; creator: bigint; tax: bigint; total: bigint }];
  return { out, fees: { platformWei: fees.platform.toString(), creatorWei: fees.creator.toString(), taxWei: fees.tax.toString(), totalWei: fees.total.toString() } };
}

export const readLaunch = <T>(launch: Addr, functionName: string, args: readonly unknown[] = []) =>
  agentClient.readContract({ address: launch, abi: PolydashLaunchABI, functionName: functionName as never, args: args as never }) as Promise<T>;

export const readToken = <T>(token: Addr, functionName: 'balanceOf' | 'allowance', args: readonly unknown[]) =>
  agentClient.readContract({ address: token, abi: PolydashTokenABI, functionName, args: args as never }) as Promise<T>;

export const encLaunch = (functionName: string, args: readonly unknown[] = []) =>
  encodeFunctionData({ abi: PolydashLaunchABI, functionName: functionName as never, args: args as never });

export const encApprove = (spender: Addr, amount: bigint) =>
  encodeFunctionData({ abi: PolydashTokenABI, functionName: 'approve', args: [spender, amount] });
