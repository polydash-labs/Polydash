import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUND_FACTORY_PHASE3,
  FUND_FACTORY_V2,
  GROWTH_FEE_OPTIONS,
  POLYDASH_TOKEN,
  TEMPLATE2,
  growthLines,
  isGrowthTemplate,
  isMomentumTemplate,
  matchesGrowthStrategy,
  momentumLines,
  allowlistLabel,
  capOf,
  checkThesisUri,
  clampThesis,
  countdownLabel,
  factoryForTemplate,
  holdingsBps,
  ipfsToHttp,
  phase6TxError,
  templateTitle,
  trackRecord,
  yieldLines,
  type ProposalView,
} from './phase6';
import { FUND_FACTORY_V3 } from './phase7';

test('template 2 uses the V2 factory, others the Phase 3 factory', () => {
  assert.equal(factoryForTemplate(2), FUND_FACTORY_V2);
  assert.equal(factoryForTemplate(1), FUND_FACTORY_PHASE3);
  assert.equal(templateTitle(2), 'Polydash Growth Tokenized Fund');
  assert.equal(templateTitle(1), 'Strategy #1');
});

test('strategies 10 and 11 route to their factories and carry names', () => {
  assert.equal(factoryForTemplate(10), FUND_FACTORY_V3);
  assert.equal(factoryForTemplate(11), FUND_FACTORY_V2);
  assert.equal(templateTitle(10), 'Polydash Yield Tokenized Fund');
  assert.equal(templateTitle(11), 'Polydash Momentum Tokenized Fund');
  assert.equal(isMomentumTemplate(11), true);
  assert.equal(isMomentumTemplate(10), false);
  assert.ok(yieldLines().join(' ').includes('compounded'));
  assert.ok(momentumLines().join(' ').includes('2-day wait'));
});

test('growth fee choice maps fees to templates on the V2 factory', () => {
  assert.deepEqual(GROWTH_FEE_OPTIONS.map((o) => [o.feeBps, o.templateId]), [[0, 3], [500, 2], [1000, 4], [2000, 5]]);
  for (const id of [2, 3, 4, 5]) { assert.equal(factoryForTemplate(id), FUND_FACTORY_V2); assert.equal(isGrowthTemplate(id), true); }
  assert.equal(isGrowthTemplate(1), false);
  assert.equal(growthLines(500).join('|'), [...TEMPLATE2.lines].join('|'));
  assert.ok(growthLines(0).includes('No performance fee (0%)'));
  assert.ok(growthLines(2000).includes('20% performance fee on new gains only'));
  const base = { assets: [POLYDASH_TOKEN], maxPositionBps: 8000, maxTradeBps: 1000, maxDeviationBps: 500, maxDrawdownBps: 2000, skinLock: 2_592_000 };
  assert.equal(matchesGrowthStrategy({ ...base, id: 3, hwmFeeBps: 0 }), true);
  assert.equal(matchesGrowthStrategy({ ...base, id: 4, hwmFeeBps: 500 }), false);
});

test('countdown label', () => {
  assert.equal(countdownLabel(0), 'Wait is over');
  assert.equal(countdownLabel(-5), 'Wait is over');
  assert.equal(countdownLabel(172_800), '2d 00h 00m 00s');
  assert.equal(countdownLabel(90_061), '1d 01h 01m 01s');
});

test('thesis is clamped to 3 lines and 512 bytes', () => {
  assert.equal(clampThesis('a\nb\nc\nd'), 'a\nb\nc');
  assert.ok(new TextEncoder().encode(clampThesis('x'.repeat(900))).length <= 512);
});

test('write-up link checks', () => {
  assert.ok(checkThesisUri(''));
  assert.ok(checkThesisUri('http://x'));
  assert.equal(checkThesisUri('ipfs://bafy123'), null);
  assert.equal(ipfsToHttp('ipfs://bafybeidy4qmoeg2mo4xz2czni7pxgmycv4ttsxt2spgif7pxzp2tv4zmki'), 'https://dweb.link/ipfs/bafybeidy4qmoeg2mo4xz2czni7pxgmycv4ttsxt2spgif7pxzp2tv4zmki');
  assert.equal(ipfsToHttp('ipfs://phase3-quote'), '');
  assert.equal(ipfsToHttp('javascript:alert(1)'), '');
});

test('holdings percentages', () => {
  assert.deepEqual(holdingsBps([1n, 3n]), [2500, 7500]);
  assert.deepEqual(holdingsBps([0n, 0n]), [0, 0]);
  assert.equal(capOf(0), 3000);
  assert.equal(capOf(1500), 1500);
});

test('track record counts', () => {
  const p = (status: number, kind = 0): ProposalView => ({ id: 1, asset: '0x0', capBps: 0, reason: '', thesisUri: '', readyAt: 0, status, kind });
  assert.deepEqual(trackRecord([p(0), p(1), p(1, 1), p(2)]), { total: 4, added: 1, removed: 1, cancelled: 1, waiting: 1 });
});

test('allowlist label and errors', () => {
  assert.equal(allowlistLabel({ allowed: true, allowlistAt: null, address: '0x1' }), 'On the approved list');
  assert.equal(allowlistLabel({ allowed: false, allowlistAt: null, address: POLYDASH_TOKEN }), 'On the approved list');
  assert.match(phase6TxError('TooEarly()'), /2-day/);
});
