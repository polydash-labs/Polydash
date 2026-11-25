#!/usr/bin/env node
/**
 * Poly credits expiry check on preview.
 * Usage: node verify-poly-credits-expiry.mjs <preview-base-url> <wallet-env-file>
 * Creates a fresh key, claims a starter onto it, then flips the account's
 * expiresAt to the past via the Neon serverless driver (HTTPS) and checks
 * that the balance reads expired and a credits spend falls through to 402.
 * Restores the expiry afterwards. Prints only key prefixes, never values.
 */
import { readFileSync, writeFileSync, chmodSync } from 'fs';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { neon } from '@neondatabase/serverless';
import { robinhoodChain } from './verify-chain.mjs';

const BASE = process.argv[2];
const ENV_FILE = process.argv[3];
if (!BASE || !ENV_FILE) {
  console.error('Usage: node verify-poly-credits-expiry.mjs https://<preview> <wallet-env-file>');
  process.exit(2);
}
const envFile = readFileSync(ENV_FILE, 'utf8');
const WALLET = envFile.match(/TEST_WALLET_ADDRESS=(\S+)/)[1];
const WALLET_KEY = envFile.match(/TEST_WALLET_PRIVATE_KEY=(\S+)/)[1];
const account = privateKeyToAccount(WALLET_KEY);
const walletClient = createWalletClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com'), account });

// Neon via HTTPS (the VM cannot do direct Postgres TLS).
const localEnv = readFileSync('.env.local', 'utf8');
const DATABASE_URL = localEnv.split('\n').find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
const sql = neon(DATABASE_URL);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function post(path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(path, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: extraHeaders });
  return { status: res.status, json: await res.json().catch(() => null) };
}

console.log(`Preview: ${BASE}`);
console.log(`Test wallet: ${WALLET}`);

// 1. Fresh key (saved to a mode-600 file for later use).
const keyRes = await post('/api/agents/v1/keys', {
  agentName: 'poly-credits-expiry-test',
  operatorUrl: 'https://polypad.family',
  acceptTerms: true,
  termsVersion: '2026-10-30',
});
check('create test Pro key', keyRes.status === 201 && keyRes.json?.apiKey?.startsWith('pp_live_'), `prefix ${keyRes.json?.prefix ?? keyRes.status}`);
const API_KEY = keyRes.json?.apiKey;
const KEY_ID = keyRes.json?.keyId;
const keyFile = `${process.env.HOME}/workspace/goals/ai-agent-defi-economy-infrastructure/hidden_files/poly-credits-expiry-test-key.env`;
writeFileSync(keyFile, `# TEST KEY ONLY — Poly credits expiry verification.\n# Created on preview ${BASE}. Revoke after use.\nTEST_KEY_ID=${KEY_ID}\nTEST_KEY_PREFIX=${keyRes.json?.prefix}\nTEST_KEY_VALUE=${API_KEY}\n`);
chmodSync(keyFile, 0o600);

// 2. Claim starter onto the key.
const nonceRes = await post('/api/credits/nonce', { wallet: WALLET, purpose: 'claim' });
const signature = await walletClient.signMessage({ message: nonceRes.json.message });
const claimRes = await post('/api/credits/claim', {
  wallet: WALLET,
  key: API_KEY,
  whatBuilding: 'Expiry verification for Poly credits.',
  nonce: nonceRes.json.nonce,
  signature,
});
check('claim $25 starter onto key', claimRes.status === 200 && claimRes.json?.amountCents === 2500, `status=${claimRes.status}`);
const subject = `key:${KEY_ID}`;

// 3. Baseline: balance live, spend works.
const bal0 = await get(`/api/credits/balance?key=${encodeURIComponent(API_KEY)}`);
check('baseline balance 2500 live', bal0.status === 200 && bal0.json?.balanceCents === 2500 && bal0.json?.expired === false, `balance=${bal0.json?.balanceCents} expired=${bal0.json?.expired}`);

// 4. Flip expiry to the past (direct DB edit, test account only).
await sql.query(`UPDATE "PolyCreditAccount" SET "expiresAt" = NOW() - INTERVAL '1 day' WHERE subject = '${subject}'`);
const bal1 = await get(`/api/credits/balance?key=${encodeURIComponent(API_KEY)}`);
check('expired balance reads 0 + expired:true', bal1.status === 200 && bal1.json?.availableCents === 0 && bal1.json?.expired === true, `available=${bal1.json?.availableCents} expired=${bal1.json?.expired}`);
const SWARM = '0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B';
const report = await get(`/api/x402/products/token-report?address=${SWARM}`, { 'x-api-key': API_KEY });
check('expired account spend → 402 (falls through to on-chain)', report.status === 402 && !report.json?.paidByCredits, `status=${report.status}`);
const bal2 = await get(`/api/credits/balance?key=${encodeURIComponent(API_KEY)}`);
check('balance unchanged after refused spend', bal2.status === 200 && bal2.json?.availableCents === 0, `available=${bal2.json?.availableCents}`);

// 5. Restore expiry to now + 180 days and confirm the account is live again.
await sql.query(`UPDATE "PolyCreditAccount" SET "expiresAt" = NOW() + INTERVAL '180 days' WHERE subject = '${subject}'`);
const bal3 = await get(`/api/credits/balance?key=${encodeURIComponent(API_KEY)}`);
check('restored balance live again at 2500', bal3.status === 200 && bal3.json?.balanceCents === 2500 && bal3.json?.expired === false, `balance=${bal3.json?.balanceCents} expired=${bal3.json?.expired}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) process.exit(1);
