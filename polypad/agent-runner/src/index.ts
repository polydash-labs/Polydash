/**
 * Agent runner entry point: poll the chain, evaluate the strategy, and —
 * only when there is an action — sign and submit a trade instruction.
 *
 * Loop (every POLL_INTERVAL_SECONDS, default 60s):
 *   1. Read vault state (status, navPerNft, balances) + executor state.
 *   2. Skip cleanly (log "hold") when the fund is not Investing, the
 *      executor is paused/retired/revoked, or swaps are paused.
 *   3. Price the mandate asset via the allowlist quote; record price history.
 *   4. Evaluate the strategy; decide buy / sell / hold with reasoning.
 *   5. On an action: size inside the caps, set minAmountOut from the
 *      configured slippage, sign (EIP-712), validate() on-chain, and submit
 *      execute() only when validate() says ok.
 *   6. Log every decision to decisions.jsonl; write heartbeat.json.
 *
 * The runner never holds money and never moves money itself: it only signs
 * instructions that the on-chain executor verifies against the caps before
 * the vault swaps. `node src/index.ts --once` runs a single loop (useful
 * for hosted runners and smoke tests).
 */
import { formatEther } from 'viem';
import type { Address } from 'viem';
import { loadAgentFromRegistry, loadConfig, type RunnerConfig } from './config.js';
import {
  FUND_STATUS,
  FUND_STATUS_INVESTING,
  agentExecutorAbi,
  createClients,
  erc20Abi,
  fundAllowlistAbi,
  fundVaultAbi,
  type Clients,
} from './chain.js';
import { ExecutorClient } from './executor.js';
import { emptyHealthStatus, startHealthServer, writeHeartbeat, type HealthStatus } from './health.js';
import { appendDecision, type DecisionRecord } from './decisions.js';
import { explainDecision } from './llm.js';
import { buildInstruction, signInstruction } from './signer.js';
import {
  TEMPLATE_NAMES,
  evaluateStrategy,
  loadPriceHistory,
  priceHistoryPath,
  recordPrice,
  savePriceHistory,
  type CustomRule,
  type PriceHistory,
  type RiskLevel,
  type StrategyDecision,
} from './strategy.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/** Vault defaults when a cap is 0 (per SPEC.md): 75% position / 75% trade / 50% deviation. */
const VAULT_DEFAULT_POSITION_BPS = 7500;
const VAULT_DEFAULT_TRADE_BPS = 7500;

function effectiveCap(paramBps: number, vaultBps: bigint, vaultDefaultBps: number): number {
  const vault = vaultBps === 0n ? vaultDefaultBps : Number(vaultBps);
  if (paramBps === 0) return vault;
  return Math.min(paramBps, vault);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface VaultState {
  status: number;
  nav: bigint;
  navPerNft: bigint;
  spendableEth: bigint;
  swapsPaused: boolean;
  weth: Address;
  allowlist: Address;
  maxPositionBps: bigint;
  maxTradeBps: bigint;
  mandateAssets: Address[];
}

async function readVaultState(publicClient: Clients['publicClient'], vault: Address): Promise<VaultState> {
  const [status, nav, navPerNft, spendableEth, swapsPaused, weth, allowlist, maxPositionBps, maxTradeBps, count] =
    await Promise.all([
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'status' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'nav' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'navPerNft' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'spendableEth' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'swapsPaused' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'weth' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'allowlist' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'maxPositionBps' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'maxTradeBps' }),
      publicClient.readContract({ address: vault, abi: fundVaultAbi, functionName: 'mandateAssetCount' }),
    ]);
  const mandateAssets: Address[] = [];
  for (let i = 0n; i < count; i++) {
    mandateAssets.push(
      await publicClient.readContract({
        address: vault,
        abi: fundVaultAbi,
        functionName: 'mandateAssets',
        args: [i],
      }),
    );
  }
  return { status, nav, navPerNft, spendableEth, swapsPaused, weth, allowlist, maxPositionBps, maxTradeBps, mandateAssets };
}

interface LoopContext {
  config: RunnerConfig;
  clients: Clients;
  executorClient: ExecutorClient;
  executorAddress: Address;
  vaultAddress: Address;
  agentId: string | null;
  templateName: string;
  health: HealthStatus;
  history: PriceHistory;
}

function baseRecord(ctx: LoopContext, decision: StrategyDecision, validateReason: string): Omit<DecisionRecord, 'status' | 'txHash' | 'error' | 'amountIn' | 'minAmountOut' | 'nonce' | 'assetIn' | 'assetOut'> {
  return {
    ts: new Date().toISOString(),
    agentId: ctx.agentId,
    executor: ctx.executorAddress,
    vault: ctx.vaultAddress,
    template: ctx.templateName,
    action: decision.action,
    rule: decision.rule,
    reasoning: decision.reasoning,
    validateReason,
  };
}

function logHold(ctx: LoopContext, decision: StrategyDecision, reason: string): void {
  const record: DecisionRecord = {
    ...baseRecord(ctx, decision, reason),
    status: 'hold',
    assetIn: null,
    assetOut: null,
    amountIn: null,
    minAmountOut: null,
    nonce: null,
    txHash: null,
    error: null,
  };
  appendDecision(ctx.config.dataDir, record);
  console.log(`[hold] ${decision.rule}: ${decision.reasoning}`);
}

async function runOnce(ctx: LoopContext): Promise<void> {
  const { config, clients } = ctx;
  const { publicClient } = clients;
  const now = Math.floor(Date.now() / 1000);

  // 1. Executor + vault state.
  const executorState = await ctx.executorClient.getState();
  const vaultState = await readVaultState(publicClient, ctx.vaultAddress);
  const isExecutor = await publicClient.readContract({
    address: ctx.vaultAddress,
    abi: fundVaultAbi,
    functionName: 'isExecutor',
    args: [ctx.executorAddress],
  });
  const statusName = FUND_STATUS[vaultState.status] ?? `unknown(${vaultState.status})`;
  console.log(
    `[loop] vault status=${statusName} nav=${formatEther(vaultState.nav)} ETH ` +
      `navPerNft=${formatEther(vaultState.navPerNft)} ETH executor paused=${executorState.paused} retired=${executorState.retired}`,
  );

  const templateId = config.strategyTemplateId ?? executorState.templateId;
  const riskLevel = (config.strategyRiskLevel ?? executorState.riskLevel) as RiskLevel;
  ctx.templateName = TEMPLATE_NAMES[templateId] ?? `template-${templateId}`;
  const riskName = ['conservative', 'balanced', 'aggressive'][riskLevel] ?? 'balanced';

  const emptyDecision: StrategyDecision = {
    action: 'hold',
    assetIn: 'WETH',
    assetOut: 'ASSET',
    amountIn: 0n,
    rule: 'skip',
    reasoning: '',
    priceChangePct: null,
    navDrawdownBps: 0,
  };

  // 2. Skip cleanly when the fund cannot trade.
  if (vaultState.status !== FUND_STATUS_INVESTING) {
    logHold(ctx, { ...emptyDecision, rule: 'not-investing', reasoning: `Fund is ${statusName}, not Investing — nothing to manage yet.` }, 'not-investing');
    return;
  }
  if (executorState.paused || executorState.retired) {
    logHold(ctx, { ...emptyDecision, rule: 'agent-paused', reasoning: 'The agent is paused or retired — holding until the manager resumes it.' }, 'paused');
    return;
  }
  if (vaultState.swapsPaused) {
    logHold(ctx, { ...emptyDecision, rule: 'vault-paused', reasoning: 'The manager paused swaps on the vault — holding.' }, 'vault-paused');
    return;
  }
  if (!isExecutor) {
    logHold(ctx, { ...emptyDecision, rule: 'not-executor', reasoning: 'The executor is no longer authorized on the vault (revoked) — holding.' }, 'not-executor');
    return;
  }

  // 3. Pick the asset and price it via the allowlist quote (fail-closed on a bad price).
  const asset = config.assetAddress ?? vaultState.mandateAssets.find((a) => a.toLowerCase() !== vaultState.weth.toLowerCase());
  if (!asset || asset.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    logHold(ctx, { ...emptyDecision, rule: 'weth-only', reasoning: 'The mandate holds WETH only — there is no asset for this agent to trade.' }, 'weth-only');
    return;
  }
  const [decimals, symbol, wethBalance, assetBalance] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: 'symbol' }).catch(() => 'ASSET'),
    publicClient.readContract({ address: vaultState.weth, abi: erc20Abi, functionName: 'balanceOf', args: [ctx.vaultAddress] }),
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [ctx.vaultAddress] }),
  ]);
  const oneToken = 10n ** BigInt(decimals);
  let pricePerTokenWei: bigint;
  try {
    pricePerTokenWei = await publicClient.readContract({
      address: vaultState.allowlist,
      abi: fundAllowlistAbi,
      functionName: 'quote',
      args: [asset, oneToken],
    });
  } catch (error) {
    const record: DecisionRecord = {
      ...baseRecord(ctx, emptyDecision, 'quote-failed'),
      status: 'error',
      assetIn: null,
      assetOut: null,
      amountIn: null,
      minAmountOut: null,
      nonce: null,
      txHash: null,
      error: `allowlist quote failed (fail-closed): ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
    };
    appendDecision(config.dataDir, record);
    console.log(`[error] allowlist quote failed — holding (fail-closed): ${record.error}`);
    return;
  }
  const priceEth = Number(pricePerTokenWei) / 1e18;
  recordPrice(ctx.history, asset, priceEth, now);
  savePriceHistory(priceHistoryPath(config.dataDir), ctx.history);
  console.log(`[loop] ${symbol} price=${priceEth} ETH weth=${formatEther(wethBalance)} asset=${assetBalance}`);

  // 4. Evaluate the strategy.
  let customRules: CustomRule[] | undefined;
  if (config.customRulesJson) {
    try {
      customRules = JSON.parse(config.customRulesJson) as CustomRule[];
    } catch {
      console.log('[warn] CUSTOM_RULES_JSON is not valid JSON — ignoring it');
    }
  }
  const decision = evaluateStrategy({
    templateId,
    riskLevel,
    now,
    lastExecution: Number(executorState.lastExecution),
    rebalanceIntervalSeconds:
      executorState.rebalanceIntervalSeconds === 0 ? 3600 : executorState.rebalanceIntervalSeconds,
    currentPriceEth: priceEth,
    history: ctx.history.assets[asset.toLowerCase()] ?? [],
    navPerNft: vaultState.navPerNft,
    highWaterNavPerNft: executorState.highWaterNavPerNft,
    nav: vaultState.nav,
    wethBalance,
    assetBalance,
    assetDecimals: decimals,
    maxPositionBps: effectiveCap(executorState.maxPositionBps, vaultState.maxPositionBps, VAULT_DEFAULT_POSITION_BPS),
    maxTradeBps: effectiveCap(executorState.maxTradeBps, vaultState.maxTradeBps, VAULT_DEFAULT_TRADE_BPS),
    circuitBreakerBps: executorState.circuitBreakerBps === 0 ? 1000 : executorState.circuitBreakerBps,
    customRules,
  });

  // Reasoning: LLM if configured, otherwise the rule text. The LLM never sets amounts.
  const reasoning = await explainDecision(
    {
      templateName: ctx.templateName,
      riskLevel: riskName,
      decision,
      navPerNftEth: formatEther(vaultState.navPerNft),
      priceEth,
      priceChangePct: decision.priceChangePct,
      navDrawdownBps: decision.navDrawdownBps,
    },
    { apiKey: config.llmApiKey, apiUrl: config.llmApiUrl, model: config.llmModel },
  );
  const decided: StrategyDecision = { ...decision, reasoning };

  if (decided.action === 'hold') {
    ctx.health.lastDecision = decided.rule;
    ctx.health.lastAction = 'hold';
    logHold(ctx, decided, 'hold');
    return;
  }

  // 5. An action: need a router, then sign -> validate -> execute.
  if (!config.routerAddress) {
    logHold(ctx, { ...decided, action: 'hold' }, 'no-router-configured');
    console.log('[hold] strategy wants a trade but no ROUTER_ADDRESS is configured — holding');
    return;
  }
  const routerAllowed = await publicClient.readContract({
    address: vaultState.allowlist,
    abi: fundAllowlistAbi,
    functionName: 'routerAllowed',
    args: [config.routerAddress],
  });
  if (!routerAllowed) {
    logHold(ctx, { ...decided, action: 'hold' }, 'bad-router');
    console.log('[hold] configured router is not allowlisted — holding');
    return;
  }

  const isBuy = decided.action === 'buy';
  const assetIn = isBuy ? vaultState.weth : asset;
  const assetOut = isBuy ? asset : vaultState.weth;
  let expectedOut: bigint;
  if (isBuy) {
    // WETH in -> asset out: expected asset = amountIn * 10^decimals / pricePerTokenWei.
    expectedOut = pricePerTokenWei > 0n ? (decided.amountIn * oneToken) / pricePerTokenWei : 0n;
  } else {
    expectedOut = await publicClient.readContract({
      address: vaultState.allowlist,
      abi: fundAllowlistAbi,
      functionName: 'quote',
      args: [asset, decided.amountIn],
    });
  }
  const minAmountOut = (expectedOut * BigInt(10_000 - config.slippageBps)) / 10_000n;
  const nonce = executorState.nextNonce;
  const deadline = BigInt(now + config.instructionTtlSeconds);
  const ix = buildInstruction({
    vault: ctx.vaultAddress,
    router: config.routerAddress,
    assetIn,
    assetOut,
    amountIn: decided.amountIn,
    minAmountOut,
    data: '0x',
    deadline,
    nonce,
  });

  const signature = await signInstruction({
    account: clients.account,
    chainId: config.chainId,
    executorAddress: ctx.executorAddress,
    instruction: ix,
  });

  const { ok, reason } = await ctx.executorClient.validate(ix, signature);
  if (!ok) {
    const record: DecisionRecord = {
      ...baseRecord(ctx, decided, reason),
      status: 'rejected',
      assetIn,
      assetOut,
      amountIn: decided.amountIn.toString(),
      minAmountOut: minAmountOut.toString(),
      nonce: nonce.toString(),
      txHash: null,
      error: null,
    };
    appendDecision(config.dataDir, record);
    ctx.health.lastDecision = decided.rule;
    ctx.health.lastAction = 'rejected';
    console.log(`[rejected] validate() says no (${reason}) — not submitting`);
    return;
  }

  try {
    const result = await ctx.executorClient.execute(ix, signature);
    const record: DecisionRecord = {
      ...baseRecord(ctx, decided, 'ok'),
      status: 'executed',
      assetIn,
      assetOut,
      amountIn: decided.amountIn.toString(),
      minAmountOut: minAmountOut.toString(),
      nonce: nonce.toString(),
      txHash: result.hash,
      error: null,
    };
    appendDecision(config.dataDir, record);
    ctx.health.lastDecision = decided.rule;
    ctx.health.lastAction = decided.action;
    ctx.health.lastTxHash = result.hash;
    console.log(`[executed] ${decided.action} ${formatEther(decided.amountIn)} ${isBuy ? 'WETH' : symbol} tx=${result.hash}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
    const record: DecisionRecord = {
      ...baseRecord(ctx, decided, 'execute-failed'),
      status: 'error',
      assetIn,
      assetOut,
      amountIn: decided.amountIn.toString(),
      minAmountOut: minAmountOut.toString(),
      nonce: nonce.toString(),
      txHash: null,
      error: message,
    };
    appendDecision(config.dataDir, record);
    ctx.health.errors += 1;
    console.log(`[error] execute failed: ${message}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const clients = createClients(config);
  console.log(`[runner] agent key ${clients.account.address} on chain ${config.chainId}`);

  let executorAddress = config.executorAddress;
  let vaultAddress = config.vaultAddress;
  let agentId: string | null = config.agentId === null ? null : config.agentId.toString();
  if (config.registryAddress && config.agentId !== null) {
    const agent = await loadAgentFromRegistry(clients.publicClient, config.registryAddress, config.agentId);
    if (!agent.active) {
      console.log(`[warn] registry agent ${config.agentId} is retired — the runner will only ever log holds`);
    }
    executorAddress = agent.executor;
    vaultAddress = agent.vault;
    console.log(`[runner] registry agent ${config.agentId}: "${agent.name}" template=${agent.templateId} executor=${executorAddress} vault=${vaultAddress}`);
  }

  const health = emptyHealthStatus(executorAddress, vaultAddress, agentId);
  const server = startHealthServer(config.healthPort, () => health);
  console.log(`[runner] health server on :${config.healthPort} (/health, /status)`);

  const ctx: LoopContext = {
    config,
    clients,
    executorClient: new ExecutorClient(clients.publicClient, clients.walletClient, executorAddress),
    executorAddress,
    vaultAddress,
    agentId,
    templateName: 'unknown',
    health,
    history: loadPriceHistory(priceHistoryPath(config.dataDir)),
  };

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('[runner] shutting down');
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const once = process.argv.includes('--once');
  do {
    health.lastLoopAt = new Date().toISOString();
    health.loops += 1;
    try {
      await runOnce(ctx);
      health.status = 'ok';
    } catch (error) {
      health.status = 'error';
      health.errors += 1;
      console.log(`[error] loop failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
    }
    writeHeartbeat(config.dataDir, health);
    if (once || stopping) break;
    await sleep(config.pollIntervalSeconds * 1000);
  } while (!stopping);
  if (once) {
    // Single run: stop the health server so the process can exit.
    server.close();
  }
}

main().catch((error: unknown) => {
  console.error(`[fatal] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
