import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultShareId, parseListing, parsePosition, parseQueue, parseQuote, phase5TxError, quoteStatusLabel, tupleField } from './phase5';

const Z = '0x0000000000000000000000000000000000000000';
const S = '0x1111111111111111111111111111111111111111';
const N = '0x2222222222222222222222222222222222222222';

test('phase5 tupleField reads arrays and objects', () => {
  assert.equal(tupleField([1, 2], 1, 'b'), 2);
  assert.equal(tupleField({ a: 1, b: 2 }, 0, 'b'), 2);
  assert.equal(tupleField(null, 0, 'a'), undefined);
});

test('phase5 listing: object shape as returned live (single struct)', () => {
  // Live listing(1) on Robinhood Chain: empty struct, decoded by viem as an object.
  const empty = parseListing({ seller: Z, nft: Z, tokenId: 0n, price: 0n, mode: 0, active: false });
  assert.equal(empty.active, false);
  const l = parseListing({ seller: S, nft: N, tokenId: 7n, price: 10n ** 16n, mode: 1, active: true });
  assert.deepEqual(l, { seller: S, nft: N, tokenId: 7n, price: 10n ** 16n, mode: 1, active: true });
  assert.deepEqual(parseListing([S, N, 7n, 10n ** 16n, 1, true]), l);
});

test('phase5 positions and queues: array shape as returned live', () => {
  assert.deepEqual(parsePosition([Z, 0n, 0n]), { holder: null, expiry: 0, tierDays: 0 });
  assert.deepEqual(parsePosition([S, 1_800_000_000n, 90n]), { holder: S, expiry: 1_800_000_000, tierDays: 90 });
  assert.deepEqual(parsePosition({ holder: S, expiry: 5n, tierDays: 30n }), { holder: S, expiry: 5, tierDays: 30 });
  assert.deepEqual(parseQueue([Z, 0n]), { holder: null, readyAt: 0 });
  assert.deepEqual(parseQueue([S, 1_800_086_400n]), { holder: S, readyAt: 1_800_086_400 });
});

test('phase5 quote: array shape (ethShare, supply, status)', () => {
  assert.deepEqual(parseQuote([10n ** 15n, 100n, 2]), { ethShare: 10n ** 15n, supply: 100n, status: 2 });
  assert.deepEqual(parseQuote({ ethShare: 1n, supply: 2n, status: 3 }), { ethShare: 1n, supply: 2n, status: 3 });
});

test('phase5 quote status shows words, never a number', () => {
  assert.equal(quoteStatusLabel(0, 0, true), 'Open for investments');
  assert.equal(quoteStatusLabel(0, 0, false), 'Waiting for the manager to join');
  assert.equal(quoteStatusLabel(1, 0, true), 'Closed');
  assert.equal(quoteStatusLabel(2, 0, true), 'Investing your money');
  assert.equal(quoteStatusLabel(3, 0, true), 'Refund available — get your money back');
  assert.equal(quoteStatusLabel(null, 2, true), 'Investing your money');
  assert.equal(quoteStatusLabel(undefined, 1, false), 'Closed');
  for (const s of [0, 1, 2, 3]) {
    const l = quoteStatusLabel(s, s, true);
    assert.doesNotMatch(l, /Status \d/);
    assert.notEqual(l, '—');
  }
});

test('phase5 default share number', () => {
  assert.equal(defaultShareId('', []), 1n);
  assert.equal(defaultShareId('', [5n, 7n]), 5n);
  assert.equal(defaultShareId('9', [5n]), 9n);
  assert.equal(defaultShareId('abc', []), 1n);
});

test('phase5 error mapping', () => {
  assert.equal(phase5TxError('NotFund'), 'This tokenized fund does not support share trading.');
  assert.equal(phase5TxError('ShareLocked()'), 'This share is in a conviction lock.');
  assert.equal(phase5TxError('Listed'), 'This share is listed. Cancel the listing first.');
  assert.equal(phase5TxError('AlreadyListed'), 'This share is already listed.');
  assert.equal(phase5TxError('CoolingDown'), 'The one-day wait has not passed yet.');
  assert.equal(typeof phase5TxError('something unknown'), 'string');
});
