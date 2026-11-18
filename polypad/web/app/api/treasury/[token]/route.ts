import { NextResponse } from 'next/server';
import { getTreasury } from '@/lib/treasury-server';
import { isAddr, treasuryLive } from '@/lib/treasury';
import { getPayoutDestination, payoutApiFields } from '@/lib/payoutDestination';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!treasuryLive()) return NextResponse.json({ live: false });
  if (!isAddr(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  try {
    const [data, dest] = await Promise.all([
      getTreasury(token.toLowerCase() as `0x${string}`),
      getPayoutDestination(token, fresh).catch((e) => { console.error('payout destination failed', e); return undefined; }),
    ]);
    const body = dest === undefined ? data : { ...data, ...payoutApiFields(dest), vault: data.vault };
    return NextResponse.json(body, { headers: { 'Cache-Control': fresh ? 'no-store' : 'public, s-maxage=30, stale-while-revalidate=30' } });
  } catch (e) {
    console.error('treasury api failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
