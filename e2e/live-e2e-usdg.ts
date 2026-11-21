// Polypad x402 — LIVE mainnet end-to-end paid call (USDG / EIP-3009).
// Hits production https://polypad.family, signs a real $0.01 EIP-3009
// authorization with a funded test payer, and runs the full flow:
//   GET product (unpaid) -> 402 + PAYMENT-REQUIRED
//   GET product with X-PAYMENT -> verify -> build -> settle -> 200 + report
// Then checks on-chain: payer debited $0.01, payee credited $0.01, nonce used.
// The payer key comes from TEST_PAYER_KEY env (transient, never stored).
// Spends $0.01 of real USDG + settlement gas from the facilitator wallet.
// Usage: cd ~/workspace/polypad-migration/nextjs_space && TEST_PAYER_KEY=0x... npx tsx ~/workspace/polydash-x402/e2e/live-e2e-usdg.ts

import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';

const BASE = 'https://polypad.family';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
const TOKEN = '0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B'; // SWARM
const AMOUNT = 10000n; // $0.01 USDG (6 dp)

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function authorizationState(address, bytes32) view returns (bool)',
]);

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const key = process.env.TEST_PAYER_KEY as Hex | undefined;
  if (!key) throw new Error('TEST_PAYER_KEY env missing');
  const payer = privateKeyToAccount(key);
  const client = createPublicClient({ transport: http(RPC) });
  const wallet = createWalletClient({ account: payer, transport: http(RPC) });

  const url = `${BASE}/api/x402/products/token-report?address=${TOKEN}`;

  // 0. Pre-check balances.
  const balBefore = (await client.readContract({ address: USDG, abi: ERC20, functionName: 'balanceOf', args: [payer.address] })) as bigint;
  console.log('payer:', payer.address, 'USDG before:', balBefore.toString());

  // 1. Unpaid request -> 402 + PAYMENT-REQUIRED.
  const unpaid = await fetch(url);
  check('unpaid request returns 402', unpaid.status === 402, `status=${unpaid.status}`);
  const body = (await unpaid.json()) as { accepts: any[] };
  const req = body.accepts.find((a) => a.asset.toLowerCase() === USDG.toLowerCase());
  check('402 offers USDG $0.01 exact', !!req && req.amount === '10000', JSON.stringify(req)?.slice(0, 160));
  const payTo = req.payTo as `0x${string}`;
  const payToBefore = (await client.readContract({ address: USDG, abi: ERC20, functionName: 'balanceOf', args: [payTo] })) as bigint;

  // 2. Sign a real EIP-3009 authorization ($0.01, 5 min window).
  const now = Math.floor(Date.now() / 1_000);
  const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
  const auth = {
    from: payer.address,
    to: payTo,
    value: AMOUNT.toString(),
    validAfter: '0',
    validBefore: String(now + 300),
    nonce,
  };
  const signature = await wallet.signTypedData({
    domain: { name: 'Global Dollar', version: '1', chainId: 4663, verifyingContract: USDG },
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
      from: payer.address,
      to: payTo,
      value: AMOUNT,
      validAfter: 0n,
      validBefore: BigInt(now + 300),
      nonce,
    },
  });
  const payload = { x402Version: 2, accepted: req, payload: { signature, authorization: auth } };
  const header = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  // 3. Paid request -> verify -> build -> settle -> 200 + report.
  const paid = await fetch(url, { headers: { 'X-PAYMENT': header } });
  const paidText = await paid.text();
  check('paid request returns 200', paid.status === 200, `status=${paid.status} body=${paidText.slice(0, 200)}`);
  const payResp = paid.headers.get('PAYMENT-RESPONSE');
  console.log('PAYMENT-RESPONSE:', payResp ? Buffer.from(payResp, 'base64').toString('utf8').slice(0, 400) : '(none)');
  let report: any = null;
  try { report = JSON.parse(paidText); } catch { /* already reported */ }
  // The report is nested under `data` (top level carries the payment receipt).
  const data = report?.data ?? {};
  console.log('report data keys:', Object.keys(data).join(', '), '| sample:', JSON.stringify(data).slice(0, 300));
  check('response contains the token report', !!(data.token || data.name || data.symbol || data.address || data.price || data.marketCap), paidText.slice(0, 160));

  // 4. On-chain settlement checks.
  const balAfter = (await client.readContract({ address: USDG, abi: ERC20, functionName: 'balanceOf', args: [payer.address] })) as bigint;
  const payToAfter = (await client.readContract({ address: USDG, abi: ERC20, functionName: 'balanceOf', args: [payTo] })) as bigint;
  const used = (await client.readContract({ address: USDG, abi: ERC20, functionName: 'authorizationState', args: [payer.address, nonce] })) as boolean;
  check('payer debited exactly $0.01', balAfter === balBefore - AMOUNT, `before=${balBefore} after=${balAfter}`);
  check('payee credited exactly $0.01', payToAfter === payToBefore + AMOUNT, `before=${payToBefore} after=${payToAfter}`);
  check('authorization nonce marked used', used === true);

  console.log(failures === 0 ? '\nLIVE E2E: ALL CHECKS PASSED' : `\nLIVE E2E: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('LIVE E2E ERROR:', e);
  process.exit(1);
});
