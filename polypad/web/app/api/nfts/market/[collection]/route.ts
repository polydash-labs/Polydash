import { NextResponse } from 'next/server';
import { getMarketData } from '@/lib/nft-market/indexer';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(collection)) return NextResponse.json({ error: 'Invalid collection address' }, { status: 400 });
  try {
    return NextResponse.json(await getMarketData(collection), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[nft-market] api failed', e);
    return NextResponse.json({ error: 'Market data unavailable' }, { status: 500 });
  }
}
