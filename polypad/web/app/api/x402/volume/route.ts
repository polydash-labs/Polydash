import { NextResponse } from 'next/server';
import { getX402Volume } from '@/lib/x402/volume';

export const dynamic = 'force-dynamic';

/**
 * GET /api/x402/volume — settled x402 volume, read live from the chains.
 * All-time + last-7-days totals for USDC on Base and USDG on Robinhood
 * Chain. Real settled data only; never estimated.
 */
export async function GET() {
  const volume = await getX402Volume();
  return NextResponse.json(volume, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
