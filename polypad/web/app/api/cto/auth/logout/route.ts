import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { cookieName, cookieOptions } from '@/lib/cto/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const launch = String(body?.launchAddress ?? '');
  if (!isAddress(launch, { strict: false })) return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(launch), '', { ...cookieOptions, maxAge: 0 });
  return res;
}
