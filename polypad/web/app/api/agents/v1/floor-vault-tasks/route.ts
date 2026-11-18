import { NextResponse } from 'next/server';
import { listFloorTasks } from '@/lib/floor-vault-server';
import { floorLive } from '@/lib/floorVault';

export const dynamic = 'force-dynamic';

let cache: { at: number; data: unknown } | null = null;

const TASK_TYPES = {
  floor_vault_buy: 'The token has graduated and the vault has ETH waiting to swap. Step "record_price": call observePrice() on the collection. Step "buy": call buyToken() on the collection once earliestAt has passed (5 to 60 minutes after the recorded price, at least 10 minutes after the last buy). Uses ETH queued in the vault to buy the token on-chain within the collection limits; bought tokens are held for NFT holders. Anyone can call; the caller pays gas and receives nothing.',
};

/** Read-only discovery of token floor vault buy steps. No keys, custody or signing here. */
export async function GET() {
  if (!floorLive()) return NextResponse.json({ live: false, tasks: [] });
  try {
    if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), data: await listFloorTasks() };
    return NextResponse.json({ live: true, taskTypes: TASK_TYPES, tasks: cache.data }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' } });
  } catch (e) {
    console.error('floor vault tasks failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
