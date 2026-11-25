/**
 * Rule-based strategy engine (v1) + local price-history store.
 *
 * Deterministic and pure: `evaluateStrategy` takes the fund's on-chain state
 * plus stored prices and returns buy / sell / hold. The LLM (llm.ts) only ever
 * writes the human-readable reasoning — it never sets amounts. Amounts are
 * sized inside the executor caps here AND enforced on-chain by the executor
 * and the vault facet regardless.
 *
 * Templates (ids per SPEC.md): 0 Momentum, 1 DipBuyer, 2 Defensive, 3 Dca,
 * 4 Balanced, 5 Custom.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const TEMPLATE_NAMES = [
  'Momentum',
  'DipBuyer',
  'Defensive',
  'Dca',
  'Balanced',
  'Custom',
] as const;

export const TEMPLATE_COUNT = 6;

/** Risk levels: 0 conservative, 1 balanced, 2 aggressive. */
export type RiskLevel = 0 | 1 | 2;

/** Trade-size fractions (bps) per risk level. */
const RISK_TABLE = [
  { buyBps: 1000, sellBps: 5000, dcaBps: 1000, dipBps: 2000 }, // conservative
  { buyBps: 2500, sellBps: 7500, dcaBps: 2000, dipBps: 3000 }, // balanced
  { buyBps: 5000, sellBps: 10000, dcaBps: 3000, dipBps: 5000 }, // aggressive
] as const;

export const MOMENTUM_THRESHOLD_PCT = 2;
export const DIP_THRESHOLD_PCT = 5;
export const DEFENSIVE_VOLATILITY_PCT = 5;
export const BALANCED_DRIFT_PCT = 10;
export const BALANCED_TARGET_BPS = 5000; // 50/50 WETH / asset
export const PRICE_WINDOW_SECONDS = 24 * 3600;
export const PRICE_HISTORY_MAX_AGE_SECONDS = 7 * 24 * 3600;
export const PRICE_HISTORY_MAX_POINTS = 10_000;

export interface PricePoint {
  /** Unix seconds. */
  ts: number;
  /** Price of one whole asset token, in ETH (decimal string, e.g. "0.00042"). */
  priceEth: string;
}

export interface PriceHistory {
  version: 1;
  assets: Record<string, PricePoint[]>;
}

export function emptyPriceHistory(): PriceHistory {
  return { version: 1, assets: {} };
}

export function priceHistoryPath(dataDir: string): string {
  return join(dataDir, 'price-history.json');
}

export function loadPriceHistory(path: string): PriceHistory {
  try {
    if (!existsSync(path)) return emptyPriceHistory();
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PriceHistory;
    if (!parsed || parsed.version !== 1 || typeof parsed.assets !== 'object') {
      return emptyPriceHistory();
    }
    return parsed;
  } catch {
    return emptyPriceHistory();
  }
}

export function savePriceHistory(path: string, history: PriceHistory): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
}

/** Append a price point (deduped by timestamp) and prune old points. */
export function recordPrice(
  history: PriceHistory,
  asset: string,
  priceEth: number,
  ts: number,
): void {
  const key = asset.toLowerCase();
  const points = history.assets[key] ?? [];
  if (points.length > 0 && points[points.length - 1]!.ts === ts) {
    points[points.length - 1]!.priceEth = String(priceEth);
  } else {
    points.push({ ts, priceEth: String(priceEth) });
  }
  const cutoff = ts - PRICE_HISTORY_MAX_AGE_SECONDS;
  const kept = points.filter((p) => p.ts >= cutoff).slice(-PRICE_HISTORY_MAX_POINTS);
  history.assets[key] = kept;
}

function pointsInWindow(points: PricePoint[], windowSeconds: number, now: number): PricePoint[] {
  const inWindow = points.filter((p) => p.ts >= now - windowSeconds && p.ts <= now);
  // Fall back to whatever history we have when the window is too short.
  return inWindow.length >= 2 ? inWindow : points;
}

/** % change from the first to the last point in the window. Null if < 2 points. */
export function priceChangePct(points: PricePoint[], windowSeconds: number, now: number): number | null {
  const window = pointsInWindow(points, windowSeconds, now);
  if (window.length < 2) return null;
  const first = Number.parseFloat(window[0]!.priceEth);
  const last = Number.parseFloat(window[window.length - 1]!.priceEth);
  if (!first || first <= 0) return null;
  return ((last - first) / first) * 100;
}

/** Highest price in the window. Null when there is no history. */
export function recentHigh(points: PricePoint[], windowSeconds: number, now: number): number | null {
  const window = pointsInWindow(points, windowSeconds, now);
  if (window.length === 0) return null;
  return Math.max(...window.map((p) => Number.parseFloat(p.priceEth)));
}

/** Volatility = standard deviation / mean of prices in the window, in %. */
export function volatilityPct(points: PricePoint[], windowSeconds: number, now: number): number | null {
  const window = pointsInWindow(points, windowSeconds, now);
  if (window.length < 2) return null;
  const values = window.map((p) => Number.parseFloat(p.priceEth));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return (Math.sqrt(variance) / mean) * 100;
}

/** NAV-per-NFT drawdown vs the high-water mark, in bps. 0 when no high-water yet. */
export function navDrawdownBps(navPerNft: bigint, highWaterNavPerNft: bigint): number {
  if (highWaterNavPerNft <= 0n || navPerNft >= highWaterNavPerNft) return 0;
  return Number(((highWaterNavPerNft - navPerNft) * 10_000n) / highWaterNavPerNft);
}

export interface CustomRule {
  label: string;
  metric: 'priceChangePct' | 'navDrawdownBps' | 'secondsSinceTrade' | 'volatilityPct';
  operator: '>' | '<' | '>=' | '<=';
  value: number;
  /** Window for price-based metrics, in seconds (default 24h). */
  windowSeconds?: number;
  action: 'buy' | 'sell';
  /** Fraction of the available side to trade, in bps. */
  fractionBps: number;
}

export interface StrategyState {
  templateId: number;
  riskLevel: RiskLevel;
  /** Unix seconds. */
  now: number;
  /** Unix seconds of the last executed trade (0 = never). */
  lastExecution: number;
  /** Minimum seconds between executions (executor default 3600). */
  rebalanceIntervalSeconds: number;
  /** Current price of one whole asset token, in ETH. */
  currentPriceEth: number;
  /** Stored price history for the asset (ascending ts). */
  history: PricePoint[];
  navPerNft: bigint;
  highWaterNavPerNft: bigint;
  /** Fund NAV in ETH wei. */
  nav: bigint;
  /** WETH the vault holds, in wei. */
  wethBalance: bigint;
  /** Asset the vault holds, in raw token units. */
  assetBalance: bigint;
  assetDecimals: number;
  /** Effective caps (executor params tightened by the vault caps), in bps. */
  maxPositionBps: number;
  maxTradeBps: number;
  /** Circuit-breaker drawdown, in bps (executor default 1000 = 10%). */
  circuitBreakerBps: number;
  /** Rules for the Custom template. */
  customRules?: CustomRule[];
}

export type StrategyAction = 'buy' | 'sell' | 'hold';

export interface StrategyDecision {
  action: StrategyAction;
  /** Which side is spent: 'WETH' for buys, 'ASSET' for sells. */
  assetIn: 'WETH' | 'ASSET';
  assetOut: 'WETH' | 'ASSET';
  /** Amount of assetIn to spend (0 for hold). Raw units (wei for WETH). */
  amountIn: bigint;
  /** Short rule id, e.g. "momentum-up", "dip-buy", "dca-due". */
  rule: string;
  /** Plain-language explanation of why. */
  reasoning: string;
  priceChangePct: number | null;
  navDrawdownBps: number;
}

function hold(rule: string, reasoning: string, state: StrategyState): StrategyDecision {
  return {
    action: 'hold',
    assetIn: 'WETH',
    assetOut: 'ASSET',
    amountIn: 0n,
    rule,
    reasoning,
    priceChangePct: priceChangePct(state.history, PRICE_WINDOW_SECONDS, state.now),
    navDrawdownBps: navDrawdownBps(state.navPerNft, state.highWaterNavPerNft),
  };
}

/** Value of the vault's asset holding, in ETH wei. */
function assetValueEth(state: StrategyState): bigint {
  if (state.assetBalance === 0n || state.currentPriceEth <= 0) return 0n;
  const scale = 10n ** BigInt(state.assetDecimals);
  // priceEth is a float: work in milli-ETH (1 milli-ETH = 1e15 wei) to stay
  // in bigint math. valueWei = tokens * priceMilliEth * 1e15 / scale.
  const priceMilliEth = BigInt(Math.round(state.currentPriceEth * 1000));
  return (state.assetBalance * priceMilliEth * 10n ** 15n) / scale;
}

/** Cap a WETH buy by the trade cap and the position-cap headroom. Returns 0n when capped out. */
function capBuy(state: StrategyState, desiredEth: bigint): bigint {
  const tradeCapEth = (state.nav * BigInt(state.maxTradeBps)) / 10_000n;
  const positionCapEth = (state.nav * BigInt(state.maxPositionBps)) / 10_000n;
  const headroomEth = positionCapEth - assetValueEth(state);
  let allowed = desiredEth;
  if (allowed > tradeCapEth) allowed = tradeCapEth;
  if (allowed > headroomEth) allowed = headroomEth;
  return allowed > 0n ? allowed : 0n;
}

/** Cap an asset sell by the trade cap. Returns 0n when capped out. */
function capSell(state: StrategyState, desiredAsset: bigint): bigint {
  if (desiredAsset <= 0n || state.currentPriceEth <= 0) return 0n;
  const tradeCapEth = (state.nav * BigInt(state.maxTradeBps)) / 10_000n;
  const scale = 10n ** BigInt(state.assetDecimals);
  const priceMilliEth = BigInt(Math.round(state.currentPriceEth * 1000));
  const valueEth = (desiredAsset * priceMilliEth * 10n ** 15n) / scale;
  if (valueEth <= tradeCapEth) return desiredAsset;
  // Scale the sale down so its ETH value fits the trade cap.
  return (desiredAsset * tradeCapEth) / valueEth;
}

function buyDecision(state: StrategyState, rule: string, reasoning: string, desiredEth: bigint): StrategyDecision {
  const amountIn = capBuy(state, desiredEth);
  if (amountIn <= 0n) {
    return hold('at-cap', 'Wanted to buy, but the trade or position cap is already full — holding.', state);
  }
  return {
    action: 'buy',
    assetIn: 'WETH',
    assetOut: 'ASSET',
    amountIn,
    rule,
    reasoning,
    priceChangePct: priceChangePct(state.history, PRICE_WINDOW_SECONDS, state.now),
    navDrawdownBps: navDrawdownBps(state.navPerNft, state.highWaterNavPerNft),
  };
}

function sellDecision(state: StrategyState, rule: string, reasoning: string, desiredAsset: bigint): StrategyDecision {
  const amountIn = capSell(state, desiredAsset);
  if (amountIn <= 0n) {
    return hold('at-cap', 'Wanted to sell, but the trade cap is already full — holding.', state);
  }
  return {
    action: 'sell',
    assetIn: 'ASSET',
    assetOut: 'WETH',
    amountIn,
    rule,
    reasoning,
    priceChangePct: priceChangePct(state.history, PRICE_WINDOW_SECONDS, state.now),
    navDrawdownBps: navDrawdownBps(state.navPerNft, state.highWaterNavPerNft),
  };
}

function evaluateMomentum(state: StrategyState): StrategyDecision {
  const change = priceChangePct(state.history, PRICE_WINDOW_SECONDS, state.now);
  if (change === null) {
    return hold('momentum-no-history', 'Not enough price history yet to judge the trend — holding.', state);
  }
  const risk = RISK_TABLE[state.riskLevel]!;
  if (change > MOMENTUM_THRESHOLD_PCT) {
    const desired = (state.wethBalance * BigInt(risk.buyBps)) / 10_000n;
    return buyDecision(
      state,
      'momentum-up',
      `Price is up ${change.toFixed(2)}% over the last day, so the trend is up — buying with ${risk.buyBps / 100}% of the available WETH.`,
      desired,
    );
  }
  if (change < -MOMENTUM_THRESHOLD_PCT) {
    const desired = (state.assetBalance * BigInt(risk.sellBps)) / 10_000n;
    return sellDecision(
      state,
      'momentum-down',
      `Price is down ${Math.abs(change).toFixed(2)}% over the last day, so the trend is down — selling ${risk.sellBps / 100}% of the asset back to WETH.`,
      desired,
    );
  }
  return hold(
    'momentum-flat',
    `Price moved ${change.toFixed(2)}% over the last day — inside the ±${MOMENTUM_THRESHOLD_PCT}% band, so no trend to follow.`,
    state,
  );
}

function evaluateDipBuyer(state: StrategyState): StrategyDecision {
  const high = recentHigh(state.history, PRICE_WINDOW_SECONDS, state.now);
  if (high === null || high <= 0 || state.currentPriceEth <= 0) {
    return hold('dip-no-history', 'Not enough price history yet to spot a dip — holding.', state);
  }
  const dropPct = ((high - state.currentPriceEth) / high) * 100;
  if (dropPct > DIP_THRESHOLD_PCT) {
    const risk = RISK_TABLE[state.riskLevel]!;
    const desired = (state.wethBalance * BigInt(risk.dipBps)) / 10_000n;
    return buyDecision(
      state,
      'dip-buy',
      `Price is down ${dropPct.toFixed(2)}% from its recent high of ${high.toFixed(6)} ETH — that is a dip worth buying, using ${risk.dipBps / 100}% of the available WETH.`,
      desired,
    );
  }
  return hold(
    'dip-no-dip',
    `Price is only ${dropPct.toFixed(2)}% below its recent high — no dip to buy yet.`,
    state,
  );
}

function evaluateDefensive(state: StrategyState): StrategyDecision {
  const vol = volatilityPct(state.history, PRICE_WINDOW_SECONDS, state.now);
  const drawdown = navDrawdownBps(state.navPerNft, state.highWaterNavPerNft);
  const shaky = vol !== null && vol > DEFENSIVE_VOLATILITY_PCT;
  const hurting = drawdown > state.circuitBreakerBps / 2;
  if (shaky || hurting) {
    if (state.assetBalance === 0n) {
      return hold('defensive-already-safe', 'Conditions look shaky, but the fund already holds no asset — nothing to move to safety.', state);
    }
    const why = [
      shaky ? `price swings are ${vol!.toFixed(2)}% (over the ${DEFENSIVE_VOLATILITY_PCT}% comfort line)` : null,
      hurting ? `the fund is down ${(drawdown / 100).toFixed(2)}% from its high` : null,
    ]
      .filter(Boolean)
      .join(' and ');
    return sellDecision(
      state,
      'defensive-to-safety',
      `Moving to safety because ${why} — selling the whole asset position back to WETH.`,
      state.assetBalance,
    );
  }
  return hold(
    'defensive-calm',
    `Conditions look calm (price swings ${vol === null ? 'unknown' : `${vol.toFixed(2)}%`}, fund drawdown ${(drawdown / 100).toFixed(2)}%) — staying put.`,
    state,
  );
}

function evaluateDca(state: StrategyState): StrategyDecision {
  const sinceTrade = state.lastExecution === 0 ? Number.POSITIVE_INFINITY : state.now - state.lastExecution;
  if (sinceTrade < state.rebalanceIntervalSeconds) {
    const waitFor = state.rebalanceIntervalSeconds - sinceTrade;
    return hold(
      'dca-not-due',
      `Next scheduled buy is in ${Math.ceil(waitFor / 60)} minutes — holding until then.`,
      state,
    );
  }
  const risk = RISK_TABLE[state.riskLevel]!;
  const desired = (state.wethBalance * BigInt(risk.dcaBps)) / 10_000n;
  return buyDecision(
    state,
    'dca-due',
    `Scheduled buy is due — buying a fixed slice (${risk.dcaBps / 100}% of available WETH) on schedule.`,
    desired,
  );
}

function evaluateBalanced(state: StrategyState): StrategyDecision {
  const assetValue = assetValueEth(state);
  const total = assetValue + state.wethBalance;
  if (total === 0n) {
    return hold('balanced-empty', 'The fund holds nothing to rebalance — holding.', state);
  }
  const targetAsset = (total * BigInt(BALANCED_TARGET_BPS)) / 10_000n;
  const driftBps = Number(((assetValue > targetAsset ? assetValue - targetAsset : targetAsset - assetValue) * 10_000n) / total);
  const driftPct = driftBps / 100;
  if (driftPct <= BALANCED_DRIFT_PCT) {
    return hold(
      'balanced-in-range',
      `The mix is close to 50/50 (drift ${driftPct.toFixed(2)}%, inside the ${BALANCED_DRIFT_PCT}% band) — no rebalance needed.`,
      state,
    );
  }
  if (assetValue < targetAsset) {
    const shortfallEth = targetAsset - assetValue;
    return buyDecision(
      state,
      'balanced-buy',
      `The asset is underweight by ${driftPct.toFixed(2)}% — buying to bring the mix back to 50/50.`,
      shortfallEth,
    );
  }
  const excessEth = assetValue - targetAsset;
  const scale = 10n ** BigInt(state.assetDecimals);
  const priceMilliEth = BigInt(Math.round(state.currentPriceEth * 1000));
  // assetRaw = excessWei * scale / priceWeiPerToken, priceWeiPerToken = priceMilliEth * 1e15
  const excessAsset = priceMilliEth > 0n ? (excessEth * scale) / (priceMilliEth * 10n ** 15n) : 0n;
  return sellDecision(
    state,
    'balanced-sell',
    `The asset is overweight by ${driftPct.toFixed(2)}% — selling the excess to bring the mix back to 50/50.`,
    excessAsset,
  );
}

function metricValue(state: StrategyState, rule: CustomRule): number | null {
  switch (rule.metric) {
    case 'priceChangePct':
      return priceChangePct(state.history, rule.windowSeconds ?? PRICE_WINDOW_SECONDS, state.now);
    case 'navDrawdownBps':
      return navDrawdownBps(state.navPerNft, state.highWaterNavPerNft);
    case 'secondsSinceTrade':
      return state.lastExecution === 0 ? Number.POSITIVE_INFINITY : state.now - state.lastExecution;
    case 'volatilityPct':
      return volatilityPct(state.history, rule.windowSeconds ?? PRICE_WINDOW_SECONDS, state.now);
    default:
      return null;
  }
}

function evaluateCustom(state: StrategyState): StrategyDecision {
  const rules = state.customRules ?? [];
  if (rules.length === 0) {
    return hold('custom-no-rules', 'Custom strategy has no rules written yet — holding.', state);
  }
  for (const rule of rules) {
    const value = metricValue(state, rule);
    if (value === null) continue;
    const hit =
      rule.operator === '>' ? value > rule.value
      : rule.operator === '<' ? value < rule.value
      : rule.operator === '>=' ? value >= rule.value
      : value <= rule.value;
    if (!hit) continue;
    if (rule.action === 'buy') {
      const desired = (state.wethBalance * BigInt(rule.fractionBps)) / 10_000n;
      return buyDecision(
        state,
        `custom:${rule.label}`,
        `Custom rule "${rule.label}" fired (${rule.metric} ${rule.operator} ${rule.value}, now ${value.toFixed(2)}) — buying ${rule.fractionBps / 100}% of available WETH.`,
        desired,
      );
    }
    const desired = (state.assetBalance * BigInt(rule.fractionBps)) / 10_000n;
    return sellDecision(
      state,
      `custom:${rule.label}`,
      `Custom rule "${rule.label}" fired (${rule.metric} ${rule.operator} ${rule.value}, now ${value.toFixed(2)}) — selling ${rule.fractionBps / 100}% of the asset.`,
      desired,
    );
  }
  return hold('custom-no-match', 'No custom rule matches the current conditions — holding.', state);
}

/** Main entry point: pick a decision for the fund's current state. */
export function evaluateStrategy(state: StrategyState): StrategyDecision {
  switch (state.templateId) {
    case 0:
      return evaluateMomentum(state);
    case 1:
      return evaluateDipBuyer(state);
    case 2:
      return evaluateDefensive(state);
    case 3:
      return evaluateDca(state);
    case 4:
      return evaluateBalanced(state);
    case 5:
      return evaluateCustom(state);
    default:
      return hold('unknown-template', `Unknown strategy template ${state.templateId} — holding.`, state);
  }
}
