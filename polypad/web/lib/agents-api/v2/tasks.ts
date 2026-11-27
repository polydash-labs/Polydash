/**
 * MCP Tasks store (base spec: tasks/list, tasks/get, tasks/result, tasks/cancel).
 *
 * Tasks let a host run a long job in the background and poll for it:
 *  - a task-augmented tools/call (`params.task = { ttl }`) creates a task
 *    instead of answering inline; the host polls tasks/get and fetches the
 *    payload with tasks/result.
 *  - a task created from `polypad_get_fund` is a fund-watch: it stays
 *    "working" until the fund's on-chain state changes (that is how a host
 *    waits out the 2-day proposal wait), then completes with the fresh state.
 *  - a prepare tool called as a task pauses for human approval first: the
 *    task goes to `input_required` with an elicitation form (see
 *    elicitation below). Nothing is prepared until the human approves.
 *
 * Persistence: Neon via Prisma (McpTask model). If the database is down or
 * slow, tasks fall back to a process-local map so the feature still works
 * on a single server instance; that fallback is best-effort and documented
 * wherever it matters, never silent about the downgrade.
 *
 * Elicitation, stateless adaptation: this server is stateless Streamable
 * HTTP — it cannot open a stream and push an `elicitation/create` request
 * to the client the way a stateful server would. So the elicitation request
 * is delivered inside the task (input_required status + the full
 * elicitation/create params), and the client answers by POSTing a JSON-RPC
 * response (`{ jsonrpc: "2.0", id: "<elicitationId>", result: { action,
 * content } }`) to the same endpoint. Same message shape, same
 * requestedSchema, same ElicitResult — only the delivery differs. The
 * wallet still enforces: approval prepares the unsigned transaction, and
 * the spend only happens when the human signs.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, withTimeout } from '../../db';

/** Prisma Json input accepts plain JSON values; our records are already JSON-shaped. */
const toInputJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';
export type TaskKind = 'tool-call' | 'fund-watch';

export type McpTask = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  kind: TaskKind;
  status: TaskStatus;
  statusMessage: string | null;
  result: unknown | null;
  watchSnapshot: string | null;
  elicitationId: string | null;
  elicitation: Record<string, unknown> | null;
  ttlMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_TASK_TTL_MS = 3600_000; // 1h for a plain tool call
export const FUND_WATCH_TTL_MS = 3 * 24 * 3600_000; // 3 days — covers the 2-day proposal wait
export const MAX_TASK_TTL_MS = 7 * 24 * 3600_000;
const TASK_RETENTION_MS = 7 * 24 * 3600_000;

export function newTaskId(): string {
  return `task_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
}

export function newElicitationId(): string {
  return `elic_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
}

const memoryTasks = new Map<string, McpTask>();
let dbDown = false;

type Row = {
  id: string;
  tool: string;
  args: unknown;
  kind: string;
  status: string;
  statusMessage: string | null;
  result: unknown;
  watchSnapshot: string | null;
  elicitationId: string | null;
  elicitation: unknown;
  ttlMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): McpTask {
  return {
    id: row.id,
    tool: row.tool,
    args: (row.args ?? {}) as Record<string, unknown>,
    kind: (row.kind === 'fund-watch' ? 'fund-watch' : 'tool-call') as TaskKind,
    status: row.status as TaskStatus,
    statusMessage: row.statusMessage,
    result: row.result ?? null,
    watchSnapshot: row.watchSnapshot,
    elicitationId: row.elicitationId,
    elicitation: (row.elicitation ?? null) as Record<string, unknown> | null,
    ttlMs: row.ttlMs,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function toRow(t: McpTask): Row {
  return {
    id: t.id,
    tool: t.tool,
    args: t.args,
    kind: t.kind,
    status: t.status,
    statusMessage: t.statusMessage,
    result: t.result ?? undefined,
    watchSnapshot: t.watchSnapshot,
    elicitationId: t.elicitationId,
    elicitation: t.elicitation ?? undefined,
    ttlMs: t.ttlMs,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
  };
}

export function isExpired(task: McpTask, nowMs: number = Date.now()): boolean {
  if (task.ttlMs === null) return false;
  return nowMs - Date.parse(task.createdAt) > task.ttlMs;
}

/** A task that is past its TTL reads as failed; the transition is persisted lazily. */
export async function expireIfNeeded(task: McpTask): Promise<McpTask> {
  if (!isExpired(task) || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;
  return (await updateTask(task.id, { status: 'failed', statusMessage: 'Task expired (ttl elapsed).' })) ?? task;
}

export async function createTask(input: {
  tool: string;
  args: Record<string, unknown>;
  kind: TaskKind;
  status?: TaskStatus;
  statusMessage?: string | null;
  result?: unknown;
  watchSnapshot?: string | null;
  elicitationId?: string | null;
  elicitation?: Record<string, unknown> | null;
  ttlMs?: number | null;
}): Promise<McpTask> {
  const now = new Date().toISOString();
  const task: McpTask = {
    id: newTaskId(),
    tool: input.tool,
    args: input.args,
    kind: input.kind,
    status: input.status ?? 'working',
    statusMessage: input.statusMessage ?? null,
    result: input.result ?? null,
    watchSnapshot: input.watchSnapshot ?? null,
    elicitationId: input.elicitationId ?? null,
    elicitation: input.elicitation ?? null,
    ttlMs: input.ttlMs ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (!dbDown) {
    try {
      const row = await withTimeout(
        prisma.mcpTask.create({
          data: {
            id: task.id,
            tool: task.tool,
            args: toInputJson(task.args),
            kind: task.kind,
            status: task.status,
            statusMessage: task.statusMessage,
            result: task.result == null ? undefined : toInputJson(task.result),
            watchSnapshot: task.watchSnapshot,
            elicitationId: task.elicitationId,
            elicitation: task.elicitation == null ? undefined : toInputJson(task.elicitation),
            ttlMs: task.ttlMs,
          },
        }),
        1500,
      );
      if (row) return toRecord(row as unknown as Row);
      dbDown = true;
    } catch {
      dbDown = true;
    }
  }
  memoryTasks.set(task.id, task);
  return task;
}

export async function getTask(id: string): Promise<McpTask | null> {
  if (!dbDown) {
    try {
      const row = await withTimeout(prisma.mcpTask.findUnique({ where: { id } }), 800);
      if (row) return toRecord(row as unknown as Row);
    } catch {
      dbDown = true;
    }
  }
  return memoryTasks.get(id) ?? null;
}

export async function updateTask(id: string, patch: Partial<McpTask>): Promise<McpTask | null> {
  const current = await getTask(id);
  if (!current) return null;
  const next: McpTask = { ...current, ...patch, updatedAt: new Date().toISOString() };
  if (!dbDown) {
    try {
      const row = await withTimeout(
        prisma.mcpTask.update({
          where: { id },
          data: {
            status: next.status,
            statusMessage: next.statusMessage,
            result: next.result == null ? undefined : toInputJson(next.result),
            watchSnapshot: next.watchSnapshot,
            elicitationId: next.elicitationId,
            elicitation: next.elicitation == null ? undefined : toInputJson(next.elicitation),
          },
        }),
        1500,
      );
      if (row) return toRecord(row as unknown as Row);
      dbDown = true;
    } catch {
      dbDown = true;
    }
  }
  memoryTasks.set(id, next);
  return next;
}

export async function listTasks(limit: number, cursor?: string | null): Promise<{ tasks: McpTask[]; nextCursor: string | null }> {
  const take = Math.max(1, Math.min(50, limit || 20));
  let rows: McpTask[] = [];
  if (!dbDown) {
    try {
      // Best-effort retention: drop terminal tasks older than 7 days.
      const cutoff = new Date(Date.now() - TASK_RETENTION_MS);
      withTimeout(
        prisma.mcpTask.deleteMany({ where: { updatedAt: { lt: cutoff }, status: { in: ['completed', 'failed', 'cancelled'] } } }),
        1500,
      ).catch(() => undefined);
      const found = await withTimeout(
        prisma.mcpTask.findMany({ orderBy: { createdAt: 'desc' }, take: take + 1 }),
        1500,
      );
      if (found) rows = (found as unknown as Row[]).map(toRecord);
      else dbDown = true;
    } catch {
      dbDown = true;
    }
  }
  if (dbDown) {
    rows = [...memoryTasks.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  let start = 0;
  if (cursor) {
    const idx = rows.findIndex((t) => t.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const page = rows.slice(start, start + take);
  const nextCursor = rows.length > start + take ? page[page.length - 1].id : null;
  return { tasks: page, nextCursor };
}

export async function findTaskByElicitationId(elicitationId: string): Promise<McpTask | null> {
  if (!dbDown) {
    try {
      const row = await withTimeout(prisma.mcpTask.findUnique({ where: { elicitationId } }), 800);
      if (row) return toRecord(row as unknown as Row);
    } catch {
      dbDown = true;
    }
  }
  for (const t of memoryTasks.values()) if (t.elicitationId === elicitationId) return t;
  return null;
}

/** Stable fields of a fund view, for the fund-watch comparison. Excludes NAV (moves with price) and the deadline (a fixed timestamp, kept out to avoid false positives from formatting). */
export function fundWatchSnapshot(fund: Record<string, unknown>): string {
  const shares = (fund.shares ?? {}) as Record<string, unknown>;
  const raise = (fund.raise ?? {}) as Record<string, unknown>;
  return JSON.stringify({
    status: fund.status ?? null,
    assets: Array.isArray(fund.assets) ? [...(fund.assets as unknown[])].sort() : [],
    minted: shares.minted ?? null,
    maxSupply: shares.maxSupply ?? null,
    progressPct: raise.progressPct ?? null,
    publicMintOpen: fund.publicMintOpen ?? null,
  });
}

export function fundWatchChanged(snapshot: string | null, fund: Record<string, unknown>): { changed: boolean; summary: string } {
  if (!snapshot) return { changed: false, summary: '' };
  const next = fundWatchSnapshot(fund);
  if (next === snapshot) return { changed: false, summary: '' };
  const old = JSON.parse(snapshot) as Record<string, unknown>;
  const cur = JSON.parse(next) as Record<string, unknown>;
  const bits: string[] = [];
  if (JSON.stringify(old.assets) !== JSON.stringify(cur.assets)) bits.push(`assets now ${(cur.assets as unknown[]).join(', ') || 'none'}`);
  if (old.status !== cur.status) bits.push(`status ${String(old.status)} → ${String(cur.status)}`);
  if (old.minted !== cur.minted) bits.push(`shares minted ${String(old.minted)} → ${String(cur.minted)}`);
  if (old.publicMintOpen !== cur.publicMintOpen) bits.push(`public mint ${cur.publicMintOpen ? 'open' : 'closed'}`);
  return { changed: true, summary: bits.join('; ') || 'fund state changed' };
}

/** Build the elicitation/create params for a prepare tool's approval pause. */
export function approvalElicitation(taskId: string, toolName: string, summary: string): Record<string, unknown> {
  return {
    mode: 'form',
    message: `Approve this Polypad spend before anything is prepared: ${summary}`,
    requestedSchema: {
      type: 'object',
      properties: {
        approved: {
          type: 'boolean',
          title: 'Approve this spend',
          description: 'Yes, prepare the unsigned transaction for this spend. Nothing moves until you sign it in your own wallet.',
          default: false,
        },
        note: { type: 'string', title: 'Note (optional)', description: 'Anything to record with this approval.' },
      },
      required: ['approved'],
    },
    _meta: { 'io.modelcontextprotocol/related-task': { taskId } },
  };
}
