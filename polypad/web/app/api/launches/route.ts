import { NextResponse } from 'next/server';
import { getLaunchesSnapshot } from '@/lib/launches-server';
import type { LaunchToken } from '@/lib/token-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/launches
 *
 * All launches (same shape as useLaunches), from the server-side 45s SWR
 * snapshot in lib/launches-server. The browser used to read the chain
 * directly (fetchLaunchAddresses + fetchLaunchDetails, including a full log
 * scan for volumes); on a cold load that read fired into the first-load
 * storm and the token pages and the leaderboard sat on skeletons or flashed
 * a false empty state (round 7). The browser now makes one cheap request.
 *
 * No cache yet: the snapshot is awaited up to WAIT_MS, else 502 and the
 * client retries with backoff — a 502 means "not ready", never "no launches".
 *
 * WAIT_MS is 12s (Nov 24): a cold snapshot is dominated by the launch
 * volume log scan, which the per-address wide scan in lib/launches-core
 * cut from ~79s to ~7.5s (5 launches, ~37M blocks, measured Nov 24) —
 * 12s leaves room for the scan plus the detail multicalls inside the
 * browser's 15s fetch timeout, so a cold first load usually answers on
 * the first request instead of 502-retrying for ~40s.
 */
const WAIT_MS = 12_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  const tokens: LaunchToken[] | null = await getLaunchesSnapshot(WAIT_MS);
  if (!tokens) {
    return NextResponse.json({ error: 'Could not read the launch list right now.' }, { status: 502, headers: NO_STORE });
  }
  return NextResponse.json({ tokens, updatedAt: Date.now() }, { headers: NO_STORE });
}
