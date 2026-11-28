import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getEligibleEvaluators } from '@/lib/earn/eligibility';
import { EVALUATOR_MIN_SCORE } from '@/lib/earn/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/earn/evaluators — the evaluator pool: registered,
 * active, credit score >= 300, session-key wallet. ?exclude=0x…,0x…
 * removes conflicts (poster, claiming agent). Atlas can also exclude
 * same-operator agents by id at draw time.
 */
export async function GET(req: Request) {
  const excludeParam = new URL(req.url).searchParams.get('exclude') ?? '';
  const exclude = excludeParam
    .split(',')
    .map((w) => w.trim())
    .filter((w) => isAddress(w, { strict: false }));
  try {
    const pool = await getEligibleEvaluators(exclude);
    return NextResponse.json(
      {
        minScore: EVALUATOR_MIN_SCORE,
        evaluators: pool.map((p) => ({ agentId: p.agentId, name: p.name, wallet: p.wallet, score: p.score })),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[earn/evaluators] failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not load the evaluator pool right now.' }, { status: 502 });
  }
}
