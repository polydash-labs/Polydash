import { NextResponse } from 'next/server';
import { getTotalTvl } from '@/lib/total-tvl';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tvl = await getTotalTvl();
  if (!tvl) return NextResponse.json({ error: 'Total TVL is unavailable right now' }, { status: 503 });
  return NextResponse.json(tvl);
}
