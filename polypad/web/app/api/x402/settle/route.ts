import { NextResponse } from 'next/server';
import {
  x402PublicClient,
  verifyPayment,
  settlePayment,
  facilitatorConfigured,
  type PaymentPayload,
} from '@/lib/x402/facilitator';
import { X402_NETWORK } from '@/lib/x402/constants';

export const dynamic = 'force-dynamic';

/** POST /api/x402/settle — verifies and broadcasts a payment authorization. */
export async function POST(req: Request) {
  let body: { x402Version?: number; paymentPayload?: PaymentPayload };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, errorReason: 'invalid_json' }, { status: 400 });
  }
  const payload = body.paymentPayload;
  if (!payload || payload.x402Version !== 2) {
    return NextResponse.json({ success: false, errorReason: 'unsupported_version' }, { status: 400 });
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
