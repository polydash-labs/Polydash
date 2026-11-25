import { handleMcp } from '@/lib/agents-api/v2/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function run(req: Request) {
  const r = await handleMcp(req);
  if (r.body === null) return new Response(null, { status: r.status, headers: r.headers });
  return Response.json(r.body, { status: r.status, headers: r.headers });
}

export const POST = run;
export const GET = run;
export const DELETE = run;
export const OPTIONS = run;
