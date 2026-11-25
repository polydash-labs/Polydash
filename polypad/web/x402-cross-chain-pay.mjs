// End-to-end cross-chain x402 payment (Polypad-native: Relay bridge +
// Polypad's own x402 facilitators, plain `exact` EIP-3009 settlement).
//
// Usage:
//   node x402-cross-chain-pay.mjs --url <product-url> --key-file <path> [--max-bridge-usd 0.05] [--force-bridge true]
//
// --force-bridge: bridge the full payment amount from the origin chain even
// when the payer already holds enough on the settlement chain. Needed to
// genuinely test a direction (e.g. Hood -> Base) with a wallet that also
// holds the settlement asset — otherwise the script correctly skips the
// bridge and the run proves nothing about the cross-chain path.
//
// --key-file is either {"privateKey": "0x..."} JSON (test buyer) or a
// dotenv file with DEPLOYER_PRIVATE_KEY= (deployer). The key is read
// transiently and NEVER printed or logged.
//
// Flow: fetch the 402 -> pick the stablecoin requirement -> check the
// payer's balances on both chains -> bridge ONLY the shortfall via Relay
// (approve + deposit, then poll the intent to success) -> sign EIP-3009
// on the settlement chain -> GET the product URL with X-PAYMENT ->
// print the receipt with both tx hashes. Stops (no funds moved) when
// the payer lacks the bridge input or gas, and says the exact shortfall.
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter(([k]) => k),
);
const URL = args.url;
const KEY_FILE = args['key-file'];
const MAX_BRIDGE_USD = Number(args['max-bridge-usd'] ?? '0.05');
const FORCE_BRIDGE = args['force-bridge'] === 'true' || args['force-bridge'] === '1';
if (!URL || !KEY_FILE) {
  console.error('usage: node x402-cross-chain-pay.mjs --url <product-url> --key-file <path> [--max-bridge-usd 0.05]');
  process.exit(1);
}

const HOOD = {
  id: 4663, name: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  stable: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', symbol: 'USDG',
  domain: { name: 'Global Dollar', version: '1' },
  explorer: (h) => `https://robinhoodchain.blockscout.com/tx/${h}`,
};
const BASE = {
  id: 8453, name: 'Base',
  rpc: 'https://mainnet.base.org',
  stable: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC',
  domain: { name: 'USD Coin', version: '2' },
  explorer: (h) => `https://basescan.org/tx/${h}`,
};
const CHAINS = { 4663: HOOD, 8453: BASE };
const RELAY = 'https://api.relay.link';
const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
]);
const fmt6 = (v) => `$${(Number(v) / 1e6).toFixed(4)}`;

function loadKey(path) {
  const raw = fs.readFileSync(path, 'utf8');
  let value;
  if (raw.trim().startsWith('{')) value = JSON.parse(raw).privateKey;
  else {
    const line = raw.split('\n').find((l) => /PRIVATE_KEY=/.test(l));
    if (!line) throw new Error('no PRIVATE_KEY found in key file');
    value = line.split('=')[1].trim().replace(/^["']|["']$/g, '');
  }
  // viem wants 0x-prefixed hex; the stored deployer key has no prefix.
  if (/^[0-9a-fA-F]{64}$/.test(value)) value = `0x${value}`;
  return value;
}

const key = loadKey(KEY_FILE);
const account = privateKeyToAccount(key);
console.log('payer:', account.address);

function viemChain(c) {
  return defineChain({
    id: c.id, name: c.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [c.rpc] } },
  });
}
const pc = (c) => createPublicClient({ chain: viemChain(c), transport: http(c.rpc, { timeout: 8000 }) });
const wc = (c) => createWalletClient({ chain: viemChain(c), transport: http(c.rpc, { timeout: 8000 }), account });

async function balances(addr) {
  const out = {};
  for (const c of [HOOD, BASE]) {
    const client = pc(c);
    const [eth, stable] = await Promise.all([
      client.getBalance({ address: addr }),
      client.readContract({ address: c.stable, abi: ERC20, functionName: 'balanceOf', args: [addr] }),
    ]);
    out[c.id] = { eth, stable };
  }
  return out;
}

// 1. Fetch the 402.
const res402 = await fetch(URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
console.log('402 status:', res402.status);
if (res402.status !== 402) { console.log(JSON.stringify(await res402.json()).slice(0, 400)); process.exit(1); }
const body402 = await res402.json();
const req = body402.accepts.find(
  (a) => a.scheme === 'exact' && [HOOD.stable.toLowerCase(), BASE.stable.toLowerCase()].includes(String(a.asset).toLowerCase()),
);
if (!req) { console.error('no stablecoin (USDG/USDC) requirement in accepts[] — cannot cross-chain pay this endpoint'); process.exit(1); }
const settle = req.network === 'eip155:8453' ? BASE : HOOD;
const origin = settle === BASE ? HOOD : BASE;
const amount = BigInt(req.amount);
console.log(`requirement: ${fmt6(amount)} ${settle.symbol} on ${settle.name} -> ${req.payTo}`);
if (amount > 50_000n) { console.error('refusing: payment above the $0.05 test cap'); process.exit(1); }

// 2. Balances on both chains.
const bal = await balances(account.address);
console.log(`balances: Hood ${fmt6(bal[4663].stable)} USDG + ${(Number(bal[4663].eth) / 1e18).toFixed(6)} ETH | Base ${fmt6(bal[8453].stable)} USDC + ${(Number(bal[8453].eth) / 1e18).toFixed(6)} ETH`);
const haveSettle = bal[settle.id].stable;
const shortfall = FORCE_BRIDGE ? amount : (amount > haveSettle ? amount - haveSettle : 0n);
if (FORCE_BRIDGE) console.log(`force-bridge: bridging full ${fmt6(amount)} ${settle.symbol} from ${origin.name} despite holding ${fmt6(haveSettle)} on ${settle.name}`);

let bridgeTxHashes = [];
let bridgeRequestId = null;
if (shortfall > 0n) {
  // 3. Size + quote the bridge (shortfall + buffer for Relay's ~$0.02 fee).
  let bridgeInput = shortfall + (shortfall / 10n > 30_000n ? shortfall / 10n : 30_000n);
  if (bridgeInput > BigInt(Math.round(MAX_BRIDGE_USD * 1e6))) {
    console.error(`STOP: bridge input ${fmt6(bridgeInput)} ${origin.symbol} exceeds the $${MAX_BRIDGE_USD} test cap — no funds moved`);
    process.exit(2);
  }
  if (bal[origin.id].stable < bridgeInput) {
    console.error(`STOP: short ${fmt6(bridgeInput - bal[origin.id].stable)} ${origin.symbol} on ${origin.name} — wallet holds ${fmt6(bal[origin.id].stable)}, bridge needs ${fmt6(bridgeInput)} (shortfall ${fmt6(shortfall)} ${settle.symbol} + Relay fees). No funds moved.`);
    process.exit(2);
  }
  let quote = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${RELAY}/quote/v2`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: account.address, originChainId: origin.id, destinationChainId: settle.id, originCurrency: origin.stable, destinationCurrency: settle.stable, amount: bridgeInput.toString(), tradeType: 'EXACT_INPUT' }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error(`STOP: Relay quote failed (${r.status}): ${j.message ?? JSON.stringify(j).slice(0, 300)} — no funds moved`);
      process.exit(2);
    }
    quote = j;
    if (BigInt(j.details.currencyOut.minimumAmount) >= shortfall) break;
    bridgeInput += (shortfall - BigInt(j.details.currencyOut.minimumAmount)) + shortfall / 10n + 1n;
    quote = null;
  }
  if (!quote) { console.error('STOP: Relay returned no usable quote — no funds moved'); process.exit(2); }
  bridgeRequestId = quote.requestId;
  console.log(`bridge: ${fmt6(bridgeInput)} ${origin.symbol} -> expected ${fmt6(BigInt(quote.details.currencyOut.amount))} ${settle.symbol} (min ${fmt6(BigInt(quote.details.currencyOut.minimumAmount))}), requestId ${bridgeRequestId}`);

  // 4. Execute the Relay steps (approve if needed, then deposit).
  const wallet = wc(origin);
  for (const step of quote.steps) {
    for (const item of step.items) {
      if (step.id === 'approve') {
        const allowance = await pc(origin).readContract({ address: origin.stable, abi: ERC20, functionName: 'allowance', args: [account.address, item.data.to] });
        if (allowance >= bridgeInput) { console.log('approve: already allowed, skipping'); continue; }
      }
      const tx = { to: item.data.to, data: item.data.data, value: BigInt(item.data.value ?? '0'), chainId: origin.id };
      if (item.data.gas) tx.gas = BigInt(item.data.gas);
      // Relay quotes very generous fee caps (6.7 gwei on Base vs ~0.006
      // gwei live) — cap them at 0.2 gwei max / 0.01 gwei priority so a
      // small wallet is not priced out by the cap itself.
      if (item.data.maxFeePerGas) tx.maxFeePerGas = BigInt(item.data.maxFeePerGas) > 200_000_000n ? 200_000_000n : BigInt(item.data.maxFeePerGas);
      if (item.data.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = BigInt(item.data.maxPriorityFeePerGas) > 10_000_000n ? 10_000_000n : BigInt(item.data.maxPriorityFeePerGas);
      const hash = await wallet.sendTransaction(tx);
      bridgeTxHashes.push(hash);
      console.log(`${step.id} tx: ${hash} ${origin.explorer(hash)}`);
      await pc(origin).waitForTransactionReceipt({ hash, timeout: 60_000 });
    }
  }

  // 5. Poll the Relay intent until the fill lands.
  const deadline = Date.now() + 180_000;
  let status = 'waiting';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await (await fetch(`${RELAY}/intents/status/v3?requestId=${bridgeRequestId}`)).json();
    status = s.status ?? 'unknown';
    if (status === 'success' || status === 'refund' || status === 'failure') break;
  }
  console.log('bridge status:', status);
  if (status !== 'success') { console.error(`STOP: bridge did not land (status ${status}, requestId ${bridgeRequestId}) — not paying`); process.exit(2); }
  const after = await balances(account.address);
  console.log(`after bridge: ${fmt6(after[settle.id].stable)} ${settle.symbol} on ${settle.name}`);
  if (after[settle.id].stable < amount) { console.error('STOP: bridge delivered less than the payment amount — not paying'); process.exit(2); }
} else {
  console.log('no bridge needed — payer already holds enough on the settlement chain');
}

// 6. Sign EIP-3009 on the settlement chain.
const now = Math.floor(Date.now() / 1000);
const validBefore = now + 120;
const nonce = '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
const signature = await account.signTypedData({
  domain: { name: settle.domain.name, version: settle.domain.version, chainId: settle.id, verifyingContract: settle.stable },
  types: { TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ] },
  primaryType: 'TransferWithAuthorization',
  message: { from: account.address, to: req.payTo, value: amount, validAfter: 0n, validBefore: BigInt(validBefore), nonce },
});
console.log('signed EIP-3009, validBefore:', validBefore);

// 7. Settle: GET the product URL with X-PAYMENT.
const payload = {
  x402Version: 2,
  resource: body402.resource ?? req.resource,
  accepted: req,
  payload: { signature, authorization: { from: account.address, to: req.payTo, value: req.amount, validAfter: '0', validBefore: String(validBefore), nonce } },
  ...(body402.extensions ? { extensions: body402.extensions } : {}),
};
const paid = await fetch(URL, { headers: { 'X-PAYMENT': Buffer.from(JSON.stringify(payload)).toString('base64') } });
const paidBody = await paid.json();
console.log('paid status:', paid.status);
console.log('paid body:', JSON.stringify(paidBody).slice(0, 1500));
if (paid.status !== 200 || !paidBody.success) process.exit(1);

console.log('\n=== RECEIPT ===');
console.log(JSON.stringify({
  direction: `${origin.name} -> ${settle.name}`,
  product: URL,
  amountUsd: fmt6(amount),
  bridgeRequestId,
  bridgeTxHashes,
  bridgeTxUrls: bridgeTxHashes.map((h) => origin.explorer(h)),
  settleTxHash: paidBody.transaction ?? null,
  settleTxUrl: paidBody.transaction ? settle.explorer(paidBody.transaction) : null,
  payer: account.address,
}, null, 2));
