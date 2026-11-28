/**
 * Remote MCP over Streamable HTTP, stateless: each POST is one JSON-RPC message (or a batch) and gets one JSON reply.
 * Supports initialize, ping, tools/list, tools/call, resources (Polypad Skills), skills/list, skills/get,
 * tasks (Tasks + Elicitation), and notifications (202). No sessions, no streaming, no auth.
 *
 * Server version 2.2.2 — Polypad Skills over MCP (SEP-2640, extension `io.modelcontextprotocol/skills`):
 * skills are SKILL.md workflow docs served through the Resources primitive; see lib/agents-api/v2/skills.ts.
 *
 * Tasks + Elicitation (base spec): a tools/call carrying `params.task = { ttl }` runs as a task instead of
 * answering inline. Prepare tools pause for human approval first (task status `input_required` with the
 * elicitation form); a polypad_get_fund task is a fund-watch that completes when the fund's on-chain state
 * changes (the 2-day proposal-wait watch). See lib/agents-api/v2/tasks.ts.
 *
 * Stateless elicitation: this server cannot push an `elicitation/create` request over a stream, so the
 * elicitation request is delivered inside the task payload and the client answers by POSTing a JSON-RPC
 * response (`{ jsonrpc: "2.0", id: "<elicitationId>", result: { action, content } }`) to this endpoint.
 * Same message shape, same requestedSchema — only the delivery differs. The wallet still enforces:
 * approval prepares the unsigned transaction; the spend only happens when the human signs.
 *
 * Protocol versions: 2025-11-25 is negotiated first (the version the current TS SDK supports, and the
 * version Skills works on). 2026-07-28 is deliberately NOT negotiated: it removes `initialize`, requires
 * `server/discover` and per-request header validation, and reworks sessions — a transport upgrade, not
 * a skills change. If a host requires 2026-07-28, that is follow-up work.
 */
import { ApiError, defaultCtx, metaOf, scrub, toApiError, type Ctx } from './core';
import { LIMITS } from './config';
import { errorBody } from './router';
import { resolveApiKey, type ApiTier, type KeyResolution } from './keys';
import { FREE_KEY_ID, kindOf, recordUsage } from './usage';
import { TOOLS, runTool, type Tool } from './tools';
import { SKILLS, findSkillByUri, skillEntry, skillMd, skillUri, SKILL_CACHE_SCOPE, SKILL_TTL_MS } from './skills';
import {
  approvalElicitation, createTask, expireIfNeeded, findTaskByElicitationId, fundWatchChanged, fundWatchSnapshot,
  getTask, listTasks, newElicitationId, updateTask, DEFAULT_TASK_TTL_MS, FUND_WATCH_TTL_MS, MAX_TASK_TTL_MS,
  type McpTask,
} from './tasks';

export const MCP_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'polypad', title: 'Polypad on Robinhood Chain', version: '2.2.2' };
export const INSTRUCTIONS =
  'Polypad is non-custodial. Tools only read data or prepare unsigned transactions. After any prepare_* tool, show the user the summary (what they pay, minimum they receive, fees, risks) BEFORE the signing link, and never ask for a private key or seed phrase. Start with polypad_what_can_i_do. Use polypad_intent for plain-language requests. Wallet addresses only. Skills are available via skills/list (extension io.modelcontextprotocol/skills): read the skill for a job before calling its tools, and follow its steps. Prepare tools called as MCP Tasks pause for human approval (elicitation) before anything is prepared.';

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
type RpcReply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const ok = (id: Rpc['id'], result: unknown): RpcReply => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Rpc['id'], code: number, message: string, data?: unknown): RpcReply => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } });

/** Caching hints (SEP-2549) on complete list/read results: public docs, fresh for 1h. */
const cacheHints = { resultType: 'complete', ttlMs: SKILL_TTL_MS, cacheScope: SKILL_CACHE_SCOPE };

export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: t.kind === 'read', openWorldHint: true, title: t.title },
  }));
}

function toolResultPayload(out: unknown): { content: { type: string; text: string }[]; structuredContent: unknown; isError: boolean } {
  return { content: [{ type: 'text', text: JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }], structuredContent: out, isError: false };
}

function taskShape(t: McpTask): Record<string, unknown> {
  const shape: Record<string, unknown> = {
    taskId: t.id, status: t.status, createdAt: t.createdAt, lastUpdatedAt: t.updatedAt, ttl: t.ttlMs,
  };
  if (t.statusMessage) shape.statusMessage = t.statusMessage;
  if (t.kind === 'fund-watch') shape.pollInterval = 3600_000; // the 2-day wait: hourly polls are plenty
  return shape;
}

function isPrepareTool(tool: Tool): boolean {
  return tool.name.startsWith('polypad_prepare_');
}

/** Run a tool and return its payload, or the error body on failure. Never throws. */
async function runToolSafe(ctx: Ctx, tool: Tool, args: Record<string, unknown>, meta: ReturnType<typeof metaOf>, tier: ApiTier, keyId: string | null) {
  try {
    const out = await runTool(ctx, tool, args, meta);
    recordUsage({ keyId: keyId ?? FREE_KEY_ID, tool: tool.name, kind: kindOf(tool), status: 'ok' });
    return { ok: true as const, payload: toolResultPayload(out), raw: out };
  } catch (err) {
    const e = toApiError(err);
    recordUsage({ keyId: keyId ?? FREE_KEY_ID, tool: tool.name, kind: kindOf(tool), status: e.status === 429 ? 'rate_limited' : 'error' });
    const body = errorBody(e);
    return { ok: false as const, payload: { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true }, raw: body, errorMessage: e.message };
  }
}

/** Create a task for a tools/call, run or pause it per its kind, and return the CreateTaskResult. */
async function startTask(msg: Rpc, req: Request, ctx: Ctx, key: KeyResolution, tool: Tool, args: Record<string, unknown>) {
  const tier: ApiTier = key.tier === 'pro' ? 'pro' : 'free';
  const keyId = key.tier === 'pro' ? key.keyId : null;
  const taskParam = (msg.params?.task ?? {}) as Record<string, unknown>;
  const ttlMs = typeof taskParam.ttl === 'number' && taskParam.ttl > 0 ? Math.min(Math.floor(taskParam.ttl), MAX_TASK_TTL_MS) : null;
  const isWatch = tool.name === 'polypad_get_fund';
  const kind = isWatch ? 'fund-watch' : 'tool-call';
  const meta = metaOf(req, args, tier, keyId);

  if (isPrepareTool(tool)) {
    // Spend path: pause for human approval before anything is prepared.
    const summary = `prepare ${tool.name} with ${JSON.stringify(args).slice(0, 500)}`;
    const elicitationId = newElicitationId();
    const task = await createTask({
      tool: tool.name, args, kind, status: 'input_required',
      statusMessage: 'Waiting for the human to approve this spend. Nothing is prepared until they approve, and nothing moves until they sign in their own wallet.',
      elicitationId, elicitation: approvalElicitation('', tool.name, summary),
      ttlMs: ttlMs ?? DEFAULT_TASK_TTL_MS,
    });
    // Stamp the real task id into the elicitation's related-task metadata.
    const elicitation = approvalElicitation(task.id, tool.name, summary);
    await updateTask(task.id, { elicitation });
    const fresh = (await getTask(task.id)) ?? task;
    return ok(msg.id, { task: taskShape(fresh), elicitationId, elicitation: fresh.elicitation, resultType: 'input_required' });
  }

  if (isWatch) {
    // Baseline read: snapshot the fund's current state, then watch for change.
    const read = await runToolSafe(ctx, tool, args, meta, tier, keyId);
    if (!read.ok) {
      const task = await createTask({ tool: tool.name, args, kind, status: 'failed', statusMessage: read.errorMessage ?? 'Fund read failed.', ttlMs: ttlMs ?? FUND_WATCH_TTL_MS });
      return ok(msg.id, { task: taskShape(task) });
    }
    const view = (read.raw as Record<string, unknown>)?.fund as Record<string, unknown> | undefined;
    const task = await createTask({
      tool: tool.name, args, kind, status: 'working',
      statusMessage: 'Watching this fund for on-chain changes (for example the end of a 2-day proposal wait). Poll tasks/get; the task completes when the fund state changes.',
      watchSnapshot: fundWatchSnapshot(view ?? {}),
      ttlMs: ttlMs ?? FUND_WATCH_TTL_MS,
    });
    return ok(msg.id, { task: taskShape(task) });
  }

  // Any other tool as a task: run it now and complete the task inline.
  const read = await runToolSafe(ctx, tool, args, meta, tier, keyId);
  const task = await createTask({
    tool: tool.name, args, kind,
    status: read.ok ? 'completed' : 'failed',
    statusMessage: read.ok ? undefined : (read.errorMessage ?? 'Tool call failed.'),
    result: read.payload,
    ttlMs: ttlMs ?? DEFAULT_TASK_TTL_MS,
  });
  return ok(msg.id, { task: taskShape(task) });
}

/** Poll a fund-watch task: re-read the fund and complete the task when its state changes. */
async function pollFundWatch(task: McpTask, req: Request, ctx: Ctx, key: KeyResolution): Promise<McpTask> {
  const tool = TOOLS.find((t) => t.name === task.tool);
  if (!tool) return task;
  const tier: ApiTier = key.tier === 'pro' ? 'pro' : 'free';
  const keyId = key.tier === 'pro' ? key.keyId : null;
  const meta = metaOf(req, task.args, tier, keyId);
  const read = await runToolSafe(ctx, tool, task.args, meta, tier, keyId);
  if (!read.ok) return task; // transient read failure: stay working, try again next poll
  const view = (read.raw as Record<string, unknown>)?.fund as Record<string, unknown> | undefined;
  const { changed, summary } = fundWatchChanged(task.watchSnapshot, view ?? {});
  if (!changed) return task;
  return (await updateTask(task.id, {
    status: 'completed',
    statusMessage: `Fund state changed: ${summary}`,
    result: read.payload,
    watchSnapshot: fundWatchSnapshot(view ?? {}),
  })) ?? task;
}

/** Handle a JSON-RPC response message: the client's answer to an elicitation. Returns null (no reply — it is a response). */
async function handleElicitationAnswer(msg: Rpc, req: Request, ctx: Ctx, key: KeyResolution): Promise<RpcReply | null> {
  const elicitationId = typeof msg.id === 'string' ? msg.id : null;
  if (!elicitationId) return null;
  const task = await findTaskByElicitationId(elicitationId);
  if (!task || task.status !== 'input_required') return null;
  const result = (msg.result ?? {}) as Record<string, unknown>;
  const action = result.action as string | undefined;
  const content = (result.content ?? {}) as Record<string, unknown>;
  const approved = action === 'accept' && content.approved === true;
  if (!approved) {
    await updateTask(task.id, { status: 'cancelled', statusMessage: `Approval ${action === 'decline' ? 'declined' : 'cancelled'} by the human. Nothing was prepared.` });
    return null;
  }
  // Approved: run the prepare. The spend still only happens when the human signs the unsigned transaction.
  const tool = TOOLS.find((t) => t.name === task.tool);
  if (!tool) {
    await updateTask(task.id, { status: 'failed', statusMessage: `Unknown tool: ${task.tool}` });
    return null;
  }
  const tier: ApiTier = key.tier === 'pro' ? 'pro' : 'free';
  const keyId = key.tier === 'pro' ? key.keyId : null;
  const meta = metaOf(req, task.args, tier, keyId);
  const read = await runToolSafe(ctx, tool, task.args, meta, tier, keyId);
  await updateTask(task.id, {
    status: read.ok ? 'completed' : 'failed',
    statusMessage: read.ok ? 'Approved by the human; unsigned transaction prepared. Nothing moves until the human signs in their own wallet.' : (read.errorMessage ?? 'Prepare failed.'),
    result: read.payload,
  });
  return null;
}

export async function handleRpc(msg: Rpc, req: Request, ctx: Ctx, key: KeyResolution = { tier: 'free', degraded: false }): Promise<RpcReply | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return fail(msg?.id, -32600, 'Invalid request');
  // A message with no method is a JSON-RPC response — the client's answer to an elicitation.
  if (typeof msg.method !== 'string') {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) return handleElicitationAnswer(msg, req, ctx, key);
    return fail(msg?.id, -32600, 'Invalid request');
  }
  const isNote = msg.id === undefined;
  const tier: ApiTier = key.tier === 'pro' ? 'pro' : 'free';
  switch (msg.method) {
    case 'initialize': {
      const want = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '';
      const protocolVersion = (MCP_PROTOCOLS as readonly string[]).includes(want) ? want : MCP_PROTOCOLS[0];
      return ok(msg.id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: {},
          extensions: { 'io.modelcontextprotocol/skills': { directoryRead: true } },
        },
        serverInfo: SERVER_INFO, instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return ok(msg.id, {});
    case 'tools/list': return ok(msg.id, { tools: listTools() });
    case 'tools/call': {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${typeof name === 'string' ? name.slice(0, 64) : ''}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof args !== 'object' || Array.isArray(args)) return fail(msg.id, -32602, 'arguments must be an object');
      if (msg.params?.task !== undefined && msg.params.task !== null && typeof msg.params.task === 'object') {
        return startTask(msg, req, ctx, key, tool, args);
      }
      const meta = metaOf(req, args, tier, key.tier === 'pro' ? key.keyId : null);
      const read = await runToolSafe(ctx, tool, args, meta, tier, key.tier === 'pro' ? key.keyId : null);
      return ok(msg.id, read.payload);
    }
    case 'skills/list': {
      const cursor = typeof msg.params?.cursor === 'string' ? msg.params.cursor : null;
      let start = 0;
      if (cursor) {
        const idx = SKILLS.findIndex((s) => skillUri(s) === cursor);
        start = idx >= 0 ? idx + 1 : 0;
      }
      const page = SKILLS.slice(start);
      return ok(msg.id, { skills: page.map(skillEntry), nextCursor: null, ...cacheHints });
    }
    case 'skills/get': {
      const uri = typeof msg.params?.uri === 'string' ? msg.params.uri : '';
      const skill = findSkillByUri(uri);
      if (!skill) return fail(msg.id, -32602, `Unknown skill: ${scrub(uri).slice(0, 128)}`);
      return ok(msg.id, { skill: skillEntry(skill), ...cacheHints });
    }
    case 'resources/list': {
      const resources = SKILLS.map((s) => {
        const entry = skillEntry(s);
        return { uri: entry.uri, name: s.name, title: s.name, description: s.description, mimeType: 'text/markdown', size: entry.resources[0].size };
      });
      return ok(msg.id, { resources, ...cacheHints });
    }
    case 'resources/read': {
      const uri = typeof msg.params?.uri === 'string' ? msg.params.uri : '';
      const skill = findSkillByUri(uri);
      if (!skill) return fail(msg.id, -32602, `Unknown resource: ${scrub(uri).slice(0, 128)}`);
      return ok(msg.id, { contents: [{ uri: skillUri(skill), mimeType: 'text/markdown', text: skillMd(skill) }], ...cacheHints });
    }
    case 'resources/directory/read': {
      const uri = typeof msg.params?.uri === 'string' ? msg.params.uri : '';
      const skill = SKILLS.find((s) => uri === `skill://${s.name}` || uri === `skill://${s.name}/`);
      if (!skill) return fail(msg.id, -32602, `Unknown skill directory: ${scrub(uri).slice(0, 128)}`);
      const entry = skillEntry(skill);
      return ok(msg.id, { uri: skillUri(skill), entries: [{ uri: entry.uri, name: 'SKILL.md', mimeType: 'text/markdown', size: entry.resources[0].size, sha256: entry.resources[0].sha256 }], ...cacheHints });
    }
    case 'tasks/list': {
      const limit = typeof msg.params?.limit === 'number' ? msg.params.limit : 20;
      const cursor = typeof msg.params?.cursor === 'string' ? msg.params.cursor : null;
      const { tasks, nextCursor } = await listTasks(limit, cursor);
      return ok(msg.id, { tasks: tasks.map(taskShape), nextCursor });
    }
    case 'tasks/get': {
      const taskId = typeof msg.params?.taskId === 'string' ? msg.params.taskId : '';
      let task = await getTask(taskId);
      if (!task) return fail(msg.id, -32602, `Unknown task: ${scrub(taskId).slice(0, 64)}`);
      task = await expireIfNeeded(task);
      if (task.status === 'working' && task.kind === 'fund-watch') task = await pollFundWatch(task, req, ctx, key);
      return ok(msg.id, { task: taskShape(task) });
    }
    case 'tasks/result': {
      const taskId = typeof msg.params?.taskId === 'string' ? msg.params.taskId : '';
      let task = await getTask(taskId);
      if (!task) return fail(msg.id, -32602, `Unknown task: ${scrub(taskId).slice(0, 64)}`);
      task = await expireIfNeeded(task);
      if (task.status !== 'completed') {
        return fail(msg.id, -32002, `Task is ${task.status}, not completed.`, { taskId: task.id, status: task.status, statusMessage: task.statusMessage });
      }
      return ok(msg.id, task.result ?? {});
    }
    case 'tasks/cancel': {
      const taskId = typeof msg.params?.taskId === 'string' ? msg.params.taskId : '';
      const task = await getTask(taskId);
      if (!task) return fail(msg.id, -32602, `Unknown task: ${scrub(taskId).slice(0, 64)}`);
      const terminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
      const next = terminal ? task : ((await updateTask(task.id, { status: 'cancelled', statusMessage: 'Cancelled by the client.' })) ?? task);
      return ok(msg.id, { task: taskShape(next) });
    }
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
