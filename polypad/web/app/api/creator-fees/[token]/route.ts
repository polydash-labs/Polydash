import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getCreatorFees } from '@/lib/creator-fees';
import { getPayoutDestination, payoutApiFields } from '@/lib/payoutDestination';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || !isAddress(token, { strict: false })) {
    return NextResponse.json({ error: 'invalid_address' }, { status: 400 });
  }
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  try {
    const [data, dest] = await Promise.all([
      getCreatorFees(token),
      getPayoutDestination(token, fresh).catch((e) => { console.error('payout destination failed', e); return undefined; }),
    ]);
    if (!data) return NextResponse.json({ error: 'not_polydash_launch' }, { status: 404 });
    return NextResponse.json(dest === undefined ? data : { ...data, ...payoutApiFields(dest) }, { headers: { 'Cache-Control': fresh ? 'no-store' : 'public, max-age=30' } });
  } catch (e) {
    console.error('creator-fees error', e);
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
