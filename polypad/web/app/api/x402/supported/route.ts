import { NextResponse } from 'next/server';
import { X402_VERSION, X402_NETWORK, X402_BASE_NETWORK, USDG_ADDRESS, POLYDASH_ADDRESS, USDC_BASE_ADDRESS } from '@/lib/x402/constants';

export const dynamic = 'force-dynamic';

/** GET /api/x402/supported — the facilitator's supported payment kinds. */
export async function GET() {
  return NextResponse.json({
    kinds: [
      {
        x402Version: X402_VERSION,
        scheme: 'exact',
        network: X402_NETWORK,
        extra: { assetTransferMethod: 'eip3009', asset: USDG_ADDRESS },
      },
      {
        x402Version: X402_VERSION,
        scheme: 'exact',
        network: X402_NETWORK,
        extra: { assetTransferMethod: 'permit2', asset: POLYDASH_ADDRESS },
      },
      {
        x402Version: X402_VERSION,
        scheme: 'exact',
        network: X402_BASE_NETWORK,
        extra: { assetTransferMethod: 'eip3009', asset: USDC_BASE_ADDRESS },
      },
    ],
    extensions: [],
    signers: {},
  });
}
