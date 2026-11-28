import { NextResponse } from 'next/server';
import { allowAttempt, clientIpHash } from '@/lib/agents-api/core';
import { isWalletAddress, resolveKeyId } from '../../_lib/subject';
import { verifyCreditsSignature } from '../../_lib/nonce';
import { confirmTopup, type TopupVerifyFailure } from '@/lib/credits/topup';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

const FAILURE_STATUS: Record<string, number> = {
  tx_not_found: 404,
  already_credited: 409,
  tx_reverted: 422,
  recipient_mismatch: 422,
  wrong_sender: 422,
  too_old: 422,
  amount_too_small: 422,
  price_unavailable: 503,
  unsupported_asset: 400,
  invalid_amount: 400,
};

const FAILURE_MESSAGE: Record<string, string> = {
  tx_not_found: 'Could not find that transaction on Robinhood Chain yet. Wait for it to confirm, then try again.',
  already_credited: 'This payment was already credited once. A payment can only buy credits one time.',
  tx_reverted: 'That transaction failed on-chain, so it bought no credits.',
  recipient_mismatch: 'That payment did not go to the Poly credits address. Check the transaction and try again.',
  wrong_sender: 'That transaction was not sent by this wallet. Only the wallet that paid can claim the credits.',
  too_old: 'That payment is more than 24 hours old. Only recent payments can buy credits.',
  amount_too_small: 'That payment is worth less than 1 cent of credits.',
  price_unavailable: 'Could not price this right now. Try again in a moment — nothing was credited.',
  unsupported_asset: 'asset must be ETH or POLYDASH.',
  invalid_amount: 'That payment is worth less than 1 cent of credits.',
};

/**
 * POST /api/credits/topup/complete { txHash, asset, wallet, key?, nonce, signature }
 * Confirms a top-up payment on-chain and credits the account — once.
 * The wallet signature over a single-use nonce (purpose 'topup') proves
 * the caller owns the wallet that sent the payment; without it, anyone
 * could claim someone else's payment. The target is the Pro key account
 * when a valid unrevoked key is given, else the sender's wallet account.
 */
export async function POST(req: Request) {
  if (!allowAttempt(`credits-topup:${clientIpHash(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, reason: 'Too many top-up attempts from here. Wait an hour and try again.' },
      { status: 429, headers: { ...noStore, 'retry-after': '3600' } },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: 'Send a JSON body.' }, { status: 400, headers: noStore });
  }

  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json(
      { ok: false, reason: 'That does not look like a transaction hash — it should start with 0x and be 66 characters long.' },
      { status: 400, headers: noStore },
    );
  }
  const asset = typeof body.asset === 'string' ? body.asset.trim().toUpperCase() : '';
  if (asset !== 'ETH' && asset !== 'POLYDASH') {
    return NextResponse.json({ ok: false, reason: 'asset must be ETH or POLYDASH.' }, { status: 400, headers: noStore });
  }
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  if (!isWalletAddress(wallet)) {
    return NextResponse.json(
      { ok: false, reason: 'Enter the wallet address that sent the payment — it should start with 0x and be 42 characters long.' },
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
            ? 'Could not verify the Pro key right now. Try again in a moment, or top up without a key.'
            : 'That Pro key is unknown or revoked. Check it, or top up without a key.',
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
      { ok: false, reason: 'Sign the message in your wallet first — ask for a nonce, sign it, then confirm the payment.' },
      { status: 401, headers: noStore },
    );
  }
  const verified = await verifyCreditsSignature({ wallet, nonce, signature, purpose: 'topup' });
  if (!verified.ok) {
    return NextResponse.json({ ok: false, reason: verified.reason }, { status: verified.status, headers: noStore });
  }

  try {
    const result = await confirmTopup({
      txHash,
      asset: asset as 'ETH' | 'POLYDASH',
      wallet: wallet.toLowerCase(),
      keyId,
    });
    if (!result.ok) {
      const reason = result.reason as TopupVerifyFailure | 'already_credited' | 'invalid_amount';
      return NextResponse.json(
        { ok: false, reason: FAILURE_MESSAGE[reason] ?? 'Could not confirm this payment.' },
        { status: FAILURE_STATUS[reason] ?? 422, headers: noStore },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        subject: result.subject,
        amountCents: result.amountCents,
        matchedCents: result.matchCents,
        balanceAfterCents: result.balanceAfterCents,
        txHash: txHash.toLowerCase(),
        asset,
        priceUsd: result.priceUsd,
      },
      { headers: noStore },
    );
  } catch (e: unknown) {
    console.error('credits topup complete failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: 'Could not confirm this payment right now.' }, { status: 500, headers: noStore });
  }
}
