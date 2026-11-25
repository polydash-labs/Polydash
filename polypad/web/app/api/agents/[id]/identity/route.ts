import { NextResponse } from 'next/server';
import { readAgentIdentityCached, AgentNotFoundError } from '@/lib/agents/identity';

export const dynamic = 'force-dynamic';

/** Machine-readable agent identity — the same fields the /agents/[id] card
 * shows, as JSON. For merchants and websites that want to know which agent
 * is calling and who stands behind it (Circle's note, Nov 24).
 *
 * GET /api/agents/[id]/identity
 * 200 — the identity (format polypad.agent-identity/1)
 * 404 — no registered agent with that id
 * 502 — the chain could not be read right now
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isInteger(agentId) || agentId < 1) {
    return NextResponse.json({ error: 'invalid agent id' }, { status: 400 });
  }
  try {
    const identity = await readAgentIdentityCached(agentId);
    return NextResponse.json(identity, {
      headers: { 'Cache-Control': 'public, s-maxage=60' },
    });
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: 'agent not found' }, { status: 404 });
    }
    console.error('[agents/identity] read failed', err);
    return NextResponse.json({ error: 'identity unavailable' }, { status: 502 });
  }
}
