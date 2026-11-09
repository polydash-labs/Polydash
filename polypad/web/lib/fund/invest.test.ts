import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEther } from 'viem';
import {
  FUND_FACTORY_PHASE3_ADDRESS,
  FUND_INVEST_FACTORY_ADDRESS,
  FUND_SWAP_FACET_PHASE3_ADDRESS,
  PHASE2_SOURCE_COMMIT,
  PHASE3_SOURCE_COMMIT,
  STRATEGY_TEMPLATE_ADDRESS,
  getFundInvestFactoryAddress,
} from './address';
import {
  PROTECTION_BITS,
  ZERO_ADDRESS,
  buildSwap,
  fundProtections,
  parseRouterData,
  parseTokenAmount,
  quotePerToken,
  tapePoints,
} from './invest';

const WETH = '0x0000000000000000000000000000000000000002' as const;
const ALPHA = '0x0000000000000000000000000000000000000003' as const;
const ROUTER = '0x0000000000000000000000000000000000000004' as const;

test('invest factory stays unset until an address is configured', () => {
  const previous = process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS;
  delete process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS;
  assert.equal(getFundInvestFactoryAddress(), null);
  assert.equal(PHASE2_SOURCE_COMMIT, 'e4ceacaab5175bc4e7724fafe3fedc8831085563');
  assert.equal(FUND_INVEST_FACTORY_ADDRESS, '0xd3c6ae470c25989cC8d2876c1855fB570B98894E');
  assert.equal(PHASE3_SOURCE_COMMIT, '0848c9c6271537ad5601415ad9f43fed5280169c');
  assert.equal(STRATEGY_TEMPLATE_ADDRESS, '0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba');
  assert.equal(FUND_SWAP_FACET_PHASE3_ADDRESS, '0x40Ef3ae910A46aDDC14f45F0983060161884f045');
  assert.equal(FUND_FACTORY_PHASE3_ADDRESS, '0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B');
  process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS = '0x0000000000000000000000000000000000000000';
  assert.equal(getFundInvestFactoryAddress(), null);
  process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS = '0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878';
  assert.equal(getFundInvestFactoryAddress(), null);
  process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS = 'not-an-address';
  assert.equal(getFundInvestFactoryAddress(), null);
  process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS = '0x0000000000000000000000000000000000000005';
  assert.equal(getFundInvestFactoryAddress(), '0x0000000000000000000000000000000000000005');
  if (previous === undefined) delete process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS;
  else process.env.NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS = previous;
});

test('phase 1 protections count custody, source, and skin only', () => {
  const waiting = fundProtections({ bits: null, skinMet: false });
  assert.equal(waiting.total, 6);
  assert.equal(waiting.met, 2);
  assert.equal(waiting.rows.find((row) => row.id === 'hwm')?.met, false);
  assert.equal(waiting.rows.find((row) => row.id === 'allowlist')?.met, false);
  const open = fundProtections({ bits: null, skinMet: true });
  assert.equal(open.met, 3);
  assert.equal(open.rows.find((row) => row.id === 'skin')?.met, true);
});

test('phase 2 bits score what the vault returns and leave the high-water mark off', () => {
  const bits = PROTECTION_BITS.custody | PROTECTION_BITS.allowlist | PROTECTION_BITS.skin | PROTECTION_BITS.source | PROTECTION_BITS.timelock;
  const scored = fundProtections({ bits, skinMet: false });
  assert.equal(scored.met, 5);
  assert.equal(scored.rows.find((row) => row.id === 'hwm')?.met, false);
  assert.equal(scored.rows.find((row) => row.id === 'allowlist')?.met, true);
  assert.match(scored.rows.find((row) => row.id === 'source')?.detail ?? '', /Unaudited/);
  const withMark = fundProtections({ bits: bits | PROTECTION_BITS.hwm, skinMet: true });
  assert.equal(withMark.rows.find((row) => row.id === 'hwm')?.met, true);
  assert.equal(withMark.met, 6);
});

test('nav tape keeps trade order and appends the current figure', () => {
  const rows = tapePoints(
    [{ t: 20, nav: 2n }, { t: 10, nav: 1n }],
    { t: 30, nav: 2n },
  );
  assert.deepEqual(rows.map((row) => row.t), [10, 20, 30]);
  const same = tapePoints([{ t: 30, nav: 2n }], { t: 30, nav: 2n });
  assert.equal(same.length, 1);
});

test('quote per token scales with decimals', () => {
  assert.equal(quotePerToken(parseEther('2'), 18), parseEther('2'));
  assert.equal(quotePerToken(parseEther('2'), 6), parseEther('2') / 10n ** 12n);
});

test('swap builder uses the allowlist shape and a 1:1 wrap minimum', () => {
  const wrap = buildSwap({
    mode: 'wrap', quote: 'eth', weth: WETH, asset: ALPHA, router: ROUTER, amountIn: parseEther('0.2'), minAmountOut: 1n, data: '0xabcd',
  });
  assert.equal(wrap.ok, true);
  if (!wrap.ok) return;
  assert.equal(wrap.call.router, ZERO_ADDRESS);
  assert.equal(wrap.call.assetIn, ZERO_ADDRESS);
  assert.equal(wrap.call.assetOut, WETH);
  assert.equal(wrap.call.minAmountOut, parseEther('0.2'));
  assert.equal(wrap.call.data, '0x');

  const buy = buildSwap({
    mode: 'buy', quote: 'eth', weth: WETH, asset: ALPHA, router: ROUTER, amountIn: parseEther('1'), minAmountOut: 5n, data: '0x',
  });
  assert.equal(buy.ok, true);
  if (!buy.ok) return;
  assert.equal(buy.call.assetIn, ZERO_ADDRESS);
  assert.equal(buy.call.assetOut, ALPHA);
  assert.equal(buy.call.router, ROUTER);

  const missing = buildSwap({
    mode: 'sell', quote: 'weth', weth: WETH, asset: ALPHA, router: '', amountIn: 1n, minAmountOut: 1n, data: '0x',
  });
  assert.equal(missing.ok, false);
});

test('amount and router data parsing stay strict', () => {
  assert.equal(parseTokenAmount('1.5', 18).ok, true);
  assert.equal(parseTokenAmount('1.55', 1).ok, false);
  assert.equal(parseTokenAmount('0', 18).ok, false);
  const blank = parseRouterData('');
  assert.equal(blank.ok, true);
  if (blank.ok) assert.equal(blank.data, '0x');
  assert.equal(parseRouterData('0xzz').ok, false);
  const hex = parseRouterData('0xabcd');
  assert.equal(hex.ok, true);
  if (hex.ok) assert.equal(hex.data, '0xabcd');
});
