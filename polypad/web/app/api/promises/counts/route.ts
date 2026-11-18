import { NextResponse } from 'next/server';
import { allPromiseCounts } from '@/lib/promises/summary';

export const dynamic = 'force-dynamic';

// Badge counts for every launch (one grouped DB query, cached 30s). No RPC.
export async function GET() {
  try {
    return NextResponse.json({ counts: await allPromiseCounts() }, { headers: { 'Cache-Control': 'public, max-age=30' } });
  } catch (e: any) {
    console.error('promise counts failed', e?.message);
    return NextResponse.json({ counts: {} });
  }
}
