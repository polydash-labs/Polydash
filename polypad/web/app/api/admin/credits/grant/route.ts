import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';
import { grantCredits, grantTopup, revokeCredits } from '@/lib/credits/ledger';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * POST /api/admin/credits/grant { subject, amountCents, reason, kind?, action?, isTopup? }
 * Admin-only. kind 'grant' (default) calls grantCredits; kind 'topup' (or
 * isTopup: true) calls grantTopup, which adds the automatic 1:1 match row
 * when matching is on. Accepts the spec's action/isTopup spellings too.
 * subject must be a well-formed key:<id> (key must exist) or
 * wallet:<lowercase address>. Unknown subject → 404.
 */
export async function POST(req: Request) {
  const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!admin) {
    return NextResponse.json({ error: 'Sign in with the admin wallet.' }, { status: 401, headers: noStore });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Send a JSON body.' }, { status: 400, headers: noStore });
  }
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const amountCents = body.amountCents;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const isTopup = body.isTopup === true || kind === 'topup';
  if (!subject) {
    return NextResponse.json({ ok: false, error: 'Enter who gets the credits — a wallet address or a key subject.' }, { status: 400, headers: noStore });
  }
  if (!reason) {
    return NextResponse.json({ ok: false, error: 'Add a short reason — it is saved with the grant.' }, { status: 400, headers: noStore });
  }
  if (kind && kind !== 'grant' && kind !== 'topup') {
    return NextResponse.json({ ok: false, error: 'kind must be "grant" or "topup".' }, { status: 400, headers: noStore });
  }
  if (action && action !== 'grant' && action !== 'revoke') {
    return NextResponse.json({ ok: false, error: 'action must be "grant" or "revoke".' }, { status: 400, headers: noStore });
  }
  // Subject must resolve to a real account target.
  if (subject.startsWith('key:')) {
    const keyId = subject.slice(4);
    const keyRow = keyId ? await prisma.agentApiKey.findUnique({ where: { id: keyId }, select: { id: true } }) : null;
    if (!keyRow) {
      return NextResponse.json({ ok: false, error: 'Unknown subject — no Pro key with that id.' }, { status: 404, headers: noStore });
    }
  } else if (subject.startsWith('wallet:')) {
    if (!isAddress(subject.slice(7), { strict: false })) {
      return NextResponse.json({ ok: false, error: 'Unknown subject — wallet: must hold a valid 0x address.' }, { status: 400, headers: noStore });
    }
  } else {
    return NextResponse.json({ ok: false, error: 'subject must look like key:<id> or wallet:<0x address>.' }, { status: 400, headers: noStore });
  }
  if (action === 'revoke') {
    // Zero the balance and write a 'revoke' ledger row. amountCents is
    // not needed (the whole balance is revoked). This is the manual-review
    // fallback for a starter grant that should not have been approved.
    try {
      const result = await revokeCredits(subject, reason);
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.reason === 'no_account' ? 'Unknown subject — no account holds credits for it.' : 'That account already holds no credits.' },
          { status: result.reason === 'no_account' ? 404 : 400, headers: noStore },
        );
      }
      return NextResponse.json(
        { ok: true, subject, balanceAfterCents: 0, revokedCents: result.revokedCents },
        { headers: noStore },
      );
    } catch (e: unknown) {
      console.error('admin credits revoke failed', e instanceof Error ? e.message : e);
      return NextResponse.json({ ok: false, error: 'Could not revoke the credits.' }, { status: 500, headers: noStore });
    }
  }
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ ok: false, error: 'amountCents must be a whole number of cents, more than 0.' }, { status: 400, headers: noStore });
  }
  try {
    if (isTopup) {
      const result = await grantTopup({ subject, amountCents, reason });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: 'amountCents must be a whole number of cents, more than 0.' }, { status: 400, headers: noStore });
      }
      return NextResponse.json(
        { ok: true, subject, balanceAfterCents: result.balanceAfterCents, matchedCents: result.matchCents },
        { headers: noStore },
      );
    }
    const result = await grantCredits({ subject, amountCents, kind: 'grant', reason });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: 'amountCents must be a whole number of cents, more than 0.' }, { status: 400, headers: noStore });
    }
    return NextResponse.json({ ok: true, subject, balanceAfterCents: result.balanceAfterCents }, { headers: noStore });
  } catch (e: unknown) {
    console.error('admin credits grant failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'Could not grant the credits.' }, { status: 500, headers: noStore });
  }
}
