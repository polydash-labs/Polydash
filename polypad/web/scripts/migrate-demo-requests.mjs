// One-off migration: demo_requests table for /business demo bookings.
//   DemoRequest: one row per demo request (email + optional company).
// Reads DATABASE_URL (fallback DATABASE_URL_UNPOOLED) from the Polypad
// .env.local in-process; never prints the value.
// Usage: node scripts/migrate-demo-requests.mjs
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
  CREATE TABLE IF NOT EXISTS "DemoRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
  );
`;
await sql`CREATE INDEX IF NOT EXISTS "DemoRequest_createdAt_idx" ON "DemoRequest"("createdAt");`;
await sql`CREATE INDEX IF NOT EXISTS "DemoRequest_email_idx" ON "DemoRequest"("email");`;

const check = await sql`SELECT COUNT(*)::int AS n FROM "DemoRequest";`;
console.log("DemoRequest table ready. Rows:", check[0].n);
