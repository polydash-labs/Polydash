import { NextResponse } from 'next/server';
import { agentCorsHeaders, handleAgentSimulate, type AgentHttpResult } from '@/lib/agent-launch';

export const dynamic = 'force-dynamic';

function respond(result: AgentHttpResult) {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { ...agentCorsHeaders(), ...result.headers },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: agentCorsHeaders() });
}

export async function POST(req: Request) {
  return respond(await handleAgentSimulate(req));
}
