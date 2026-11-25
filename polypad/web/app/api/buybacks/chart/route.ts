import { NextResponse } from 'next/server';
import { buybackLive } from '@/lib/buyback';
import { getChart, getFactories } from '@/lib/buyback-server';

export const dynamic = 'force-dynamic';

/** Daily cumulative buyback series (Pacific dates). Only bucket=day is supported. */
export async function GET(req: Request) {
  const bucket = new URL(req.url).searchParams.get('bucket') ?? 'day';
  if (bucket !== 'day') return NextResponse.json({ error: 'unsupported_bucket' }, { status: 400 });
  try {
    if (!buybackLive()) return NextResponse.json({ live: false, factories: await getFactories(), points: [] });
    return NextResponse.json({ live: true, points: await getChart() }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } });
  } catch (e) {
    console.error('buyback chart failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
