import { NextResponse } from 'next/server';
import { getPoolDetail } from '@/lib/staking/server';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool)) return NextResponse.json({ error: 'Invalid pool address' }, { status: 400 });
  try {
    const data = await getPoolDetail(pool);
    if (data === 'not-found') return NextResponse.json({ error: 'This address is not a Polypad staking pool.' }, { status: 404 });
    if (!data) return NextResponse.json({ pending: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=60' } });
  } catch (e) {
    console.error(`GET /api/stake/${pool} failed`, e);
    return NextResponse.json({ error: 'Could not read this pool right now.' }, { status: 502 });
  }
}
