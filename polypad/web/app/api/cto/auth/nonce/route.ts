import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { ensureCto } from '@/lib/cto/chain';
import { loginMessage } from '@/lib/cto/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const address = String(body?.address ?? '').toLowerCase();
  const launch = String(body?.launchAddress ?? '');
  if (!isAddress(address, { strict: false }) || !isAddress(launch, { strict: false })) return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  try {
    const row = await ensureCto(launch);
    if (!row) return NextResponse.json({ error: 'Launch not found.' }, { status: 404 });
    if (row.creator !== address) return NextResponse.json({ error: 'Only the wallet that created this token can manage its CTO.' }, { status: 403 });
    await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const active = await prisma.authNonce.count({ where: { address } });
    if (active >= 10) return NextResponse.json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, { status: 429 });
    const nonce = crypto.randomBytes(16).toString('hex');
    await prisma.authNonce.create({ data: { address, nonce, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    return NextResponse.json({ nonce, message: loginMessage(row.launchAddress, nonce) });
  } catch (e: any) {
    console.error('cto nonce failed', e?.message);
    return NextResponse.json({ error: 'Could not start sign-in.' }, { status: 500 });
  }
}
