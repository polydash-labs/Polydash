// Sign-page funnel events + admin session. Server only.
import crypto from 'crypto';
import { getAddress } from 'viem';
import { agentClient } from '@/lib/agents-api/core';
import { PolydashFactoryABI } from '@/lib/contracts/abis';
import { FACTORY } from '@/lib/cto/chain';

export const AGENT_ACTIONS = ['buy', 'sell', 'nft-buy', 'nft-mint', 'fund-create', 'fund-mint', 'fund-redeem', 'token-launch'] as const;
export const AGENT_STATUSES = ['viewed', 'connected', 'sent', 'confirmed', 'failed'] as const;
export const REF_RE = /^[a-z0-9_-]{1,24}$/;
export const isClient = (s: unknown): s is string => typeof s === 'string' && s.length >= 1 && s.length <= 64 && !/[\u0000-\u001f]/.test(s);

// ---- Admin: the wallet that owns the Polypad launch factory (read on-chain, never stored) ----

export const ADMIN_COOKIE = 'pp_admin_actions';
const ADMIN_TTL = 8 * 60 * 60;
export const adminLoginMessage = (nonce: string) => `Polypad admin: view agent actions. Nonce: ${nonce}`;

let ownerCache: { at: number; owner: string } | null = null;
export async function factoryOwner(): Promise<string | null> {
  if (ownerCache && Date.now() - ownerCache.at < 5 * 60_000) return ownerCache.owner;
  try {
    const o = (await agentClient.readContract({ address: FACTORY, abi: PolydashFactoryABI, functionName: 'owner' })) as string;
    ownerCache = { at: Date.now(), owner: o.toLowerCase() };
    return ownerCache.owner;
  } catch (e: any) {
    console.error('factory owner read failed', e?.shortMessage ?? e?.message);
    return ownerCache?.owner ?? null;
  }
}

function secret() {
  const s = process.env.CTO_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('Session secret is not configured.');
  return s;
}
const mac = (p: string) => crypto.createHmac('sha256', secret()).update(`admin-actions|${p}`).digest('hex');

export function signAdmin(address: string) {
  const payload = `${getAddress(address).toLowerCase()}|${Math.floor(Date.now() / 1000) + ADMIN_TTL}`;
  return `${payload}|${mac(payload)}`;
}

/** Signed-in admin address if the cookie is valid AND the wallet still owns the factory. */
export async function readAdmin(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const [addr, exp, sig] = value.split('|');
  if (!addr || !exp || !sig || !/^0x[0-9a-f]{40}$/.test(addr) || !(Number(exp) > Date.now() / 1000)) return null;
  const a = Buffer.from(sig, 'hex'), b = Buffer.from(mac(`${addr}|${exp}`), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const owner = await factoryOwner();
  return owner && owner === addr ? addr : null;
}

export const adminCookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: ADMIN_TTL };
