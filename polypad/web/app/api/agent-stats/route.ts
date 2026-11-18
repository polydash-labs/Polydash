import { prisma } from '@/lib/db';
import { allowAttempt, clientIpHash, fail, json } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

const WINDOWS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 } as const;

/** Aggregate counts only (no addresses): by action and ref, by status, and unique wallets, for 24h / 7d / 30d. */
export async function GET(req: Request) {
  if (!allowAttempt(`agent-stats:${clientIpHash(req)}`, 60, 60_000)) return fail(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  try {
    const out: Record<string, unknown> = {};
    for (const [key, hours] of Object.entries(WINDOWS)) {
      const where = { createdAt: { gte: new Date(Date.now() - hours * 3600_000) } };
      const [byActionRef, byStatus, wallets, total] = await Promise.all([
        prisma.agentAction.groupBy({ by: ['action', 'ref'], where, _count: { _all: true } }),
        prisma.agentAction.groupBy({ by: ['status'], where, _count: { _all: true } }),
        prisma.agentAction.findMany({ where: { ...where, wallet: { not: null } }, distinct: ['wallet'], select: { wallet: true } }),
        prisma.agentAction.count({ where }),
      ]);
      out[key] = {
        total,
        uniqueWallets: wallets.length,
        byActionRef: byActionRef.map((r) => ({ action: r.action, ref: r.ref, count: r._count._all })).sort((a, b) => b.count - a.count),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      };
    }
    return json({ windows: out, generatedAt: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=60' });
  } catch (e: any) {
    console.error('agent-stats failed', e?.message);
    return fail(500, 'server_error', 'Could not load stats.');
  }
}
