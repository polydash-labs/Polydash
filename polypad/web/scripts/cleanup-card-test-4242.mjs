// One-off cleanup: delete ALL test rows for the throwaway 4242-test wallet
// 0x8ef83e35c370c44649c732d96d1b7ac2e6b9baa7 (Polypad card-checkout browser test, Nov 26).
// Deletes ONLY rows for that wallet: ledger -> card topup -> account. Nothing else.
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

const subject = "wallet:0x8ef83e35c370c44649c732d96d1b7ac2e6b9baa7";
const session = "cs_test_a0XlJOuqyOzWRoUigQEsQQbeKCFNdCChPfFReLY7182h1tDPVHUkbVRmOP";

const accounts = await sql`SELECT id FROM "PolyCreditAccount" WHERE subject = ${subject}`;
console.log("accounts found:", accounts.length);
if (accounts.length === 0) {
  console.log("Nothing to delete.");
  process.exit(0);
}
const accountId = accounts[0].id;

const ledgerDeleted = await sql`DELETE FROM "PolyCreditLedger" WHERE "accountId" = ${accountId} RETURNING id`;
console.log("PolyCreditLedger deleted:", ledgerDeleted.length, JSON.stringify(ledgerDeleted));

const topupDeleted = await sql`DELETE FROM "PolyCreditCardTopup" WHERE subject = ${subject} AND "stripeSessionId" = ${session} RETURNING id`;
console.log("PolyCreditCardTopup deleted:", topupDeleted.length, JSON.stringify(topupDeleted));

const accountDeleted = await sql`DELETE FROM "PolyCreditAccount" WHERE subject = ${subject} RETURNING id`;
console.log("PolyCreditAccount deleted:", accountDeleted.length, JSON.stringify(accountDeleted));

// Verify: 0 rows remain for this wallet in all three tables.
const afterAccount = await sql`SELECT COUNT(*)::int AS n FROM "PolyCreditAccount" WHERE subject = ${subject}`;
const afterLedger = await sql`SELECT COUNT(*)::int AS n FROM "PolyCreditLedger" WHERE "accountId" = ${accountId}`;
const afterTopup = await sql`SELECT COUNT(*)::int AS n FROM "PolyCreditCardTopup" WHERE subject = ${subject} OR "stripeSessionId" = ${session}`;
console.log("remaining PolyCreditAccount:", afterAccount[0].n);
console.log("remaining PolyCreditLedger:", afterLedger[0].n);
console.log("remaining PolyCreditCardTopup:", afterTopup[0].n);

// Read-only sanity: no starter claim exists for this wallet either.
const claim = await sql`SELECT COUNT(*)::int AS n FROM "PolyCreditClaim" WHERE wallet = '0x8ef83e35c370c44649c732d96d1b7ac2e6b9baa7'`;
console.log("PolyCreditClaim rows for wallet (not deleted, out of scope):", claim[0].n);
