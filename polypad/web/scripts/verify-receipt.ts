// CLI for the receipt verifier. Third parties can run it with only a receipt
// JSON file and a public RPC — no key, no private data.
//
//   npx tsx scripts/verify-receipt.ts public/receipts/agent-score-posted-1-0x552d903e.json
//   npx tsx scripts/verify-receipt.ts <receipt.json> --rpc https://rpc.mainnet.chain.robinhood.com
//
// Exit code 0 when the receipt verifies, 1 otherwise.
import { readFileSync } from 'node:fs';
import { verifyReceipt, type VerificationResult } from '../lib/receipts/verifier';
import type { AgentReceipt } from '../lib/receipts/types';

function usage(): never {
  console.error('Usage: npx tsx scripts/verify-receipt.ts <receipt.json> [--rpc <url>]');
  process.exit(2);
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const rpcIdx = args.indexOf('--rpc');
const rpcUrl = rpcIdx >= 0 ? args[rpcIdx + 1] : undefined;
if (!file) usage();

const receipt = JSON.parse(readFileSync(file, 'utf8')) as AgentReceipt;

function printResult(result: VerificationResult) {
  console.log(`\nReceipt: ${result.receiptId} (${result.actionType})`);
  console.log(`Checked: ${result.checkedAt} via ${result.rpcUrl}`);
  console.log(`Verdict: ${result.verdict.toUpperCase()}\n`);
  const bySection = new Map<string, typeof result.checks>();
  for (const c of result.checks) {
    const list = bySection.get(c.section) ?? [];
    list.push(c);
    bySection.set(c.section, list);
  }
  for (const [section, list] of bySection) {
    console.log(`[${section}]`);
    for (const c of list) {
      const mark = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : 'SKIP';
      console.log(`  ${mark} ${c.id} — ${c.label}`);
      if (c.status !== 'pass') {
        if (c.expected !== undefined) console.log(`       expected: ${c.expected}`);
        if (c.actual !== undefined) console.log(`       actual:   ${c.actual}`);
      }
      if (c.detail) console.log(`       ${c.detail}`);
    }
    console.log('');
  }
  const passed = result.checks.filter((c) => c.status === 'pass').length;
  console.log(`${passed}/${result.checks.length} checks passed.`);
}

async function main() {
  const result = await verifyReceipt(receipt, rpcUrl ? { rpcUrl } : undefined);
  printResult(result);
  process.exit(result.verdict === 'verified' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
