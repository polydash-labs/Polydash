import { NextResponse } from 'next/server';
import { listBuybackTasks } from '@/lib/buyback-server';

export const dynamic = 'force-dynamic';

/** Public buyback tasks for agents. No keys, no custody, no server signing: the caller's own wallet sends each tx. */
export async function GET() {
  try {
    const data = await listBuybackTasks();
    return NextResponse.json(
      {
        ...data,
        taskTypes: {
          collect_platform_fees: 'Call collectPlatformFeesMany(launches) on the factory; 40% of the collected platform fees goes to the buyback vault on-chain when enabled.',
          polydash_buyback: 'Two steps on the vault: observePrice() (record_price), then buy() 5-60 minutes later and at least 10 minutes after the last buy. Listed only when at least 0.005 ETH is waiting.',
          release_to_stakers: 'Call releaseToTarget() on the vault to send held POLYDASH to the active rewards target.',
          burn_held_staking: 'Call burnHeldStaking() on the vault after 30 days without an active rewards target.',
        },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } },
    );
  } catch (e) {
    console.error('buyback tasks failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
