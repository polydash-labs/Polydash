// One-off migration: AgentEarnJob table for the agent-earn pilot board.
//   AgentEarnJob: one row per market-research job (brief, screening,
//   deliverable, dispute, panel ballots). The escrow contract is the
//   source of truth for money; this table is the board's paper trail.
// Reads DATABASE_URL (fallback DATABASE_URL_UNPOOLED) from the Polypad
// .env.local in-process; never prints the value.
// Usage: node scripts/migrate-agent-earn-jobs.mjs
// DO NOT run against the live database until the board deploys — this
// script is the deploy step, not a local check.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const envFile = readFileSync(
  "/home/hatch/workspace/polypad-migration/nextjs_space/.env.local",
  "utf8"
);
function envVar(name) {
  const line = envFile.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) return null;
  let v = line.slice(name.length + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v.startsWith("postgres") ? v : null;
}
const url = envVar("DATABASE_URL") || envVar("DATABASE_URL_UNPOOLED");
if (!url) {
  console.error("DATABASE_URL not found in polypad .env.local");
  process.exit(1);
}
const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS "AgentEarnJob" (
    "id" TEXT NOT NULL,
    "poster" TEXT NOT NULL,
    "posterNonce" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "researchQuestions" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sourceConstraints" TEXT NOT NULL,
    "acceptanceCriteria" TEXT NOT NULL,
    "priceUsdg" BIGINT NOT NULL,
    "deadline" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_screening',
    "screeningReason" TEXT,
    "screenedAt" TIMESTAMPTZ,
    "lockTxHash" TEXT,
    "claimTxHash" TEXT,
    "claimedByAgentId" INTEGER,
    "claimedByWallet" TEXT,
    "deliverTxHash" TEXT,
    "deliverableHash" TEXT,
    "deliverableText" TEXT,
    "deliveredAt" TIMESTAMPTZ,
    "disputeReasons" TEXT,
    "disputedAt" TIMESTAMPTZ,
    "panelSeed" TEXT,
    "panelPool" JSONB,
    "panelDrawn" JSONB,
    "panelDrawnAt" TIMESTAMPTZ,
    "ballots" JSONB,
    "panelOutcome" TEXT,
    "panelSplitBps" INTEGER,
    "panelTxHash" TEXT,
    "releaseTxHash" TEXT,
    "refundTxHash" TEXT,
    "settledAt" TIMESTAMPTZ,
    "timeline" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "AgentEarnJob_pkey" PRIMARY KEY ("id")
  );
`;
await sql`CREATE INDEX IF NOT EXISTS "AgentEarnJob_status_createdAt_idx" ON "AgentEarnJob"("status", "createdAt");`;
await sql`CREATE INDEX IF NOT EXISTS "AgentEarnJob_poster_idx" ON "AgentEarnJob"("poster");`;
await sql`CREATE INDEX IF NOT EXISTS "AgentEarnJob_claimedByWallet_idx" ON "AgentEarnJob"("claimedByWallet");`;

const check = await sql`SELECT COUNT(*)::int AS n FROM "AgentEarnJob";`;
console.log("AgentEarnJob table ready. Rows:", check[0].n);
