import { NextResponse } from 'next/server';
import { getLaunchLookup } from '@/lib/launches-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/launch?address=0x…
 *
 * One launch by its launch contract address or its token address (same shape
 * as useLaunch), from the server-side 45s SWR snapshot in
 * lib/launches-server. The browser used to resolve the address and read the
 * launch details from the chain directly; on a direct load / refresh that
 * read fired into the first-load storm and the token page sat on the
 * "Loading token" skeleton for minutes (SWARM, Nov 21 scan) or flipped to
 * "Couldn't load this token right now" (POLYCAT), while the same pages
 * loaded fully via SPA navigation from the homepage. The browser now makes
 * one cheap request.
 *
 * 200: the launch. 404: the address genuinely is not a launch on any known
 * factory (getLaunchLookup sets `missing` only then). 502: the snapshot was
 * not ready in time — the client retries with backoff; a 502 never means
 * "not a launch".
 */
const WAIT_MS = 8_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'A launch or token address (0x…) is required.' }, { status: 400, headers: NO_STORE });
  }
  const { token, missing } = await getLaunchLookup(address, WAIT_MS);
  if (token) return NextResponse.json({ token, updatedAt: Date.now() }, { headers: NO_STORE });
  if (missing) return NextResponse.json({ token: null, missing: true }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ error: 'Could not read this token right now.' }, { status: 502, headers: NO_STORE });
}
