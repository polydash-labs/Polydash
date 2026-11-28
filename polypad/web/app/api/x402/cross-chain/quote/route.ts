import { NextResponse } from 'next/server';
import { planCrossChainPayment } from '@/lib/x402/cross-chain';
import { toApiError } from '@/lib/agents-api/v2/core';

export const dynamic = 'force-dynamic';

/** Hard ceiling — Vercel Hobby kills the function at 10s. */
const HANDLER_TIMEOUT_MS = 9_000;

/**
 * POST /api/x402/cross-chain/quote — dry-run plan for paying an x402 URL
 * from the other chain. Read-only: fetches the 402, reads balances on both
 * chains, quotes Relay for the shortfall only. No key, no signature,
 * nothing is sent on-chain.
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
    return NextResponse.json(plan);
  } catch (err) {
    if ((err as Error)?.message === 'handler timeout') {
      return NextResponse.json({ ok: false, error: { code: 'timeout', message: 'The quote took too long. Try again.' } }, { status: 503 });
    }
    const e = toApiError(err);
    return NextResponse.json({ ok: false, error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status });
  }
}
