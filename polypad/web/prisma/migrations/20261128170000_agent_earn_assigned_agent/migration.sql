-- AgentEarnEscrow v2 (Nov 28, 2026): the poster names one assigned agent
-- when a job is created; only that agent's wallet can claim the job.
-- The v1 board had no assignee — claims were first-come-first-served.
-- NOTE: this DB has no _prisma_migrations table (schema was built with
-- db push / raw DDL), so this migration file is documentary — the columns
-- were applied with scripts/apply-neon-ddl.mjs (Neon serverless HTTPS
-- driver), which is the supported path from this VM because direct
-- Postgres TLS is blocked by egress.
ALTER TABLE "AgentEarnJob" ADD COLUMN IF NOT EXISTS "assignedAgentWallet" TEXT;
ALTER TABLE "AgentEarnJob" ADD COLUMN IF NOT EXISTS "assignedAgentId" INTEGER;
CREATE INDEX IF NOT EXISTS "AgentEarnJob_assignedAgentWallet_idx" ON "AgentEarnJob"("assignedAgentWallet");
