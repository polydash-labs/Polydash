/**
 * Optional API keys for the v2 agent API (MCP + REST): the Pro tier.
 *
 * A key buys higher per-minute limits (10x the free limits — "Pro free while growing",
 * decided by Jon Nov 18, 2026) and nothing else: same 25 tools, same 25 ETH per-action
 * cap, same 1 ETH confirmLarge rule. Keys are optional — a call with no key works exactly
 * as before, at the free limits. A call with a bad key gets a 401.
 *
 * Keys are the v1 REST keys (`pp_live_` + 24 random bytes, SHA-256 hash stored, shown
 * once), issued from /agents/accounts and checked the v1 way. One key works for both the
 * v1 launch API and the MCP — there is no separate MCP key type yet, because the key
 * table has no tier column and adding one needs a database migration. When that migration
 * lands, MCP keys can become their own type; until then, any valid unrevoked key is Pro.
 *
 * Degradation rule (the database is the weak point — see lib/db.ts): if the key lookup
 * times out or the database errors, the call falls back to the free tier instead of
 * failing. A key is never granted Pro limits without a successful database check, and
 * a database outage never breaks free calls. Validated key hashes are cached in memory
 * for 60 seconds so a cold database is only woken once per key per process; a revocation
 * can therefore take up to 60 seconds to reach a running process.
 */
import { prisma, withTimeout } from '@/lib/db';
import { sha256 } from '../core';

export type ApiTier = 'free' | 'pro';

export type KeyResolution =
  | { tier: 'pro'; keyId: string; prefix: string }
  | { tier: 'free'; degraded: boolean }
  | { tier: 'invalid'; reason: string };

const KEY_TTL_MS = 60_000;
const KEY_LOOKUP_TIMEOUT_MS = 3_000;

/** In-memory cache of validated key hashes (hash only, never the key) → key identity. */
const validated = new Map<string, { keyId: string; prefix: string; at: number }>();

function readKey(req: Request): string {
  const h = req.headers.get('x-api-key')?.trim();
  if (h) return h;
  const a = req.headers.get('authorization') ?? '';
  return a.toLowerCase().startsWith('bearer ') ? a.slice(7).trim() : '';
}

/**
 * Resolve the API key on a request. No key → free tier. Malformed key → invalid.
 * Well-formed key → database lookup (3s timeout): found and not revoked → Pro;
 * unknown or revoked → invalid; lookup failed or timed out → free tier (degraded).
 */
export async function resolveApiKey(req: Request): Promise<KeyResolution> {
  const raw = readKey(req);
  if (!raw) return { tier: 'free', degraded: false };
  if (!raw.startsWith('pp_live_') || raw.length > 80) {
    return { tier: 'invalid', reason: 'Send your API key in the x-api-key header. Get a Pro key from polypad.family/agents/accounts.' };
  }
  const hash = sha256(raw);
  const hit = validated.get(hash);
  if (hit !== undefined && Date.now() - hit.at < KEY_TTL_MS) return { tier: 'pro', keyId: hit.keyId, prefix: hit.prefix };
  if (hit !== undefined) validated.delete(hash);
  let found: { id: string; prefix: string; revoked: boolean } | null;
  try {
    const res = await withTimeout(
      prisma.agentApiKey.findUnique({ where: { keyHash: hash }, select: { id: true, prefix: true, revoked: true } }).then((row) => ({ row })),
      KEY_LOOKUP_TIMEOUT_MS,
    );
    if (res === null) {
      console.warn('agents v2 key lookup timed out; serving free tier');
      return { tier: 'free', degraded: true };
    }
    found = res.row;
  } catch {
    console.warn('agents v2 key lookup failed; serving free tier');
    return { tier: 'free', degraded: true };
  }
  if (!found || found.revoked) {
    return { tier: 'invalid', reason: 'This API key is unknown or revoked. Free calls need no key — send no key at all, or get a Pro key from polypad.family/agents/accounts.' };
  }
  validated.set(hash, { keyId: found.id, prefix: found.prefix, at: Date.now() });
  if (validated.size > 5000) validated.clear();
  return { tier: 'pro', keyId: found.id, prefix: found.prefix };
}
