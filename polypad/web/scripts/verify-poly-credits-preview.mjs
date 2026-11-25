#!/usr/bin/env node
/**
 * Poly credits preview verification — run against a Vercel preview URL.
 * Usage: node verify-poly-credits-preview.mjs <preview-base-url>
 *
 * Steps: create test Pro key → claim $25 starter (test wallet signs) →
 * balance → spend token-report + fund-nav via x402 credits → quote ETH +
 * POLYDASH → top-up complete rejection paths (no funds needed) → expiry
 * behaviour via direct DB edit is NOT done here (see README in the report).
 * Prints only key PREFIXES — never a full pp_live_ value or private key.
 */
import { readFileSync } from 'fs';
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhoodChain } from './verify-chain.mjs';

const BASE = process.argv[2];
if (!BASE || !BASE.startsWith('https://')) {
  console.error('Usage: node verify-poly-credits-preview.mjs https://<preview>.vercel.app');
  process.exit(2);
}
const envFile = readFileSync(
  process.argv[3] ||
    `${process.env.HOME}/workspace/goals/ai-agent-defi-economy-infrastructure/hidden_files/poly-credits-test-wallet.env`,
  'utf8',
);
const WALLET = envFile.match(/TEST_WALLET_ADDRESS=(\S+)/)[1];
const WALLET_KEY = envFile.match(/TEST_WALLET_PRIVATE_KEY=(\S+)/)[1];
const account = privateKeyToAccount(WALLET_KEY);
const walletClient = createWalletClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com'), account });

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

// 1. Create a test Pro key.
const keyRes = await post('/api/agents/v1/keys', {
  agentName: 'poly-credits-preview-test',
  operatorUrl: 'https://polypad.family',
  acceptTerms: true,
  termsVersion: '2026-10-30',
});
check('create test Pro key', keyRes.status === 201 && keyRes.json?.apiKey?.startsWith('pp_live_'), `prefix ${keyRes.json?.prefix ?? keyRes.status}`);
const API_KEY = keyRes.json?.apiKey;
const KEY_PREFIX = keyRes.json?.prefix ?? '';

// 2. Claim the $25 starter with the test wallet.
const nonceRes = await post('/api/credits/nonce', { wallet: WALLET, purpose: 'claim' });
check('claim nonce issued', nonceRes.status === 200 && !!nonceRes.json?.nonce);
const signature = await walletClient.signMessage({ message: nonceRes.json.message });
const claimRes = await post('/api/credits/claim', {
  wallet: WALLET,
  key: API_KEY,
  whatBuilding: 'Preview verification of Poly credits top-ups.',
  nonce: nonceRes.json.nonce,
  signature,
});
if (claimRes.status === 200) {
  check('claim $25 starter onto key', claimRes.json?.amountCents === 2500, JSON.stringify(claimRes.json)?.slice(0, 160));
} else if (claimRes.status === 409) {
  // Wallet already claimed (earlier run) — move its balance onto the new key instead.
  const ln = await post('/api/credits/nonce', { wallet: WALLET, purpose: 'link-key' });
  const lsig = await walletClient.signMessage({ message: ln.json.message });
  const linkRes = await post('/api/credits/link-key', { wallet: WALLET, key: API_KEY, nonce: ln.json.nonce, signature: lsig });
  check('link wallet balance onto new key', linkRes.status === 200 && linkRes.json?.movedCents === 2500, JSON.stringify(linkRes.json)?.slice(0, 160));
} else {
  check('claim $25 starter onto key', false, JSON.stringify(claimRes.json)?.slice(0, 160));
}

// 2b. Second claim must fail (one per wallet).
const nonce2 = await post('/api/credits/nonce', { wallet: WALLET, purpose: 'claim' });
const sig2 = await walletClient.signMessage({ message: nonce2.json.message });
const claim2 = await post('/api/credits/claim', {
  wallet: WALLET,
  key: API_KEY,
  whatBuilding: 'Second claim must fail.',
  nonce: nonce2.json.nonce,
  signature: sig2,
});
check('second claim → 409 already_claimed', claim2.status === 409, JSON.stringify(claim2.json)?.slice(0, 120));

// 3. Balance via key.
const bal = await get(`/api/credits/balance?key=${encodeURIComponent(API_KEY)}`);
check('balance $25.00 after claim', bal.status === 200 && bal.json?.balanceCents === 2500, `balanceCents=${bal.json?.balanceCents}`);

// 4. Spend: token-report (1¢) via x402 credits, no payment header.
const SWARM = '0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B';
const report = await get(`/api/x402/products/token-report?address=${SWARM}`, { 'x-api-key': API_KEY });
check('token-report paid by credits', report.status === 200 && report.json?.paidByCredits === true, `status=${report.status} paidByCredits=${report.json?.paidByCredits}`);
const bal2 = await get(`/api/credits/balance?key=${encodeURIComponent(API_KEY)}`);
check('balance decremented by 1¢ → 2499', bal2.status === 200 && bal2.json?.balanceCents === 2499, `balanceCents=${bal2.json?.balanceCents}`);

// 4b. Spend: fund-nav (1¢).
const POLYFUND = '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef';
const nav = await get(`/api/x402/products/fund-nav?fund=${POLYFUND}`, { 'x-api-key': API_KEY });
check('fund-nav paid by credits', nav.status === 200 && nav.json?.paidByCredits === true, `status=${nav.status}`);
const bal3 = await get(`/api/credits/balance?key=${encodeURIComponent(API_KEY)}`);
check('balance decremented by 1¢ → 2498', bal3.status === 200 && bal3.json?.balanceCents === 2498, `balanceCents=${bal3.json?.balanceCents}`);

// 5. Quote endpoints.
const qEth = await get('/api/credits/topup/quote?asset=ETH&amount=0.01');
check('quote ETH 0.01', qEth.status === 200 && qEth.json?.estimatedCents > 0 && qEth.json?.recipient?.toLowerCase() === '0x9a21c75ac263cc43125e70200636f6397f8776d0', `estimatedCents=${qEth.json?.estimatedCents} usd=${qEth.json?.usdValue}`);
const qPoly = await get('/api/credits/topup/quote?asset=POLYDASH&amount=50000');
check('quote POLYDASH 50000', qPoly.status === 200 && qPoly.json?.estimatedCents > 0, `estimatedCents=${qPoly.json?.estimatedCents} priceUsd=${qPoly.json?.priceUsd}`);
const qBad = await get('/api/credits/topup/quote?asset=BTC&amount=1');
check('quote bad asset → 400', qBad.status === 400);

// 6. Top-up complete: rejection paths (no funds needed).
const fakeHash = `0x${'11'.repeat(32)}`;
const topNonce = await post('/api/credits/nonce', { wallet: WALLET, purpose: 'topup' });
check('topup nonce issued', topNonce.status === 200 && !!topNonce.json?.nonce);
const topSig = await walletClient.signMessage({ message: topNonce.json.message });
const noTx = await post('/api/credits/topup/complete', {
  txHash: fakeHash, asset: 'ETH', wallet: WALLET, nonce: topNonce.json.nonce, signature: topSig,
});
check('complete unknown tx → 404 tx_not_found', noTx.status === 404, JSON.stringify(noTx.json)?.slice(0, 120));

// Wrong sender: a real recent tx from someone else. Fetch the latest block's first tx.
const { createPublicClient } = await import('viem');
const pub = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com') });
const block = await pub.getBlock({ blockTag: 'latest' });
const otherTx = block.transactions?.[0];
if (otherTx && otherTx.toLowerCase() !== WALLET.toLowerCase()) {
  const n3 = await post('/api/credits/nonce', { wallet: WALLET, purpose: 'topup' });
  const s3 = await walletClient.signMessage({ message: n3.json.message });
  const wrongSender = await post('/api/credits/topup/complete', {
    txHash: otherTx, asset: 'ETH', wallet: WALLET, nonce: n3.json.nonce, signature: s3,
  });
  check("complete someone else's tx → 422 wrong_sender", wrongSender.status === 422, JSON.stringify(wrongSender.json)?.slice(0, 120));
} else {
  check("complete someone else's tx → 422 wrong_sender", false, 'no usable foreign tx found in latest block');
}

// Bad signature → 401.
const n4 = await post('/api/credits/nonce', { wallet: WALLET, purpose: 'topup' });
const badSig = await post('/api/credits/topup/complete', {
  txHash: fakeHash, asset: 'ETH', wallet: WALLET, nonce: n4.json.nonce, signature: '0x' + '22'.repeat(65),
});
check('complete bad signature → 401', badSig.status === 401, `status=${badSig.status}`);

// 7. History shows the grant + spends.
const hist = await get(`/api/credits/history?key=${encodeURIComponent(API_KEY)}`);
const kinds = (hist.json?.entries ?? []).map((e) => e.kind);
check('history has grant + 2 spends', hist.status === 200 && kinds.includes('grant') && kinds.filter((k) => k === 'spend').length >= 2, `kinds=${kinds.join(',')}`);

// 8. Admin routes require the admin cookie.
const adminNoAuth = await get('/api/admin/credits/overview');
check('admin overview without cookie → 401', adminNoAuth.status === 401, `status=${adminNoAuth.status}`);

// 9. Key hygiene: no response contained the full key value.
// Key issuance legitimately returns the full key once ("store it now");
// every LOOKUP response must never echo it.
const allBodies = JSON.stringify([bal.json, bal2.json, bal3.json, hist.json]);
check('no response echoes the full key', API_KEY ? !allBodies.includes(API_KEY) : false, `key prefix ${KEY_PREFIX}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log('Failed:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
