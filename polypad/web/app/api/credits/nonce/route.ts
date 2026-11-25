import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { allowAttempt, clientIpHash } from '@/lib/agents-api/core';
import { CREDITS_NONCE_MAX_LIVE, isCreditsNoncePurpose, issueCreditsNonce } from '../_lib/nonce';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * POST /api/credits/nonce { wallet, purpose: 'claim' | 'link-key' | 'topup' }
 * Issues a single-use nonce for the wallet-signature step of claim /
 * link-key / top-up. Reuses the existing AuthNonce table (10-minute expiry, max 10
 * live nonces per address). Returns { nonce, message } — the wallet signs
 * the message; the signature + nonce go to /api/credits/claim,
 * /api/credits/link-key, or /api/credits/topup/complete.
 */
export async function POST(req: Request) {
  if (!allowAttempt(`credits-claim:${clientIpHash(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: 'Too many requests. Wait an hour and try again.' },
      { status: 429, headers: { ...noStore, 'retry-after': '3600' } },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Send a JSON body.' }, { status: 400, headers: noStore });
  }
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : '';
  if (!isAddress(wallet, { strict: false })) {
    return NextResponse.json({ error: 'Enter a valid wallet address.' }, { status: 400, headers: noStore });
  }
  if (!isCreditsNoncePurpose(body.purpose)) {
    return NextResponse.json({ error: 'purpose must be "claim", "link-key", or "topup".' }, { status: 400, headers: noStore });
  }
  try {
    if ((await prisma.authNonce.count({ where: { address: wallet } })) >= CREDITS_NONCE_MAX_LIVE) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts for this wallet. Try again in a few minutes.' },
        { status: 429, headers: noStore },
      );
    }
    const { nonce, message } = await issueCreditsNonce(wallet, body.purpose);
    return NextResponse.json({ nonce, message }, { headers: noStore });
  } catch (e: unknown) {
    console.error('credits nonce failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not start the sign-in.' }, { status: 500, headers: noStore });
  }
}
