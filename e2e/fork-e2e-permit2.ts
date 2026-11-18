// Polypad x402 — fork end-to-end test, POLYDASH via Permit2 (LOCAL FORK ONLY).
// Same setup as fork-e2e.ts, but exercises the second asset path:
// payer approves canonical Permit2, signs a PermitWitnessTransferFrom,
// and the REAL facilitator code verifies + settles through the canonical
// x402ExactPermit2Proxy. Fork-only anvil test keys. NEVER run on mainnet.
//
// Run:  anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8545 --chain-id 4663
//       cd ~/workspace/polypad-migration/nextjs_space && NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
//         X402_FACILITATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f3ff80 \
//         npx tsx ~/workspace/polydash-x402/e2e/fork-e2e-permit2.ts

import { createWalletClient, http, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount, mnemonicToAccount, generatePrivateKey } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import {
  buildRequirements,
  getPolydashUsd,
  settlePayment,
  verifyPayment,
  x402PublicClient,
  type PaymentPayload,
} from '@/lib/x402/facilitator';

const FORK = 'http://127.0.0.1:8545';
const POLYDASH = '0x319525528f42167eF7fC18b77b889958080568e4' as const;
const PAY_TO = '0x9a21c75aC263cC43125E70200636f6397f8776d0' as const;
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
const PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001' as const;
// V4 PoolManager holds ~9.5B POLYDASH on mainnet — impersonated only.
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951' as const;
// Payer: a FRESH random key (no code on mainnet). Do NOT use anvil account 1
// (0x70997970C51812dc3A010C7d01b50e0d17dc79C8) as the payer: that address is
// EIP-7702-delegated on Robinhood Chain mainnet, so Permit2 takes the
// ERC-1271 path instead of plain ecrecover and the delegate rejects the
// signature. (EIP-3009 is unaffected — it uses ecrecover directly.)
const PAYER_KEY = generatePrivateKey();
// No-allowance wallet: anvil test account 2, derived from the standard test
// mnemonic (address 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC).
const NO_ALLOWANCE_MNEMONIC = 'test test test test test test test test test test test junk' as const;
const FACILITATOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f3ff80' as const;

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
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
  const noAllowance = mnemonicToAccount(NO_ALLOWANCE_MNEMONIC, { addressIndex: 2 });
  const facilitator = privateKeyToAccount(FACILITATOR_KEY);
  const client = x402PublicClient();
  check('fork chain id is 4663', (await client.getChainId()) === 4663);

  await rpc('anvil_setBalance', [facilitator.address, '0x8ac7230489e80000']);
  await rpc('anvil_setBalance', [payer.address, '0xde0b6b3a7640000']);
  await rpc('anvil_setBalance', [noAllowance.address, '0xde0b6b3a7640000']);
  await rpc('anvil_setBalance', [POOL_MANAGER, '0xde0b6b3a7640000']);
  await rpc('anvil_impersonateAccount', [POOL_MANAGER]);
  for (const to of [payer.address, noAllowance.address]) {
    const hash = (await rpc('eth_sendTransaction', [
      { from: POOL_MANAGER, to: POLYDASH, data: encodeFunctionData({ abi: ERC20, functionName: 'transfer', args: [to, 100n * 10n ** 18n] }), gas: '0x186a0' },
    ])) as string;
    check(`PoolManager -> ${to.slice(0, 10)} transfer mined`, (await waitReceipt(hash)).status === '0x1', hash);
  }
  await rpc('anvil_stopImpersonatingAccount', [POOL_MANAGER]);

  // Payer approves Permit2 (own tx, known key).
  const payerWallet = createWalletClient({ account: payer, transport: http(FORK) });
  const approveHash = await payerWallet.writeContract({
    address: POLYDASH, abi: ERC20, functionName: 'approve', args: [PERMIT2, 100n * 10n ** 18n],
  });
  check('payer approves Permit2', (await client.waitForTransactionReceipt({ hash: approveHash })).status === 'success', approveHash);

  // Live POLYDASH price drives the quoted amount, as in production.
  const price = await getPolydashUsd();
  if (!price) {
    console.log('SKIP: CoinGecko price unavailable — cannot quote POLYDASH amount');
    process.exit(0);
  }
  console.log(`live POLYDASH price: $${price}`);
  const reqs = buildRequirements('https://polypad.family/api/x402/products/token-report', 'Token research report', 0.01, price);
  const req = reqs.find((r) => r.asset.toLowerCase() === POLYDASH.toLowerCase());
  if (!req) {
    console.log('FAIL: no POLYDASH requirement built');
    process.exit(1);
  }
  const amount = BigInt(req.amount);
  console.log(`POLYDASH requirement: ${amount} wei (~$0.01)`);
  check('requirement is exact/eip155:4663', req.scheme === 'exact' && req.network === 'eip155:4663');

  const now = Math.floor(Date.now() / 1_000);
  const nonce = BigInt(`0x${randomBytes(8).toString('hex')}`);
  const deadline = now + 300;
  const signature = await payerWallet.signTypedData({
    domain: { name: 'Permit2', chainId: 4663, verifyingContract: PERMIT2 },
    types: {
      PermitWitnessTransferFrom: [
        { name: 'permitted', type: 'TokenPermissions' },
        { name: 'spender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'witness', type: 'Witness' },
      ],
      TokenPermissions: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Witness: [
        { name: 'to', type: 'address' },
        { name: 'validAfter', type: 'uint256' },
      ],
    },
    primaryType: 'PermitWitnessTransferFrom',
    message: {
      permitted: { token: POLYDASH, amount },
      spender: PROXY,
      nonce,
      deadline: BigInt(deadline),
      witness: { to: PAY_TO, validAfter: 0n },
    },
  });
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: req,
    payload: {
      signature,
      permit2Authorization: {
        permitted: { token: POLYDASH, amount: amount.toString() },
        from: payer.address,
        spender: PROXY,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        witness: { to: PAY_TO, validAfter: '0' },
      },
    },
  };

  const verify = await verifyPayment(client, payload);
  check('verifyPayment accepts the real Permit2 authorization', verify.isValid, verify.invalidReason ?? '');
  check('verify identifies the payer', verify.payer?.toLowerCase() === payer.address.toLowerCase(), verify.payer ?? '');

  const payerBefore = (await client.readContract({ address: POLYDASH, abi: ERC20, functionName: 'balanceOf', args: [payer.address] })) as bigint;
  const payToBefore = (await client.readContract({ address: POLYDASH, abi: ERC20, functionName: 'balanceOf', args: [PAY_TO] })) as bigint;
  const settle = await settlePayment(client, payload, verify);
  check('settlePayment succeeds via Permit2 proxy', settle.success, settle.errorReason ?? settle.transaction ?? '');
  if (settle.transaction) {
    check('settlement tx mined successfully', (await client.waitForTransactionReceipt({ hash: settle.transaction })).status === 'success', settle.transaction);
  }
  const payerAfter = (await client.readContract({ address: POLYDASH, abi: ERC20, functionName: 'balanceOf', args: [payer.address] })) as bigint;
  const payToAfter = (await client.readContract({ address: POLYDASH, abi: ERC20, functionName: 'balanceOf', args: [PAY_TO] })) as bigint;
  check('payer debited exactly the quoted amount', payerAfter === payerBefore - amount, `before=${payerBefore} after=${payerAfter}`);
  check('fee wallet credited exactly the quoted amount', payToAfter === payToBefore + amount, `before=${payToBefore} after=${payToAfter}`);

  const vReplay = await verifyPayment(client, payload);
  check('replayed Permit2 authorization rejected', !vReplay.isValid, vReplay.invalidReason ?? '');

  // Negative: wallet with balance but no Permit2 allowance.
  const nonce2 = BigInt(`0x${randomBytes(8).toString('hex')}`);
  const noAllowWallet = createWalletClient({ account: noAllowance, transport: http(FORK) });
  const sig2 = await noAllowWallet.signTypedData({
    domain: { name: 'Permit2', chainId: 4663, verifyingContract: PERMIT2 },
    types: {
      PermitWitnessTransferFrom: [
        { name: 'permitted', type: 'TokenPermissions' },
        { name: 'spender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'witness', type: 'Witness' },
      ],
      TokenPermissions: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Witness: [
        { name: 'to', type: 'address' },
        { name: 'validAfter', type: 'uint256' },
      ],
    },
    primaryType: 'PermitWitnessTransferFrom',
    message: {
      permitted: { token: POLYDASH, amount },
      spender: PROXY,
      nonce: nonce2,
      deadline: BigInt(deadline),
      witness: { to: PAY_TO, validAfter: 0n },
    },
  });
  const payload2: PaymentPayload = {
    x402Version: 2,
    accepted: req,
    payload: {
      signature: sig2,
      permit2Authorization: {
        permitted: { token: POLYDASH, amount: amount.toString() },
        from: noAllowance.address,
        spender: PROXY,
        nonce: nonce2.toString(),
        deadline: deadline.toString(),
        witness: { to: PAY_TO, validAfter: '0' },
      },
    },
  };
  const vNoAllow = await verifyPayment(client, payload2);
  check('missing Permit2 allowance rejected', !vNoAllow.isValid && vNoAllow.invalidReason === 'permit2_allowance_required', vNoAllow.invalidReason ?? '');

  console.log(failures === 0 ? '\nALL PERMIT2 FORK E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E ERROR:', e);
  process.exit(1);
});
