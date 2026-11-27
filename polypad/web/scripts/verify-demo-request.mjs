// Verify + clean up the Preview demo-request test row. Prints rows only.
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
const sql = neon(url);

const rows = await sql`SELECT "id", "email", "company", "createdAt" FROM "DemoRequest" WHERE "email" = 'test+demo@dasheco.xyz'`;
console.log("TEST ROWS:", JSON.stringify(rows));
if (rows.length) {
  await sql`DELETE FROM "DemoRequest" WHERE "email" = 'test+demo@dasheco.xyz'`;
  const after = await sql`SELECT COUNT(*)::int AS n FROM "DemoRequest"`;
  console.log("DELETED. Remaining rows:", after[0].n);
}
