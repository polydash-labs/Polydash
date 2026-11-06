import { NextResponse } from 'next/server';
import { agentCorsHeaders, agentIndexBody } from '@/lib/agent-launch';

export const dynamic = 'force-dynamic';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: agentCorsHeaders() });
}

export function GET() {
  return json(agentIndexBody());
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: agentCorsHeaders() });
}
