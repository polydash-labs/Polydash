import { NextResponse } from 'next/server';
import { listTreasuryTasks } from '@/lib/treasury-server';
import { treasuryLive } from '@/lib/treasury';

export const dynamic = 'force-dynamic';

let cache: { at: number; data: unknown } | null = null;

const TASK_TYPES = {
  claim_fees_to_treasury: 'Creator fees are routed to the vault and claimableFeesWei > 0. Call claimCreatorFees() on the launch (target). Anyone can call; fees go to the vault, the caller pays gas and receives nothing.',
  execute_payout_change: 'A pending payout change to this vault has passed executeAt. Call executePayoutWalletChange() on the launch (target). Anyone can call.',
};

/** Read-only discovery of treasury rules vaults. Agents are added on-chain by the creator; no keys, custody or signing here. */
export async function GET() {
  if (!treasuryLive()) return NextResponse.json({ live: false, vaults: [] });
  try {
    if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), data: await listTreasuryTasks() };
    return NextResponse.json({ live: true, taskTypes: TASK_TYPES, vaults: cache.data }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' } });
  } catch (e) {
    console.error('treasury tasks failed', e);
    return NextResponse.json({ error: 'rpc_error' }, { status: 502 });
  }
}
