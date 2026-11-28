import { prisma } from '@/lib/db';
import { allowAttempt, clientIpHash, fail, json, sha256 } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

/**
 * Revokes an API key. Revocation is by possession: sending the full key proves you hold
 * it, so no separate owner check is needed (the key table has no owner column). Revocation
 * is permanent — a revoked key is never un-revoked; issue a fresh one instead. The key
 * stops working on the very next call (within 60 seconds on a running process, while the
 * in-memory validation cache clears).
 */
export async function POST(req: Request) {
  try {
    if (!allowAttempt(`revoke:${clientIpHash(req)}`, 10, 60 * 60 * 1000)) {
      return fail(429, 'rate_limited', 'Too many revoke attempts. Wait an hour and try again.', { scope: 'ip', limit: 10, window: '1h', retryAfter: 3600 }, { 'retry-after': '3600' });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const raw = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!raw || !raw.startsWith('pp_live_') || raw.length > 80) {
      return fail(400, 'invalid_params', 'Send the full API key as "apiKey".');
    }
    const row = await prisma.agentApiKey.findUnique({ where: { keyHash: sha256(raw) }, select: { id: true, prefix: true, revoked: true } });
    if (!row) return fail(404, 'invalid_api_key', 'This API key is unknown or already revoked.');
    if (row.revoked) return json({ revoked: true, alreadyRevoked: true, prefix: row.prefix, note: 'This key was already revoked.' });
    await prisma.agentApiKey.update({ where: { id: row.id }, data: { revoked: true } });
    return json({ revoked: true, prefix: row.prefix, note: 'This key is revoked and stops working immediately. Issue a fresh one if you still need a key.' });
  } catch (e) {
    console.error('agents v1 keys revoke failed', e);
    return fail(500, 'server_error', 'Could not revoke the API key.');
  }
}
