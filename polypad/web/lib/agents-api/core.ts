// Polypad for Agents (v1): shared helpers. Polypad never holds keys and never signs; it only returns unsigned transactions.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createPublicClient, getAddress, http, isAddress, zeroAddress, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { prisma } from '@/lib/db';
import { cleanLine, cleanText, safeHttpUrl } from '@/lib/sanitize';

import { CHAIN_ID, LIMITS, TERMS_VERSION } from './terms';

export { CHAIN_ID, LIMITS, TERMS_VERSION };
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Server read client on the existing chain RPC (no new endpoints). */
export const agentClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }),
}) as PublicClient;

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new NextResponse(JSON.stringify(body, replacer), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function fail(status: number, error: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return json({ error, message, ...extra }, status, headers);
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function clientIpHash(req: Request): string {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return sha256(`polypad-agents:${ip}`);
}

export function newApiKey() {
  const key = `pp_live_${crypto.randomBytes(24).toString('base64url')}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 12) };
}

function readKey(req: Request): string {
  const h = req.headers.get('x-api-key')?.trim();
  if (h) return h;
  const a = req.headers.get('authorization') ?? '';
  return a.toLowerCase().startsWith('bearer ') ? a.slice(7).trim() : '';
}

export type AgentKey = { id: string; agentName: string; operatorUrl: string };

/** Resolves the API key or returns a 401 response. */
export async function requireKey(req: Request): Promise<AgentKey | NextResponse> {
  const raw = readKey(req);
  if (!raw || !raw.startsWith('pp_live_') || raw.length > 80) {
    return fail(401, 'api_key_required', 'Send your API key in the x-api-key header. Get one with POST /api/agents/v1/keys.');
  }
  const row = await prisma.agentApiKey.findUnique({ where: { keyHash: sha256(raw) } });
  if (!row || row.revoked) return fail(401, 'invalid_api_key', 'This API key is unknown or revoked.');
  return { id: row.id, agentName: row.agentName, operatorUrl: row.operatorUrl };
}

type TermsBody = { acceptTerms?: unknown; termsVersion?: unknown };

/** Every subject (wallet:<addr>, key:<id>) must have accepted TERMS_VERSION; a first call can accept in the body. */
export async function ensureTerms(subjects: string[], body: TermsBody): Promise<NextResponse | null> {
  const rows = await prisma.agentTermsAcceptance.findMany({ where: { subject: { in: subjects }, version: TERMS_VERSION } });
  const missing = subjects.filter((s) => !rows.some((r) => r.subject === s));
  if (missing.length === 0) return null;
  if (body.acceptTerms === true && body.termsVersion === TERMS_VERSION) {
    await prisma.agentTermsAcceptance.createMany({ data: missing.map((subject) => ({ subject, version: TERMS_VERSION })), skipDuplicates: true });
    return null;
  }
  return fail(403, 'terms_required', `First call from this wallet or key must include "acceptTerms": true and "termsVersion": "${TERMS_VERSION}".`, {
    termsVersion: TERMS_VERSION,
    termsUrl: '/agents/launch#terms',
    missing: missing.map((s) => s.split(':')[0]),
  });
}

/** 3 builds per wallet and 10 per API key in a rolling 24h window. */
export async function checkBuildLimits(wallet: string, keyId: string): Promise<NextResponse | null> {
  const since = new Date(Date.now() - DAY_MS);
  const checks: [string, number, { wallet: string } | { keyId: string }][] = [
    ['wallet', LIMITS.walletBuilds, { wallet }],
    ['api_key', LIMITS.keyBuilds, { keyId }],
  ];
  for (const [scope, limit, where] of checks) {
    const rows = await prisma.agentBuild.findMany({ where: { ...where, createdAt: { gt: since } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true }, take: limit });
    if (rows.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((rows[0].createdAt.getTime() + DAY_MS - Date.now()) / 1000));
      return fail(429, 'rate_limited', `Limit reached: ${limit} builds per ${scope === 'wallet' ? 'wallet' : 'API key'} per 24 hours.`, { scope, limit, window: '24h', retryAfter }, { 'retry-after': String(retryAfter) });
    }
  }
  return null;
}

/** Small in-memory attempt limiter for unstored work (failed simulations, uploads). */
const attempts = new Map<string, number[]>();
export function allowAttempt(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) { attempts.set(key, list); return false; }
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 5000) attempts.clear();
  return true;
}

// ---- Launch parameter validation ----

const E = (n: number) => BigInt(10) ** BigInt(n);
const SUPPLY_MIN = E(24);
const SUPPLY_MAX = E(30);
const VETH_MIN = E(16); // 0.01 ETH
const VETH_MAX = E(21); // 1000 ETH
const MAX_DELAY = BigInt(30 * 24 * 60 * 60);

function toBig(v: unknown, field: string, errors: string[], def = BigInt(0)): bigint {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d{1,40}$/.test(v.trim())) return BigInt(v.trim());
  errors.push(`${field} must be a non-negative integer (wei as a decimal string).`);
  return def;
}

export type LaunchArgs = {
  name: string; symbol: string; imageUri: string; description: string; socialLinks: string[];
  creatorFeeBps: bigint; creatorPayoutWallet: `0x${string}`; devBuyEth: bigint; totalSupply: bigint;
  virtualEthReserve: bigint; launchDelay: bigint;
};

export function validateLaunch(body: Record<string, unknown>):
  | { ok: true; from: `0x${string}`; value: bigint; args: LaunchArgs }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const p = (body.params && typeof body.params === 'object' ? body.params : body) as Record<string, unknown>;

  const fromRaw = typeof body.from === 'string' ? body.from.trim() : '';
  if (!isAddress(fromRaw)) errors.push('from must be the wallet address that will sign and send the transaction.');

  const name = cleanLine(p.name, 64);
  const symbol = cleanLine(p.symbol, 16);
  if (!name) errors.push('name is required.');
  if (!symbol) errors.push('symbol is required.');
  const description = cleanText(p.description, 1000);

  let imageUri = '';
  if (typeof p.imageUri === 'string' && p.imageUri.trim()) {
    const s = p.imageUri.trim();
    if (/^ipfs:\/\/[A-Za-z0-9/._-]{10,200}$/.test(s)) imageUri = s;
    else if (s.startsWith('https://')) imageUri = safeHttpUrl(s, 512) ?? '';
    if (!imageUri) errors.push('imageUri must be an https:// or ipfs:// URL (max 512 characters). Use POST /metadata to host an image.');
  }

  let socialLinks: string[] = [];
  if (p.socialLinks !== undefined) {
    if (!Array.isArray(p.socialLinks)) errors.push('socialLinks must be an array of URLs.');
    else if (p.socialLinks.length > 10) errors.push('socialLinks: at most 10 links.');
    else {
      socialLinks = p.socialLinks.map((l) => safeHttpUrl(l, 256)).filter((l): l is string => !!l);
      if (socialLinks.length !== p.socialLinks.length) errors.push('socialLinks must all be http(s) URLs (max 256 characters).');
    }
  }

  const creatorFeeBps = toBig(p.creatorFeeBps, 'creatorFeeBps', errors);
  if (creatorFeeBps > BigInt(500)) errors.push('creatorFeeBps must be between 0 and 500 (0-5%).');

  let creatorPayoutWallet: `0x${string}` = zeroAddress;
  if (p.creatorPayoutWallet !== undefined && p.creatorPayoutWallet !== '') {
    if (typeof p.creatorPayoutWallet === 'string' && isAddress(p.creatorPayoutWallet.trim())) creatorPayoutWallet = getAddress(p.creatorPayoutWallet.trim());
    else errors.push('creatorPayoutWallet must be an address.');
  }

  const devBuyEth = toBig(p.devBuyEth, 'devBuyEth', errors);
  const totalSupply = toBig(p.totalSupply, 'totalSupply', errors);
  if (totalSupply !== BigInt(0) && (totalSupply < SUPPLY_MIN || totalSupply > SUPPLY_MAX)) errors.push('totalSupply must be 0 (default) or between 1e24 and 1e30 wei.');
  const virtualEthReserve = toBig(p.virtualEthReserve, 'virtualEthReserve', errors);
  if (virtualEthReserve !== BigInt(0) && (virtualEthReserve < VETH_MIN || virtualEthReserve > VETH_MAX)) errors.push('virtualEthReserve must be 0 (default) or between 0.01 and 1000 ETH (1e16-1e21 wei).');
  const launchDelay = toBig(p.launchDelay, 'launchDelay', errors);
  if (launchDelay > MAX_DELAY) errors.push('launchDelay must be at most 30 days (2592000 seconds).');

  const value = toBig(body.value ?? p.value, 'value', errors, devBuyEth);
  if (value !== devBuyEth) errors.push('value must equal devBuyEth.');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    from: getAddress(fromRaw),
    value,
    args: { name, symbol, imageUri, description, socialLinks, creatorFeeBps, creatorPayoutWallet, devBuyEth, totalSupply, virtualEthReserve, launchDelay },
  };
}

export const isTxHash = (s: unknown): s is `0x${string}` => typeof s === 'string' && /^0x[0-9a-fA-F]{64}$/.test(s);

/** Short, single-line error reason from a viem error (no stack, no RPC URL). */
export function shortReason(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  return cleanLine(err?.shortMessage ?? err?.message ?? 'Unknown error', 300);
}

// Cached list of agent-launched addresses (badge + filter).
let launchedCache: { at: number; value: { launch: string; token: string }[] } | null = null;
export async function getAgentLaunched(): Promise<{ launch: string; token: string }[]> {
  if (launchedCache && Date.now() - launchedCache.at < 60_000) return launchedCache.value;
  const rows = await prisma.agentLaunch.findMany({ select: { launchAddress: true, tokenAddress: true }, orderBy: { createdAt: 'desc' }, take: 5000 });
  launchedCache = { at: Date.now(), value: rows.map((r) => ({ launch: r.launchAddress, token: r.tokenAddress })) };
  return launchedCache.value;
}
export function clearAgentLaunchedCache() { launchedCache = null; }
