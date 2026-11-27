import { prisma } from '@/lib/db';
import { allowAttempt, clientIpHash, fail, json, sha256 } from '@/lib/agents-api/core';
import { LIMITS } from '@/lib/agents-api/v2/config';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS = 30;
const MAX_ROWS = 5000;

/**
 * Returns per-key usage for a Pro API key: calls over the last 30 days, a
 * breakdown by tool, reads vs prepares vs intent, 429s, calls in the last
 * minute against the Pro limits, and token launches prepared with the key.
 *
 * Authentication is by possession, like revoke: send the full key as "apiKey"
 * in the JSON body (or the x-api-key header). The key itself is never returned,
 * only its prefix and agent name. A revoked key can still view its history.
 */
export async function POST(req: Request) {
  try {
    if (!allowAttempt(`usage:${clientIpHash(req)}`, 60, 60 * 1000)) {
      return fail(429, 'rate_limited', 'Too many usage lookups. Wait a minute and try again.', { scope: 'ip', limit: 60, window: '1m', retryAfter: 60 }, { 'retry-after': '60' });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const fromBody = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const fromHeader = req.headers.get('x-api-key')?.trim() ?? '';
    const raw = fromBody || fromHeader;
    if (!raw || !raw.startsWith('pp_live_') || raw.length > 80) {
      return fail(400, 'invalid_params', 'Send the full API key as "apiKey".');
    }
    const row = await prisma.agentApiKey.findUnique({
      where: { keyHash: sha256(raw) },
      select: { id: true, prefix: true, agentName: true, revoked: true, createdAt: true },
    });
    if (!row) return fail(404, 'invalid_api_key', 'This API key is unknown. Get a Pro key from polypad.family/agents/accounts.');
    const since = new Date(Date.now() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const rows = await prisma.apiKeyUsage.findMany({
      where: { keyId: row.id, createdAt: { gte: since } },
      select: { tool: true, kind: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    const truncated = rows.length >= MAX_ROWS;
    const minuteAgo = Date.now() - 60_000;

    const totals = { calls: 0, reads: 0, prepares: 0, intents: 0, rateLimited: 0, errors: 0 };
    const lastMinute = { reads: 0, prepares: 0, intents: 0 };
    const byTool = new Map<string, { tool: string; calls: number; reads: number; prepares: number }>();
    const byDay = new Map<string, { day: string; calls: number; reads: number; prepares: number }>();
    for (let i = PERIOD_DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      byDay.set(d, { day: d, calls: 0, reads: 0, prepares: 0 });
    }
    for (const r of rows) {
      totals.calls += 1;
      if (r.kind === 'read') totals.reads += 1;
      else if (r.kind === 'prepare') totals.prepares += 1;
      else if (r.kind === 'intent') totals.intents += 1;
      if (r.status === 'rate_limited') totals.rateLimited += 1;
      else if (r.status === 'error') totals.errors += 1;
      if (r.createdAt.getTime() >= minuteAgo) {
        if (r.kind === 'read') lastMinute.reads += 1;
        else if (r.kind === 'prepare') lastMinute.prepares += 1;
        else if (r.kind === 'intent') lastMinute.intents += 1;
      }
      const t = byTool.get(r.tool) ?? { tool: r.tool, calls: 0, reads: 0, prepares: 0 };
      t.calls += 1;
      if (r.kind === 'read') t.reads += 1;
      if (r.kind === 'prepare') t.prepares += 1;
      byTool.set(r.tool, t);
      const day = r.createdAt.toISOString().slice(0, 10);
      const d = byDay.get(day);
      if (d) {
        d.calls += 1;
        if (r.kind === 'read') d.reads += 1;
        if (r.kind === 'prepare') d.prepares += 1;
      }
    }
    // Token launches prepared with this key (v1 launch API keeps its own per-key record).
    const launches = await prisma.agentBuild.count({ where: { keyId: row.id } });

    return json({
      key: { prefix: row.prefix, agentName: row.agentName, createdAt: row.createdAt.toISOString(), revoked: row.revoked },
      periodDays: PERIOD_DAYS,
      truncated,
      totals,
      byDay: [...byDay.values()],
      byTool: [...byTool.values()].sort((a, b) => b.calls - a.calls).slice(0, 10),
      lastMinute,
      limits: {
        read: LIMITS.ratePro.read.limit,
        prepare: LIMITS.ratePro.prepare.limit,
        perWalletPrepare: LIMITS.ratePro.perWalletPrepare.limit,
        intent: LIMITS.ratePro.intent.limit,
      },
      launchesPrepared: launches,
    });
  } catch (e) {
    console.error('agents v1 keys usage failed', e);
    return fail(500, 'server_error', 'Could not load usage for this API key.');
  }
}
