import { NextResponse } from 'next/server';
import { getAddress, isAddress, isHex } from 'viem';
import { prisma } from '@/lib/db';
import { agentClient } from '@/lib/agents-api/core';
import { ADMIN_COOKIE, adminCookieOptions, adminLoginMessage, factoryOwner, signAdmin } from '@/lib/agent-actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const address = String(body?.address ?? '').toLowerCase();
  const nonce = String(body?.nonce ?? '');
  const signature = String(body?.signature ?? '');
  if (!isAddress(address, { strict: false }) || !/^[0-9a-f]{32}$/.test(nonce) || !isHex(signature)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const stored = await prisma.authNonce.findUnique({ where: { nonce } });
    if (stored) await prisma.authNonce.delete({ where: { nonce } }).catch(() => null);
    if (!stored || stored.address !== address || stored.expiresAt < new Date()) return NextResponse.json({ error: 'Sign-in request expired. Try again.' }, { status: 401 });
    const owner = await factoryOwner();
    if (!owner || owner !== address) return NextResponse.json({ error: 'Only the admin wallet can view this page.' }, { status: 403 });
    const ok = await agentClient.verifyMessage({ address: getAddress(address), message: adminLoginMessage(nonce), signature: signature as `0x${string}` }).catch(() => false);
    if (!ok) return NextResponse.json({ error: 'Signature does not match this wallet.' }, { status: 401 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, signAdmin(address), adminCookieOptions);
    return res;
  } catch (e: any) {
    console.error('admin verify failed', e?.message);
    return NextResponse.json({ error: 'Could not verify the signature.' }, { status: 500 });
  }
}
