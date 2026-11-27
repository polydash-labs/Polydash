import { NextResponse } from 'next/server';
import { x402PublicClient, verifyPayment, type PaymentPayload } from '@/lib/x402/facilitator';
import { cdpConfigured, verifyBasePayment } from '@/lib/x402/base';
import { X402_BASE_NETWORK } from '@/lib/x402/constants';
import { resolveApiKey } from '@/lib/agents-api/v2/keys';
import { keySubject } from '@/lib/credits/ledger';
import { checkCredits, priceCents } from '@/lib/x402/credits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/x402/verify — verifies a payment authorization without settling.
 * Credits shape: { x402Version: 2, credits: { key, productId } } — checks
 * the key and the credits balance only; verify never debits.
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
    return NextResponse.json({ isValid: false, invalidReason: 'invalid_json' }, { status: 400 });
  }

  // --- Poly credits check (no paymentPayload, no debit) ---
  if (body.credits) {
    const key = body.credits.key;
    const productId = body.credits.productId;
    if (!key || typeof key !== 'string' || !productId || typeof productId !== 'string') {
      return NextResponse.json({ isValid: false, invalidReason: 'invalid_key', paidByCredits: true }, { status: 400 });
    }
    const resolved = await resolveApiKey(
      new Request('http://localhost/', { headers: { 'x-api-key': key } }),
    );
    if (resolved.tier !== 'pro') {
      return NextResponse.json({ isValid: false, invalidReason: 'invalid_key', paidByCredits: true }, { status: 400 });
    }
    const subject = keySubject(resolved.keyId);
    if (priceCents(productId) == null) {
      return NextResponse.json({ isValid: false, invalidReason: 'unknown_product', payer: subject, paidByCredits: true }, { status: 400 });
    }
    const check = await checkCredits(subject, productId);
    if (!check.ok) {
      const invalidReason =
        check.reason === 'unknown_product'
          ? 'unknown_product'
          : check.reason === 'expired'
            ? 'credits_expired'
            : check.reason === 'no_account'
              ? 'no_credits_account'
              : 'insufficient_credits';
      return NextResponse.json({ isValid: false, invalidReason, payer: subject, paidByCredits: true }, { status: 400 });
    }
    return NextResponse.json(
      { isValid: true, payer: subject, paidByCredits: true, creditsRemainingCents: check.balanceCents },
      { status: 200 },
    );
  }

  const payload = body.paymentPayload;
  if (!payload || payload.x402Version !== 2) {
    return NextResponse.json({ isValid: false, invalidReason: 'unsupported_version' }, { status: 400 });
  }
  // Base variant: verify through the CDP facilitator. The accepted
  // requirement is the one the client signed; verifyBasePayment checks
  // it against the Base/USDC shape before calling CDP.
  if (payload.accepted?.network === X402_BASE_NETWORK) {
    if (!cdpConfigured()) {
      return NextResponse.json({ isValid: false, invalidReason: 'cdp_facilitator_not_configured' }, { status: 503 });
    }
    const base = await verifyBasePayment(x402PublicClient(), payload, payload.accepted);
    const out: Record<string, unknown> = { isValid: base.isValid, invalidReason: base.invalidReason, payer: base.payer };
    if (base.extensionResponses) out.extensionResponses = base.extensionResponses;
    return NextResponse.json(out, { status: base.isValid ? 200 : 400 });
  }
  const result = await verifyPayment(x402PublicClient(), payload);
  return NextResponse.json(result, { status: result.isValid ? 200 : 400 });
}
