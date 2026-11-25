import { NextResponse } from 'next/server';
import { floorLive } from '@/lib/floorVault';
import { FloorInputError, getFloorVault } from '@/lib/floor-vault-server';

export const dynamic = 'force-dynamic';

/** Read-only token floor vault state. Anyone can call; no keys, custody or signing. */
export async function GET(_req: Request, { params }: { params: Promise<{ collection: string }> }) {
  if (!floorLive()) return NextResponse.json({ live: false });
  const { collection } = await params;
  try {
    const data = await getFloorVault(collection);
    if (!data) return NextResponse.json({ live: true, error: 'not_a_collection' }, { status: 404 });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' } });
  } catch (e) {
    if (e instanceof FloorInputError) return NextResponse.json({ live: true, error: 'invalid_address' }, { status: 400 });
    console.error('floor vault api failed', e);
    return NextResponse.json({ live: true, error: 'rpc_error' }, { status: 502 });
  }
}
