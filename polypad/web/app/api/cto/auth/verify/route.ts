import { NextResponse } from 'next/server';
import { getAddress, isAddress, isHex } from 'viem';
import { prisma } from '@/lib/db';
import { publicClient } from '@/lib/agents/tools';
import { ensureCto } from '@/lib/cto/chain';
import { cookieName, cookieOptions, loginMessage, signSession } from '@/lib/cto/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const address = String(body?.address ?? '').toLowerCase();
  const launch = String(body?.launchAddress ?? '');
  const nonce = String(body?.nonce ?? '');
  const signature = String(body?.signature ?? '');
  if (!isAddress(address, { strict: false }) || !isAddress(launch, { strict: false }) || !/^[0-9a-f]{32}$/.test(nonce) || !isHex(signature)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  try {
    const stored = await prisma.authNonce.findUnique({ where: { nonce } });
    if (stored) await prisma.authNonce.delete({ where: { nonce } }).catch(() => null); // one-time use
    if (!stored || stored.address !== address || stored.expiresAt < new Date()) return NextResponse.json({ error: 'Sign-in request expired. Try again.' }, { status: 401 });
    const row = await ensureCto(launch);
    if (!row) return NextResponse.json({ error: 'Launch not found.' }, { status: 404 });
    if (row.creator !== address) return NextResponse.json({ error: 'Only the wallet that created this token can manage its CTO.' }, { status: 403 });
    const ok = await publicClient.verifyMessage({ address: getAddress(address), message: loginMessage(row.launchAddress, nonce), signature: signature as `0x${string}` }).catch(() => false);
    if (!ok) return NextResponse.json({ error: 'Signature does not match the creator wallet.' }, { status: 401 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(cookieName(row.launchAddress), signSession(address, row.launchAddress), cookieOptions);
    return res;
  } catch (e: any) {
    console.error('cto verify failed', e?.message);
    return NextResponse.json({ error: 'Could not verify the signature.' }, { status: 500 });
  }
}
