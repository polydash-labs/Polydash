import { NextResponse } from 'next/server';
import { getAllStakingStatuses } from '@/lib/staking-status';

export const dynamic = 'force-dynamic';

/** Batch status for every launch token: { statuses: { [tokenLower]: { state, byCreator, activeByCreator } } | null }. */
export async function GET() {
  const statuses = await getAllStakingStatuses();
  return NextResponse.json({ statuses }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
}
