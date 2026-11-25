// Minimal ABIs + contract addresses for the receipt verifier.
// Only the functions and events the verifier actually re-reads are listed.
// Contracts are unaudited (Slither only). Addresses are the live mainnet
// deployments on Robinhood Chain (4663).

import { parseAbi } from 'viem';

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER_URL = 'https://robinhoodchain.blockscout.com';

export const AGENT_REGISTRY_ADDRESS = '0x514e352A12F3DB3d4cA649dD328776390e1725eF' as const;
export const AGENT_SCORE_ADDRESS = '0x1F7ebaAf16aEAa2F519D2Cc69B6091f908C6C92b' as const;
export const FUND_ALLOWLIST_ADDRESS = '0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19' as const;

/** 1,000 POLYDASH registration bond (18 decimals). */
export const REGISTRATION_STAKE = 1000n * 10n ** 18n;

export const agentRegistryVerifierAbi = parseAbi([
  'function agentIdByWallet(address wallet) view returns (uint256)',
  'function isRegistered(uint256 agentId) view returns (bool)',
  'function REGISTRATION_STAKE() view returns (uint256)',
]);

export const agentScoreVerifierAbi = parseAbi([
  'function getScore(uint256 agentId) view returns (uint16 score, uint16 performance, uint16 history, uint16 activity, uint16 stake, uint16 conduct, uint64 updatedAt, bytes32 inputsHash, bool exists)',
  'function updater() view returns (address)',
  'function weightedScore(uint16 performance, uint16 history, uint16 activity, uint16 stake, uint16 conduct) view returns (uint16)',
  'function bandOf(uint256 agentId) view returns (uint8)',
  'function owner() view returns (address)',
]);

export const fundAllowlistVerifierAbi = parseAbi([
  'function proposals(uint256 id) view returns (address target, bool isRouter, bool allowed, uint64 readyAt, bool executed, bool canceled, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)',
  'function owner() view returns (address)',
  'function delay() view returns (uint256)',
  'function assetAllowed(address asset) view returns (bool)',
  'function feedOf(address asset) view returns (address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)',
]);

/** getAgent returns a struct with a dynamic string. viem 2.58 readContract
 *  mis-decodes struct returns of this shape, so the verifier reads the raw
 *  return data with client.call and decodes the tuple explicitly. */
export const agentTupleAbiParameters = '(address wallet, address agentAccount, string name, uint256 stake, uint64 registeredAt, bool active)' as const;

export const getAgentCallAbi = parseAbi([
  'function getAgent(uint256 agentId) view returns (address wallet, address agentAccount, string name, uint256 stake, uint64 registeredAt, bool active)',
]);

export const scorePostedCallAbi = parseAbi([
  'function updateScore(uint256 agentId, uint16 score, uint16[5] components, bytes32 inputsHash)',
]);

export const allowlistCallAbi = parseAbi([
  'function execute(uint256 id)',
  'function proposeAsset(address asset, address feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)',
]);

export const receiptEventsAbi = parseAbi([
  'event ScoreUpdated(uint256 indexed agentId, uint16 score, uint16 performance, uint16 history, uint16 activity, uint16 stake, uint16 conduct, bytes32 inputsHash, uint64 updatedAt)',
  'event Proposed(uint256 indexed id, address indexed target, bool isRouter, bool allowed, uint64 readyAt)',
  'event Executed(uint256 indexed id, address indexed target, bool isRouter, bool allowed)',
  'event FeedSet(address indexed asset, address indexed feed, uint64 maxStale, uint256 minPriceX18, uint256 maxPriceX18)',
]);
