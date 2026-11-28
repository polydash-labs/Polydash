import { NextResponse } from 'next/server';
import { getEthUsd } from '@/lib/eth-price';
import { getPolydashUsdForTopup } from '@/lib/credits/pricing';

export const dynamic = 'force-dynamic';

/**
 * Wallet prices for the checking-account view: ETH/USD (Coinbase spot),
 * POLYDASH/USD (on-chain V4 pool via StateView, Dexscreener fallback — never
 * CoinGecko), USDG = $1 by construction. A price of 0 means "unavailable
 * right now" — the UI must show that, never a guessed price.
 */
export async function GET() {
  const [ethUsd, polydashUsd] = await Promise.all([getEthUsd(), getPolydashUsdForTopup()]);
  return NextResponse.json({ ethUsd, polydashUsd, usdgUsd: 1 });
}
