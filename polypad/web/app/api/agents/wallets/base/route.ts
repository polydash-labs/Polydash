// Base agent wallets (CDP Server Wallets on Base) — list + create.
// POST /api/agents/wallets/base — create one. The human proves ownership
// by signing the creation message with their wallet; the server then
// creates the CDP account + policy. Without the CDP wallet secret the
// route answers 503 `cdp_wallet_secret_not_configured` — it never pretends
// a wallet was created.
import { NextResponse } from 'next/server';
import { getAddress, isAddress, type Hex } from 'viem';
import {
  createBaseWallet,
  listBaseWallets,
  DEFAULT_DAILY_CAP_CENTS,
  DEFAULT_PER_PAYMENT_CAP_CENTS,
  DEFAULT_EXPIRY_DAYS,
} from '@/lib/cdp-base/wallets';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner') ?? '';
  if (!isAddress(owner)) {
    return NextResponse.json({ error: 'A valid owner address is required.' }, { status: 400 });
  }
  const wallets = await listBaseWallets(owner);
  return NextResponse.json({ wallets });
}

export async function POST(req: Request) {
  let body: {
    name?: string;
    ownerAddress?: string;
    dailyCapUsdCents?: number;
    perPaymentCapUsdCents?: number;
    expiryDays?: number;
    validUntil?: number;
    nonce?: string;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const ownerAddress = body.ownerAddress ?? '';
  const name = (body.name ?? '').trim();
  const dailyCapUsdCents = body.dailyCapUsdCents ?? DEFAULT_DAILY_CAP_CENTS;
  const perPaymentCapUsdCents = body.perPaymentCapUsdCents ?? DEFAULT_PER_PAYMENT_CAP_CENTS;
  const expiryDays = body.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const validUntil = body.validUntil ?? 0;
  const nonce = body.nonce ?? '';
  const signature = body.signature ?? '';
  if (!isAddress(ownerAddress) || !name || !signature.startsWith('0x')) {
    return NextResponse.json({ error: 'name, ownerAddress and a wallet signature are required.' }, { status: 400 });
  }
  const result = await createBaseWallet({
    name,
    ownerAddress: getAddress(ownerAddress),
    dailyCapUsdCents,
    perPaymentCapUsdCents,
    expiryDays,
    validUntil,
    nonce,
    signature: signature as Hex,
  });
  if (!result.ok) {
    const status =
      result.error === 'cdp_wallet_secret_not_configured' || result.error === 'cdp_not_configured' ? 503 : 400;
    return NextResponse.json({ error: result.error, detail: result.detail }, { status });
  }
  // The agent key is shown once, here. It is never stored in plain text
  // and never returned again — the owner must save it now.
  return NextResponse.json({
    wallet: result.wallet,
    agentKey: result.agentKey || undefined,
    keyShownOnce: !!result.agentKey,
  });
}
