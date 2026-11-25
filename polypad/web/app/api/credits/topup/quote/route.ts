import { NextResponse } from 'next/server';
import { parseUnits } from 'viem';
import { allowAttempt, clientIpHash } from '@/lib/agents-api/core';
import { X402_PAY_TO } from '@/lib/x402/constants';
import { quoteTopup, type TopupAsset } from '@/lib/credits/pricing';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/** Quote validity: prices move, so a quote is an estimate for 10 minutes. */
const QUOTE_VALID_MS = 10 * 60_000;

/**
 * GET /api/credits/topup/quote?asset=ETH|POLYDASH&amount=<human amount>
 * Estimates what a top-up payment is worth in Poly credits at current
 * prices. Read-only, no auth. The confirm credits at confirmation-time
 * prices, so the quote is an estimate — the response says so.
 */
export async function GET(req: Request) {
  if (!allowAttempt(`credits-quote:${clientIpHash(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429, headers: noStore });
  }
  const params = new URL(req.url).searchParams;
  const asset = (params.get('asset') ?? '').toUpperCase();
  if (asset !== 'ETH' && asset !== 'POLYDASH') {
    return NextResponse.json({ error: 'asset must be ETH or POLYDASH.' }, { status: 400, headers: noStore });
  }
  const amountRaw = params.get('amount') ?? '';
  let amountWei: bigint;
  try {
    // Human amount (e.g. "0.01" ETH, "50000" POLYDASH) → wei. Rejects
    // negatives, junk, and absurd values.
    if (!/^\d+(\.\d{1,18})?$/.test(amountRaw)) throw new Error('bad amount');
    amountWei = parseUnits(amountRaw, 18);
  } catch {
    return NextResponse.json({ error: 'amount must be a positive number, e.g. 0.01.' }, { status: 400, headers: noStore });
  }
  if (amountWei <= 0n || amountWei > 10n ** 27n) {
    return NextResponse.json({ error: 'amount must be a positive number, e.g. 0.01.' }, { status: 400, headers: noStore });
  }
  const quoted = await quoteTopup(asset as TopupAsset, amountWei);
  if (!quoted.ok) {
    return NextResponse.json(
      { error: 'Could not price this right now. Try again in a moment.' },
      { status: 503, headers: noStore },
    );
  }
  return NextResponse.json(
    {
      asset,
      amount: amountRaw,
      recipient: X402_PAY_TO,
      usdValue: quoted.usdValue,
      estimatedCents: quoted.cents,
      priceUsd: quoted.priceUsd,
      validUntil: new Date(Date.now() + QUOTE_VALID_MS).toISOString(),
      estimate: true,
    },
    { headers: noStore },
  );
}
