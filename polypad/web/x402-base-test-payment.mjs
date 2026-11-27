// One-off test: first real $0.01 Base/USDC x402 settlement (2026-11-22).
// Buyer: throwaway test wallet (key in ~/workspace/polydash/buyback-keeper/.x402-test-buyer.json, mode 600).
// Signs EIP-3009 for USDC on Base, pays token-report, echoes the Bazaar extension.
import fs from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';

const PRODUCT_URL = process.argv[2];
if (!PRODUCT_URL) {
  console.error('usage: node x402-base-test-payment.mjs <product-url>');
  process.exit(1);
}
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const { privateKey } = JSON.parse(
  fs.readFileSync(process.env.HOME + '/workspace/polydash/buyback-keeper/.x402-test-buyer.json', 'utf8'),
);
const account = privateKeyToAccount(privateKey);
console.log('buyer:', account.address);

// 1. Fetch the 402.
const res402 = await fetch(PRODUCT_URL);
const body402 = await res402.json();
console.log('402 status:', res402.status);
if (res402.status !== 402) {
  console.log(JSON.stringify(body402).slice(0, 500));
  process.exit(1);
}
const req = body402.accepts[0];
console.log(
  'requirement:',
  JSON.stringify({
    scheme: req.scheme,
    network: req.network,
    amount: req.amount,
    asset: req.asset,
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
  }),
);
console.log('bazaar extension present:', !!body402.extensions?.bazaar);

// 2. Sign EIP-3009 TransferWithAuthorization for USDC on Base.
const now = Math.floor(Date.now() / 1000);
const validBefore = now + 120;
const nonce =
  '0x' +
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
const signature = await account.signTypedData({
  domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: {
    from: account.address,
    to: req.payTo,
    value: BigInt(req.amount),
    validAfter: 0n,
    validBefore: BigInt(validBefore),
    nonce,
  },
});
console.log('signed authorization, validBefore:', validBefore);

// 3. Retry with X-PAYMENT (payload forwarded verbatim to the CDP facilitator).
const payload = {
  x402Version: 2,
  // The CDP facilitator requires paymentPayload.resource to associate the
  // Bazaar metadata with the endpoint — without it, indexing cannot happen.
  resource: body402.resource,
  accepted: req,
  payload: {
    signature,
    authorization: {
      from: account.address,
      to: req.payTo,
      value: req.amount,
      validAfter: '0',
      validBefore: String(validBefore),
      nonce,
    },
  },
  extensions: body402.extensions,
};
const header = Buffer.from(JSON.stringify(payload)).toString('base64');
const paid = await fetch(PRODUCT_URL, { headers: { 'X-PAYMENT': header } });
console.log('paid status:', paid.status);
const paidBody = await paid.json();
console.log('paid body:', JSON.stringify(paidBody, null, 2).slice(0, 3000));
console.log(
  'payment headers:',
  JSON.stringify(
    [...paid.headers.entries()].filter(([k]) => /payment|extension/i.test(k)),
    null,
    2,
  ),
);
