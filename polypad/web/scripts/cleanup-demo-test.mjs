// One-off cleanup: delete the Atlas verification demo-request test row.
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const envFile = fs.readFileSync(
  "/home/hatch/workspace/polypad-migration/nextjs_space/.env.local",
  "utf8"
);
const line = envFile.split("\n").find((l) => l.startsWith("DATABASE_URL="));
let url = line.slice("DATABASE_URL=".length).trim();
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
const sql = neon(url);
const deleted = await sql`DELETE FROM "DemoRequest" WHERE email = 'test+atlas-verify@dasheco.xyz' RETURNING id`;
console.log("deleted:", JSON.stringify(deleted));
const count = await sql`SELECT COUNT(*)::int AS n FROM "DemoRequest"`;
console.log("rows remaining:", JSON.stringify(count));
