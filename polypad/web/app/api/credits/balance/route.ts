import { NextResponse } from 'next/server';
import { getBalance } from '@/lib/credits/ledger';
import { allowAttempt, clientIpHash } from '@/lib/agents-api/core';
import { resolveSubjectFromQuery } from '../_lib/subject';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * GET /api/credits/balance?key=pp_live_... OR ?wallet=0x...
 * Exactly one of the two is required. A missing account returns an empty
 * balance (0 cents), never a 500. A revoked key can still view its balance
 * (same rule as the usage page) — the response says revoked: true.
 */
export async function GET(req: Request) {
  if (!allowAttempt(`credits-balance:${clientIpHash(req)}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many lookups. Wait a minute and try again.' }, { status: 429, headers: { ...noStore, 'retry-after': '60' } });
  }
  const resolved = await resolveSubjectFromQuery(req);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.reason }, { status: resolved.status, headers: noStore });
  }
  try {
    const bal = await getBalance(resolved.subject);
    const balanceCents = Math.max(0, bal.balanceCents);
    return NextResponse.json(
      {
        subject: resolved.subject,
        balanceCents,
        availableCents: bal.availableCents,
        balanceUsd: `$${(balanceCents / 100).toFixed(2)}`,
        expiresAt: bal.expiresAt ? bal.expiresAt.toISOString() : null,
        expired: bal.expired,
        subjectType: resolved.subjectType,
        ...(resolved.key ? { key: resolved.key } : {}),
      },
      { headers: noStore },
    );
  } catch (e: unknown) {
    console.error('credits balance failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not load the balance right now.' }, { status: 500, headers: noStore });
  }
}
