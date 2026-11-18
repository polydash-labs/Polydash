import { NextResponse } from 'next/server';
import {
  x402PublicClient,
  verifyPayment,
  settlePayment,
  facilitatorConfigured,
  buildRequirements,
  paymentRequiredBody,
  toBase64Json,
  parsePaymentSignature,
  getPolydashUsd,
  type PaymentPayload,
} from '@/lib/x402/facilitator';
import { productById, buildProduct } from '@/lib/x402/products';
import { X402_NETWORK } from '@/lib/x402/constants';

export const dynamic = 'force-dynamic';

/** Hard ceiling — Vercel Hobby kills the function at 10s. */
const HANDLER_TIMEOUT_MS = 9_000;

/**
 * GET /api/x402/products/:id — a priced endpoint.
 * Unpaid → 402 + PAYMENT-REQUIRED. Paid → verify → build → settle → 200.
 * Funds move only after the resource is built; if the resource cannot be
 * built (or the facilitator is not configured), nothing is settled.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = productById(id);
  if (!product) {
    return NextResponse.json({ error: 'Unknown product.' }, { status: 404 });
  }
  const url = new URL(req.url);
  const resourceUrl = `${url.origin}/api/x402/products/${id}${url.search}`;
  const polyUsd = await getPolydashUsd();
  const accepts = buildRequirements(resourceUrl, product.blurb, product.priceUsd, polyUsd);
  const requiredBody = paymentRequiredBody(accepts);

  const payment = parsePaymentSignature(
    req.headers.get('PAYMENT-SIGNATURE') ?? req.headers.get('X-PAYMENT'),
  );
  if (!payment) {
    return new NextResponse(JSON.stringify(requiredBody), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-REQUIRED': toBase64Json(requiredBody),
      },
    });
  }

  let broadcastTx: string | null = null;
  const run = async () => {
    const client = x402PublicClient();
    const verified = await verifyPayment(client, payment as PaymentPayload);
    if (!verified.isValid) {
      return new NextResponse(
        JSON.stringify({ ...requiredBody, error: verified.invalidReason ?? 'invalid_payment' }),
        {
          status: 402,
          headers: {
            'Content-Type': 'application/json',
            'PAYMENT-REQUIRED': toBase64Json(requiredBody),
          },
        },
      );
    }
    if (!facilitatorConfigured()) {
      return NextResponse.json(
        { error: 'The payment facilitator is not configured yet. Please try again shortly.' },
        { status: 503 },
      );
    }
    const built = await buildProduct(id, url.searchParams);
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: built.status });
    }
    const settled = await settlePayment(client, payment as PaymentPayload, verified);
    if (settled.pending && settled.transaction) {
      broadcastTx = settled.transaction;
      return NextResponse.json(
        {
          error: 'settlement_pending',
          errorReason: 'The payment was broadcast but its confirmation is not known yet. Check the transaction on-chain before retrying.',
          transaction: settled.transaction,
          network: X402_NETWORK,
        },
        { status: 503 },
      );
    }
    if (!settled.success) {
      return NextResponse.json({ error: settled.errorReason ?? 'settlement_failed' }, { status: 503 });
    }
    const response = { x402Version: 2, success: true, transaction: settled.transaction, network: X402_NETWORK, payer: settled.payer, data: built.data };
    return new NextResponse(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-RESPONSE': toBase64Json({ success: true, transaction: settled.transaction, network: X402_NETWORK, payer: settled.payer }),
      },
    });
  };

  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('handler timeout')), HANDLER_TIMEOUT_MS)),
    ]);
  } catch {
    if (broadcastTx) {
      return NextResponse.json(
        {
          error: 'settlement_pending',
          errorReason: 'The payment was broadcast but its confirmation is not known yet. Check the transaction on-chain before retrying.',
          transaction: broadcastTx,
          network: X402_NETWORK,
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'The request timed out. Please try again shortly.' }, { status: 503 });
  }
}
