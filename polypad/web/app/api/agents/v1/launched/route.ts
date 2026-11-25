import { fail, getAgentLaunched, json } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

/** Launch + token addresses registered as agent-launched (database only, 60s cache). */
export async function GET() {
  try {
    const items = await getAgentLaunched();
    return json({ items }, 200, { 'cache-control': 'public, max-age=30, stale-while-revalidate=60' });
  } catch (e) {
    console.error('agents v1 launched failed', e);
    return fail(503, 'unavailable', 'Could not load the list right now.');
  }
}
