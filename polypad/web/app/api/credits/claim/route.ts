import { NextResponse } from 'next/server';
import { claimStarter } from '@/lib/credits/ledger';
import { allowAttempt, clientIpHash } from '@/lib/agents-api/core';
import { isWalletAddress, resolveKeyId } from '../_lib/subject';
import { verifyCreditsSignature } from '../_lib/nonce';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * POST /api/credits/claim { wallet, key?, whatBuilding, signature, nonce }
 * Auto-approves the $25 starter balance on the spot. One claim per wallet.
 * The wallet signature over a single-use nonce proves the caller owns the
 * wallet — without it, anyone could burn someone else's starter slot.
 * 409 when the wallet already claimed, 401 on a bad/expired signature,
 * 400 on bad input.
 */
export async function POST(req: Request) {
  if (!allowAttempt(`credits-claim:${clientIpHash(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, reason: 'Too many claims from here. Wait an hour and try again.' },
      { status: 429, headers: { ...noStore, 'retry-after': '3600' } },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: 'Send a JSON body.' }, { status: 400, headers: noStore });
  }

  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  if (!isWalletAddress(wallet)) {
    return NextResponse.json(
      { ok: false, reason: 'Enter a valid wallet address — it should start with 0x and be 42 characters long.' },
      { status: 400, headers: noStore },
    );
  }
  const whatBuilding = typeof body.whatBuilding === 'string' ? body.whatBuilding.trim() : '';
  if (!whatBuilding) {
    return NextResponse.json(
      { ok: false, reason: 'Tell us what you are building — one short sentence is enough.' },
      { status: 400, headers: noStore },
    );
  }
  if (whatBuilding.length > 500) {
    return NextResponse.json(
      { ok: false, reason: 'Keep “what are you building” to 500 characters or fewer.' },
      { status: 400, headers: noStore },
    );
  }

  let keyId: string | undefined;
  if (body.key !== undefined && body.key !== null && body.key !== '') {
    const resolved = await resolveKeyId(body.key);
    if (resolved.keyId === null) {
      return NextResponse.json(
        {
          ok: false,
          reason: resolved.degraded
            ? 'Could not verify the Pro key right now. Try again in a moment, or claim without a key.'
            : 'That Pro key is unknown or revoked. Check it, or claim without a key.',
        },
        { status: 400, headers: noStore },
      );
    }
    keyId = resolved.keyId;
  }

  // Wallet ownership proof: signature over the single-use nonce.
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!nonce || !signature) {
    return NextResponse.json(
      { ok: false, reason: 'Sign the message in your wallet first — ask for a nonce, sign it, then claim.' },
      { status: 401, headers: noStore },
    );
  }
  const verified = await verifyCreditsSignature({ wallet, nonce, signature, purpose: 'claim' });
  if (!verified.ok) {
    return NextResponse.json({ ok: false, reason: verified.reason }, { status: verified.status, headers: noStore });
  }

  try {
    const result = await claimStarter({ wallet: wallet.toLowerCase(), keyId, whatBuilding });
    if (!result.ok) {
      if (result.reason === 'already_claimed') {
        return NextResponse.json({ ok: false, reason: 'already_claimed' }, { status: 409, headers: noStore });
      }
      return NextResponse.json(
        { ok: false, reason: result.reason === 'invalid_key' ? 'That Pro key is unknown or revoked.' : 'That wallet address is not valid.' },
        { status: 400, headers: noStore },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        subject: result.subject,
        amountCents: result.amountCents,
        balanceCents: result.balanceAfterCents,
        expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
      },
      { headers: noStore },
    );
  } catch (e: unknown) {
    console.error('credits claim failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: 'Could not claim the starter credits right now.' }, { status: 500, headers: noStore });
  }
}
