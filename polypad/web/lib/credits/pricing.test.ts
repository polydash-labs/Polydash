import assert from 'node:assert/strict';
import test from 'node:test';
import { centsFromUsd6, isFresh, polydashWethFromSqrtPrice, usd6FromWei } from './pricing';

const ETHER = 10n ** 18n;
const Q96 = 2n ** 96n;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The same math as lib/total-tvl.ts, written the way total-tvl states it:
 * WETH per POLYDASH = (2^96 / sqrtPriceX96)^2, so
 * wethWei = polydashWei * (2^96)^2 / sqrtPriceX96^2.
 * polydashWethFromSqrtPrice states it as amount * 2^192 / sqrtPriceX96^2 —
 * the two must agree exactly.
 */
function totalTvlWeth(sqrtPriceX96: bigint, amountWei: bigint): bigint {
  return (amountWei * Q96 * Q96) / (sqrtPriceX96 * sqrtPriceX96);
}

test('sqrtPriceX96 = 2^96 means 1 POLYDASH = 1 WETH (matches total-tvl math)', () => {
  // sqrtPriceX96 = 2^96 -> (2^96 / 2^96)^2 = 1, so 1 POLYDASH buys 1 WETH.
  assert.equal(polydashWethFromSqrtPrice(Q96, ETHER), ETHER);
  assert.equal(polydashWethFromSqrtPrice(Q96, ETHER), totalTvlWeth(Q96, ETHER));
});

test('sqrtPriceX96 hand-computed ratios: 2^97 -> 1/4, 3*2^96 -> 1/9', () => {
  // sqrtPriceX96 = 2^97 -> (2^96 / 2^97)^2 = (1/2)^2 = 1/4.
  // 4 POLYDASH -> 1 WETH.
  assert.equal(polydashWethFromSqrtPrice(2n * Q96, 4n * ETHER), ETHER);
  assert.equal(polydashWethFromSqrtPrice(2n * Q96, 4n * ETHER), totalTvlWeth(2n * Q96, 4n * ETHER));
  // sqrtPriceX96 = 3 * 2^96 -> (1/3)^2 = 1/9. 9 POLYDASH -> 1 WETH.
  assert.equal(polydashWethFromSqrtPrice(3n * Q96, 9n * ETHER), ETHER);
  assert.equal(polydashWethFromSqrtPrice(3n * Q96, 9n * ETHER), totalTvlWeth(3n * Q96, 9n * ETHER));
});

test('sqrtPriceX96 edge cases: zero price, zero amount, sqrtPriceX96 = 1', () => {
  assert.equal(polydashWethFromSqrtPrice(0n, ETHER), 0n);
  assert.equal(polydashWethFromSqrtPrice(Q96, 0n), 0n);
  // sqrtPriceX96 = 1 -> amount * 2^192 / 1.
  assert.equal(polydashWethFromSqrtPrice(1n, 1n), 2n ** 192n);
});

test('doubling sqrtPriceX96 quarters the WETH out', () => {
  const amount = 8n * ETHER;
  const atBase = polydashWethFromSqrtPrice(Q96, amount);
  const atDouble = polydashWethFromSqrtPrice(2n * Q96, amount);
  assert.equal(atBase, amount);
  assert.equal(atDouble, amount / 4n);
});

test('usd6FromWei: 1 ETH at $2000 is $2000.000000', () => {
  assert.equal(usd6FromWei(ETHER, 2000), 2_000_000_000n);
  assert.equal(usd6FromWei(ETHER / 2n, 2000), 1_000_000_000n);
});

test('usd6FromWei: POLYDASH-scale dust price keeps 12-dp precision', () => {
  // 1 POLYDASH at $0.000000194 is worth $0.000000194 = 0.194 usd6 units,
  // which floors to 0 — but the 12-dp price must survive: at 6 dp the
  // price itself would round to $0 and even a huge amount would be 0.
  assert.equal(usd6FromWei(ETHER, 0.000000194), 0n);
  // 10 POLYDASH = $0.00000194 -> 1.94 usd6 units -> 1n (floored).
  assert.equal(usd6FromWei(10n * ETHER, 0.000000194), 1n);
  // 1,000,000 POLYDASH = $0.194 -> 194_000 usd6 units.
  assert.equal(usd6FromWei(10n ** 24n, 0.000000194), 194_000n);
});

test('usd6FromWei: invalid or too-small prices credit nothing', () => {
  assert.equal(usd6FromWei(ETHER, 0), 0n);
  assert.equal(usd6FromWei(ETHER, -5), 0n);
  assert.equal(usd6FromWei(ETHER, Number.NaN), 0n);
  assert.equal(usd6FromWei(ETHER, Number.POSITIVE_INFINITY), 0n);
  // $1e-13 rounds to 0 at 12 dp, so even 1 ETH is worth 0 usd6.
  assert.equal(usd6FromWei(ETHER, 1e-13), 0n);
  assert.equal(usd6FromWei(0n, 2000), 0n);
});

test('centsFromUsd6 floors: dust under 1 cent is 0', () => {
  assert.equal(centsFromUsd6(0n), 0);
  assert.equal(centsFromUsd6(9_999n), 0); // $0.009999 -> dust
  assert.equal(centsFromUsd6(10_000n), 1); // exactly $0.01
  assert.equal(centsFromUsd6(19_999n), 1); // $0.019999 floors to 1c
  assert.equal(centsFromUsd6(25_000n), 2);
  assert.equal(centsFromUsd6(2_000_000_000n), 200_000); // $2000
});

test('cents round-trip: 1M POLYDASH at $0.000000194 is 19 cents, 1 token is dust', () => {
  assert.equal(centsFromUsd6(usd6FromWei(10n ** 24n, 0.000000194)), 19); // $0.194 -> 19c
  assert.equal(centsFromUsd6(usd6FromWei(ETHER, 0.000000194)), 0); // 1 token = $0.000000194
  assert.equal(centsFromUsd6(usd6FromWei(1n, 3000)), 0); // 1 wei at $3000 < 1c
  assert.equal(centsFromUsd6(usd6FromWei(10n ** 13n, 2000)), 2); // 0.00001 ETH at $2000 = $0.02
});

test('isFresh: exactly 24h old is fresh, 1s older is stale', () => {
  const nowMs = 1_800_000_000_000; // fixed "now"
  const nowSec = nowMs / 1000;
  assert.equal(isFresh(nowSec - DAY_MS / 1000, nowMs, DAY_MS), true);
  assert.equal(isFresh(nowSec - DAY_MS / 1000 - 1, nowMs, DAY_MS), false);
  assert.equal(isFresh(nowSec, nowMs, DAY_MS), true);
  assert.equal(isFresh(nowSec - 100, nowMs, DAY_MS), true);
});

test('isFresh: zero window only accepts the current second', () => {
  const nowMs = 1_800_000_000_000;
  const nowSec = nowMs / 1000;
  assert.equal(isFresh(nowSec, nowMs, 0), true);
  assert.equal(isFresh(nowSec - 1, nowMs, 0), false);
});

test('isFresh: a block timestamp in the future counts as fresh (current behaviour)', () => {
  // now - blockTimestamp is negative, which is <= the window. Documented
  // here so a future change to reject future blocks shows up as a failure.
  const nowMs = 1_800_000_000_000;
  assert.equal(isFresh(nowMs / 1000 + 3600, nowMs, DAY_MS), true);
});
