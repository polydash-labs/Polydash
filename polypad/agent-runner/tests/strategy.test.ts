/**
 * Strategy engine tests (node:test + tsx). Every template's buy / sell /
 * hold paths, the cap sizing, and the price-history store round-trip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateStrategy,
  loadPriceHistory,
  recordPrice,
  savePriceHistory,
  priceChangePct,
  type PricePoint,
  type StrategyState,
} from '../src/strategy.js';

const ETH = 10n ** 18n;
const NOW = 1_800_000_000;

function points(prices: number[], startTs: number = NOW - 24 * 3600): PricePoint[] {
  const step = prices.length > 1 ? (NOW - startTs) / (prices.length - 1) : 0;
  return prices.map((p, i) => ({ ts: Math.floor(startTs + i * step), priceEth: String(p) }));
}

function baseState(overrides: Partial<StrategyState> = {}): StrategyState {
  return {
    templateId: 0,
    riskLevel: 1,
    now: NOW,
    lastExecution: 0,
    rebalanceIntervalSeconds: 3600,
    currentPriceEth: 0.01,
    history: points([0.01, 0.01]),
    navPerNft: ETH,
    highWaterNavPerNft: ETH,
    nav: 10n * ETH,
    wethBalance: 5n * ETH,
    assetBalance: 100n * ETH,
    assetDecimals: 18,
    maxPositionBps: 7500,
    maxTradeBps: 7500,
    circuitBreakerBps: 1000,
    ...overrides,
  };
}

describe('Momentum (template 0)', () => {
  it('buys when the price is up more than 2% over the window', () => {
    const d = evaluateStrategy(baseState({ history: points([0.0095, 0.01]) }));
    assert.equal(d.action, 'buy');
    assert.equal(d.rule, 'momentum-up');
    // Balanced risk: 25% of 5 ETH WETH = 1.25 ETH, inside the caps.
    assert.equal(d.amountIn, 1_250_000_000_000_000_000n);
    assert.equal(d.assetIn, 'WETH');
    assert.equal(d.assetOut, 'ASSET');
  });

  it('sells when the price is down more than 2% over the window', () => {
    const d = evaluateStrategy(baseState({ history: points([0.0105, 0.01]) }));
    assert.equal(d.action, 'sell');
    assert.equal(d.rule, 'momentum-down');
    // Balanced risk: 75% of 100 tokens.
    assert.equal(d.amountIn, 75n * ETH);
  });

  it('holds when the move is inside the +/-2% band', () => {
    const d = evaluateStrategy(baseState({ history: points([0.0099, 0.01]) }));
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'momentum-flat');
    assert.equal(d.amountIn, 0n);
  });

  it('holds when there is not enough price history', () => {
    const d = evaluateStrategy(baseState({ history: [] }));
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'momentum-no-history');
  });

  it('sizes the buy inside the trade cap', () => {
    // 1% trade cap on a 10 ETH NAV = 0.1 ETH max per trade.
    const d = evaluateStrategy(baseState({ history: points([0.0095, 0.01]), maxTradeBps: 100 }));
    assert.equal(d.action, 'buy');
    assert.equal(d.amountIn, ETH / 10n);
  });
});

describe('DipBuyer (template 1)', () => {
  it('buys a tranche when the price is down more than 5% from the recent high', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 1, history: points([0.011, 0.0105, 0.01]), currentPriceEth: 0.01 }),
    );
    assert.equal(d.action, 'buy');
    assert.equal(d.rule, 'dip-buy');
    // Balanced risk: 30% of 5 ETH = 1.5 ETH.
    assert.equal(d.amountIn, 1_500_000_000_000_000_000n);
  });

  it('holds when the dip is smaller than 5%', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 1, history: points([0.0102, 0.01]), currentPriceEth: 0.01 }),
    );
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'dip-no-dip');
  });
});

describe('Defensive (template 2)', () => {
  it('rotates to WETH when volatility is high', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 2, history: points([0.008, 0.012, 0.008, 0.012, 0.01]) }),
    );
    assert.equal(d.action, 'sell');
    assert.equal(d.rule, 'defensive-to-safety');
    assert.equal(d.amountIn, 100n * ETH);
  });

  it('rotates to WETH when the NAV drawdown passes half the breaker', () => {
    const d = evaluateStrategy(
      baseState({
        templateId: 2,
        history: points([0.01, 0.01]),
        navPerNft: (ETH * 9n) / 10n, // 10% drawdown vs high-water
        highWaterNavPerNft: ETH,
      }),
    );
    assert.equal(d.action, 'sell');
    assert.equal(d.rule, 'defensive-to-safety');
  });

  it('holds when conditions are calm', () => {
    const d = evaluateStrategy(baseState({ templateId: 2, history: points([0.01, 0.0101, 0.01]) }));
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'defensive-calm');
  });
});

describe('Dca (template 3)', () => {
  it('buys a fixed slice when the rebalance interval has elapsed', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 3, lastExecution: NOW - 7200, rebalanceIntervalSeconds: 3600 }),
    );
    assert.equal(d.action, 'buy');
    assert.equal(d.rule, 'dca-due');
    // Balanced risk: 20% of 5 ETH = 1 ETH.
    assert.equal(d.amountIn, ETH);
  });

  it('buys on the first run (never traded)', () => {
    const d = evaluateStrategy(baseState({ templateId: 3, lastExecution: 0 }));
    assert.equal(d.action, 'buy');
    assert.equal(d.rule, 'dca-due');
  });

  it('holds when the next buy is not due yet', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 3, lastExecution: NOW - 100, rebalanceIntervalSeconds: 3600 }),
    );
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'dca-not-due');
  });
});

describe('Balanced (template 4)', () => {
  it('buys when the asset is underweight by more than 10%', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 4, assetBalance: 10n * ETH, wethBalance: 5n * ETH }),
    );
    assert.equal(d.action, 'buy');
    assert.equal(d.rule, 'balanced-buy');
    // Total 5.1 ETH, target 2.55 ETH, asset worth 0.1 ETH -> buy 2.45 ETH.
    assert.equal(d.amountIn, 2_450_000_000_000_000_000n);
  });

  it('sells when the asset is overweight by more than 10%', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 4, assetBalance: 1000n * ETH, wethBalance: ETH }),
    );
    assert.equal(d.action, 'sell');
    assert.equal(d.rule, 'balanced-sell');
    // Total 11 ETH, target 5.5 ETH, asset worth 10 ETH -> sell 4.5 ETH = 450 tokens.
    assert.equal(d.amountIn, 450n * ETH);
  });

  it('holds when the mix is already close to 50/50', () => {
    const d = evaluateStrategy(
      baseState({ templateId: 4, assetBalance: 250n * ETH, wethBalance: (ETH * 5n) / 2n }),
    );
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'balanced-in-range');
  });
});

describe('Custom (template 5)', () => {
  it('fires the first matching rule', () => {
    const d = evaluateStrategy(
      baseState({
        templateId: 5,
        history: points([0.0106, 0.01]),
        customRules: [
          { label: 'buy the dip', metric: 'priceChangePct', operator: '<', value: -5, action: 'buy', fractionBps: 2000 },
          { label: 'never', metric: 'priceChangePct', operator: '>', value: 100, action: 'sell', fractionBps: 5000 },
        ],
      }),
    );
    assert.equal(d.action, 'buy');
    assert.equal(d.rule, 'custom:buy the dip');
    assert.equal(d.amountIn, ETH); // 20% of 5 ETH
  });

  it('holds when no rule matches', () => {
    const d = evaluateStrategy(
      baseState({
        templateId: 5,
        history: points([0.01, 0.01]),
        customRules: [
          { label: 'buy the dip', metric: 'priceChangePct', operator: '<', value: -5, action: 'buy', fractionBps: 2000 },
        ],
      }),
    );
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'custom-no-match');
  });

  it('holds when no rules are configured', () => {
    const d = evaluateStrategy(baseState({ templateId: 5, customRules: [] }));
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'custom-no-rules');
  });
});

describe('unknown template', () => {
  it('holds', () => {
    const d = evaluateStrategy(baseState({ templateId: 99 }));
    assert.equal(d.action, 'hold');
    assert.equal(d.rule, 'unknown-template');
  });
});

describe('price helpers', () => {
  it('priceChangePct measures first-to-last over the window', () => {
    const change = priceChangePct(points([0.01, 0.011]), 24 * 3600, NOW);
    assert.ok(change !== null && Math.abs(change - 10) < 1e-9);
    assert.equal(priceChangePct(points([0.01]), 24 * 3600, NOW), null);
    assert.equal(priceChangePct([], 24 * 3600, NOW), null);
  });
});

describe('price-history store', () => {
  it('round-trips through JSON and prunes points older than 7 days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-runner-test-'));
    const path = join(dir, 'price-history.json');
    const history = loadPriceHistory(path);
    recordPrice(history, '0xAbC', 0.01, NOW - 8 * 24 * 3600); // too old
    recordPrice(history, '0xAbC', 0.011, NOW - 3600);
    recordPrice(history, '0xAbC', 0.012, NOW);
    savePriceHistory(path, history);
    const reloaded = loadPriceHistory(path);
    assert.equal(reloaded.assets['0xabc']!.length, 2);
    assert.equal(reloaded.assets['0xabc']![1]!.priceEth, '0.012');
  });

  it('returns an empty history for a missing or corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-runner-test-'));
    assert.deepEqual(loadPriceHistory(join(dir, 'nope.json')), { version: 1, assets: {} });
  });
});
