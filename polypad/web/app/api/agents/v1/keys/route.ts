import { prisma } from '@/lib/db';
import { cleanLine, safeHttpUrl } from '@/lib/sanitize';
import { DAY_MS, LIMITS, TERMS_VERSION, clientIpHash, fail, json, newApiKey } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

/** Issues an operator API key. The key is shown once; only its hash is stored. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, 'invalid_json', 'Send a JSON body.');
    const agentName = cleanLine(body.agentName, 48);
    const operatorUrl = safeHttpUrl(body.operatorUrl, 256);
    const errors: string[] = [];
    if (agentName.length < 2) errors.push('agentName is required (2-48 characters).');
    if (!operatorUrl) errors.push('operatorUrl must be an http(s) URL where the operator can be reached.');
    if (errors.length) return fail(400, 'invalid_params', 'Some fields are invalid.', { details: errors });
    if (body.acceptTerms !== true || body.termsVersion !== TERMS_VERSION) {
      return fail(403, 'terms_required', `Include "acceptTerms": true and "termsVersion": "${TERMS_VERSION}".`, { termsVersion: TERMS_VERSION, termsUrl: '/agents/launch#terms' });
    }
    const ipHash = clientIpHash(req);
    const recent = await prisma.agentApiKey.count({ where: { ipHash, createdAt: { gt: new Date(Date.now() - DAY_MS) } } });
    if (recent >= LIMITS.keysPerIp) {
      return fail(429, 'rate_limited', `Limit reached: ${LIMITS.keysPerIp} new API keys per 24 hours.`, { scope: 'ip', limit: LIMITS.keysPerIp, window: '24h', retryAfter: 86400 }, { 'retry-after': '86400' });
    }
    const { key, hash, prefix } = newApiKey();
    const row = await prisma.agentApiKey.create({ data: { keyHash: hash, prefix, agentName, operatorUrl: operatorUrl!, ipHash } });
    await prisma.agentTermsAcceptance.create({ data: { subject: `key:${row.id}`, version: TERMS_VERSION } });
    return json({ apiKey: key, keyId: row.id, prefix, agentName, operatorUrl, termsVersion: TERMS_VERSION, note: 'Store this key now. It is not shown again.' }, 201);
  } catch (e) {
    console.error('agents v1 keys failed', e);
    return fail(500, 'server_error', 'Could not create the API key.');
  }
}
