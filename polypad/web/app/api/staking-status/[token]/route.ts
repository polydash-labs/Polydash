import { NextResponse } from 'next/server';
import { getStakingStatus } from '@/lib/staking-status';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return NextResponse.json({ error: 'invalid_address' }, { status: 400 });
  const status = await getStakingStatus(token);
  return NextResponse.json(status, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
}
