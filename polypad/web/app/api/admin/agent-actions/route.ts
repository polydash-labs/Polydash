import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';

export const dynamic = 'force-dynamic';

/** Admin-only: latest AgentAction rows. ?before=<ISO date> pages back. */
export async function GET(req: Request) {
  const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!admin) return NextResponse.json({ error: 'Sign in with the admin wallet.' }, { status: 401 });
  const before = new URL(req.url).searchParams.get('before');
  const d = before ? new Date(before) : null;
  try {
    const rows = await prisma.agentAction.findMany({
      where: d && !isNaN(d.getTime()) ? { createdAt: { lt: d } } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({ admin, rows }, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    console.error('admin agent-actions failed', e?.message);
    return NextResponse.json({ error: 'Could not load rows.' }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
