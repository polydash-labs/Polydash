import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentExecutorABI, AgentRegistryABI } from './agent';
import {
  TEMPLATE_COUNT,
  explainTrade,
  formatChange,
  generateMandateText,
  prefillFromParams,
  rankAgents,
  rulesHashFor,
  buildRulesJson,
  runPaperTrade,
  strategyDefaults,
  validateAgentIdentity,
  validateGuardrails,
  type PricePoint,
  type StrategyParams,
} from './agent';

function params(templateId: number, riskLevel: number): StrategyParams {
  return strategyDefaults(templateId, riskLevel);
}

test('six templates with plain-language names', () => {
  assert.equal(TEMPLATE_COUNT, 6);
  assert.equal(strategyDefaults(0, 1).templateId, 0);
  assert.equal(strategyDefaults(5, 1).templateId, 5);
});

test('strategy defaults match the spec risk mapping', () => {
  const conservative = strategyDefaults(4, 0);
  assert.deepEqual(
    [conservative.maxPositionBps, conservative.maxTradeBps, conservative.circuitBreakerBps, conservative.dailyTradeLimit],
    [3000, 2000, 500, 3],
  );
  const balanced = strategyDefaults(4, 1);
  assert.deepEqual(
    [balanced.maxPositionBps, balanced.maxTradeBps, balanced.circuitBreakerBps, balanced.dailyTradeLimit],
    [5000, 5000, 1000, 6],
  );
  const aggressive = strategyDefaults(4, 2);
  assert.deepEqual(
    [aggressive.maxPositionBps, aggressive.maxTradeBps, aggressive.circuitBreakerBps, aggressive.dailyTradeLimit],
    [7500, 7500, 2000, 12],
  );
  assert.equal(balanced.maxDeviationBps, 0);
  assert.equal(balanced.rulesHash, `0x${'0'.repeat(64)}`);
});

test('rebalance defaults match the spec per template', () => {
  assert.equal(strategyDefaults(0, 1).rebalanceIntervalSeconds, 4 * 3600);
  assert.equal(strategyDefaults(1, 1).rebalanceIntervalSeconds, 3600);
  assert.equal(strategyDefaults(2, 1).rebalanceIntervalSeconds, 24 * 3600);
  assert.equal(strategyDefaults(3, 1).rebalanceIntervalSeconds, 24 * 3600);
  assert.equal(strategyDefaults(4, 1).rebalanceIntervalSeconds, 12 * 3600);
  assert.equal(strategyDefaults(5, 1).rebalanceIntervalSeconds, 12 * 3600);
});

test('unknown template or risk falls back to balanced defaults', () => {
  assert.equal(strategyDefaults(99, 1).templateId, 4);
  assert.equal(strategyDefaults(0, 99).riskLevel, 1);
  assert.equal(strategyDefaults(0, 99).maxTradeBps, 5000);
});

test('guardrail validation rejects out-of-range values', () => {
  const good = params(4, 1);
  assert.deepEqual(validateGuardrails(good), []);
  const bad = { ...good, maxPositionBps: 10_001, dailyTradeLimit: 101, circuitBreakerBps: -1, rebalanceIntervalSeconds: 8 * 24 * 3600 };
  const issues = validateGuardrails(bad);
  assert.ok(issues.some((issue) => issue.field === 'maxPositionBps'));
  assert.ok(issues.some((issue) => issue.field === 'dailyTradeLimit'));
  assert.ok(issues.some((issue) => issue.field === 'circuitBreakerBps'));
  assert.ok(issues.some((issue) => issue.field === 'rebalanceIntervalSeconds'));
  const tradeBiggerThanPosition = { ...good, maxPositionBps: 1000, maxTradeBps: 2000 };
  assert.ok(validateGuardrails(tradeBiggerThanPosition).some((issue) => issue.field === 'maxTradeBps'));
});

test('agent identity validation requires a name and a runner wallet address', () => {
  assert.ok(validateAgentIdentity({ name: '', description: '', logoUri: '', agentKey: '' }).some((i) => i.field === 'name'));
  assert.ok(validateAgentIdentity({ name: 'Ada', description: '', logoUri: '', agentKey: 'not-an-address' }).some((i) => i.field === 'agentKey'));
  assert.deepEqual(
    validateAgentIdentity({ name: 'Ada', description: 'Buys dips.', logoUri: 'https://example.com/logo.png', agentKey: '0x0000000000000000000000000000000000000001' }),
    [],
  );
});

test('mandate text is plain language and contains the strategy and limits', () => {
  const text = generateMandateText({
    agentName: 'Ada',
    fundName: 'Ada Fund',
    params: params(1, 1),
    assets: [],
    description: 'Buys the dips.',
  });
  assert.match(text, /Ada/);
  assert.match(text, /Dip-buyer/);
  assert.match(text, /Balanced/);
  assert.match(text, /WETH only/);
  assert.match(text, /50%/); // max position 5000 bps
  assert.match(text, /6 trades per day/);
  assert.match(text, /10%/); // circuit breaker 1000 bps
  assert.match(text, /pause the agent or remove it/);
  const withAssets = generateMandateText({
    agentName: 'Ada',
    fundName: 'Ada Fund',
    params: params(0, 0),
    assets: ['0x0000000000000000000000000000000000000002'],
    description: '',
  });
  assert.match(withAssets, /0x0000000000000000000000000000000000000002/);
  assert.match(withAssets, /Momentum/);
  assert.match(withAssets, /Conservative/);
});

test('rules hash is keccak256 of the rules JSON and deterministic', () => {
  const json = buildRulesJson({ agentName: 'Ada', params: params(1, 1), assets: [], description: 'Buys dips.' });
  const hash = rulesHashFor(json);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(rulesHashFor(json), hash);
  assert.notEqual(rulesHashFor(buildRulesJson({ agentName: 'Bob', params: params(1, 1), assets: [], description: 'Buys dips.' })), hash);
});

test('paper trade: momentum buys a rising market and ends ahead', () => {
  const prices: PricePoint[] = Array.from({ length: 20 }, (_, i) => ({ t: 1_700_000_000 + i * 3600, price: 1 + i * 0.05 }));
  const result = runPaperTrade({ templateId: 0, params: { ...params(0, 1), rebalanceIntervalSeconds: 3600 }, prices, startingEth: 1 });
  assert.ok(result.trades.length >= 1);
  assert.equal(result.trades[0]?.side, 'buy');
  assert.ok(result.endValueEth > result.startValueEth);
  assert.ok(result.changePct > 0);
});

test('paper trade: momentum sells on a falling market and protects cash', () => {
  const prices: PricePoint[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ t: 1_700_000_000 + i * 3600, price: 1 + i * 0.05 })),
    ...Array.from({ length: 10 }, (_, i) => ({ t: 1_700_000_000 + (5 + i) * 3600, price: 1.2 - i * 0.05 })),
  ];
  const result = runPaperTrade({ templateId: 0, params: { ...params(0, 1), rebalanceIntervalSeconds: 3600 }, prices, startingEth: 1 });
  assert.ok(result.trades.some((trade) => trade.side === 'sell'));
  // Selling into the fall leaves more than holding the asset to the bottom (0.75).
  assert.ok(result.endValueEth > 0.75);
});

test('paper trade: dip-buyer buys the dip, DCA buys on schedule, balanced rebalances', () => {
  const dip: PricePoint[] = [
    { t: 1_700_000_000, price: 1 },
    { t: 1_700_000_000 + 3600, price: 1.1 },
    { t: 1_700_000_000 + 7200, price: 1.04 },
    { t: 1_700_000_000 + 10_800, price: 1.1 },
  ];
  const dipResult = runPaperTrade({ templateId: 1, params: { ...params(1, 1), rebalanceIntervalSeconds: 3600 }, prices: dip, startingEth: 1 });
  assert.ok(dipResult.trades.some((trade) => trade.side === 'buy'));

  const flat: PricePoint[] = Array.from({ length: 10 }, (_, i) => ({ t: 1_700_000_000 + i * 3600, price: 1 }));
  const dca = runPaperTrade({ templateId: 3, params: { ...params(3, 1), rebalanceIntervalSeconds: 3600 }, prices: flat, startingEth: 1 });
  assert.ok(dca.trades.length >= 5);
  assert.ok(dca.trades.every((trade) => trade.side === 'buy'));

  const jump: PricePoint[] = [
    { t: 1_700_000_000, price: 1 },
    { t: 1_700_000_000 + 3600, price: 1 },
    { t: 1_700_000_000 + 7200, price: 2 },
  ];
  const balanced = runPaperTrade({ templateId: 4, params: { ...params(4, 1), rebalanceIntervalSeconds: 3600 }, prices: jump, startingEth: 1 });
  assert.ok(balanced.trades.length >= 1);
});

test('paper trade respects the daily trade limit and the rebalance interval', () => {
  const prices: PricePoint[] = Array.from({ length: 20 }, (_, i) => ({ t: 1_700_000_000 + i * 60, price: 1 + (i % 2) * 0.1 }));
  const result = runPaperTrade({
    templateId: 3,
    params: { ...params(3, 1), rebalanceIntervalSeconds: 3600, dailyTradeLimit: 2 },
    prices,
    startingEth: 1,
  });
  assert.ok(result.trades.length <= 2);
});

test('paper trade reports drawdown and a flat market stays flat', () => {
  const prices: PricePoint[] = Array.from({ length: 10 }, (_, i) => ({ t: 1_700_000_000 + i * 3600, price: 1 }));
  const result = runPaperTrade({ templateId: 0, params: params(0, 1), prices, startingEth: 1 });
  assert.equal(result.trades.length, 0);
  assert.equal(result.changePct, 0);
  assert.equal(result.maxDrawdownPct, 0);
});

test('decision explanations name the rule and the numbers', () => {
  const text = explainTrade(0, { side: 'buy', assetSymbol: 'USDC', amountEth: 0.5, priceChangePct: 2.4, navPerNftEth: 0.0102 });
  assert.match(text, /Momentum/);
  assert.match(text, /bought USDC/);
  assert.match(text, /0\.5/);
  assert.match(text, /\+2\.4%/);
  assert.match(text, /0\.0102 ETH/);
  assert.match(text, /decision log/);
  const sell = explainTrade(2, { side: 'sell', assetSymbol: 'USDC' });
  assert.match(sell, /Defensive/);
  assert.match(sell, /sold USDC back to WETH/);
});

test('leaderboard ranks by change and puts too-early agents last', () => {
  const rows = rankAgents([
    { agentId: 1n, name: 'A', logoURI: '', templateId: 0, fund: '0x1', navPerNftEth: 0.011, baselineNavPerNftEth: 0.01, trades: 3, active: true, paused: false },
    { agentId: 2n, name: 'B', logoURI: '', templateId: 1, fund: '0x2', navPerNftEth: 0.009, baselineNavPerNftEth: 0.01, trades: 1, active: true, paused: true },
    { agentId: 3n, name: 'C', logoURI: '', templateId: 2, fund: '0x3', navPerNftEth: 0.01, baselineNavPerNftEth: null, trades: 0, active: true, paused: false },
  ]);
  assert.deepEqual(rows.map((row) => row.name), ['A', 'B', 'C']);
  assert.equal(rows[0]?.changePct?.toFixed(1), '10.0');
  assert.equal(rows[1]?.status, 'Paused');
  assert.equal(rows[2]?.changePct, null);
  assert.equal(formatChange(null), 'Too early');
  assert.equal(formatChange(10), '+10.0%');
  assert.equal(formatChange(-2.5), '-2.5%');
});

test('copy-an-agent prefill parses the wizard link', () => {
  assert.equal(prefillFromParams(new URLSearchParams('')), null);
  const prefill = prefillFromParams(
    new URLSearchParams('agent=1&template=1&risk=0&maxPositionBps=3000&maxTradeBps=2000&dailyTradeLimit=3&circuitBreakerBps=500&rebalanceIntervalSeconds=3600'),
  );
  assert.equal(prefill?.templateId, 1);
  assert.equal(prefill?.riskLevel, 0);
  assert.equal(prefill?.maxPositionBps, 3000);
  assert.equal(prefill?.rebalanceIntervalSeconds, 3600);
});

test('executor ABI matches the spec: execute/validate/pause/unpause/retire', () => {
  const names: string[] = AgentExecutorABI.filter((item) => item.type === 'function').map((item) => item.name);
  for (const name of ['execute', 'validate', 'pause', 'unpause', 'retire', 'updateAgentKey', 'paused', 'nextNonce']) {
    assert.ok(names.includes(name), `missing ${name}`);
  }
  const execute = AgentExecutorABI.find((item) => item.type === 'function' && item.name === 'execute');
  assert.ok(execute && execute.type === 'function');
  if (!execute || execute.type !== 'function') return;
  const ix = execute.inputs[0];
  assert.equal(ix?.type, 'tuple');
  if (ix?.type !== 'tuple') return;
  assert.deepEqual(ix.components.map((component) => component.name), [
    'vault', 'router', 'assetIn', 'assetOut', 'amountIn', 'minAmountOut', 'data', 'deadline', 'nonce',
  ]);
  const validate = AgentExecutorABI.find((item) => item.type === 'function' && item.name === 'validate');
  assert.ok(validate && validate.type === 'function');
  if (!validate || validate.type !== 'function') return;
  assert.deepEqual(validate.outputs.map((output) => output.type), ['bool', 'string']);
  const event = AgentExecutorABI.find((item) => item.type === 'event' && item.name === 'InstructionExecuted');
  assert.ok(event && event.type === 'event');
  if (!event || event.type !== 'event') return;
  assert.deepEqual(event.inputs.map((input) => input.name), [
    'vault', 'assetIn', 'assetOut', 'amountIn', 'minAmountOut', 'nonce', 'navPerNftAfter',
  ]);
});

test('registry ABI matches the spec: register/update/retire/lookups', () => {
  const names: string[] = AgentRegistryABI.filter((item) => item.type === 'function').map((item) => item.name);
  for (const name of ['registerAgent', 'updateAgent', 'retireAgent', 'getAgent', 'agentOfFund', 'agentCount', 'agentsByCreator', 'activeAgents']) {
    assert.ok(names.includes(name), `missing ${name}`);
  }
  const register = AgentRegistryABI.find((item) => item.type === 'function' && item.name === 'registerAgent');
  assert.ok(register && register.type === 'function');
  if (!register || register.type !== 'function') return;
  const tuple = register.inputs[0];
  assert.equal(tuple?.type, 'tuple');
  if (tuple?.type !== 'tuple') return;
  assert.deepEqual(tuple.components.map((component) => component.name), [
    'fund', 'vault', 'executor', 'creator', 'agentKey', 'name', 'logoURI', 'description',
    'templateId', 'runnerMode', 'strategyHash', 'rulesHash', 'createdAt', 'active',
  ]);
});
