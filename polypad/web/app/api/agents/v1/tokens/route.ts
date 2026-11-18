import { bad, browseTokens, cors, ok } from '@/lib/agents-api/trade';

export const dynamic = 'force-dynamic';

const PHASES = new Set(['all', 'commit', 'trading', 'graduated']);
const SORTS = new Set(['newest', 'progress', 'raised']);

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

/** Browse and search Polypad launches. Read only. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get('q') ?? '').slice(0, 64);
  const phase = sp.get('phase') ?? 'all';
  const sort = sp.get('sort') ?? 'newest';
  const limitRaw = Number(sp.get('limit') ?? 20);
  if (!PHASES.has(phase)) return bad(400, 'invalid_params', 'phase must be all, commit, trading or graduated.');
  if (!SORTS.has(sort)) return bad(400, 'invalid_params', 'sort must be newest, progress or raised.');
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) return bad(400, 'invalid_params', 'limit must be an integer from 1 to 100.');
  const agentOnly = sp.get('agent') === '1' || sp.get('agent') === 'true';
  try {
    const res = await browseTokens({ q, phase, sort, limit: limitRaw, agentOnly });
    if (!res) return bad(503, 'unavailable', 'Token data is not ready yet. Retry shortly.', {}, { 'retry-after': '5' });
    return ok({ ok: true, chainId: res.items[0]?.chainId ?? 4663, query: { q, phase, sort, limit: limitRaw, agent: agentOnly }, ...res }, 200, {
      'cache-control': 'public, max-age=15, stale-while-revalidate=30',
    });
  } catch (e) {
    console.error('agents v1 tokens failed', e);
    return bad(503, 'unavailable', 'Could not load tokens right now.');
  }
}
