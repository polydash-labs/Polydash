/**
 * Remote MCP over Streamable HTTP, stateless: each POST is one JSON-RPC message (or a batch) and gets one JSON reply.
 * Supports initialize, ping, tools/list, tools/call, and notifications (202). No sessions, no streaming, no auth.
 */
import { ApiError, defaultCtx, metaOf, scrub, toApiError, type Ctx } from './core';
import { LIMITS } from './config';
import { errorBody } from './router';
import { resolveApiKey, type ApiTier, type KeyResolution } from './keys';
import { FREE_KEY_ID, kindOf, recordUsage } from './usage';
import { TOOLS, runTool } from './tools';

export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'polypad', title: 'Polypad on Robinhood Chain', version: '2.1.0' };
export const INSTRUCTIONS =
  'Polypad is non-custodial. Tools only read data or prepare unsigned transactions. After any prepare_* tool, show the user the summary (what they pay, minimum they receive, fees, risks) BEFORE the signing link, and never ask for a private key or seed phrase. Start with polypad_what_can_i_do. Use polypad_intent for plain-language requests. Wallet addresses only.';

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcReply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const ok = (id: Rpc['id'], result: unknown): RpcReply => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Rpc['id'], code: number, message: string, data?: unknown): RpcReply => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } });

export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: t.kind === 'read', openWorldHint: true, title: t.title },
  }));
}

export async function handleRpc(msg: Rpc, req: Request, ctx: Ctx, key: KeyResolution = { tier: 'free', degraded: false }): Promise<RpcReply | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
  const isNote = msg.id === undefined;
  const tier: ApiTier = key.tier === 'pro' ? 'pro' : 'free';
  switch (msg.method) {
    case 'initialize': {
      const want = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '';
      const protocolVersion = (MCP_PROTOCOLS as readonly string[]).includes(want) ? want : MCP_PROTOCOLS[0];
      return ok(msg.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok(msg.id, {});
    case 'tools/list': return ok(msg.id, { tools: listTools() });
    case 'tools/call': {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${typeof name === 'string' ? name.slice(0, 64) : ''}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof args !== 'object' || Array.isArray(args)) return fail(msg.id, -32602, 'arguments must be an object');
      try {
        const meta = metaOf(req, args, tier, key.tier === 'pro' ? key.keyId : null);
        const out = await runTool(ctx, tool, args, meta);
        recordUsage({ keyId: key.tier === 'pro' ? key.keyId : FREE_KEY_ID, tool: tool.name, kind: kindOf(tool), status: 'ok' });
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }], structuredContent: out, isError: false });
      } catch (err) {
        const e = toApiError(err);
        recordUsage({ keyId: key.tier === 'pro' ? key.keyId : FREE_KEY_ID, tool: tool.name, kind: kindOf(tool), status: e.status === 429 ? 'rate_limited' : 'error' });
        const body = errorBody(e);
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true });
      }
    }
    case 'resources/list': return ok(msg.id, { resources: [] });
    case 'prompts/list': return ok(msg.id, { prompts: [] });
    default:
      if (isNote || msg.method.startsWith('notifications/')) return null;
      return fail(msg.id, -32601, `Method not found: ${scrub(msg.method).slice(0, 64)}`);
  }
}

export async function handleMcp(req: Request, ctx: Ctx = defaultCtx()): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const headers: Record<string, string> = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, x-polypad-client, x-api-key', 'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS', 'cache-control': 'no-store' };
  if (req.method === 'OPTIONS') return { status: 204, body: null, headers };
  if (req.method !== 'POST') return { status: 405, body: { error: 'Use POST with a JSON-RPC message.' }, headers: { ...headers, allow: 'POST, OPTIONS' } };
  // Optional API key: no key → free tier, valid key → Pro (10x limits), bad key → 401.
  // A database failure degrades to the free tier instead of failing the call.
  const key = await resolveApiKey(req);
  if (key.tier === 'invalid') {
    return { status: 401, body: fail(null, -32001, key.reason), headers };
  }
  try {
    const raw = await req.text();
    if (raw.length > LIMITS.maxBodyBytes) throw new ApiError(413, 'payload_too_large', 'Body too large.');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { status: 400, body: fail(null, -32700, 'Parse error'), headers }; }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0 || parsed.length > 10) return { status: 400, body: fail(null, -32600, 'Batch must have 1 to 10 messages'), headers };
      const replies = (await Promise.all(parsed.map((m) => handleRpc(m as Rpc, req, ctx, key)))).filter((r): r is RpcReply => r !== null);
      return replies.length ? { status: 200, body: replies, headers } : { status: 202, body: null, headers };
    }
    const reply = await handleRpc(parsed as Rpc, req, ctx, key);
    return reply ? { status: 200, body: reply, headers } : { status: 202, body: null, headers };
  } catch (err) {
    const e = toApiError(err);
    return { status: e.status, body: fail(null, -32000, e.message), headers };
  }
}
