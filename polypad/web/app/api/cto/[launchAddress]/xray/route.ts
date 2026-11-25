import { NextResponse } from 'next/server';
import { getXray } from '@/lib/xray/scan';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Cached Bundle & Sniper X-ray result (no chain calls; the scan runs in the CTO background refresh). */
export async function GET(_req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(launchAddress)) return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  // Accept a token address too: map it to its launch from the CTO index (DB only, no chain calls).
  const a = launchAddress.toLowerCase();
  const row = await prisma.tokenCTO.findFirst({ where: { OR: [{ launchAddress: a }, { tokenAddress: a }] }, select: { launchAddress: true } }).catch(() => null);
  const xray = await getXray(row?.launchAddress ?? launchAddress);
  return NextResponse.json({ xray });
}
