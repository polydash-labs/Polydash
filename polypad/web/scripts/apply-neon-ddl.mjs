// Applies a schema change to Neon via the @neondatabase/serverless HTTPS driver.
// This VM cannot complete a direct Postgres TLS handshake to Neon (egress proxy),
// so Prisma `db push` / `migrate` cannot run here. This script is the supported path:
// it runs the exact DDL Prisma would generate for the model, then verifies it.
// Usage: node scripts/apply-neon-ddl.mjs <name>   (reads DATABASE_URL_UNPOOLED from .env.local)
// The connection string is never printed.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const DDL = {
  apiKeyUsage: `
    CREATE TABLE IF NOT EXISTS "ApiKeyUsage" (
      "id" SERIAL PRIMARY KEY,
      "keyId" TEXT NOT NULL,
      "tool" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "ApiKeyUsage_keyId_createdAt_idx" ON "ApiKeyUsage"("keyId", "createdAt");
    CREATE INDEX IF NOT EXISTS "ApiKeyUsage_createdAt_idx" ON "ApiKeyUsage"("createdAt");
  `,
  wardenAuditRequests: `
    CREATE TABLE IF NOT EXISTS "WardenAuditRequest" (
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
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "reviewedAt" TIMESTAMPTZ,
      CONSTRAINT "WardenAuditRequest_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "WardenAuditRequest_status_createdAt_idx" ON "WardenAuditRequest"("status", "createdAt");
  `,
  newsletterSubscribers: `
    CREATE TABLE IF NOT EXISTS "NewsletterSubscriber" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "source" TEXT NOT NULL DEFAULT 'explore',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "unsubscribedAt" TIMESTAMPTZ,
      CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
    CREATE INDEX IF NOT EXISTS "NewsletterSubscriber_createdAt_idx" ON "NewsletterSubscriber"("createdAt");
  `,
};

const name = process.argv[2];
if (!name || !DDL[name]) {
  console.error(`Unknown DDL: ${name}. Available: ${Object.keys(DDL).join(', ')}`);
  process.exit(1);
}

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const match = env.match(/^DATABASE_URL_UNPOOLED=(.+)$/m);
if (!match) {
  console.error('DATABASE_URL_UNPOOLED not found in .env.local');
  process.exit(1);
}
// .env.local wraps values in double quotes; strip them before parsing as a URL.
const connStr = match[1].trim().replace(/^"|"$/g, '');
const sql = neon(connStr);

for (const statement of DDL[name].split(';').map((s) => s.trim()).filter(Boolean)) {
  await sql.query(statement);
}

// Verify: table exists with the expected columns.
const table = DDL[name].includes('"WardenAuditRequest"')
  ? 'WardenAuditRequest'
  : DDL[name].includes('"NewsletterSubscriber"')
    ? 'NewsletterSubscriber'
    : 'ApiKeyUsage';
const cols = await sql.query(
  `SELECT column_name, data_type, column_default FROM information_schema.columns
   WHERE table_name = '${table}' ORDER BY ordinal_position`,
);
console.log(`OK ${name}: ${cols.length} columns`);
for (const c of cols) console.log(`  ${c.column_name} ${c.data_type} ${c.column_default ?? ''}`);
