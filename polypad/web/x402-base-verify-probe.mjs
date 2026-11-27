// Verify-only probe: does the CDP facilitator accept the Bazaar extension?
// Builds a fresh EIP-3009 authorization (new nonce, never settled) and POSTs
// it to /api/x402/verify, which surfaces the facilitator's extensionResponses.
import fs from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';

const PRODUCT_URL =
  'https://polypad.family/api/x402/products/token-report?network=base&address=0x319525528f42167eF7fC18b77b889958080568e4';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const { privateKey } = JSON.parse(
  fs.readFileSync(process.env.HOME + '/workspace/polydash/buyback-keeper/.x402-test-buyer.json', 'utf8'),
);
const account = privateKeyToAccount(privateKey);

const res402 = await fetch(PRODUCT_URL);
const body402 = await res402.json();
const req = body402.accepts[0];
console.log('402 status:', res402.status, '| bazaar ext:', !!body402.extensions?.bazaar);

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
    value: 10000n,
    validAfter: 0n,
    validBefore: BigInt(validBefore),
    nonce,
  },
});

const payload = {
  x402Version: 2,
  resource: body402.resource,
  accepted: req,
  payload: {
    signature,
    authorization: {
      from: account.address,
      to: req.payTo,
      value: '10000',
      validAfter: '0',
      validBefore: String(validBefore),
      nonce,
    },
  },
  extensions: body402.extensions,
};

const res = await fetch('https://polypad.family/api/x402/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x402Version: 2, paymentPayload: payload }),
});
console.log('verify status:', res.status);
console.log('verify body:', JSON.stringify(await res.json(), null, 2));
