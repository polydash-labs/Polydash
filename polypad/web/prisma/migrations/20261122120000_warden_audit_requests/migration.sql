-- Warden audit requests (Nov 22, 2026): projects submit on /audits, requests are
-- stored in order, Warden reviews oldest first. NOTE: this DB has no
-- _prisma_migrations table (schema was built with db push / raw DDL), so this
-- migration file is documentary — the table was applied with
-- scripts/apply-neon-ddl.mjs (Neon serverless HTTPS driver), which is the
-- supported path from this VM because direct Postgres TLS is blocked by egress.
CREATE TABLE "WardenAuditRequest" (
    "id" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "commitHash" TEXT NOT NULL,
    "contractsInScope" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'Robinhood Chain',
    "deployedAddresses" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "verdict" TEXT,
    "reportUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    CONSTRAINT "WardenAuditRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WardenAuditRequest_status_createdAt_idx" ON "WardenAuditRequest"("status", "createdAt");
