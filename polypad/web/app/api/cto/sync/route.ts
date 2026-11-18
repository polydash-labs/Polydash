import { NextResponse } from 'next/server';
import { syncCto } from '@/lib/cto/chain';

export const dynamic = 'force-dynamic';

// Indexer entry point. Throttled to one run per minute; safe to call on every page load.
export async function GET() {
  try {
    return NextResponse.json(await syncCto());
  } catch (e: any) {
    console.error('cto sync failed', e?.message);
    return NextResponse.json({ error: 'Sync failed.' }, { status: 500 });
  }
}
