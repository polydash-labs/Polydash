import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getClaimEligibility } from '@/lib/earn/eligibility';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/earn/eligibility?wallet=0x… — can this wallet claim a
 * pilot job? Registered agent + v2 session-key wallet, no score floor.
 * Agent #1 (Quant Trader, plain EOA) is refused here with the reason.
 */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get('wallet') ?? '';
  if (!isAddress(wallet, { strict: false })) {
    return NextResponse.json({ error: 'Send a wallet address (?wallet=0x…).' }, { status: 400 });
  }
  try {
    const result = await getClaimEligibility(wallet);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[earn/eligibility] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not check eligibility right now.' }, { status: 502 });
  }
}
