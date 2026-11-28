// POST /api/agents/wallets/base/:address/pay — pay for one of Polypad's
// x402 products from a Base agent wallet.
//
// Auth: the wallet's agent key (`pp_base_…`) in the Authorization header.
// The key is the agent's credential — anyone holding it can spend up to
// the wallet's caps, which is exactly what it is for. The human's wallet
// signature is only needed at creation; payments are the agent's job.
//
// Body: { product: 'token-report' | 'fund-nav' | 'cto-report', address |
// fund | launch }. The pay flow enforces caps, signs an EIP-3009
// authorization with the CDP wallet key, and settles through the CDP
// facilitator — the same settlement path an external agent's payment
// takes. Funds move only after the product is built.
import { NextResponse } from 'next/server';
import { payFromBaseWallet, resolveBaseWalletKey } from '@/lib/cdp-base/wallets';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const key = await resolveBaseWalletKey(req, address);
  if (!key) {
    return NextResponse.json(
      { error: 'This request needs the wallet’s agent key (pp_base_…) in the Authorization header.' },
      { status: 401 },
    );
  }
  let body: { product?: string; address?: string; fund?: string; launch?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const origin = new URL(req.url).origin;
  const result = await payFromBaseWallet({
    walletAddress: key.address,
    walletId: key.id,
    productId: body.product ?? '',
    params: { address: body.address ?? '', fund: body.fund ?? '', launch: body.launch ?? '' },
    origin,
  });
  if (!result.ok) {
    const status =
      result.error === 'cdp_wallet_secret_not_configured' ? 503 : result.error === 'timeout' ? 503 : 400;
    return NextResponse.json({ error: result.error, detail: result.detail }, { status });
  }
  return NextResponse.json({
    success: true,
    transaction: result.transaction,
    spentTodayUsdCents: result.spentTodayUsdCents,
    data: result.data,
  });
}
