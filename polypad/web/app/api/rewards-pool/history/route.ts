import { NextResponse } from 'next/server';
import { poolLive } from '@/lib/buyback';
import { getPoolHistory } from '@/lib/buyback-server';

export const dynamic = 'force-dynamic';

/** Read-only POLYDASH Rewards Pool events (Staked, Withdrawn, RewardPaid, RewardAdded, Restreamed), newest first. */
export async function GET() {
  try {
    if (!poolLive()) return NextResponse.json({ live: false, items: [] });
    return NextResponse.json({ live: true, items: await getPoolHistory() }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } });
  } catch (e) {
    console.error('rewards pool history failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
