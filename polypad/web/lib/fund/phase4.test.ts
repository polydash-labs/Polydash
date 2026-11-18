import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCloseSeason, endTimeFromDays, envAddress, offerAmountIssue, optionalEth, signedPct } from './phase4';

test('phase4 env address parsing', () => {
  assert.equal(envAddress(undefined), null);
  assert.equal(envAddress(''), null);
  assert.equal(envAddress('0x0000000000000000000000000000000000000000'), null);
  assert.equal(envAddress('0x3cd372e32Da71321D795a32b244eAa16724531dB'), '0x3cd372e32da71321d795a32b244eaa16724531db');
});

test('phase4 signed percent', () => {
  assert.equal(signedPct(-125n), '-1.25%');
  assert.equal(signedPct(250), '2.5%');
  assert.equal(signedPct(0n), '0%');
  assert.equal(signedPct(-10000), '-100%');
});

test('phase4 end time limits', () => {
  assert.equal(endTimeFromDays('1', 1000).end, 1000 + 86_400);
  assert.equal(endTimeFromDays('0.5', 0).end, 43_200);
  assert.ok(endTimeFromDays('31', 0).error);
  assert.ok(endTimeFromDays('0', 0).error);
  assert.ok(endTimeFromDays('abc', 0).error);
});

test('phase4 amounts and season close', () => {
  assert.equal(optionalEth('').wei, 0n);
  assert.equal(optionalEth('1').wei, 10n ** 18n);
  assert.ok(optionalEth('x').error);
  assert.ok(offerAmountIssue(1n, null));
  assert.ok(offerAmountIssue(2n * 10n ** 18n, 10n ** 18n));
  assert.equal(offerAmountIssue(10n ** 17n, 10n ** 18n), undefined);
  assert.equal(canCloseSeason(100, 100 + 86_399), false);
  assert.equal(canCloseSeason(100, 100 + 86_400), true);
});
