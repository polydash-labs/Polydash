import { NextResponse } from 'next/server';
import { buybackLive } from '@/lib/buyback';
import { getFactories, getHistory } from '@/lib/buyback-server';

export const dynamic = 'force-dynamic';
const PAGE = 50;

/** Read-only buyback event history, newest first. ?cursor= is the offset returned as nextCursor. */
export async function GET(req: Request) {
  try {
    if (!buybackLive()) return NextResponse.json({ live: false, factories: await getFactories(), items: [] });
    const cursor = Math.max(0, Number(new URL(req.url).searchParams.get('cursor') ?? 0) || 0);
    const all = await getHistory();
    const items = all.slice(cursor, cursor + PAGE);
    return NextResponse.json(
      { live: true, items, total: all.length, nextCursor: cursor + PAGE < all.length ? String(cursor + PAGE) : null },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } },
    );
  } catch (e) {
    console.error('buyback history failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
