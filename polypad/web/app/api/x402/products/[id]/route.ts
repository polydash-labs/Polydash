import { NextResponse } from 'next/server';
import {
  x402PublicClient,
  verifyPayment,
  settlePayment,
  facilitatorConfigured,
  buildRequirements,
  toBase64Json,
  parsePaymentSignature,
  getPolydashUsd,
  type PaymentPayload,
} from '@/lib/x402/facilitator';
import { productById, buildProduct } from '@/lib/x402/products';
import { X402_NETWORK, X402_BASE_NETWORK } from '@/lib/x402/constants';
import {
  isBaseVariant,
  cdpConfigured,
  buildBaseRequirement,
  buildDefaultAccepts,
  buildBasePaymentRequired,
  buildDefaultPaymentRequired,
  verifyBasePayment,
  settleBasePayment,
} from '@/lib/x402/base';
import { resolveCreditSubject, checkCredits, spendForProduct } from '@/lib/x402/credits';

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
  // ?network=base selects the Base/USDC variant (CDP facilitator +
  // Bazaar declaration). Anything else is the Hood variant, unchanged
  // and still the default. Credits pay in the Hood flow only — a Base
  // request goes straight to the 402/payment flow.
  const isBase = isBaseVariant(url.searchParams);

  // An explicit payment signature always beats credits — parse it first
  // and only try the credits branch when there is none.
  const payment = parsePaymentSignature(
    req.headers.get('PAYMENT-SIGNATURE') ?? req.headers.get('X-PAYMENT'),
  );

  // --- Poly credits branch: a valid Pro key with enough credits pays
  // without an on-chain payment, and skips the Dexscreener price fetch
  // below. Build first (a build error spends nothing), then debit, then
  // return. Any failure here falls through to the existing 402/payment
  // flow below, untouched. This path never checks facilitatorConfigured().
  // Hood only — the Base variant has no credits path.
  if (!payment && !isBase) {
    const creditSubject = await resolveCreditSubject(req);
    if (creditSubject) {
      const creditCheck = await checkCredits(creditSubject.subject, id);
      if (creditCheck.ok) {
        const built = await buildProduct(id, url.searchParams);
        if ('error' in built) {
          return NextResponse.json({ error: built.error }, { status: built.status });
        }
        const spent = await spendForProduct(creditSubject.subject, id);
        if (spent.ok) {
          const response = {
            x402Version: 2,
            success: true,
            transaction: null,
            network: X402_NETWORK,
            payer: creditSubject.subject,
            paidByCredits: true,
            creditsRemainingCents: spent.balanceAfterCents,
            data: built.data,
          };
          return new NextResponse(JSON.stringify(response), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'PAYMENT-RESPONSE': toBase64Json({
                success: true,
                transaction: null,
                network: X402_NETWORK,
                payer: creditSubject.subject,
              }),
            },
          });
        }
        // Balance dropped between check and spend: fall through to the
        // 402/payment flow so the caller can still pay on-chain.
      }
    }
  }

  const resourceUrl = `${url.origin}/api/x402/products/${id}${url.search}`;
  // Default challenge offers every payable option: Hood (USDG + POLYDASH
  // at the live rate) AND USDC on Base via the CDP facilitator. The Base
  // option is genuinely payable — the CDP path already settled USDC on
  // Base — and registries that only index supported networks (HIVE402)
  // need it in the default challenge, not behind ?network=base:
  // HIVE402 rejected the Hood-only default challenge on Nov 24 for
  // exactly that reason. The default challenge also carries the same
  // Bazaar discovery extension as the Base variant (buildDefaultPaymentRequired):
  // a Bazaar-aware client can only echo an extension the 402 declared,
  // and the Nov 22 settlements never echoed one, so nothing was indexed.
  // ?network=base keeps its Base-only challenge + Bazaar declaration,
  // unchanged. Hood accepts are untouched by the extension.
  const accepts = isBase
    ? [buildBaseRequirement(resourceUrl, product.blurb, product.priceUsd)]
    : buildDefaultAccepts(
        buildRequirements(resourceUrl, product.blurb, product.priceUsd, await getPolydashUsd()),
        resourceUrl,
        product.blurb,
        product.priceUsd,
      );
  const requiredBody = isBase
    ? buildBasePaymentRequired(product, resourceUrl)
    : buildDefaultPaymentRequired(product, resourceUrl, accepts);

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
    // --- Base payment: verify + settle through the CDP facilitator. ---
    // Route on the network the payer actually signed for, not on the
    // ?network=base query param: the default challenge now offers the
    // Base option too, so a Base payment can arrive on the plain URL.
    // (Same pattern as /api/x402/verify and /api/x402/settle.)
    if (payment.accepted.network === X402_BASE_NETWORK) {
      if (!cdpConfigured()) {
        return NextResponse.json(
          { error: 'The Base payment facilitator is not configured yet. Please try again shortly.' },
          { status: 503 },
        );
      }
      const client = x402PublicClient();
      const requirement = buildBaseRequirement(resourceUrl, product.blurb, product.priceUsd);
      const verified = await verifyBasePayment(client, payment as PaymentPayload, requirement);
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
      const built = await buildProduct(id, url.searchParams);
      if ('error' in built) {
        return NextResponse.json({ error: built.error }, { status: built.status });
      }
      const settled = await settleBasePayment(payment as PaymentPayload, requirement, verified);
      if (!settled.success) {
        return NextResponse.json({ error: settled.errorReason ?? 'settlement_failed' }, { status: 503 });
      }
      const response = { x402Version: 2, success: true, transaction: settled.transaction, network: X402_BASE_NETWORK, payer: settled.payer, data: built.data };
      return new NextResponse(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-RESPONSE': toBase64Json({ success: true, transaction: settled.transaction, network: X402_BASE_NETWORK, payer: settled.payer }),
        },
      });
    }

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
