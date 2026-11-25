/**
 * Phase 4 AI agent funds — pure logic + on-chain ABIs.
 *
 * Everything in this file that a unit test can cover is pure: strategy
 * defaults, guardrail validation, mandate text, the paper-trade (backtest)
 * engine, decision explanations, and leaderboard ranking. The ABIs are
 * written from the exact function signatures in src/fund/phase4/SPEC.md;
 * they are verified against the compiled contracts at integration time.
 *
 * The agent registry address comes from NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS.
 * Until the registry is deployed and that variable is set, the agent
 * features degrade gracefully (no agent card, no leaderboard rows) instead
 * of pretending an agent exists.
 */
import { keccak256, toHex } from 'viem';
import { bpsLabel } from '@/lib/fund/model';

// ---------------------------------------------------------------------------
// Strategy templates (spec: AgentStrategies template ids 0–5)
// ---------------------------------------------------------------------------

export const TEMPLATE_COUNT = 6;

export type TemplateId = 0 | 1 | 2 | 3 | 4 | 5;
/** 0 conservative, 1 balanced, 2 aggressive. */
export type RiskLevel = 0 | 1 | 2;

export type StrategyTemplate = {
  id: TemplateId;
  /** Plain on-chain name (AgentStrategies.templateName). */
  name: string;
  /** Plain-language card title. */
  title: string;
  /** One-line plain-language description shown on the card. */
  description: string;
  /** The rule, in plain language, used to explain each decision. */
  rule: string;
};

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 0,
    name: 'Momentum',
    title: 'Follows the trend',
    description: 'Buys when the price is climbing, sells when it turns down.',
    rule: 'the price had risen more than 2% from its last level, so the trend rule said buy; a fall of more than 2% says sell',
  },
  {
    id: 1,
    name: 'Dip-buyer',
    title: 'Buys the dips',
    description: 'Waits for a drop from the recent high, then buys a slice.',
    rule: 'the price had fallen more than 5% from its recent high, so the dip rule said buy a slice; a recovery of 5% says sell',
  },
  {
    id: 2,
    name: 'Defensive',
    title: 'Moves to safety when shaky',
    description: 'Moves back to WETH when prices swing hard or the fund slips.',
    rule: 'prices were swinging hard (more than a 5% move), so the safety rule said move back to WETH until things calm down',
  },
  {
    id: 3,
    name: 'DCA accumulator',
    title: 'Buys a little on a schedule',
    description: 'Buys the same small slice on a regular schedule, whatever the price.',
    rule: 'the schedule came due, so the regular-buy rule said buy the usual small slice',
  },
  {
    id: 4,
    name: 'Balanced rebalancer',
    title: 'Keeps the mix',
    description: 'Keeps the fund near half WETH, half the asset, topping up or trimming when it drifts.',
    rule: 'the mix had drifted more than 10% away from half-and-half, so the rebalance rule said top up or trim back to the target',
  },
  {
    id: 5,
    name: 'Custom',
    title: 'Your own plain-language rules',
    description: 'You write the rules in plain words; the runner follows them like the balanced mix.',
    rule: 'your own written rules said to act, using the balanced-mix check as the fallback',
  },
];

export function templateById(id: number): StrategyTemplate {
  return STRATEGY_TEMPLATES[id] ?? STRATEGY_TEMPLATES[4]!;
}

export const RISK_LEVELS: { id: RiskLevel; label: string; description: string }[] = [
  { id: 0, label: 'Conservative', description: 'Smaller trades, quicker to pause on a drop.' },
  { id: 1, label: 'Balanced', description: 'Middle-size trades and a middle pause point.' },
  { id: 2, label: 'Aggressive', description: 'Bigger trades, only pauses on a large drop.' },
];

export function riskLabel(level: number): string {
  return RISK_LEVELS[level]?.label ?? 'Balanced';
}

// ---------------------------------------------------------------------------
// Strategy params (spec: AgentTypes.StrategyParams + AgentStrategies.defaults)
// ---------------------------------------------------------------------------

export type StrategyParams = {
  templateId: TemplateId;
  riskLevel: RiskLevel;
  /** 0 = use the vault's cap. */
  maxPositionBps: number;
  /** 0 = use the vault's cap. */
  maxTradeBps: number;
  /** 0 = use the vault's cap. */
  maxDeviationBps: number;
  /** Max executed instructions per UTC day; 0 = 5. */
  dailyTradeLimit: number;
  /** NAV-per-NFT drop vs the high point that auto-pauses; 0 = 1000 (10%). */
  circuitBreakerBps: number;
  /** Minimum seconds between trades; 0 = 3600 (1h). */
  rebalanceIntervalSeconds: number;
  /** keccak of the off-chain rules JSON (the agent's constitution detail). */
  rulesHash: `0x${string}`;
};

export const ZERO_HASH = `0x${'0'.repeat(64)}` as `0x${string}`;

/** Risk mapping from the spec. Deviation is left 0 (use the vault's cap). */
const RISK_DEFAULTS: Record<RiskLevel, { maxPositionBps: number; maxTradeBps: number; circuitBreakerBps: number; dailyTradeLimit: number }> = {
  0: { maxPositionBps: 3000, maxTradeBps: 2000, circuitBreakerBps: 500, dailyTradeLimit: 3 },
  1: { maxPositionBps: 5000, maxTradeBps: 5000, circuitBreakerBps: 1000, dailyTradeLimit: 6 },
  2: { maxPositionBps: 7500, maxTradeBps: 7500, circuitBreakerBps: 2000, dailyTradeLimit: 12 },
};

/** Rebalance defaults in seconds, per template, from the spec. */
const REBALANCE_DEFAULTS: Record<TemplateId, number> = {
  0: 4 * 3600,
  1: 1 * 3600,
  2: 24 * 3600,
  3: 24 * 3600,
  4: 12 * 3600,
  5: 12 * 3600,
};

export function strategyDefaults(templateId: number, riskLevel: number): StrategyParams {
  const template = templateById(templateId);
  const risk = (RISK_LEVELS[riskLevel] ? riskLevel : 1) as RiskLevel;
  const base = RISK_DEFAULTS[risk];
  return {
    templateId: template.id,
    riskLevel: risk,
    maxPositionBps: base.maxPositionBps,
    maxTradeBps: base.maxTradeBps,
    maxDeviationBps: 0,
    dailyTradeLimit: base.dailyTradeLimit,
    circuitBreakerBps: base.circuitBreakerBps,
    rebalanceIntervalSeconds: REBALANCE_DEFAULTS[template.id],
    rulesHash: ZERO_HASH,
  };
}

export function rebalanceHours(seconds: number): number {
  return seconds / 3600;
}

// ---------------------------------------------------------------------------
// Guardrail validation
// ---------------------------------------------------------------------------

export type GuardrailIssue = { field: string; message: string };

export function validateGuardrails(params: StrategyParams): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];
  const range = (value: number, field: string, label: string, min: number, max: number) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      issues.push({ field, message: `${label} must be from ${min} to ${max}.` });
    }
  };
  range(params.maxPositionBps, 'maxPositionBps', 'Largest single holding', 0, 10_000);
  range(params.maxTradeBps, 'maxTradeBps', 'Largest single trade', 0, 10_000);
  range(params.maxDeviationBps, 'maxDeviationBps', 'Largest allowed price gap', 0, 10_000);
  range(params.dailyTradeLimit, 'dailyTradeLimit', 'Trades per day', 0, 100);
  range(params.circuitBreakerBps, 'circuitBreakerBps', 'Auto-pause drop', 0, 10_000);
  if (!Number.isInteger(params.rebalanceIntervalSeconds) || params.rebalanceIntervalSeconds < 0 || params.rebalanceIntervalSeconds > 7 * 24 * 3600) {
    issues.push({ field: 'rebalanceIntervalSeconds', message: 'Time between trades must be from 0 to 7 days.' });
  }
  if (params.maxTradeBps > 0 && params.maxPositionBps > 0 && params.maxTradeBps > params.maxPositionBps) {
    issues.push({ field: 'maxTradeBps', message: 'A single trade cannot be larger than the largest single holding.' });
  }
  return issues;
}

export function validateAgentIdentity(input: {
  name: string;
  description: string;
  logoUri: string;
  agentKey: string;
}): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];
  const name = input.name.trim();
  if (!name) issues.push({ field: 'name', message: 'Give the agent a name.' });
  else if (name.length > 64) issues.push({ field: 'name', message: 'Agent name must be 64 characters or fewer.' });
  if (input.description.trim().length > 500) {
    issues.push({ field: 'description', message: 'Description must be 500 characters or fewer.' });
  }
  if (input.logoUri.trim() && !input.logoUri.trim().startsWith('https://') && !input.logoUri.trim().startsWith('ipfs://')) {
    issues.push({ field: 'logoUri', message: 'Logo link must start with https:// or ipfs://.' });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.agentKey.trim())) {
    issues.push({ field: 'agentKey', message: 'Enter the runner wallet address (0x…).' });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Rules JSON + mandate text (the agent's constitution)
// ---------------------------------------------------------------------------

export type AgentRules = {
  agentName: string;
  template: string;
  risk: string;
  maxPositionBps: number;
  maxTradeBps: number;
  maxDeviationBps: number;
  dailyTradeLimit: number;
  circuitBreakerBps: number;
  rebalanceIntervalSeconds: number;
  assets: string[];
  description: string;
  backtested?: { startValueEth: number; endValueEth: number; changePct: number; trades: number } | null;
};

export function buildRulesJson(input: {
  agentName: string;
  params: StrategyParams;
  assets: string[];
  description: string;
  backtested?: AgentRules['backtested'];
}): string {
  const rules: AgentRules = {
    agentName: input.agentName.trim(),
    template: templateById(input.params.templateId).name,
    risk: riskLabel(input.params.riskLevel),
    maxPositionBps: input.params.maxPositionBps,
    maxTradeBps: input.params.maxTradeBps,
    maxDeviationBps: input.params.maxDeviationBps,
    dailyTradeLimit: input.params.dailyTradeLimit,
    circuitBreakerBps: input.params.circuitBreakerBps,
    rebalanceIntervalSeconds: input.params.rebalanceIntervalSeconds,
    assets: input.assets,
    description: input.description.trim(),
    backtested: input.backtested ?? null,
  };
  return JSON.stringify(rules);
}

export function rulesHashFor(rulesJson: string): `0x${string}` {
  return keccak256(toHex(rulesJson));
}

function assetListText(assets: string[]): string {
  return assets.length === 0 ? 'WETH only' : `WETH plus ${assets.join(', ')}`;
}

/**
 * Auto-written mandate: the agent's constitution in plain language. The
 * fund stores keccak256 of this exact text, so the rules cannot change
 * after creation without anyone noticing.
 */
export function generateMandateText(input: {
  agentName: string;
  fundName: string;
  params: StrategyParams;
  assets: string[];
  description: string;
}): string {
  const template = templateById(input.params.templateId);
  const risk = riskLabel(input.params.riskLevel);
  const lines = [
    `This fund is managed by an AI agent called ${input.agentName.trim() || 'the agent'}.`,
    `Fund: ${input.fundName.trim() || 'this fund'}.`,
    input.description.trim() ? `About the agent: ${input.description.trim()}` : '',
    `Strategy: ${template.name} — ${template.description}`,
    `Risk level: ${risk}.`,
    `It may hold: ${assetListText(input.assets)}. It never holds money itself; the vault holds the money and the agent can only ask the vault to swap within these limits.`,
    `Largest single holding: ${bpsLabel(input.params.maxPositionBps)} of the fund's value${input.params.maxPositionBps === 0 ? ' (the vault default)' : ''}.`,
    `Largest single trade: ${bpsLabel(input.params.maxTradeBps)} of the fund's value${input.params.maxTradeBps === 0 ? ' (the vault default)' : ''}.`,
    input.params.maxDeviationBps === 0
      ? 'Price gap limit: the vault default.'
      : `Price gap limit: ${bpsLabel(input.params.maxDeviationBps)} from the feed price.`,
    `At most ${input.params.dailyTradeLimit === 0 ? 5 : input.params.dailyTradeLimit} trades per day.`,
    `Auto-pause: if the value per share falls ${bpsLabel(input.params.circuitBreakerBps === 0 ? 1000 : input.params.circuitBreakerBps)} below its highest point, the agent stops itself.`,
    `It waits at least ${rebalanceHours(input.params.rebalanceIntervalSeconds === 0 ? 3600 : input.params.rebalanceIntervalSeconds)} hour(s) between trades.`,
    'The human who created this fund can pause the agent or remove it at any time.',
  ];
  return lines.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Decision explanations ("Ask the agent why" = the rule + the numbers)
// ---------------------------------------------------------------------------

export type TradeExplanationInput = {
  /** 'buy' = into the asset, 'sell' = back to WETH/ETH. */
  side: 'buy' | 'sell';
  assetSymbol: string;
  /** Size of the trade in ETH, when known. */
  amountEth?: number | null;
  /** Price move (percent) that triggered the rule, when known. */
  priceChangePct?: number | null;
  /** Value per share after the trade, in ETH, when known. */
  navPerNftEth?: number | null;
};

export function explainTrade(templateId: number, trade: TradeExplanationInput): string {
  const template = templateById(templateId);
  const direction = trade.side === 'buy' ? `bought ${trade.assetSymbol}` : `sold ${trade.assetSymbol} back to WETH`;
  const size = trade.amountEth != null ? ` for about ${trade.amountEth.toFixed(4)} ETH` : '';
  const move = trade.priceChangePct != null
    ? ` The price had moved ${trade.priceChangePct > 0 ? '+' : ''}${trade.priceChangePct.toFixed(1)}%.`
    : '';
  const nav = trade.navPerNftEth != null ? ` Value per share after the trade: ${trade.navPerNftEth.toFixed(4)} ETH.` : '';
  return `${template.name} agent ${direction}${size}. Rule: ${template.rule}.${move}${nav} The full reasoning lives in the runner's decision log, not on-chain.`;
}

// ---------------------------------------------------------------------------
// Paper trade / backtest — pure function over a price series (no chain)
// ---------------------------------------------------------------------------

export type PricePoint = { t: number; price: number };
export type PaperTrade = {
  t: number;
  side: 'buy' | 'sell';
  price: number;
  amountEth: number;
  valueAfterEth: number;
};
export type PaperTradeResult = {
  startValueEth: number;
  endValueEth: number;
  changePct: number;
  trades: PaperTrade[];
  maxDrawdownPct: number;
  points: { t: number; valueEth: number }[];
};

/** Deterministic sample history (60 hourly points) for "Try it on paper first". */
export const SAMPLE_PRICE_SERIES: PricePoint[] = (() => {
  const start = 1_700_000_000;
  const points: PricePoint[] = [];
  for (let i = 0; i < 60; i += 1) {
    const trend = 1 + i * 0.004;
    const wave = 1 + 0.05 * Math.sin(i / 4) - 0.03 * Math.sin(i / 2.3);
    points.push({ t: start + i * 3600, price: 1 * trend * wave });
  }
  return points;
})();

function dayOf(t: number): number {
  return Math.floor(t / 86_400);
}

/**
 * Run a strategy over a price series locally. `price` is the asset price in
 * ETH per whole token. Starts fully in WETH (cash). Mirrors the runner's
 * v1 rules in the spec: Momentum ±2%, Dip-buyer −5% from the high / +5%
 * recovery, Defensive >5% swing to WETH, DCA a fixed slice on schedule,
 * Balanced rebalance to 50/50 on >10% drift, Custom = balanced fallback.
 */
export function runPaperTrade(input: {
  templateId: number;
  params: StrategyParams;
  prices: PricePoint[];
  startingEth?: number;
}): PaperTradeResult {
  const template = templateById(input.templateId);
  const params = input.params;
  const startValue = input.startingEth ?? 1;
  const prices = [...input.prices].sort((a, b) => a.t - b.t).filter((p) => p.price > 0);
  const interval = params.rebalanceIntervalSeconds === 0 ? 3600 : params.rebalanceIntervalSeconds;
  const dailyLimit = params.dailyTradeLimit === 0 ? 5 : params.dailyTradeLimit;
  const maxTradeBps = params.maxTradeBps === 0 ? 7500 : params.maxTradeBps;
  const maxPositionBps = params.maxPositionBps === 0 ? 7500 : params.maxPositionBps;

  let cash = startValue;
  let asset = 0;
  let lastTradeT = -Infinity;
  let lastBuyT = -Infinity;
  let lastBuyPrice = 0;
  let refPrice = prices[0]?.price ?? 0;
  let recentHigh = refPrice;
  let peak = startValue;
  let maxDrawdown = 0;
  const tradesToday = new Map<number, number>();
  const trades: PaperTrade[] = [];
  const points: { t: number; valueEth: number }[] = [];
  const window: number[] = [];

  const value = (price: number) => cash + asset * price;

  const canTrade = (t: number) => t - lastTradeT >= interval && (tradesToday.get(dayOf(t)) ?? 0) < dailyLimit;

  const recordTrade = (t: number, side: 'buy' | 'sell', price: number, amountEth: number) => {
    lastTradeT = t;
    tradesToday.set(dayOf(t), (tradesToday.get(dayOf(t)) ?? 0) + 1);
    trades.push({ t, side, price, amountEth, valueAfterEth: value(price) });
  };

  const buy = (t: number, price: number, amountEth: number) => {
    const portfolio = value(price);
    const assetValue = asset * price;
    const room = (portfolio * maxPositionBps) / 10_000 - assetValue;
    const capped = Math.min(amountEth, cash, (portfolio * maxTradeBps) / 10_000, Math.max(room, 0));
    if (capped <= 0) return;
    cash -= capped;
    asset += capped / price;
    lastBuyPrice = price;
    recordTrade(t, 'buy', price, capped);
  };

  const sell = (t: number, price: number, fraction: number) => {
    const portfolio = value(price);
    const assetValue = asset * price;
    const amountEth = Math.min(assetValue * fraction, (portfolio * maxTradeBps) / 10_000);
    if (amountEth <= 0 || asset <= 0) return;
    const units = amountEth / price;
    asset -= Math.min(units, asset);
    cash += amountEth;
    recordTrade(t, 'sell', price, amountEth);
  };

  for (const point of prices) {
    const { t, price } = point;
    recentHigh = Math.max(recentHigh, price);
    window.push(price);
    if (window.length > 6) window.shift();
    const current = value(price);
    if (current > peak) peak = current;
    const drawdown = peak > 0 ? ((peak - current) / peak) * 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    if (!canTrade(t)) {
      points.push({ t, valueEth: current });
      continue;
    }

    if (template.id === 0) {
      if (cash > 0 && price >= refPrice * 1.02) {
        buy(t, price, cash);
        refPrice = price;
      } else if (asset > 0 && price <= refPrice * 0.98) {
        sell(t, price, 1);
        refPrice = price;
      }
    } else if (template.id === 1) {
      if (cash > 0 && price <= recentHigh * 0.95) {
        buy(t, price, cash);
      } else if (asset > 0 && lastBuyPrice > 0 && price >= lastBuyPrice * 1.05) {
        sell(t, price, 1);
      }
    } else if (template.id === 2) {
      const oldest = window[0] ?? price;
      const swing = oldest > 0 ? Math.abs((price - oldest) / oldest) * 100 : 0;
      if (asset > 0 && (swing > 5 || drawdown > (params.circuitBreakerBps === 0 ? 1000 : params.circuitBreakerBps) / 200)) {
        sell(t, price, 1);
      } else if (cash > 0 && swing < 1 && window.length >= 3) {
        buy(t, price, cash * 0.5);
      }
    } else if (template.id === 3) {
      if (t - lastBuyT >= interval && cash > 0) {
        buy(t, price, cash * 0.1);
        lastBuyT = t;
      }
    } else {
      // Balanced (4) and Custom (5, balanced fallback).
      const portfolio = value(price);
      const assetValue = asset * price;
      const target = portfolio / 2;
      const drift = portfolio > 0 ? Math.abs(assetValue - target) / portfolio : 0;
      if (drift > 0.1) {
        if (assetValue > target) sell(t, price, (assetValue - target) / Math.max(assetValue, 1e-12));
        else buy(t, price, target - assetValue);
      }
    }
    points.push({ t, valueEth: value(price) });
  }

  const endValue = prices.length ? value(prices[prices.length - 1]!.price) : startValue;
  const changePct = startValue > 0 ? ((endValue - startValue) / startValue) * 100 : 0;
  return { startValueEth: startValue, endValueEth: endValue, changePct, trades, maxDrawdownPct: maxDrawdown, points };
}

// ---------------------------------------------------------------------------
// Leaderboard ranking (pure)
// ---------------------------------------------------------------------------

export type LeaderboardRowInput = {
  agentId: bigint;
  name: string;
  logoURI: string;
  templateId: number;
  fund: string;
  navPerNftEth: number | null;
  /** Baseline NAV per share when investing began; null = too early. */
  baselineNavPerNftEth: number | null;
  trades: number;
  active: boolean;
  paused: boolean;
  /** On-chain guardrails, when read — used for "Use this strategy". */
  params?: StrategyParams | null;
};

export type LeaderboardRow = LeaderboardRowInput & {
  /** Percent change since investing began; null when there is no baseline. */
  changePct: number | null;
  status: 'Running' | 'Paused' | 'Retired';
};

export function rankAgents(rows: LeaderboardRowInput[]): LeaderboardRow[] {
  const withChange: LeaderboardRow[] = rows.map((row) => {
    const changePct =
      row.baselineNavPerNftEth != null && row.baselineNavPerNftEth > 0 && row.navPerNftEth != null
        ? ((row.navPerNftEth - row.baselineNavPerNftEth) / row.baselineNavPerNftEth) * 100
        : null;
    return {
      ...row,
      changePct,
      status: !row.active ? 'Retired' : row.paused ? 'Paused' : 'Running',
    };
  });
  withChange.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
  return withChange;
}

export function formatChange(changePct: number | null): string {
  if (changePct == null) return 'Too early';
  return `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Copy-an-agent prefill (from a leaderboard / agent-card link)
// ---------------------------------------------------------------------------

export type AgentPrefill = {
  templateId: number;
  riskLevel: number;
  maxPositionBps?: number;
  maxTradeBps?: number;
  maxDeviationBps?: number;
  dailyTradeLimit?: number;
  circuitBreakerBps?: number;
  rebalanceIntervalSeconds?: number;
  assetsText?: string;
  agentName?: string;
};

export function prefillFromParams(params: URLSearchParams): AgentPrefill | null {
  if (params.get('agent') !== '1') return null;
  const num = (key: string): number | undefined => {
    const raw = params.get(key);
    if (raw == null || raw === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const templateId = num('template');
  const prefill: AgentPrefill = {
    templateId: templateId != null && templateId >= 0 && templateId < TEMPLATE_COUNT ? templateId : 4,
    riskLevel: num('risk') ?? 1,
  };
  const maxPositionBps = num('maxPositionBps');
  if (maxPositionBps != null) prefill.maxPositionBps = maxPositionBps;
  const maxTradeBps = num('maxTradeBps');
  if (maxTradeBps != null) prefill.maxTradeBps = maxTradeBps;
  const maxDeviationBps = num('maxDeviationBps');
  if (maxDeviationBps != null) prefill.maxDeviationBps = maxDeviationBps;
  const dailyTradeLimit = num('dailyTradeLimit');
  if (dailyTradeLimit != null) prefill.dailyTradeLimit = dailyTradeLimit;
  const circuitBreakerBps = num('circuitBreakerBps');
  if (circuitBreakerBps != null) prefill.circuitBreakerBps = circuitBreakerBps;
  const rebalanceIntervalSeconds = num('rebalanceIntervalSeconds');
  if (rebalanceIntervalSeconds != null) prefill.rebalanceIntervalSeconds = rebalanceIntervalSeconds;
  const assets = params.get('assets');
  if (assets) prefill.assetsText = assets;
  const agentName = params.get('agentName');
  if (agentName) prefill.agentName = agentName;
  return prefill;
}

/** Link that opens the agent wizard prefilled with this agent's strategy. */
export function copyAgentLink(input: {
  templateId: number;
  riskLevel: number;
  params: StrategyParams;
  assets: string[];
  agentName?: string;
}): string {
  const query = new URLSearchParams({
    agent: '1',
    template: String(input.templateId),
    risk: String(input.riskLevel),
    maxPositionBps: String(input.params.maxPositionBps),
    maxTradeBps: String(input.params.maxTradeBps),
    maxDeviationBps: String(input.params.maxDeviationBps),
    dailyTradeLimit: String(input.params.dailyTradeLimit),
    circuitBreakerBps: String(input.params.circuitBreakerBps),
    rebalanceIntervalSeconds: String(input.params.rebalanceIntervalSeconds),
  });
  if (input.assets.length) query.set('assets', input.assets.join('\n'));
  if (input.agentName) query.set('agentName', input.agentName);
  return `/funds/create?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// On-chain addresses / ABIs (spec exact signatures)
// ---------------------------------------------------------------------------

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** Agent registry address, once deployed. Null until configured. */
export function getAgentRegistryAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS?.trim();
  if (!raw || raw.toLowerCase() === ZERO_ADDRESS) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

/**
 * Compiled AgentExecutor bytecode (0x…), set once the contracts workstream
 * publishes it. Empty until then: the wizard creates the fund and tells
 * the creator the executor step is waiting on the published bytecode
 * instead of pretending the agent is live.
 */
export function getAgentExecutorBytecode(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_AGENT_EXECUTOR_BYTECODE?.trim();
  if (!raw || !/^0x[0-9a-fA-F]+$/.test(raw)) return null;
  return raw as `0x${string}`;
}

const strategyParamsComponents = [
  { name: 'templateId', type: 'uint8' },
  { name: 'riskLevel', type: 'uint8' },
  { name: 'maxPositionBps', type: 'uint16' },
  { name: 'maxTradeBps', type: 'uint16' },
  { name: 'maxDeviationBps', type: 'uint16' },
  { name: 'dailyTradeLimit', type: 'uint16' },
  { name: 'circuitBreakerBps', type: 'uint16' },
  { name: 'rebalanceIntervalSeconds', type: 'uint32' },
  { name: 'rulesHash', type: 'bytes32' },
] as const;

const instructionComponents = [
  { name: 'vault', type: 'address' },
  { name: 'router', type: 'address' },
  { name: 'assetIn', type: 'address' },
  { name: 'assetOut', type: 'address' },
  { name: 'amountIn', type: 'uint256' },
  { name: 'minAmountOut', type: 'uint256' },
  { name: 'data', type: 'bytes' },
  { name: 'deadline', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
] as const;

/** AgentExecutor ABI, from the spec's exact signatures. */
export const AgentExecutorABI = [
  {
    type: 'constructor',
    inputs: [
      { name: 'vault_', type: 'address' },
      { name: 'agentKey_', type: 'address' },
      { name: 'params_', type: 'tuple', components: strategyParamsComponents },
      { name: 'registry_', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'ix', type: 'tuple', components: instructionComponents },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'validate',
    stateMutability: 'view',
    inputs: [
      { name: 'ix', type: 'tuple', components: instructionComponents },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [
      { name: 'ok', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'unpause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'retire', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'updateAgentKey',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newKey', type: 'address' }],
    outputs: [],
  },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'retired', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'agentKey', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'nextNonce', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'lastExecution', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'highWaterNavPerNft', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'vault', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'registry', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function',
    name: 'params',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'tuple', components: strategyParamsComponents }],
  },
  {
    type: 'event',
    name: 'InstructionExecuted',
    inputs: [
      { name: 'vault', type: 'address', indexed: true },
      { name: 'assetIn', type: 'address', indexed: false },
      { name: 'assetOut', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'minAmountOut', type: 'uint256', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'navPerNftAfter', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CircuitBreakerTripped',
    inputs: [
      { name: 'navPerNft', type: 'uint256', indexed: false },
      { name: 'highWaterNavPerNft', type: 'uint256', indexed: false },
    ],
  },
  { type: 'event', name: 'AgentPaused', inputs: [] },
  { type: 'event', name: 'AgentUnpaused', inputs: [] },
  { type: 'event', name: 'AgentRetired', inputs: [] },
  {
    type: 'event',
    name: 'AgentKeyUpdated',
    inputs: [{ name: 'newKey', type: 'address', indexed: true }],
  },
  { type: 'error', name: 'WrongVault', inputs: [] },
  { type: 'error', name: 'Expired', inputs: [] },
  { type: 'error', name: 'BadNonce', inputs: [] },
  { type: 'error', name: 'BadSignature', inputs: [] },
  { type: 'error', name: 'AgentPaused', inputs: [] },
  { type: 'error', name: 'NotInvesting', inputs: [] },
  { type: 'error', name: 'VaultPaused', inputs: [] },
  { type: 'error', name: 'NotExecutor', inputs: [] },
  { type: 'error', name: 'NotInMandate', inputs: [] },
  { type: 'error', name: 'NotAllowlisted', inputs: [] },
  { type: 'error', name: 'BadRouter', inputs: [] },
  { type: 'error', name: 'TradeCap', inputs: [] },
  { type: 'error', name: 'PositionCap', inputs: [] },
  { type: 'error', name: 'DailyLimitExceeded', inputs: [] },
  { type: 'error', name: 'CircuitBreakerTripped', inputs: [] },
  { type: 'error', name: 'TooSoon', inputs: [] },
] as const;

const agentComponents = [
  { name: 'fund', type: 'address' },
  { name: 'vault', type: 'address' },
  { name: 'executor', type: 'address' },
  { name: 'creator', type: 'address' },
  { name: 'agentKey', type: 'address' },
  { name: 'name', type: 'string' },
  { name: 'logoURI', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'templateId', type: 'uint8' },
  { name: 'runnerMode', type: 'uint8' },
  { name: 'strategyHash', type: 'bytes32' },
  { name: 'rulesHash', type: 'bytes32' },
  { name: 'createdAt', type: 'uint64' },
  { name: 'active', type: 'bool' },
] as const;

/** AgentRegistry ABI, from the spec's exact signatures. */
export const AgentRegistryABI = [
  {
    type: 'function',
    name: 'registerAgent',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'a', type: 'tuple', components: agentComponents }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'updateAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'logoURI', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'rulesHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'retireAgent',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getAgent',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: agentComponents }],
  },
  {
    type: 'function',
    name: 'agentOfFund',
    stateMutability: 'view',
    inputs: [{ name: 'fund', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'agentCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'agentsByCreator',
    stateMutability: 'view',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'activeAgents',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'fund', type: 'address', indexed: true },
      { name: 'executor', type: 'address', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AgentUpdated',
    inputs: [{ name: 'agentId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'AgentRetired',
    inputs: [{ name: 'agentId', type: 'uint256', indexed: true }],
  },
] as const;

export type AgentRecord = {
  fund: `0x${string}`;
  vault: `0x${string}`;
  executor: `0x${string}`;
  creator: `0x${string}`;
  agentKey: `0x${string}`;
  name: string;
  logoURI: string;
  description: string;
  templateId: number;
  /** 0 = self-hosted, 1 = Polypad-hosted. */
  runnerMode: number;
  strategyHash: `0x${string}`;
  rulesHash: `0x${string}`;
  createdAt: number;
  active: boolean;
};

/** Map a getAgent tuple (array or object) to a typed record. */
export function parseAgentRecord(value: unknown): AgentRecord | null {
  const row = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : null;
  if (!row || row.length < 14) return null;
  const asAddress = (v: unknown): `0x${string}` =>
    typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : ZERO_ADDRESS;
  return {
    fund: asAddress(row[0]),
    vault: asAddress(row[1]),
    executor: asAddress(row[2]),
    creator: asAddress(row[3]),
    agentKey: asAddress(row[4]),
    name: typeof row[5] === 'string' ? row[5] : '',
    logoURI: typeof row[6] === 'string' ? row[6] : '',
    description: typeof row[7] === 'string' ? row[7] : '',
    templateId: Number(row[8] ?? 0),
    runnerMode: Number(row[9] ?? 0),
    strategyHash: typeof row[10] === 'string' ? (row[10] as `0x${string}`) : ZERO_HASH,
    rulesHash: typeof row[11] === 'string' ? (row[11] as `0x${string}`) : ZERO_HASH,
    createdAt: Number(row[12] ?? 0),
    active: row[13] === true,
  };
}

// ---------------------------------------------------------------------------
// Runner setup card values (self-hosted mode)
// ---------------------------------------------------------------------------

/** Exact env values for the self-hosted runner (polypad/agent-runner). */
export function runnerEnvText(input: {
  executor: string;
  vault: string;
  fund: string;
  agentKey: string;
  registry: string | null;
  chainId?: number;
}): string {
  return [
    `AGENT_EXECUTOR_ADDRESS=${input.executor}`,
    `AGENT_VAULT_ADDRESS=${input.vault}`,
    `AGENT_FUND_ADDRESS=${input.fund}`,
    `AGENT_REGISTRY_ADDRESS=${input.registry ?? ''}`,
    `AGENT_KEY_ADDRESS=${input.agentKey}`,
    `CHAIN_ID=${input.chainId ?? 4663}`,
    'RPC_URL=https://rpc.mainnet.chain.robinhood.com',
    'AGENT_PRIVATE_KEY=',
    'POLL_INTERVAL_SECONDS=60',
  ].join('\n');
}

export const RUNNER_COMMANDS = [
  'cd polypad/agent-runner',
  'npm install',
  'cp .env.example .env   # then fill in the values above; never share the key',
  'npm start',
] as const;
