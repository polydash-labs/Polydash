import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { adminLoginMessage, factoryOwner } from '@/lib/agent-actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const address = String(body?.address ?? '').toLowerCase();
  if (!isAddress(address, { strict: false })) return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  try {
    const owner = await factoryOwner();
    if (!owner || owner !== address) return NextResponse.json({ error: 'Only the admin wallet can view this page.' }, { status: 403 });
    await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if ((await prisma.authNonce.count({ where: { address } })) >= 10) return NextResponse.json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, { status: 429 });
    const nonce = crypto.randomBytes(16).toString('hex');
    await prisma.authNonce.create({ data: { address, nonce, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    return NextResponse.json({ nonce, message: adminLoginMessage(nonce) });
  } catch (e: any) {
    console.error('admin nonce failed', e?.message);
    return NextResponse.json({ error: 'Could not start sign-in.' }, { status: 500 });
  }
}
