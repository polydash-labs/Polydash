// Creates the "BaseAgentWallet" + "BaseAgentWalletPayment" tables used by
// the Base-side agent wallets (lib/cdp-base/wallets.ts) — one row per CDP
// Server Wallet on Base, plus one row per x402 payment made from it.
// Run: node scripts/migrate-base-agent-wallets.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const url = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
if (!url) throw new Error('DATABASE_URL missing from .env.local');
const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS "BaseAgentWallet" (
    "id" text PRIMARY KEY,
    "address" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "ownerAddress" text NOT NULL,
    "createNonce" text NOT NULL UNIQUE,
    "keyHash" text NOT NULL UNIQUE,
    "keyPrefix" text NOT NULL,
    "dailyCapUsdCents" integer NOT NULL,
    "perPaymentCapUsdCents" integer NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "policyId" text,
    "frozen" boolean NOT NULL DEFAULT false,
    "revoked" boolean NOT NULL DEFAULT false,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS "BaseAgentWallet_ownerAddress_createdAt_idx" ON "BaseAgentWallet" ("ownerAddress", "createdAt")`;
await sql`
  CREATE TABLE IF NOT EXISTS "BaseAgentWalletPayment" (
    "id" serial PRIMARY KEY,
    "walletId" text NOT NULL REFERENCES "BaseAgentWallet"("id"),
    "nonce" text NOT NULL UNIQUE,
    "product" text NOT NULL,
    "amountUsdCents" integer NOT NULL,
    "txHash" text,
    "status" text NOT NULL DEFAULT 'pending',
    "error" text,
    "createdAt" timestamptz NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS "BaseAgentWalletPayment_walletId_createdAt_idx" ON "BaseAgentWalletPayment" ("walletId", "createdAt")`;
console.log('BaseAgentWallet tables ready');
