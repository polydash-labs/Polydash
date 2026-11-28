// Agent-earn board checks — pure logic only, no chain, no DB, no keys.
//   npx tsx scripts/verify-agent-earn.ts
// Exit code 0 when every check passes, 1 otherwise.
// Covers: fee math (the $10 → $9.75 / $50 → $48.75 cases from the brief),
// USDG formatting, unpredictable job IDs, panel split rules, the dispute
// countdown, the seeded panel draw, and the receipt builder (net payout,
// fee from feeBpsAtLock, ballots published).

import { netPayout, feeOn, formatUsdg, usdToUsdgUnits, validatePanelSplit, formatCountdown, disputeSecondsLeft } from '../lib/earn/fees';
import { deriveJobId, newJobNonce, isValidJobId } from '../lib/earn/job-id';
import { drawPanel } from '../lib/earn/eligibility';
import { buildJobReceipt, briefHash, type JobBallot } from '../lib/earn/receipt';
import { AGENT_EARN_FEE_BPS } from '../lib/earn/constants';
import type { AgentEarnJob } from '@prisma/client';
import type { EscrowLock } from '../lib/earn/abi';

let failures = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) console.log('ok:', name);
  else {
    failures += 1;
    console.error('FAIL:', name, detail ?? '');
  }
};
const eq = (a: unknown, b: unknown) => a === b;

// --- Fee math (brief §2.1) ---
const ten = netPayout(10_000_000n, AGENT_EARN_FEE_BPS);
check('$10 job: fee $0.25', eq(ten.fee, 250_000n), `got ${ten.fee}`);
check('$10 job: net $9.75', eq(ten.net, 9_750_000n), `got ${ten.net}`);
const fifty = netPayout(50_000_000n, AGENT_EARN_FEE_BPS);
check('$50 job: fee $1.25', eq(fifty.fee, 1_250_000n));
check('$50 job: net $48.75', eq(fifty.net, 48_750_000n));
check('No fee at 0 bps', eq(feeOn(10_000_000n, 0), 0n));
check('No fee on zero gross', eq(feeOn(0n, 250), 0n));
check('Fee rounds down like Solidity', eq(feeOn(999_999n, 250), 24_999n));

// --- Formatting ---
check('format $9.75', formatUsdg(9_750_000n) === '$9.75', formatUsdg(9_750_000n));
check('format $0.25', formatUsdg(250_000n) === '$0.25');
check('format $48.75', formatUsdg(48_750_000n) === '$48.75');
check('$10 → 10,000,000 units', eq(usdToUsdgUnits(10), 10_000_000n));
check('$25 → 25,000,000 units', eq(usdToUsdgUnits(25), 25_000_000n));

// --- Job IDs (brief §2.4) ---
const poster = '0x9a21c75aC263cC43125E70200636f6397f8776d0' as `0x${string}`;
const n1 = newJobNonce();
const n2 = newJobNonce();
check('Nonces are 32 random bytes', isValidJobId(n1) && isValidJobId(n2) && n1 !== n2);
const id1 = deriveJobId(poster, n1);
check('JobId is a 32-byte hash', isValidJobId(id1));
check('JobId is deterministic for poster+nonce', deriveJobId(poster, n1) === id1);
check('Different nonces give different jobIds', deriveJobId(poster, n1) !== deriveJobId(poster, n2));
check('Different posters give different jobIds', deriveJobId('0x0000000000000000000000000000000000000001' as `0x${string}`, n1) !== id1);
check('Short values are not jobIds', !isValidJobId('0x1234') && !isValidJobId('job-1'));

// --- Panel split rules (contract panelResolve) ---
check('PayFull needs 10000', validatePanelSplit('PayFull', 10_000, 10_000_000n) === null);
check('PayFull rejects 9999', validatePanelSplit('PayFull', 9_999, 10_000_000n) !== null);
check('NoPay needs 0', validatePanelSplit('NoPay', 0, 10_000_000n) === null);
check('NoPay rejects 1', validatePanelSplit('NoPay', 1, 10_000_000n) !== null);
check('PayPart 5000 ok', validatePanelSplit('PayPart', 5_000, 10_000_000n) === null);
check('PayPart rejects 0', validatePanelSplit('PayPart', 0, 10_000_000n) !== null);
check('PayPart rejects 10000', validatePanelSplit('PayPart', 10_000, 10_000_000n) !== null);

// --- Dispute countdown ---
check('72h window: 1h left formats', formatCountdown(3600) === '1h 0m left', formatCountdown(3600));
check('72h window: 2d left formats', formatCountdown(2 * 86400 + 4 * 3600) === '2d 4h left');
check('Expired formats', formatCountdown(0) === 'expired' && formatCountdown(-5) === 'expired');
check('disputeSecondsLeft: 71h left after 1h', disputeSecondsLeft(1_000_000, 1_000_000 + 3600) === 71 * 3600);

// --- Seeded panel draw (auditable) ---
const pool = [1, 2, 3, 4, 5];
const d1 = drawPanel(pool, '0x00000000000000000000000000000000000000000000000000000000abcdef01' as `0x${string}`);
const d2 = drawPanel(pool, '0x00000000000000000000000000000000000000000000000000000000abcdef01' as `0x${string}`);
check('Draw returns 3 evaluators', d1.drawn.length === 3);
check('Draw is reproducible from the seed', JSON.stringify(d1.drawn) === JSON.stringify(d2.drawn));
check('Drawn are all from the pool', d1.drawn.every((id) => pool.includes(id)));
check('Drawn are distinct', new Set(d1.drawn).size === 3);
const d3 = drawPanel(pool);
check('Draw without a seed returns a seed', isValidJobId(d3.seed) || /^0x[0-9a-f]{32}$/.test(d3.seed));

// --- Receipt builder (brief §1.7 + §2.1 + §2.3) ---
const fixtureJob = {
  id: id1,
  poster: poster.toLowerCase(),
  posterNonce: n1,
  title: 'Stablecoin flows, Nov 2026',
  topic: 'Robinhood Chain stablecoin flows',
  researchQuestions: 'How much USDG moved in November?',
  format: 'Written report.',
  sourceConstraints: 'On-chain only.',
  acceptanceCriteria: 'Numbers checkable on the explorer.',
  priceUsdg: 10_000_000n,
  deadline: new Date('2026-12-10T00:00:00.000Z'),
  status: 'settled',
  screeningReason: null,
  screenedAt: new Date('2026-11-27T10:00:00.000Z'),
  lockTxHash: '0x' + '11'.repeat(32),
  claimTxHash: '0x' + '22'.repeat(32),
  claimedByAgentId: 2,
  claimedByWallet: '0x825E0D093D584b3dc0E28AFC1Bebf39a95B693Da',
  deliverTxHash: '0x' + '33'.repeat(32),
  deliverableHash: '0x' + '44'.repeat(32),
  deliverableText: 'Report text.',
  deliveredAt: new Date('2026-11-28T10:00:00.000Z'),
  disputeReasons: null,
  disputedAt: null,
  panelSeed: null,
  panelPool: null,
  panelDrawn: null,
  panelDrawnAt: null,
  ballots: [
    { agentId: 2, name: 'Astro Trader', wallet: '0x0000000000000000000000000000000000000002', vote: 'PayFull', at: '2026-11-29T10:00:00.000Z' },
    { agentId: 3, name: 'Fund Ledger', wallet: '0x0000000000000000000000000000000000000003', vote: 'PayFull', at: '2026-11-29T10:00:00.000Z' },
    { agentId: 4, name: 'Signal Reporter', wallet: '0x0000000000000000000000000000000000000004', vote: 'PayFull', at: '2026-11-29T10:00:00.000Z' },
  ] as JobBallot[],
  panelOutcome: 'PayFull',
  panelSplitBps: 10_000,
  panelTxHash: '0x' + '55'.repeat(32),
  releaseTxHash: null,
  refundTxHash: null,
  settledAt: new Date('2026-11-29T12:00:00.000Z'),
  timeline: [
    { type: 'created', at: '2026-11-27T09:00:00.000Z' },
    { type: 'locked', at: '2026-11-27T10:00:00.000Z', txHash: '0x' + '11'.repeat(32) },
    { type: 'claimed', at: '2026-11-27T11:00:00.000Z', txHash: '0x' + '22'.repeat(32) },
    { type: 'delivered', at: '2026-11-28T10:00:00.000Z', txHash: '0x' + '33'.repeat(32) },
  ],
  createdAt: new Date('2026-11-27T09:00:00.000Z'),
  updatedAt: new Date('2026-11-29T12:00:00.000Z'),
} as unknown as AgentEarnJob;

const fixtureLock: EscrowLock = {
  poster: poster.toLowerCase(),
  agent: '0x825E0D093D584b3dc0E28AFC1Bebf39a95B693Da',
  assignee: '0x825E0D093D584b3dc0E28AFC1Bebf39a95B693Da',
  amount: 10_000_000n,
  state: 4,
  lockedAt: 1795790000n,
  claimedAt: 1795793600n,
  deliverableHash: '0x' + '44'.repeat(32),
  deliveredAt: 1795876800n,
  feeBpsAtLock: 250,
  settledAt: 1795963200n,
  outcome: 1,
  agentShare: 10_000_000n,
  posterShare: 0n,
  feePaid: 250_000n,
};

const h1 = briefHash(fixtureJob);
const h2 = briefHash(fixtureJob);
check('Brief hash is stable', h1 === h2 && isValidJobId(h1));
const receipt = buildJobReceipt(fixtureJob, fixtureLock, [], 'settled');
check('Receipt format', receipt.receiptFormat === 'polypad.agent-earn-receipt/1');
check('Receipt shows net $9.75 (not gross)', receipt.settlement.netToAgent === '$9.75', receipt.settlement.netToAgent ?? '');
check('Receipt shows fee $0.25 from feeBpsAtLock', receipt.settlement.fee === '$0.25' && receipt.settlement.feeBpsAtLock === 250);
check('Receipt shows outcome PayFull', receipt.settlement.outcome === 'PayFull');
check('Receipt publishes all 3 ballots', receipt.action.panel?.ballots.length === 3);
check('Receipt carries the deliverable hash', receipt.action.deliverableHash === '0x' + '44'.repeat(32));
check('Receipt links the escrow', receipt.escrow === '0xb0A3fE7240a0b1a10177651FE985c3FDbB9dda7c');
check('Receipt timeline preserved', receipt.timeline.length === 4);

// Open job: expected net shown, no settlement yet.
const openJob = { ...fixtureJob, status: 'locked', panelTxHash: null, releaseTxHash: null, refundTxHash: null, panelOutcome: null, panelSplitBps: null } as AgentEarnJob;
const openReceipt = buildJobReceipt(openJob, { ...fixtureLock, state: 1, settledAt: 0n, outcome: 0, agentShare: 0n, posterShare: 0n, feePaid: 0n }, [], 'locked');
check('Open job receipt shows expected net $9.75', openReceipt.settlement.netToAgent === '$9.75');
check('Open job receipt has no settlement tx', openReceipt.settlement.txHash === null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll agent-earn checks passed.');
}
