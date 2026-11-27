// GET /api/agents/wallets/base/:address — one Base agent wallet:
// address, caps, live USDC balance on Base, spent today, recent payments.
import { NextResponse } from 'next/server';
import { getBaseWallet } from '@/lib/cdp-base/wallets';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const found = await getBaseWallet(address);
  if (!found) {
    return NextResponse.json({ error: 'No Base agent wallet at that address.' }, { status: 404 });
  }
  return NextResponse.json(found);
}
