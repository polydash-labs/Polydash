/**
 * viem clients and contract ABIs for the Phase 4 agent runner.
 *
 * The executor / registry ABIs are written from the exact function signatures
 * in src/fund/phase4/SPEC.md. The vault / allowlist ABIs are the Phase 2 read
 * interfaces (FundVaultInvest / IFundAllowlist) — read-only, never modified.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { RunnerConfig } from './config.js';

/** Robinhood Chain mainnet (chain id 4663). */
export function robinhoodChain(rpcUrl: string): Chain {
  return defineChain({
    id: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/** FundVaultInvest.Status: 0 Raising, 1 RaisingClosed, 2 Investing, 3 Failed. */
export const FUND_STATUS = ['Raising', 'RaisingClosed', 'Investing', 'Failed'] as const;
export const FUND_STATUS_INVESTING = 2;

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

/** AgentExecutor — see SPEC.md "AgentExecutor.sol". */
export const agentExecutorAbi = [
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
  { type: 'function', name: 'nextNonce', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'agentKey', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
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
    type: 'function',
    name: 'highWaterNavPerNft',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'lastExecution',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tradesToday',
    stateMutability: 'view',
    inputs: [{ name: 'day', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'InstructionExecuted',
    inputs: [
      { name: 'vault', type: 'address', indexed: false },
      { name: 'assetIn', type: 'address', indexed: false },
      { name: 'assetOut', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'minAmountOut', type: 'uint256', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'navPerNftAfter', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CircuitBreakerTripped',
    inputs: [
      { name: 'navPerNft', type: 'uint256', indexed: false },
      { name: 'highWaterNavPerNft', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  { type: 'event', name: 'AgentPaused', inputs: [], anonymous: false },
  { type: 'event', name: 'AgentUnpaused', inputs: [], anonymous: false },
  {
    type: 'event',
    name: 'AgentKeyUpdated',
    inputs: [{ name: 'newKey', type: 'address', indexed: false }],
    anonymous: false,
  },
  { type: 'event', name: 'AgentRetired', inputs: [], anonymous: false },
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

/** AgentRegistry — a directory, not a security boundary (see SPEC.md). */
export const agentRegistryAbi = [
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
      { name: 'agentId', type: 'uint256', indexed: false },
      { name: 'fund', type: 'address', indexed: false },
      { name: 'executor', type: 'address', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentUpdated',
    inputs: [{ name: 'agentId', type: 'uint256', indexed: false }],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentRetired',
    inputs: [{ name: 'agentId', type: 'uint256', indexed: false }],
    anonymous: false,
  },
] as const;

/** FundVaultInvest — Phase 2 read interface only. */
export const fundVaultAbi = [
  { type: 'function', name: 'manager', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'status', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'swapsPaused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  {
    type: 'function',
    name: 'isExecutor',
    stateMutability: 'view',
    inputs: [{ name: 'who', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'inMandate',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  { type: 'function', name: 'allowlist', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'weth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'maxPositionBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'maxTradeBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'maxDeviationBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'nav', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'navPerNft', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'spendableEth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'mandateAssetCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function',
    name: 'mandateAssets',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/** IFundAllowlist — Phase 2 read interface only. */
export const fundAllowlistAbi = [
  {
    type: 'function',
    name: 'assetAllowed',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'routerAllowed',
    stateMutability: 'view',
    inputs: [{ name: 'router', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'view',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'checkPrice',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [],
  },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'delay', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'quoteAsset', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const;

/** Minimal ERC-20 reads (balances / decimals / symbol for mandate assets + WETH). */
export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const;

export interface Clients {
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: PrivateKeyAccount;
}

export function createClients(config: RunnerConfig): Clients {
  const chain = config.chainId === 4663 ? robinhoodChain(config.rpcUrl) : defineChain({
    id: config.chainId,
    name: `Chain ${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const account = privateKeyToAccount(config.agentPrivateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  return { chain, publicClient, walletClient, account };
}
