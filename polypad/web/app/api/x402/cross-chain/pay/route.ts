import { NextResponse } from 'next/server';
import { planCrossChainPayment, toExecutionPackage } from '@/lib/x402/cross-chain';
import { toApiError } from '@/lib/agents-api/v2/core';

export const dynamic = 'force-dynamic';

/** Hard ceiling — Vercel Hobby kills the function at 10s. */
const HANDLER_TIMEOUT_MS = 9_000;

/**
 * POST /api/x402/cross-chain/pay — the executable package for paying an
 * x402 URL from the other chain. Same dry-run plan as /quote, plus the
 * unsigned bridge transactions and the EIP-3009 typed data to sign.
 * Nothing here signs or sends: the agent signs the bridge transactions
 * on the origin chain, waits for the bridge to land, signs the typed
 * data, and POSTs it to the product URL as an X-PAYMENT header.
 * Polypad never sees a private key.
 *
 * Body: { url: "https://... (must return a 402)", from: "0x..." }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'invalid_json', message: 'Body is not valid JSON.' } }, { status: 400 });
  }
  try {
    const plan = await Promise.race([
      planCrossChainPayment(body),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('handler timeout')), HANDLER_TIMEOUT_MS)),
    ]);
    if (!plan.feasible) return NextResponse.json(plan);
    return NextResponse.json({ ...plan, execution: toExecutionPackage(plan) });
  } catch (err) {
    if ((err as Error)?.message === 'handler timeout') {
      return NextResponse.json({ ok: false, error: { code: 'timeout', message: 'The quote took too long. Try again.' } }, { status: 503 });
    }
    const e = toApiError(err);
    return NextResponse.json({ ok: false, error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status });
  }
}
