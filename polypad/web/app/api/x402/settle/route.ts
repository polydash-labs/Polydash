import { NextResponse } from 'next/server';
import {
  x402PublicClient,
  verifyPayment,
  settlePayment,
  facilitatorConfigured,
  type PaymentPayload,
} from '@/lib/x402/facilitator';
import { X402_NETWORK, X402_BASE_NETWORK } from '@/lib/x402/constants';
import { cdpConfigured, verifyBasePayment, settleBasePayment } from '@/lib/x402/base';
import { resolveApiKey } from '@/lib/agents-api/v2/keys';
import { keySubject } from '@/lib/credits/ledger';
import { checkCredits, priceCents, spendForProduct } from '@/lib/x402/credits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/x402/settle — verifies and broadcasts a payment authorization.
 * Credits shape: { x402Version: 2, credits: { key, productId } } — re-checks
 * the balance, then atomically debits. Nothing is broadcast on-chain, so
 * this path does NOT require the facilitator to be configured.
 */
export async function POST(req: Request) {
  let body: {
    x402Version?: number;
    paymentPayload?: PaymentPayload;
    credits?: { key?: string; productId?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, errorReason: 'invalid_json' }, { status: 400 });
  }

  // --- Poly credits settle (no facilitator wallet needed) ---
  if (body.credits) {
    const key = body.credits.key;
    const productId = body.credits.productId;
    if (!key || typeof key !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ success: false, errorReason: 'invalid_key' }, { status: 400 });
    }
    const resolved = await resolveApiKey(
      new Request('http://localhost/', { headers: { 'x-api-key': key } }),
    );
    if (resolved.tier !== 'pro') {
      return NextResponse.json({ success: false, errorReason: 'invalid_key' }, { status: 400 });
    }
    const subject = keySubject(resolved.keyId);
    if (priceCents(productId) == null) {
      return NextResponse.json({ success: false, errorReason: 'unknown_product' }, { status: 400 });
    }
    // Re-check the balance first so a stale/insufficient balance gets the
    // clean error; spendForProduct then debits atomically.
    const check = await checkCredits(subject, productId);
    if (!check.ok) {
      const errorReason =
        check.reason === 'unknown_product'
          ? 'unknown_product'
          : check.reason === 'expired'
            ? 'credits_expired'
            : check.reason === 'no_account'
              ? 'no_credits_account'
              : 'insufficient_credits';
      return NextResponse.json({ success: false, errorReason }, { status: 400 });
    }
    const spent = await spendForProduct(subject, productId);
    if (!spent.ok) {
      const errorReason =
        spent.reason === 'unknown_product'
          ? 'unknown_product'
          : spent.reason === 'expired'
            ? 'credits_expired'
            : spent.reason === 'no_account'
              ? 'no_credits_account'
              : 'insufficient_credits';
      return NextResponse.json({ success: false, errorReason }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      network: X402_NETWORK,
      payer: subject,
      paidByCredits: true,
      creditsRemainingCents: spent.balanceAfterCents,
    });
  }

  const payload = body.paymentPayload;
  if (!payload || payload.x402Version !== 2) {
    return NextResponse.json({ success: false, errorReason: 'unsupported_version' }, { status: 400 });
  }
  // Base variant: verify + settle through the CDP facilitator.
  if (payload.accepted?.network === X402_BASE_NETWORK) {
    if (!cdpConfigured()) {
      return NextResponse.json({ success: false, errorReason: 'cdp_facilitator_not_configured' }, { status: 503 });
    }
    const client = x402PublicClient();
    const verify = await verifyBasePayment(client, payload, payload.accepted);
    if (!verify.isValid) {
      return NextResponse.json({ success: false, errorReason: verify.invalidReason ?? 'invalid_payment' }, { status: 400 });
    }
    const base = await settleBasePayment(payload, payload.accepted, verify);
    if (!base.success) {
      return NextResponse.json(base, { status: 400 });
    }
    return NextResponse.json({ ...base, network: X402_BASE_NETWORK });
  }
  if (!facilitatorConfigured()) {
    return NextResponse.json({ success: false, errorReason: 'facilitator_not_configured' }, { status: 503 });
  }
  const client = x402PublicClient();
  const verify = await verifyPayment(client, payload);
  if (!verify.isValid) {
    return NextResponse.json({ success: false, errorReason: verify.invalidReason ?? 'invalid_payment' }, { status: 400 });
  }
  const result = await settlePayment(client, payload, verify);
  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ ...result, network: X402_NETWORK });
}
