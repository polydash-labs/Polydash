import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { allowAttempt, clientIpHash } from '@/lib/agents-api/core';
import { resolveSubjectFromQuery } from '../_lib/subject';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * GET /api/credits/history?key=pp_live_... OR ?wallet=0x...
 * Ledger rows for that subject, newest first, capped at 100. The ledger
 * module has no history reader, so this reads PolyCreditLedger directly
 * (accountId is the PolyCreditAccount id for the subject).
 */
export async function GET(req: Request) {
  if (!allowAttempt(`credits-history:${clientIpHash(req)}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many lookups. Wait a minute and try again.' }, { status: 429, headers: { ...noStore, 'retry-after': '60' } });
  }
  const resolved = await resolveSubjectFromQuery(req);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.reason }, { status: resolved.status, headers: noStore });
  }
  try {
    const account = await prisma.polyCreditAccount.findUnique({
      where: { subject: resolved.subject },
      select: { id: true },
    });
    const rows = account
      ? await prisma.polyCreditLedger.findMany({
          where: { accountId: account.id },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : [];
    const entries = rows.map((r) => ({
      kind: r.kind,
      amountCents: r.amountCents,
      balanceAfterCents: r.balanceAfterCents,
      productId: r.productId ?? null,
      reason: r.reason ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    return NextResponse.json({ subject: resolved.subject, rows: entries, entries }, { headers: noStore });
  } catch (e: unknown) {
    console.error('credits history failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not load history right now.' }, { status: 500, headers: noStore });
  }
}
