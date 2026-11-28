import { getAddress } from 'viem';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/agents-api/core';
import { keySubject, walletSubject } from '@/lib/credits/ledger';

export type ResolvedSubject =
  | {
      ok: true;
      subject: string;
      subjectType: 'wallet' | 'key';
      key?: { prefix: string; agentName: string; revoked: boolean };
    }
  | { ok: false; status: number; reason: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isWalletAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_RE.test(value);
}

/**
 * Look a Pro key up by value (SHA-256 hash only — the key itself is never
 * stored or logged). Mirrors the usage route: a revoked key is still
 * identifiable, so it can view its own balance/history, but it can never
 * spend or claim. Returns null when the key is unknown; 'degraded' when
 * the database could not be reached to check it.
 */
export async function lookupKey(
  key: string,
): Promise<
  | { found: true; keyId: string; prefix: string; agentName: string; revoked: boolean }
  | { found: false; degraded: boolean }
> {
  try {
    const row = await prisma.agentApiKey.findUnique({
      where: { keyHash: sha256(key.trim()) },
      select: { id: true, prefix: true, agentName: true, revoked: true },
    });
    if (!row) return { found: false, degraded: false };
    return { found: true, keyId: row.id, prefix: row.prefix, agentName: row.agentName, revoked: row.revoked };
  } catch {
    return { found: false, degraded: true };
  }
}

/**
 * Resolve ?key= / ?wallet= (exactly one required) to a ledger subject.
 *
 * The key arrives as a query param ONLY on these lookup routes. It is hashed
 * before any lookup, never stored, and never echoed back — only the stored
 * prefix and agent name are returned. A revoked key can still view its
 * balance/history (same rule as the usage page); an unknown key is a 404.
 */
export async function resolveSubjectFromQuery(req: Request): Promise<ResolvedSubject> {
  const params = new URL(req.url).searchParams;
  const key = params.get('key')?.trim() ?? '';
  const wallet = params.get('wallet')?.trim() ?? '';
  if ((key && wallet) || (!key && !wallet)) {
    return { ok: false, status: 400, reason: 'Send exactly one of ?key= or ?wallet=.' };
  }
  if (key) {
    if (!key.startsWith('pp_live_') || key.length > 80) {
      return { ok: false, status: 400, reason: 'That does not look like a Pro key — it starts with pp_live_.' };
    }
    const row = await lookupKey(key);
    if (!row.found) {
      return {
        ok: false,
        status: row.degraded ? 503 : 404,
        reason: row.degraded
          ? 'Could not verify the key right now. Try again in a moment.'
          : 'This Pro key is unknown. Get a Pro key from polypad.family/agents/accounts.',
      };
    }
    return {
      ok: true,
      subject: keySubject(row.keyId),
      subjectType: 'key',
      key: { prefix: row.prefix, agentName: row.agentName, revoked: row.revoked },
    };
  }
  if (!isWalletAddress(wallet)) {
    return { ok: false, status: 400, reason: 'That wallet address does not look right — it should start with 0x and be 42 characters long.' };
  }
  return { ok: true, subject: walletSubject(getAddress(wallet)), subjectType: 'wallet' };
}

/**
 * Resolve a Pro key from a POST JSON body to its key id. Only an existing,
 * unrevoked key resolves — for claim/link-key, which spend or grant.
 */
export async function resolveKeyId(key: unknown): Promise<{ keyId: string } | { keyId: null; degraded: boolean }> {
  if (typeof key !== 'string' || !key.startsWith('pp_live_') || key.length > 80) {
    return { keyId: null, degraded: false };
  }
  const row = await lookupKey(key);
  if (!row.found) return { keyId: null, degraded: row.degraded };
  if (row.revoked) return { keyId: null, degraded: false };
  return { keyId: row.keyId };
}
