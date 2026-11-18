import { NextResponse } from 'next/server';
import { getStakingOverview } from '@/lib/staking/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (token && !/^0x[0-9a-fA-F]{40}$/.test(token)) return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
  try {
    const data = await getStakingOverview(token);
    if (!data) return NextResponse.json({ pending: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=60' } });
  } catch (e) {
    console.error('GET /api/stake/pools failed', e);
    return NextResponse.json({ error: 'Could not read staking pools right now.' }, { status: 502 });
  }
}
