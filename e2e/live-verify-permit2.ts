// Live check: does production /verify accept a correctly-signed Permit2
// authorization (version-less domain) and reject the old wrong domain?
// The signing key is fresh and holds no POLYDASH, so a correct signature
// must return `insufficient_funds` (past the signature check); the old
// `version: "1"` domain must return `invalid_signature`.
// Usage: cd ~/workspace/polypad-migration/nextjs_space && npx tsx ~/workspace/polydash-x402/e2e/live-verify-permit2.ts

import { createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildRequirements, getPolydashUsd } from '@/lib/x402/facilitator';

const POLYDASH = '0x319525528f42167eF7fC18b77b889958080568e4' as const;
const PAY_TO = '0x9a21c75aC263cC43125E70200636f6397f8776d0' as const;
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
const PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001' as const;

async function postVerify(payload: unknown): Promise<any> {
  const res = await fetch('https://polypad.family/api/x402/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentPayload: payload }),
  });
  return res.json();
}

async function main() {
  const payer = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({ account: payer, transport: http('https://rpc.mainnet.chain.robinhood.com') });
  const price = await getPolydashUsd();
  console.log('live POLYDASH price:', price);
  const req = buildRequirements('https://polypad.family/api/x402/products/token-report', 'Token research report', 0.01, price).find(
    (r) => r.asset.toLowerCase() === POLYDASH.toLowerCase(),
  )!;
  const amount = BigInt(req.amount);
  const now = Math.floor(Date.now() / 1_000);
  const deadline = now + 300;
  const nonce = 123456789n;

  const types = {
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
  } as const;
  const message = {
    permitted: { token: POLYDASH, amount },
    spender: PROXY,
    nonce,
    deadline: BigInt(deadline),
    witness: { to: PAY_TO, validAfter: 0n },
  };

  // Correct domain: Permit2 has NO version field.
  const sigGood = await wallet.signTypedData({
    domain: { name: 'Permit2', chainId: 4663, verifyingContract: PERMIT2 },
    types, primaryType: 'PermitWitnessTransferFrom', message,
  });
  const payloadGood = {
    x402Version: 2,
    accepted: req,
    payload: {
      signature: sigGood,
      permit2Authorization: {
        permitted: { token: POLYDASH, amount: amount.toString() },
        from: payer.address, spender: PROXY,
        nonce: nonce.toString(), deadline: deadline.toString(),
        witness: { to: PAY_TO, validAfter: '0' },
      },
    },
  };
  const rGood = await postVerify(payloadGood);
  console.log('correct domain ->', JSON.stringify(rGood));
  console.log(rGood.invalidReason === 'insufficient_funds' ? 'PASS: signature accepted (fails only on balance, as expected)' : 'FAIL: expected insufficient_funds');

  // Old wrong domain: version "1" — must now be rejected at the signature.
  const sigBad = await wallet.signTypedData({
    domain: { name: 'Permit2', version: '1', chainId: 4663, verifyingContract: PERMIT2 },
    types, primaryType: 'PermitWitnessTransferFrom', message,
  });
  const payloadBad = { ...payloadGood, payload: { ...payloadGood.payload, signature: sigBad } };
  const rBad = await postVerify(payloadBad);
  console.log('version-1 domain ->', JSON.stringify(rBad));
  console.log(rBad.invalidReason === 'invalid_signature' ? 'PASS: old wrong domain rejected' : 'FAIL: expected invalid_signature');
}

main().catch((e) => { console.error(e); process.exit(1); });
