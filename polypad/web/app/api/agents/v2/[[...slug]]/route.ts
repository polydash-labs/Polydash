import { handleV2 } from '@/lib/agents-api/v2/router';
import { corsHeaders } from '@/lib/agents-api/v2/router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug?: string[] }> };

async function run(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const r = await handleV2(req, slug ?? []);
  return Response.json(r.body, { status: r.status, headers: r.headers });
}

export const GET = run;
export const POST = run;
export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
