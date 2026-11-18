import { NextResponse } from 'next/server';
import { getFactories, getSummary } from '@/lib/buyback-server';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' };

/** Read-only POLYDASH buyback summary. Anyone can call; no keys, custody or signing. */
export async function GET() {
  try {
    return NextResponse.json(await getSummary(), { headers: HEADERS });
  } catch (e) {
    console.error('buyback summary failed', e);
    const factories = await getFactories().catch(() => []);
    return NextResponse.json({ error: 'rpc_error', factories }, { status: 502 });
  }
}
