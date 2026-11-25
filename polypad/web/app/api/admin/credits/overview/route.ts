import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';
import { totalOutstandingLiability } from '@/lib/credits/ledger';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

const liveWhere = (now: Date) => ({
  balanceCents: { gt: 0 },
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

/**
 * GET /api/admin/credits/overview — admin-only. ?take= (default 100).
 * Total outstanding liability (what Polypad owes in unspent credits),
 * live accounts, and the most recent ledger rows with their subjects.
 *
 * POST /api/admin/credits/overview { action: 'sweep-expired' } — zeroes
 * expired, positive-balance accounts and writes an 'expire' ledger row
 * each. (lib/credits/ledger.ts has no expireStaleAccounts in v1, so the
 * sweep runs here in one transaction.)
 */
export async function GET(req: Request) {
  const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!admin) {
    return NextResponse.json({ error: 'Sign in with the admin wallet.' }, { status: 401, headers: noStore });
  }
  const takeRaw = Number(new URL(req.url).searchParams.get('take') ?? '100');
  const take = Number.isFinite(takeRaw) ? Math.min(500, Math.max(1, Math.floor(takeRaw))) : 100;
  try {
    const now = new Date();
    const [total, liveAccounts, accounts, recent] = await Promise.all([
      totalOutstandingLiability(),
      prisma.polyCreditAccount.count({ where: liveWhere(now) }),
      prisma.polyCreditAccount.findMany({
        where: liveWhere(now),
        orderBy: { updatedAt: 'desc' },
        take,
        select: { subject: true, balanceCents: true, expiresAt: true },
      }),
      prisma.polyCreditLedger.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { accountId: true, kind: true, amountCents: true, balanceAfterCents: true, reason: true, createdAt: true },
      }),
    ]);
    const accountIds = [...new Set(recent.map((r) => r.accountId))];
    const subjects = new Map(
      (await prisma.polyCreditAccount.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, subject: true },
      })).map((a) => [a.id, a.subject] as const),
    );
    return NextResponse.json(
      {
        totalOutstandingLiabilityCents: total,
        totalOutstandingLiabilityUsd: total / 100,
        liveAccounts,
        accounts: accounts.map((a) => ({
          subject: a.subject,
          balanceCents: a.balanceCents,
          expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
          expired: a.expiresAt !== null && a.expiresAt <= now,
        })),
        recentLedger: recent.map((r) => ({
          subject: subjects.get(r.accountId) ?? r.accountId,
          kind: r.kind,
          amountCents: r.amountCents,
          balanceAfterCents: r.balanceAfterCents,
          reason: r.reason ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      { headers: noStore },
    );
  } catch (e: unknown) {
    console.error('admin credits overview failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not load the overview.' }, { status: 500, headers: noStore });
  }
}

export async function POST(req: Request) {
  const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!admin) {
    return NextResponse.json({ error: 'Sign in with the admin wallet.' }, { status: 401, headers: noStore });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Send a JSON body.' }, { status: 400, headers: noStore });
  }
  if (body.action !== 'sweep-expired') {
    return NextResponse.json({ error: 'action must be "sweep-expired".' }, { status: 400, headers: noStore });
  }
  try {
    const now = new Date();
    const stale = await prisma.polyCreditAccount.findMany({
      where: { balanceCents: { gt: 0 }, expiresAt: { lte: now } },
      select: { id: true, balanceCents: true },
    });
    let centsExpired = 0;
    await prisma.$transaction(async (tx) => {
      for (const account of stale) {
        centsExpired += account.balanceCents;
        await tx.polyCreditAccount.update({ where: { id: account.id }, data: { balanceCents: 0 } });
        await tx.polyCreditLedger.create({
          data: {
            accountId: account.id,
            kind: 'expire',
            amountCents: -account.balanceCents,
            balanceAfterCents: 0,
            reason: 'expiry',
          },
        });
      }
    });
    return NextResponse.json({ swept: stale.length, centsExpired }, { headers: noStore });
  } catch (e: unknown) {
    console.error('admin credits sweep failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not sweep expired accounts.' }, { status: 500, headers: noStore });
  }
}
