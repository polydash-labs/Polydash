import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { ensureCto } from '@/lib/cto/chain';
import { cookieName, readSession } from '@/lib/cto/session';

export const dynamic = 'force-dynamic';

// One-time nonce for a promise signature (stored in AuthNonce under a separate `promise:` namespace,
// so it never counts against or works for the creator sign-in flow).
export async function POST(_req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  try {
    const row = await ensureCto(launchAddress);
    if (!row) return NextResponse.json({ error: 'Launch not found.' }, { status: 404 });
    const session = readSession((await cookies()).get(cookieName(row.launchAddress))?.value, row.launchAddress);
    if (!session) return NextResponse.json({ error: 'Sign in as the token creator first.' }, { status: 401 });
    if (session !== row.creator) return NextResponse.json({ error: 'Only the token creator can publish promises.' }, { status: 403 });
    const key = `promise:${row.creator}`;
    await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if ((await prisma.authNonce.count({ where: { address: key } })) >= 10) return NextResponse.json({ error: 'Too many open requests. Try again in a few minutes.' }, { status: 429 });
    const nonce = `promise:${crypto.randomBytes(16).toString('hex')}`;
    await prisma.authNonce.create({ data: { address: key, nonce, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    return NextResponse.json({ nonce, startsAt: Math.floor(Date.now() / 1000) });
  } catch (e: any) {
    console.error('promise nonce failed', e?.message);
    return NextResponse.json({ error: 'Could not start the promise. Try again.' }, { status: 500 });
  }
}
