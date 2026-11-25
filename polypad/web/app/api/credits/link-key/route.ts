import { NextResponse } from 'next/server';
import { linkKeyTransfer } from '@/lib/credits/ledger';
import { allowAttempt, clientIpHash } from '@/lib/agents-api/core';
import { isWalletAddress, resolveKeyId } from '../_lib/subject';
import { verifyCreditsSignature } from '../_lib/nonce';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * POST /api/credits/link-key { wallet, key, nonce, signature }
 * Moves the wallet's whole Poly credits balance onto the Pro key. The
 * wallet signature over a single-use nonce proves the caller owns the
 * wallet — without it, anyone could drain a wallet's balance onto their
 * own key. One-way in v1: the wallet balance becomes 0.
 */
export async function POST(req: Request) {
  if (!allowAttempt(`credits-claim:${clientIpHash(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, reason: 'Too many requests from here. Wait an hour and try again.' },
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
  const resolved = await resolveKeyId(body.key);
  if (resolved.keyId === null) {
    return NextResponse.json(
      {
        ok: false,
        reason: resolved.degraded
          ? 'Could not verify the Pro key right now. Try again in a moment.'
          : 'That Pro key is unknown or revoked.',
      },
      { status: 400, headers: noStore },
    );
  }

  // Wallet ownership proof: signature over the single-use nonce.
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!nonce || !signature) {
    return NextResponse.json(
      { ok: false, reason: 'Sign the message in your wallet first — ask for a nonce, sign it, then move the balance.' },
      { status: 401, headers: noStore },
    );
  }
  const verified = await verifyCreditsSignature({ wallet, nonce, signature, purpose: 'link-key' });
  if (!verified.ok) {
    return NextResponse.json({ ok: false, reason: verified.reason }, { status: verified.status, headers: noStore });
  }

  try {
    const result = await linkKeyTransfer({ wallet: wallet.toLowerCase(), keyId: resolved.keyId });
    if (!result.ok) {
      const reason =
        result.reason === 'invalid_key'
          ? 'That Pro key is unknown or revoked.'
          : result.reason === 'no_wallet_balance'
            ? 'This wallet has no credits yet — claim the $25 starter balance first.'
            : 'Nothing to move — the wallet balance is $0 or its credits have expired.';
      return NextResponse.json({ ok: false, reason }, { status: 400, headers: noStore });
    }
    return NextResponse.json(
      {
        ok: true,
        movedCents: result.movedCents,
        keySubject: result.keySubject,
        balanceAfterCents: result.balanceAfterCents,
        expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
      },
      { headers: noStore },
    );
  } catch (e: unknown) {
    console.error('credits link-key failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: 'Could not move the balance right now.' }, { status: 500, headers: noStore });
  }
}
