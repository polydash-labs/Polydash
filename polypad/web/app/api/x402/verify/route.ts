import { NextResponse } from 'next/server';
import { x402PublicClient, verifyPayment, type PaymentPayload } from '@/lib/x402/facilitator';

export const dynamic = 'force-dynamic';

/** POST /api/x402/verify — verifies a payment authorization without settling. */
export async function POST(req: Request) {
  let body: { x402Version?: number; paymentPayload?: PaymentPayload };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ isValid: false, invalidReason: 'invalid_json' }, { status: 400 });
  }
  const payload = body.paymentPayload;
  if (!payload || payload.x402Version !== 2) {
    return NextResponse.json({ isValid: false, invalidReason: 'unsupported_version' }, { status: 400 });
  }
  const result = await verifyPayment(x402PublicClient(), payload);
  return NextResponse.json(result, { status: result.isValid ? 200 : 400 });
}
