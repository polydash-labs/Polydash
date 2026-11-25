import { NextResponse } from 'next/server';
import { getPoolSummary } from '@/lib/buyback-server';

export const dynamic = 'force-dynamic';

/** Read-only POLYDASH Rewards Pool summary. aprVariable uses only the current rewardRate and totalStaked; it is not a projection. */
export async function GET() {
  try {
    return NextResponse.json(await getPoolSummary(), { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } });
  } catch (e) {
    console.error('rewards pool summary failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
