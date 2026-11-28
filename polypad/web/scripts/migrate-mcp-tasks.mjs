// Creates the "McpTask" table used by the MCP Tasks store
// (lib/agents-api/v2/tasks.ts) — one row per task created by a
// task-augmented tools/call, including fund-watch tasks and tasks paused
// for human approval (elicitation). Run: node scripts/migrate-mcp-tasks.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const url = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
if (!url) throw new Error('DATABASE_URL missing from .env.local');
const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS "McpTask" (
    "id" text PRIMARY KEY,
    "tool" text NOT NULL,
    "args" jsonb NOT NULL,
    "kind" text NOT NULL DEFAULT 'tool-call',
    "status" text NOT NULL DEFAULT 'working',
    "statusMessage" text,
    "result" jsonb,
    "watchSnapshot" text,
    "elicitationId" text UNIQUE,
    "elicitation" jsonb,
    "ttlMs" integer,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS "McpTask_status_createdAt_idx" ON "McpTask" ("status", "createdAt")`;
await sql`CREATE INDEX IF NOT EXISTS "McpTask_createdAt_idx" ON "McpTask" ("createdAt")`;
console.log('McpTask table ready');
