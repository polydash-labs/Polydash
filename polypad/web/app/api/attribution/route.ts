import { allowAttempt, clientIpHash, fail, isTxHash, json } from '@/lib/agents-api/core';
import { attributionForHashes } from '@/lib/attribution-server';

export const dynamic = 'force-dynamic';

/** GET /api/attribution?hashes=0x..,0x.. (max 50). Labels come from each transaction's ERC-8021 suffix. */
export async function GET(req: Request) {
  if (!allowAttempt(`attr:${clientIpHash(req)}`, 120, 60_000)) return fail(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  const raw = new URL(req.url).searchParams.get('hashes') ?? '';
  const hashes = raw.split(',').map((h) => h.trim()).filter(Boolean);
  if (hashes.length === 0 || hashes.length > 50 || !hashes.every((h) => isTxHash(h))) return fail(400, 'bad_request', 'Send 1 to 50 transaction hashes in ?hashes=.');
  return json({ results: await attributionForHashes(hashes) }, 200, { 'cache-control': 'public, max-age=60' });
}
