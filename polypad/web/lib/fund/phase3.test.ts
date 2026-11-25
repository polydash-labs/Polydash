import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PHASE3_DRAFT, brakeActive, checkPhase3Draft, claimableTotal, drawdownBps, templateLine } from './phase3';

test('phase3 draft defaults need a name, ticker and template', () => {
  const r = checkPhase3Draft(DEFAULT_PHASE3_DRAFT);
  assert.deepEqual(r.issues.map((i) => i.field).sort(), ['name', 'symbol', 'templateId']);
  assert.equal(r.preview?.maxSupply, 100n);
  assert.equal(r.preview?.skinRequired, 5n);
});

test('phase3 params match factory rules', () => {
  const r = checkPhase3Draft({ ...DEFAULT_PHASE3_DRAFT, name: 'A', symbol: 'A', templateId: 1, skinBps: 1000, entryFeeBps: 100 });
  assert.ok(r.params);
  assert.equal(r.params!.minSkinBps, 1000n);
  assert.equal(r.params!.raiseDuration, 7n * 86_400n);
  const d = checkPhase3Draft({ ...DEFAULT_PHASE3_DRAFT, name: 'A', symbol: 'A', templateId: 1 });
  assert.equal(d.params!.minSkinBps, 0n);
  const big = checkPhase3Draft({ ...DEFAULT_PHASE3_DRAFT, name: 'A', symbol: 'A', templateId: 1, mintPriceEth: '0.0001', raiseCapEth: '2' });
  assert.ok(big.issues.some((i) => i.field === 'raiseCapEth'));
});

test('drawdown and claimable math', () => {
  assert.equal(drawdownBps(100n, 80n), 2000);
  assert.equal(drawdownBps(0n, 80n), 0);
  assert.equal(brakeActive(2000, 2000), true);
  assert.equal(brakeActive(0, 9000), false);
  assert.equal(claimableTotal([5n, 7n], [[false, true], [false, false]]), 19n);
});

test('template line is plain', () => {
  const line = templateLine({ id: 1, mandateHash: '0x00', mandateUri: '', maxPositionBps: 0, maxTradeBps: 0, maxDeviationBps: 0, hwmFeeBps: 1000, maxDrawdownBps: 2000, skinLock: 30 * 86_400, assets: [] });
  assert.equal(line, 'Holds ETH and WETH only, 10% fee on new gains only, new buys pause after a 20% drop, manager shares locked 30 days.');
  const capped = templateLine({ id: 1, mandateHash: '0x00', mandateUri: '', maxPositionBps: 3000, maxTradeBps: 3000, maxDeviationBps: 0, hwmFeeBps: 500, maxDrawdownBps: 2000, skinLock: 7 * 86_400, assets: [] });
  assert.equal(capped, 'Holds ETH and WETH only, max 30% of the tokenized fund in one position or one trade, 5% fee on new gains only, new buys pause after a 20% drop, manager shares locked 7 days.');
  const split = templateLine({ id: 2, mandateHash: '0x00', mandateUri: '', maxPositionBps: 3000, maxTradeBps: 1000, maxDeviationBps: 0, hwmFeeBps: 500, maxDrawdownBps: 2000, skinLock: 7 * 86_400, assets: [] });
  assert.ok(split.includes('max 30% of the tokenized fund in one position and 10% in one trade'));
});
