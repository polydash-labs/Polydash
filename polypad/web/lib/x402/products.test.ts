// Platform-token (POLYDASH) report mapping + reference matching.
// Run from the repo root:  npx tsx lib/x402/products.test.ts
// No network, no DB — the mapping is pure and the chain reads are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlatformTokenFacts,
  isPlatformToken,
  isPlatformTokenRef,
  parseDexPair,
  platformTokenReport,
  type PlatformTokenFacts,
} from '../platform-token';
import { POLYDASH_ADDRESS } from './constants';

const DEX_FIXTURE = {
  schemaVersion: '1.0.0',
  pairs: [
    {
      chainId: 'robinhood',
      dexId: 'uniswap',
      url: 'https://dexscreener.com/robinhood/0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5',
      pairAddress: '0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5',
      baseToken: { address: POLYDASH_ADDRESS, name: 'Polydash', symbol: 'polydash' },
      quoteToken: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', name: 'WETH', symbol: 'WETH' },
      priceNative: '0.0000000001564',
      priceUsd: '0.0000002631',
      volume: { h24: 50.22, h6: 13.36 },
      liquidity: { usd: 2520.08, base: 7934926808, quote: 0.2566 },
      fdv: 26319,
      marketCap: 26319,
    },
  ],
};

const FACTS: PlatformTokenFacts = {
  address: POLYDASH_ADDRESS,
  name: 'Polydash',
  symbol: 'POLYDASH',
  decimals: 18,
  totalSupply: 100000000000n * 10n ** 18n,
  priceUsd: 0.0000002631,
  priceNative: '0.0000000001564',
  marketCapUsd: 26319,
  volumeUsd24h: 50.22,
  liquidityUsd: 2520.08,
  pairAddress: '0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5',
  dexId: 'uniswap',
  dexUrl: 'https://dexscreener.com/robinhood/0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5',
};

test('isPlatformToken matches the address in any casing, nothing else', () => {
  assert.equal(isPlatformToken(POLYDASH_ADDRESS), true);
  assert.equal(isPlatformToken(POLYDASH_ADDRESS.toLowerCase()), true);
  assert.equal(isPlatformToken('0x319525528f42167eF7fC18b77b889958080568e5'), false);
  assert.equal(isPlatformToken('0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B'), false);
});

test('isPlatformTokenRef matches address, symbol, and $symbol', () => {
  assert.equal(isPlatformTokenRef(POLYDASH_ADDRESS), true);
  assert.equal(isPlatformTokenRef('polydash'), true);
  assert.equal(isPlatformTokenRef('POLYDASH'), true);
  assert.equal(isPlatformTokenRef('$POLYDASH'), true);
  assert.equal(isPlatformTokenRef('POLYCAT'), false);
  assert.equal(isPlatformTokenRef('0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B'), false);
});

test('parseDexPair reads the first pair and prefers marketCap over fdv', () => {
  const pair = parseDexPair(DEX_FIXTURE);
  assert.ok(pair);
  assert.equal(pair.priceUsd, 0.0000002631);
  assert.equal(pair.priceNative, '0.0000000001564');
  assert.equal(pair.marketCapUsd, 26319);
  assert.equal(pair.volumeUsd24h, 50.22);
  assert.equal(pair.liquidityUsd, 2520.08);
  assert.equal(pair.pairAddress, '0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5');
});

test('parseDexPair returns null when there are no pairs', () => {
  assert.equal(parseDexPair({ pairs: [] }), null);
  assert.equal(parseDexPair({}), null);
  assert.equal(parseDexPair(null), null);
});

test('platformTokenReport carries the launch-report keys with launch fields null', () => {
  const r = platformTokenReport(FACTS);
  assert.equal(r.product, 'token-report');
  assert.equal(r.tokenAddress, POLYDASH_ADDRESS);
  assert.equal(r.launchAddress, null);
  assert.equal(r.platformToken, true);
  assert.equal(r.name, 'Polydash');
  assert.equal(r.symbol, 'POLYDASH');
  assert.equal(r.graduated, true);
  assert.equal(r.phase, 4);
  assert.equal(r.curveProgress, null);
  assert.equal(r.ethRaised, null);
  assert.equal(r.createdAt, null);
  assert.equal(r.totalSupply, '100000000000000000000000000000');
  assert.equal(r.priceEth, 0.0000000001564);
  assert.equal(r.marketCapUsd, 26319);
  assert.equal(r.volumeUsd, 50.22);
  assert.equal(r.chainId, 4663);
  assert.deepEqual(r.pool, {
    pairAddress: '0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5',
    dexId: 'uniswap',
    liquidityUsd: 2520.08,
    url: 'https://dexscreener.com/robinhood/0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5',
  });
});

test('platformTokenReport with no market data still builds from on-chain facts', () => {
  const r = platformTokenReport({ ...FACTS, priceUsd: null, priceNative: null, marketCapUsd: null, volumeUsd24h: null, liquidityUsd: null, pairAddress: null, dexId: null, dexUrl: null });
  assert.equal(r.priceEth, null);
  assert.equal(r.marketCapUsd, null);
  assert.equal(r.volumeUsd, null);
  assert.equal(r.pool, null);
  assert.equal(r.totalSupply, '100000000000000000000000000000');
  assert.equal(r.symbol, 'POLYDASH');
});

/** Stub viem client: multicall returns name/symbol/decimals/totalSupply. */
function stubClient() {
  return {
    multicall: async () => [
      { status: 'success', result: 'Polydash' },
      { status: 'success', result: 'polydash' },
      { status: 'success', result: 18 },
      { status: 'success', result: 100000000000n * 10n ** 18n },
    ],
  };
}

test('getPlatformTokenFacts reads on-chain facts and tolerates a Dexscreener outage', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('dexscreener down');
  }) as typeof fetch;
  try {
    const facts = await getPlatformTokenFacts(
      stubClient() as unknown as Parameters<typeof getPlatformTokenFacts>[0],
      POLYDASH_ADDRESS,
    );
    assert.ok(facts);
    assert.equal(facts.name, 'Polydash');
    assert.equal(facts.symbol, 'POLYDASH');
    assert.equal(facts.totalSupply, 100000000000n * 10n ** 18n);
    assert.equal(facts.priceUsd, null);
    assert.equal(facts.pairAddress, null);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getPlatformTokenFacts returns null when the on-chain reads fail', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => DEX_FIXTURE })) as unknown as typeof fetch;
  try {
    const facts = await getPlatformTokenFacts(
      { multicall: async () => null } as unknown as Parameters<typeof getPlatformTokenFacts>[0],
      POLYDASH_ADDRESS,
    );
    assert.equal(facts, null);
  } finally {
    globalThis.fetch = origFetch;
  }
});
