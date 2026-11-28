// Fund the test buyer wallet on Robinhood Chain from its OWN Base holdings
// via Relay (one-off setup for cross-chain Test 1). No other wallet touched.
//
// Usage:
//   node x402-fund-hood.mjs --key-file <path> [--eth-wei 30000000000000] [--usdc 70000]
//
// Legs (both Base 8453 -> Hood 4663, same wallet both sides):
//   1. ETH for Hood gas (default 0.00003 ETH; Relay takes a ~$0.021 flat fee,
//      so ~0.0000177 ETH lands — ~4x the ~0.000004 ETH the Test 1 bridge txs need)
//   2. USDC for the Test 1 bridge input (default $0.07 -> ~$0.0468 USDG;
//      Test 1 needs $0.04 USDG input, so this leaves ~$0.007 buffer)
// Stops (no funds moved for that leg) when a quote is missing, absurd, or
// the minimum output is below the floor. Key read transiently, never logged.
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter(([k]) => k),
);
const KEY_FILE = args['key-file'];
const ETH_WEI = BigInt(args['eth-wei'] ?? '30000000000000'); // 0.00003 ETH
const USDC_UNITS = BigInt(args['usdc'] ?? '70000'); // $0.07
if (!KEY_FILE) { console.error('usage: node x402-fund-hood.mjs --key-file <path> [--eth-wei N] [--usdc N]'); process.exit(1); }

const HOOD = { id: 4663, name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', stable: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', symbol: 'USDG', explorer: (h) => `https://robinhoodchain.blockscout.com/tx/${h}` };
const BASE = { id: 8453, name: 'Base', rpc: 'https://mainnet.base.org', stable: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', explorer: (h) => `https://basescan.org/tx/${h}` };
const ZERO = '0x0000000000000000000000000000000000000000';
const RELAY = 'https://api.relay.link';
const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
]);

function loadKey(path) {
  const raw = fs.readFileSync(path, 'utf8');
  let value;
  if (raw.trim().startsWith('{')) value = JSON.parse(raw).privateKey;
  else {
    const line = raw.split('\n').find((l) => /PRIVATE_KEY=/.test(l));
    if (!line) throw new Error('no PRIVATE_KEY found in key file');
    value = line.split('=')[1].trim().replace(/^["']|["']$/g, '');
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) value = `0x${value}`;
  return value;
}

const key = loadKey(KEY_FILE);
const account = privateKeyToAccount(key);
console.log('payer:', account.address);

function viemChain(c) {
  return defineChain({ id: c.id, name: c.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [c.rpc] } } });
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

async function runLeg({ label, originCurrency, destinationCurrency, amount, minOutFloor, isNative }) {
  console.log(`\n--- ${label}: ${amount.toString()} ---`);
  const r = await fetch(`${RELAY}/quote/v2`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: account.address, originChainId: BASE.id, destinationChainId: HOOD.id, originCurrency, destinationCurrency, amount: amount.toString(), tradeType: 'EXACT_INPUT' }),
    signal: AbortSignal.timeout(8000),
  });
  const quote = await r.json();
  if (!r.ok || !quote.details) {
    console.error(`STOP: Relay quote failed (${r.status}): ${quote.message ?? JSON.stringify(quote).slice(0, 300)} — no funds moved`);
    process.exit(2);
  }
  const out = BigInt(quote.details.currencyOut.amount);
  const minOut = BigInt(quote.details.currencyOut.minimumAmount);
  console.log(`quote: out ${out.toString()} (min ${minOut.toString()}), requestId ${quote.requestId}`);
  if (minOut < minOutFloor) {
    console.error(`STOP: min output ${minOut.toString()} below floor ${minOutFloor.toString()} — no funds moved`);
    process.exit(2);
  }
  const wallet = wc(BASE);
  const txHashes = [];
  for (const step of quote.steps) {
    for (const item of step.items) {
      if (step.id === 'approve' && !isNative) {
        const allowance = await pc(BASE).readContract({ address: BASE.stable, abi: ERC20, functionName: 'allowance', args: [account.address, item.data.to] });
        if (allowance >= amount) { console.log('approve: already allowed, skipping'); continue; }
      }
      const tx = { to: item.data.to, data: item.data.data, value: BigInt(item.data.value ?? '0'), chainId: BASE.id };
      if (item.data.gas) tx.gas = BigInt(item.data.gas);
      if (item.data.maxFeePerGas) tx.maxFeePerGas = BigInt(item.data.maxFeePerGas) > 200_000_000n ? 200_000_000n : BigInt(item.data.maxFeePerGas);
      if (item.data.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = BigInt(item.data.maxPriorityFeePerGas) > 10_000_000n ? 10_000_000n : BigInt(item.data.maxPriorityFeePerGas);
      const hash = await wallet.sendTransaction(tx);
      txHashes.push(hash);
      console.log(`${step.id} tx: ${hash} ${BASE.explorer(hash)}`);
      await pc(BASE).waitForTransactionReceipt({ hash, timeout: 60_000 });
    }
  }
  const deadline = Date.now() + 180_000;
  let status = 'waiting';
  while (Date.now() < deadline) {
    await new Promise((r2) => setTimeout(r2, 2000));
    const s = await (await fetch(`${RELAY}/intents/status/v3?requestId=${quote.requestId}`)).json();
    status = s.status ?? 'unknown';
    if (status === 'success' || status === 'refund' || status === 'failure') break;
  }
  console.log('bridge status:', status);
  if (status !== 'success') { console.error(`STOP: bridge did not land (status ${status}, requestId ${quote.requestId})`); process.exit(2); }
  return { requestId: quote.requestId, txHashes, out: out.toString() };
}

const before = await balances(account.address);
console.log(`before: Hood $${(Number(before[4663].stable) / 1e6).toFixed(4)} USDG + ${(Number(before[4663].eth) / 1e18).toFixed(6)} ETH | Base $${(Number(before[8453].stable) / 1e6).toFixed(4)} USDC + ${(Number(before[8453].eth) / 1e18).toFixed(6)} ETH`);

const results = {};
// Leg 1: ETH for Hood gas. Floor: 1e-5 ETH landing (2.5x the ~4e-6 ETH the Test 1 bridge txs need).
results.eth = await runLeg({ label: 'ETH Base -> Hood (gas)', originCurrency: ZERO, destinationCurrency: ZERO, amount: ETH_WEI, minOutFloor: 10_000_000_000_000n, isNative: true });
// Leg 2: USDC for the Test 1 bridge input. Floor: $0.042 USDG landing (Test 1 needs $0.04 input).
results.usdc = await runLeg({ label: 'USDC Base -> Hood (Test 1 input)', originCurrency: BASE.stable, destinationCurrency: HOOD.stable, amount: USDC_UNITS, minOutFloor: 42_000n, isNative: false });

const after = await balances(account.address);
console.log(`\nafter: Hood $${(Number(after[4663].stable) / 1e6).toFixed(4)} USDG + ${(Number(after[4663].eth) / 1e18).toFixed(6)} ETH | Base $${(Number(after[8453].stable) / 1e6).toFixed(4)} USDC + ${(Number(after[8453].eth) / 1e18).toFixed(6)} ETH`);
console.log('\n=== FUNDING RECEIPT ===');
console.log(JSON.stringify({ payer: account.address, eth: results.eth, usdc: results.usdc }, null, 2));
