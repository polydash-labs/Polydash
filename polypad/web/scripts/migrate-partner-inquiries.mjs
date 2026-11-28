// One-off migration: partner_inquiries table for /build/partnerships inquiries.
//   PartnerInquiry: one row per inquiry (name, company, email, website, type, message).
// Reads DATABASE_URL (fallback DATABASE_URL_UNPOOLED) from the Polypad
// .env.local in-process; never prints the value.
// Usage: node scripts/migrate-partner-inquiries.mjs
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
  CREATE TABLE IF NOT EXISTS "PartnerInquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT NOT NULL,
    "website" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "PartnerInquiry_pkey" PRIMARY KEY ("id")
  );
`;
await sql`CREATE INDEX IF NOT EXISTS "PartnerInquiry_createdAt_idx" ON "PartnerInquiry"("createdAt");`;
await sql`CREATE INDEX IF NOT EXISTS "PartnerInquiry_email_idx" ON "PartnerInquiry"("email");`;

const check = await sql`SELECT COUNT(*)::int AS n FROM "PartnerInquiry";`;
console.log("PartnerInquiry table ready. Rows:", check[0].n);
