/** HTTP dispatch for /api/agents/v2/*. Pure: takes a Request, returns status, body, and headers. */
import { ApiError, defaultCtx, metaOf, scrub, toApiError, type Ctx } from './core';
import { LIMITS } from './config';
import { TOOLS, indexBody, runTool } from './tools';

export type HttpResult = { status: number; body: Record<string, unknown>; headers: Record<string, string> };

export function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-polypad-client',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
  };
}

export function errorBody(e: ApiError): Record<string, unknown> {
  return { ok: false, error: { code: e.code, message: scrub(e.message), ...e.extra } };
}

const ALIASES: Record<string, string> = { 'token': 'token', 'fund': 'fund', 'protections': 'protections' };

export async function handleV2(req: Request, slug: string[], ctx: Ctx = defaultCtx()): Promise<HttpResult> {
  const headers = corsHeaders();
  try {
    const path = slug.join('/');
    if (path === '') {
      if (req.method !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Use GET.');
      return { status: 200, body: indexBody(), headers };
    }
    let tool = TOOLS.find((t) => t.path === path);
    const params: Record<string, unknown> = {};
    // /token/{address}, /fund/{address}, /protections/{address}
    if (!tool && slug.length === 2 && ALIASES[slug[0]]) {
      tool = TOOLS.find((t) => t.path === ALIASES[slug[0]]);
      params[slug[0] === 'fund' ? 'fund' : 'token'] = decodeURIComponent(slug[1]);
    }
    if (!tool) throw new ApiError(404, 'not_found', 'Unknown endpoint. GET /api/agents/v2 lists them.');
    if (req.method !== tool.method) throw new ApiError(405, 'method_not_allowed', `Use ${tool.method} for this endpoint.`);

    let input: Record<string, unknown> = params;
    if (tool.method === 'GET') {
      for (const [k, v] of new URL(req.url).searchParams) if (!(k in input)) input[k] = v;
    } else {
      const raw = await req.text();
      if (raw.length > LIMITS.maxBodyBytes) throw new ApiError(413, 'payload_too_large', `Body is over ${LIMITS.maxBodyBytes} bytes.`);
      let parsed: unknown;
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw new ApiError(400, 'invalid_json', 'Body is not valid JSON.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError(400, 'invalid_json', 'Expected a JSON object.');
      input = { ...(parsed as Record<string, unknown>), ...params };
    }
    const meta = metaOf(req, input);
    const body = await runTool(ctx, tool, input, meta);
    return { status: 200, body, headers };
  } catch (err) {
    const e = toApiError(err);
    const h = { ...headers };
    if (e.status === 429) h['retry-after'] = String(e.extra.retryAfter ?? 60);
    return { status: e.status, body: errorBody(e), headers: h };
  }
}
