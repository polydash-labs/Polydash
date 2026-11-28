// One-off Bazaar indexing trigger: one real paid call per x402 product in
// USDC on Base through the CDP Facilitator, echoing the declared
// extensions.bazaar + resource in the PaymentPayload (the echo is what the
// Nov 22 settlements missed, so nothing was indexed).
//
// Usage:  npx tsx scripts/pay-bazaar-test.ts
// The test-buyer key is read from the mode-600 file at run time and never
// printed or stored. Total spend: $0.07 (0.01 + 0.01 + 0.05).
// If the buyer cannot cover it, the script stops before paying anything.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createPublicClient, http, type Hex } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const KEY_PATH = '/home/hatch/workspace/polydash/buyback-keeper/.x402-test-buyer.json';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const PAY_TO = '0x9a21c75aC263cC43125E70200636f6397f8776d0' as const;
const BASE_NETWORK = 'eip155:8453';

const PRODUCTS = [
  {
    id: 'token-report',
    url: 'https://polypad.family/api/x402/products/token-report?address=0x319525528f42167eF7fC18b77b889958080568e4',
  },
  {
    id: 'fund-nav',
    url: 'https://polypad.family/api/x402/products/fund-nav?fund=0x7c1d31629ac68aebe83f230edbc7eacfc26285ef',
  },
  {
    id: 'cto-report',
    url: 'https://polypad.family/api/x402/products/cto-report?launch=0x2B0b4151cA57546BD968718b1ba256b288e51CA9',
  },
];

const USDC_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const EIP3009_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_BASE,
} as const;

async function main() {
  const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as { address: string; privateKey: string };
  const account = privateKeyToAccount(keyFile.privateKey as Hex);
  console.log(`buyer: ${account.address}`);

  const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const usdc = (await client.readContract({
    address: USDC_BASE,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint;
  const totalNeeded = 70_000n; // $0.07 in USDC 6dp
  console.log(`buyer USDC on Base: $${(Number(usdc) / 1e6).toFixed(6)} (need $0.07)`);
  if (usdc < totalNeeded) {
    console.error(
      `STOP: test buyer is short — has $${(Number(usdc) / 1e6).toFixed(6)} USDC, needs $0.07. ` +
        `Fund ${account.address} on Base and re-run. Nothing was paid.`,
    );
    process.exit(2);
  }

  const results: Array<{ product: string; amount: string; transaction: string | null }> = [];
  for (const product of PRODUCTS) {
    console.log(`\n--- ${product.id} ---`);
    // 1. Fetch the default 402 challenge.
    const challengeRes = await fetch(product.url);
    if (challengeRes.status !== 402) {
      throw new Error(`${product.id}: expected 402 challenge, got ${challengeRes.status}: ${await challengeRes.text()}`);
    }
    const challenge = (await challengeRes.json()) as any;
    const baseAccept = (challenge.accepts as any[]).find((a) => a.network === BASE_NETWORK);
    if (!baseAccept) throw new Error(`${product.id}: no Base USDC accept in default challenge`);
    // 2. Verify the echo BEFORE paying: the payload must carry both the
    // declared extensions.bazaar and the top-level resource, per CDP docs
    // ("set both paymentPayload.extensions.bazaar and paymentPayload.resource").
    const extensions = challenge.extensions;
    const resource = challenge.resource;
    if (!extensions?.bazaar) throw new Error(`${product.id}: extensions.bazaar missing from 402 — refusing to pay`);
    if (!resource?.url) throw new Error(`${product.id}: top-level resource missing from 402 — refusing to pay`);
    console.log(`echo preview: bazaar input method=${extensions.bazaar.info.input.method} queryParams=${JSON.stringify(extensions.bazaar.info.input.queryParams)}`);
    console.log(`echo preview: resource.url=${resource.url}`);
    console.log(`Base accept: $${(Number(baseAccept.amount) / 1e6).toFixed(2)} USDC -> ${baseAccept.payTo}`);

    // 3. Sign the EIP-3009 authorization (buyer signs; CDP submits on-chain).
    const now = BigInt(Math.floor(Date.now() / 1000));
    const authorization = {
      from: account.address,
      to: PAY_TO,
      value: BigInt(baseAccept.amount),
      validAfter: 0n,
      validBefore: now + 3600n,
      nonce: ('0x' + randomBytes(32).toString('hex')) as Hex,
    };
    const signature = await account.signTypedData({
      domain: EIP3009_DOMAIN,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    });

    // 4. Pay: same URL, X-PAYMENT header carries the payload WITH the echo.
    const payload = {
      x402Version: 2,
      resource,
      accepted: baseAccept,
      payload: {
        signature,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
          nonce: authorization.nonce,
        },
      },
      extensions,
    };
    const paidRes = await fetch(product.url, {
      headers: { 'X-PAYMENT': Buffer.from(JSON.stringify(payload)).toString('base64') },
    });
    const paidBody = (await paidRes.json()) as any;
    console.log(`paid call HTTP ${paidRes.status}: ${JSON.stringify(paidBody).slice(0, 400)}`);
    if (paidRes.status !== 200 || !paidBody.success) {
      throw new Error(`${product.id}: paid call failed (HTTP ${paidRes.status}): ${JSON.stringify(paidBody)}`);
    }
    results.push({ product: product.id, amount: baseAccept.amount, transaction: paidBody.transaction ?? null });
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n=== settlements ===');
  for (const r of results) {
    console.log(`${r.product}: $${(Number(r.amount) / 1e6).toFixed(2)} tx=${r.transaction}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e?.message ?? e);
  process.exit(1);
});
