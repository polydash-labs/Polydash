// Polypad x402 — fork end-to-end test (LOCAL FORK ONLY).
// Forks Robinhood Chain mainnet (4663) with anvil, impersonates a real
// USDG holder, funds a test payer wallet, signs a real EIP-3009
// transferWithAuthorization, and runs it through the REAL facilitator
// code (lib/x402/facilitator.ts): verify -> settle -> balance checks.
// Uses only well-known anvil test keys. NEVER run against mainnet.
//
// Run:  anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8545 --chain-id 4663
//       cd ~/workspace/polypad-migration/nextjs_space && NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
//         X402_FACILITATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f3ff80 \
//         npx tsx ~/workspace/polydash-x402/e2e/fork-e2e.ts

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from 'viem';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildRequirements,
  settlePayment,
  verifyPayment,
  x402PublicClient,
  type PaymentPayload,
} from '@/lib/x402/facilitator';

const FORK = 'http://127.0.0.1:8545';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
const PAY_TO = '0x9a21c75aC263cC43125E70200636f6397f8776d0' as const;
// Real mainnet USDG holder (9,044 USDG at fork time) — impersonated only.
const HOLDER = '0x15c38890ab7933c6cc06d28184d59b9915a2fc9b' as const;
// Anvil test account 1 (payer) and the facilitator key. Fork-only keys.
// NOTE: the facilitator key below derives to 0x7f225583E3bCE24E0DEaA116EcFF1E552Cb74272
// (not anvil's default account 0) — the script funds it on the fork.
const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const FACILITATOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f3ff80' as const;
const AMOUNT = 10_000n; // $0.01 in USDG (6 dp)

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
]);

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(FORK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function waitReceipt(hash: string): Promise<{ status: string }> {
  for (let i = 0; i < 30; i++) {
    const r = (await rpc('eth_getTransactionReceipt', [hash])) as { status?: string } | null;
    if (r?.status) return { status: r.status };
    await new Promise((r2) => setTimeout(r2, 500));
  }
  throw new Error(`no receipt for ${hash}`);
}

async function main() {
  const payer = privateKeyToAccount(PAYER_KEY);
  const facilitator = privateKeyToAccount(FACILITATOR_KEY);
  const client = x402PublicClient();
  const chainId = await client.getChainId();
  check('fork chain id is 4663', chainId === 4663, `got ${chainId}`);
  // The facilitator pays gas to broadcast settlements — fund its fork address.
  await rpc('anvil_setBalance', [facilitator.address, '0x8ac7230489e80000']); // 10 ETH
  const facBal = await client.getBalance({ address: facilitator.address });
  check('facilitator funded on fork', facBal === 10n ** 19n, `balance=${facBal}`);

  // 1. Fund the payer: impersonate a real USDG holder, transfer 1 USDG.
  await rpc('anvil_setBalance', [HOLDER, '0xde0b6b3a7640000']); // 1 ETH for gas
  await rpc('anvil_impersonateAccount', [HOLDER]);
  const data = encodeFunctionData({
    abi: ERC20,
    functionName: 'transfer',
    args: [payer.address, 1_000_000n],
  });
  const txHash = (await rpc('eth_sendTransaction', [
    { from: HOLDER, to: USDG, data, gas: '0x186a0' },
  ])) as string;
  const receipt = await waitReceipt(txHash);
  check('holder -> payer transfer mined', receipt.status === '0x1', txHash);
  await rpc('anvil_stopImpersonatingAccount', [HOLDER]);
  const payerBal = (await client.readContract({
    address: USDG,
    abi: ERC20,
    functionName: 'balanceOf',
    args: [payer.address],
  })) as bigint;
  check('payer holds at least 1 USDG', payerBal >= 1_000_000n, `balance=${payerBal}`);

  // 2. Sign a real EIP-3009 authorization ($0.01, 5 min window).
  const now = Math.floor(Date.now() / 1_000);
  const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
  const auth = {
    from: payer.address,
    to: PAY_TO,
    value: AMOUNT.toString(),
    validAfter: '0',
    validBefore: String(now + 300),
    nonce,
  };
  const wallet = createWalletClient({ account: payer, transport: http(FORK) });
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
      to: PAY_TO,
      value: AMOUNT,
      validAfter: 0n,
      validBefore: BigInt(now + 300),
      nonce,
    },
  });

  const req = buildRequirements('https://polypad.family/api/x402/products/token-report', 'Token research report', 0.01)[0];
  check('requirement is $0.01 USDG exact/eip155:4663', req.amount === '10000' && req.scheme === 'exact' && req.network === 'eip155:4663', JSON.stringify(req).slice(0, 120));
  const payload: PaymentPayload = { x402Version: 2, accepted: req, payload: { signature, authorization: auth } };

  // 3. Verify (real facilitator code, against the fork).
  const verify = await verifyPayment(client, payload);
  check('verifyPayment accepts the real authorization', verify.isValid, verify.invalidReason ?? '');
  check('verify identifies the payer', verify.payer?.toLowerCase() === payer.address.toLowerCase(), verify.payer ?? '');

  // 4. Settle (facilitator broadcasts transferWithAuthorization on the fork).
  const payerBeforeSettle = (await client.readContract({
    address: USDG, abi: ERC20, functionName: 'balanceOf', args: [payer.address],
  })) as bigint;
  const payToBefore = (await client.readContract({
    address: USDG, abi: ERC20, functionName: 'balanceOf', args: [PAY_TO],
  })) as bigint;
  const settle = await settlePayment(client, payload, verify);
  check('settlePayment succeeds', settle.success, settle.errorReason ?? settle.transaction ?? '');
  if (settle.transaction) {
    const sReceipt = await client.waitForTransactionReceipt({ hash: settle.transaction });
    check('settlement tx mined successfully', sReceipt.status === 'success', settle.transaction);
  }
  const payerAfter = (await client.readContract({
    address: USDG, abi: ERC20, functionName: 'balanceOf', args: [payer.address],
  })) as bigint;
  const payToAfter = (await client.readContract({
    address: USDG, abi: ERC20, functionName: 'balanceOf', args: [PAY_TO],
  })) as bigint;
  check('payer debited exactly $0.01', payerAfter === payerBeforeSettle - AMOUNT, `before=${payerBeforeSettle} after=${payerAfter}`);
  check('fee wallet credited exactly $0.01', payToAfter === payToBefore + AMOUNT, `before=${payToBefore} after=${payToAfter}`);
  const used = (await client.readContract({
    address: USDG, abi: ERC20, functionName: 'authorizationState', args: [payer.address, nonce],
  })) as boolean;
  check('authorization nonce consumed on-chain', used === true);

  // 5. Negative cases.
  const tampered: PaymentPayload = {
    ...payload,
    accepted: { ...req, amount: '20000' },
  };
  const vTampered = await verifyPayment(client, tampered);
  check('tampered amount rejected', !vTampered.isValid && vTampered.invalidReason === 'amount_mismatch', vTampered.invalidReason ?? '');
  const vReplay = await verifyPayment(client, payload);
  check('replayed authorization rejected (nonce used)', !vReplay.isValid && vReplay.invalidReason === 'nonce_already_used', vReplay.invalidReason ?? '');

  console.log(failures === 0 ? '\nALL FORK E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E ERROR:', e);
  process.exit(1);
});
