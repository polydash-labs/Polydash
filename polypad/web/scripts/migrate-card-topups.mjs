// One-off migration: PolyCreditCardTopup table for Stripe card top-ups.
//   One row per confirmed card top-up; stripeSessionId is the replay guard
//   (unique) — the same Checkout session can never credit twice.
// Reads DATABASE_URL (fallback DATABASE_URL_UNPOOLED) from the Polypad
// .env.local in-process; never prints the value.
// Usage: node scripts/migrate-card-topups.mjs
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
  CREATE TABLE IF NOT EXISTS "PolyCreditCardTopup" (
    "id" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "stripePaymentIntent" TEXT,
    "subject" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "PolyCreditCardTopup_pkey" PRIMARY KEY ("id")
  );
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS "PolyCreditCardTopup_stripeSessionId_key" ON "PolyCreditCardTopup"("stripeSessionId");`;
await sql`CREATE INDEX IF NOT EXISTS "PolyCreditCardTopup_subject_createdAt_idx" ON "PolyCreditCardTopup"("subject", "createdAt");`;

const check = await sql`SELECT COUNT(*)::int AS n FROM "PolyCreditCardTopup";`;
console.log("PolyCreditCardTopup table ready. Rows:", check[0].n);
