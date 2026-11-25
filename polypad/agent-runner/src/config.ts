/**
 * Configuration: environment variables plus on-chain registry reads.
 * No secrets are ever logged — the agent key is only ever used to sign.
 */
import 'dotenv/config';
import type { Address } from 'viem';
import { agentRegistryAbi } from './chain.js';
import type { PublicClient } from 'viem';

export interface RunnerConfig {
  rpcUrl: string;
  chainId: number;
  /** AgentExecutor contract address. */
  executorAddress: Address;
  /** FundVaultInvest contract address. */
  vaultAddress: Address;
  registryAddress: Address | null;
  agentId: bigint | null;
  /** 0x-prefixed hex private key. Used to sign instructions and pay gas. */
  agentPrivateKey: `0x${string}`;
  /** Allowlisted swap router (e.g. UniswapV3RouterAdapter). Null = hold only. */
  routerAddress: Address | null;
  /** Non-WETH mandate asset to trade. Null = first non-WETH mandate asset. */
  assetAddress: Address | null;
  pollIntervalSeconds: number;
  slippageBps: number;
  instructionTtlSeconds: number;
  strategyTemplateId: number | null;
  strategyRiskLevel: number | null;
  /** Custom-template rules JSON (parsed), if provided. */
  customRulesJson: string | null;
  dataDir: string;
  healthPort: number;
  llmApiKey: string | null;
  llmApiUrl: string;
  llmModel: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function envAddress(name: string): Address | null {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`Invalid ${name}: not an address`);
  return raw as Address;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const rpcUrl = env.RPC_URL;
  if (!rpcUrl) throw new Error('Missing RPC_URL');
  const agentPrivateKey = env.AGENT_PRIVATE_KEY;
  if (!agentPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(agentPrivateKey)) {
    throw new Error('Missing or invalid AGENT_PRIVATE_KEY (0x-prefixed 32-byte hex)');
  }
  const executorAddress = envAddress('EXECUTOR_ADDRESS');
  const vaultAddress = envAddress('VAULT_ADDRESS');
  const registryAddress = envAddress('REGISTRY_ADDRESS');
  const agentIdRaw = env.AGENT_ID;
  if (!executorAddress && !vaultAddress && !(registryAddress && agentIdRaw !== undefined && agentIdRaw !== '')) {
    throw new Error(
      'Set EXECUTOR_ADDRESS + VAULT_ADDRESS, or REGISTRY_ADDRESS + AGENT_ID so the runner can find them on-chain',
    );
  }
  const slippageBps = envInt('SLIPPAGE_BPS', 100);
  if (slippageBps < 0 || slippageBps > 5000) throw new Error('SLIPPAGE_BPS must be 0..5000');

  return {
    rpcUrl,
    chainId: envInt('CHAIN_ID', 4663),
    executorAddress: (executorAddress ?? '0x0000000000000000000000000000000000000000') as Address,
    vaultAddress: (vaultAddress ?? '0x0000000000000000000000000000000000000000') as Address,
    registryAddress,
    agentId: agentIdRaw !== undefined && agentIdRaw !== '' ? BigInt(agentIdRaw) : null,
    agentPrivateKey: agentPrivateKey as `0x${string}`,
    routerAddress: envAddress('ROUTER_ADDRESS'),
    assetAddress: envAddress('ASSET_ADDRESS'),
    pollIntervalSeconds: envInt('POLL_INTERVAL_SECONDS', 60),
    slippageBps,
    instructionTtlSeconds: envInt('INSTRUCTION_TTL_SECONDS', 600),
    strategyTemplateId:
      env.STRATEGY_TEMPLATE_ID !== undefined && env.STRATEGY_TEMPLATE_ID !== ''
        ? envInt('STRATEGY_TEMPLATE_ID', 0)
        : null,
    strategyRiskLevel:
      env.STRATEGY_RISK_LEVEL !== undefined && env.STRATEGY_RISK_LEVEL !== ''
        ? envInt('STRATEGY_RISK_LEVEL', 1)
        : null,
    customRulesJson: env.CUSTOM_RULES_JSON ?? null,
    dataDir: env.DATA_DIR ?? './data',
    healthPort: envInt('HEALTH_PORT', 8080),
    llmApiKey: env.LLM_API_KEY ?? null,
    llmApiUrl: env.LLM_API_URL ?? 'https://api.openai.com/v1/chat/completions',
    llmModel: env.LLM_MODEL ?? 'gpt-4o-mini',
  };
}

export interface RegistryAgent {
  fund: Address;
  vault: Address;
  executor: Address;
  creator: Address;
  agentKey: Address;
  name: string;
  logoURI: string;
  description: string;
  templateId: number;
  runnerMode: number;
  strategyHash: `0x${string}`;
  rulesHash: `0x${string}`;
  createdAt: bigint;
  active: boolean;
}

/** Read one agent's record from the on-chain registry. */
export async function loadAgentFromRegistry(
  publicClient: PublicClient,
  registryAddress: Address,
  agentId: bigint,
): Promise<RegistryAgent> {
  const a = await publicClient.readContract({
    address: registryAddress,
    abi: agentRegistryAbi,
    functionName: 'getAgent',
    args: [agentId],
  });
  return {
    fund: a.fund,
    vault: a.vault,
    executor: a.executor,
    creator: a.creator,
    agentKey: a.agentKey,
    name: a.name,
    logoURI: a.logoURI,
    description: a.description,
    templateId: a.templateId,
    runnerMode: a.runnerMode,
    strategyHash: a.strategyHash,
    rulesHash: a.rulesHash,
    createdAt: a.createdAt,
    active: a.active,
  };
}
