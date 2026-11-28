// POST /api/agents/wallets/base/:address/freeze — freeze or unfreeze a
// Base agent wallet.
//
// Auth: the human owner signs a short freeze message with their wallet.
// Freezing pauses the CDP policy (the wallet cannot send or sign) and
// marks the wallet frozen in Polypad, which also blocks payments
// server-side. Unfreezing resumes both. The agent key cannot freeze —
// that would let a compromised agent lock its owner out.
import { NextResponse } from 'next/server';
import { getAddress, isAddress, recoverMessageAddress, type Hex } from 'viem';
import { prisma, withTimeout } from '@/lib/db';
import { freezeMessage } from '@/lib/cdp-base/message';
import { setBaseWalletFrozen } from '@/lib/cdp-base/wallets';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) {
    return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400 });
  }
  let body: { frozen?: boolean; validUntil?: number; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const frozen = body.frozen === true;
  const validUntil = body.validUntil ?? 0;
  const signature = body.signature ?? '';
  if (!signature.startsWith('0x') || Math.floor(Date.now() / 1000) > validUntil) {
    return NextResponse.json({ error: 'A fresh owner signature is required.' }, { status: 400 });
  }
  const row = await withTimeout(
    prisma.baseAgentWallet.findUnique({
      where: { address: getAddress(address) },
      select: { ownerAddress: true, revoked: true },
    }),
  );
  if (!row || row.revoked) {
    return NextResponse.json({ error: 'No Base agent wallet at that address.' }, { status: 404 });
  }
  const message = freezeMessage(getAddress(address), frozen, validUntil);
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }
  if (getAddress(signer) !== getAddress(row.ownerAddress)) {
    return NextResponse.json({ error: 'Only the wallet’s owner can freeze or unfreeze it.' }, { status: 403 });
  }
  const result = await setBaseWalletFrozen(getAddress(address), frozen);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.error === 'cdp_wallet_secret_not_configured' ? 503 : 400 },
    );
  }
  return NextResponse.json({ success: true, frozen });
}
