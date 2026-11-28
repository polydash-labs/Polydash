// Server-side reader for "Know your agent" identity cards (Scout proposal #1,
// Nov 24, 2026). One agent's public identity, assembled only from on-chain
// reads — nothing invented, nothing self-reported. A field with no on-chain
// source comes back null and the card renders it as "Not published".
//
// Field map (MAS SAFR's four points + AAIF working-group terms):
//   1. Identity — who the agent is, and whom it represents
//      (registry name/id/wallet, ERC-8004 identity, Safe owners)
//   2. Authority — what it is allowed to spend
//      (session-key policy: daily caps, allowlist, expiry, freeze)
//   3. Mandate — what it is allowed to do
//      (the session-key policy bounds + tokenized funds it manages)
//   4. Assurance — why you can believe it
//      (credit score + components + inputs hash, bond, receipts)
//
// No contract changes, no writes. Reads only, cached 60s in-memory (same
// pattern as /api/agents/scores).
//
// Known limits, stated on the card, not hidden:
// - The ERC-8004 identity scan starts at block 120285357 (the first v2
//   factory deploy, Nov 21) — identities registered before that block, or
//   linked outside Polypad's wallet flow, are not found by this scan.
// - The ERC-8004 reputation registry has no verified record for any
//   registered agent yet, so reputation reads "Not published" for now.
// - The session-key policy is only discoverable for v2 agent wallets
//   (agentKeyOf exists only on the v2 module). A v1 wallet's key is not
//   enumerable on-chain, so its policy reads "Not published" here even
//   though the key exists — the wallet's own page shows it.

import { formatUnits, getAddress, parseAbiItem, type Address } from 'viem';
import { publicClient } from '@/lib/agents/tools';
import { AgentRegistryABI, AgentScoreABI } from '@/lib/contracts/agent-credit-score-abi';
import { getAgentRegistryAddress, getAgentScoreAddress } from '@/lib/contracts/addresses';
import { USDG_ADDRESS, POLYDASH_ADDRESS } from '@/lib/x402/constants';
import { AgentWalletModuleV2ABI } from '@/lib/agent-wallet/abi-v2';
import { readFundsList } from '@/lib/fund/list-server';

export const IDENTITY_FORMAT = 'polypad.agent-identity/1' as const;

/** Earliest block an identity linked through Polypad's wallet flow can exist. */
const IDENTITY_SCAN_FROM_BLOCK = 120285357n;
/** getLogs chunk size (same as the wallet identity scan). */
const LOG_CHUNK = 99_000n;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
/** Hood 4663 v2 session-key module, Nov 22 2026 (Sourcify exact_match).
 * Same value as AGENT_WALLET_V2_HOOD.moduleV2 in lib/agent-wallet/client.ts —
 * repeated here because that module is 'use client' and cannot be imported
 * from server code (its exports come back as client-reference stubs). */
const SESSION_KEY_MODULE_V2 = '0xB8A927dfd18D87f5a041706b14424CBBA59Db270' as Address;
const IDENTITY_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as Address;

const RegisteredEvent = parseAbiItem(
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
);
const SafeGetOwnersAbi = parseAbiItem('function getOwners() view returns (address[])');

export interface IdentityTokenCap {
  address: string;
  symbol: string;
  decimals: number;
  /** Daily cap in the token's smallest units (decimal string). */
  dailyCap: string;
  /** Daily cap in human units, e.g. "5000" for $5,000 USDG/day. */
  dailyCapFormatted: string;
}

export interface IdentitySessionKey {
  key: string;
  expiry: number;
  expiryIso: string;
  activeHours: { start: number; end: number };
  frozen: boolean;
  isActive: boolean;
  backupKey: string | null;
  tokens: IdentityTokenCap[];
}

export interface IdentityFund {
  address: string;
  name: string;
  symbol: string;
}

export interface AgentIdentity {
  format: typeof IDENTITY_FORMAT;
  agentId: number;
  name: string;
  wallet: string;
  /** The agent's token-bound (ERC-6551) account, or null when it has none. */
  agentAccount: string | null;
  stakePolydash: string;
  registeredAt: number;
  registeredAtIso: string;
  active: boolean;
  scored: boolean;
  score: number | null;
  scoreBand: string | null;
  scoreComponents: { performance: number; history: number; activity: number; stake: number; conduct: number } | null;
  scoreUpdatedAt: number | null;
  scoreInputsHash: string | null;
  /** ERC-8004 identity, or null when this wallet has none registered. */
  erc8004: { agentId: string; agentURI: string } | null;
  identityScanFromBlock: string;
  /** The Safe owners, when the wallet is a Safe. Null when it is not a Safe. */
  controlledBy: string[] | null;
  /** The session-key authority, or null when no v2 key policy is published. */
  sessionKey: IdentitySessionKey | null;
  fundsManaged: IdentityFund[];
  /** False when the funds list could not be read (do not mistake for "none"). */
  fundsChecked: boolean;
  generatedAt: string;
}

export class AgentNotFoundError extends Error {
  constructor(agentId: number) {
    super(`No registered agent with id ${agentId}.`);
    this.name = 'AgentNotFoundError';
  }
}

function scoreBandFor(score: number): string {
  if (score >= 800) return 'Elite';
  if (score >= 700) return 'Prime';
  if (score >= 600) return 'Standard';
  if (score >= 500) return 'Building';
  return 'New';
}

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [USDG_ADDRESS.toLowerCase()]: { symbol: 'USDG', decimals: 6 },
  [POLYDASH_ADDRESS.toLowerCase()]: { symbol: 'POLYDASH', decimals: 18 },
};

async function readErc8004Identity(wallet: Address): Promise<{ agentId: string; agentURI: string } | null> {
  const latest = await publicClient.getBlockNumber();
  let found: { agentId: string; agentURI: string } | null = null;
  for (let s = IDENTITY_SCAN_FROM_BLOCK; s <= latest; s += LOG_CHUNK) {
    const e = s + LOG_CHUNK - 1n;
    const logs = await publicClient.getLogs({
      address: IDENTITY_REGISTRY_ADDRESS,
      event: RegisteredEvent,
      args: { owner: wallet },
      fromBlock: s,
      toBlock: e > latest ? latest : e,
    });
    for (const l of logs) {
      found = { agentId: (l.args.agentId as bigint).toString(), agentURI: l.args.agentURI as string };
    }
  }
  return found;
}

async function readSessionKey(wallet: Address): Promise<IdentitySessionKey | null> {
  const module = SESSION_KEY_MODULE_V2;
  if (!module) return null;
  const key = (await publicClient.readContract({
    address: module, abi: AgentWalletModuleV2ABI, functionName: 'agentKeyOf', args: [wallet],
  })) as Address;
  if (!key || key.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return null;
  const [policy, tokens, frozen, isActive, backupKey] = await Promise.all([
    publicClient.readContract({
      address: module, abi: AgentWalletModuleV2ABI, functionName: 'getPolicy', args: [wallet, key],
    }) as Promise<{ key: string; expiry: bigint; startHour: number; endHour: number; exists: boolean }>,
    publicClient.readContract({
      address: module, abi: AgentWalletModuleV2ABI, functionName: 'getPolicyTokens', args: [wallet, key],
    }) as Promise<Address[]>,
    publicClient.readContract({
      address: module, abi: AgentWalletModuleV2ABI, functionName: 'frozen', args: [wallet],
    }) as Promise<boolean>,
    publicClient.readContract({
      address: module, abi: AgentWalletModuleV2ABI, functionName: 'isKeyActive', args: [wallet, key],
    }) as Promise<boolean>,
    publicClient.readContract({
      address: module, abi: AgentWalletModuleV2ABI, functionName: 'backupKey', args: [wallet],
    }) as Promise<Address>,
  ]);
  // Named access only: viem decodes tuples as named-key objects.
  if (!policy.exists) return null;
  const caps: IdentityTokenCap[] = [];
  for (const token of tokens) {
    const cap = (await publicClient.readContract({
      address: module, abi: AgentWalletModuleV2ABI, functionName: 'getTokenCaps', args: [wallet, key, token],
    })) as { daily: bigint };
    const known = KNOWN_TOKENS[token.toLowerCase()];
    caps.push({
      address: getAddress(token),
      symbol: known?.symbol ?? 'Unknown token',
      decimals: known?.decimals ?? 18,
      dailyCap: cap.daily.toString(),
      dailyCapFormatted: formatUnits(cap.daily, known?.decimals ?? 18),
    });
  }
  return {
    key: getAddress(key),
    expiry: Number(policy.expiry),
    expiryIso: new Date(Number(policy.expiry) * 1000).toISOString(),
    activeHours: { start: Number(policy.startHour), end: Number(policy.endHour) },
    frozen,
    isActive,
    backupKey: backupKey && backupKey.toLowerCase() !== ZERO_ADDRESS.toLowerCase() ? getAddress(backupKey) : null,
    tokens: caps,
  };
}

async function readControlledBy(wallet: Address): Promise<string[] | null> {
  try {
    const owners = (await publicClient.readContract({
      address: wallet, abi: [SafeGetOwnersAbi], functionName: 'getOwners',
    })) as Address[];
    return owners.map((o) => getAddress(o));
  } catch {
    // Not a Safe (most registered agents are plain wallets) — no owners to show.
    return null;
  }
}

async function readFundsManaged(wallet: Address): Promise<{ funds: IdentityFund[]; checked: boolean }> {
  try {
    const list = await readFundsList();
    const all = [...(list.phase3 ?? []), ...(list.v2 ?? []), ...(list.v3 ?? []), ...(list.legacy ?? [])];
    return {
      funds: all
        .filter((f) => f.manager && f.manager.toLowerCase() === wallet.toLowerCase())
        .map((f) => ({ address: getAddress(f.address), name: f.name, symbol: f.symbol })),
      checked: true,
    };
  } catch {
    return { funds: [], checked: false };
  }
}

export async function readAgentIdentity(agentId: number): Promise<AgentIdentity> {
  const registry = getAddress(getAgentRegistryAddress() as `0x${string}`);
  const scoreAddr = getAddress(getAgentScoreAddress() as `0x${string}`);
  const count = Number(await publicClient.readContract({ address: registry, abi: AgentRegistryABI, functionName: 'agentCount' }));
  if (!Number.isInteger(agentId) || agentId < 1 || agentId > count) throw new AgentNotFoundError(agentId);

  const [a, s] = await Promise.all([
    publicClient.readContract({ address: registry, abi: AgentRegistryABI, functionName: 'getAgent', args: [BigInt(agentId)] }) as Promise<{ wallet: string; agentAccount: string; name: string; stake: bigint; registeredAt: bigint; active: boolean }>,
    publicClient.readContract({ address: scoreAddr, abi: AgentScoreABI, functionName: 'scores', args: [BigInt(agentId)] }) as Promise<{ score: number; performance: number; history: number; activity: number; stake: number; conduct: number; updatedAt: bigint; inputsHash: string; exists: boolean }>,
  ]);
  // Named access only: viem decodes tuples as named-key objects (same lesson
  // as the scores directory, Nov 20).
  const wallet = getAddress(a.wallet);
  const scored = s.exists === true;
  const [erc8004, sessionKey, controlledBy, funds] = await Promise.all([
    readErc8004Identity(wallet),
    readSessionKey(wallet),
    readControlledBy(wallet),
    readFundsManaged(wallet),
  ]);
  return {
    format: IDENTITY_FORMAT,
    agentId,
    name: a.name || `Agent #${agentId}`,
    wallet,
    agentAccount: a.agentAccount && a.agentAccount.toLowerCase() !== ZERO_ADDRESS.toLowerCase() ? getAddress(a.agentAccount) : null,
    stakePolydash: formatUnits(a.stake ?? 0n, 18),
    registeredAt: Number(a.registeredAt),
    registeredAtIso: new Date(Number(a.registeredAt) * 1000).toISOString(),
    active: a.active,
    scored,
    score: scored ? Number(s.score) : null,
    scoreBand: scored ? scoreBandFor(Number(s.score)) : null,
    scoreComponents: scored
      ? { performance: Number(s.performance), history: Number(s.history), activity: Number(s.activity), stake: Number(s.stake), conduct: Number(s.conduct) }
      : null,
    scoreUpdatedAt: scored ? Number(s.updatedAt) : null,
    scoreInputsHash: scored ? s.inputsHash : null,
    erc8004,
    identityScanFromBlock: IDENTITY_SCAN_FROM_BLOCK.toString(),
    controlledBy,
    sessionKey,
    fundsManaged: funds.funds,
    fundsChecked: funds.checked,
    generatedAt: new Date().toISOString(),
  };
}

// In-memory cache, 60s TTL (same pattern as /api/agents/scores). The page
// and the API route share this process, so one read serves both.
const TTL_MS = 60_000;
type Entry = { value?: AgentIdentity; at: number; inflight?: Promise<AgentIdentity> };
const cache = new Map<number, Entry>();

export async function readAgentIdentityCached(agentId: number): Promise<AgentIdentity> {
  const entry = cache.get(agentId);
  if (entry?.value && Date.now() - entry.at < TTL_MS) return entry.value;
  if (entry?.inflight) return entry.inflight;
  const p = readAgentIdentity(agentId)
    .then((value) => { cache.set(agentId, { value, at: Date.now() }); return value; })
    .catch((err) => {
      cache.delete(agentId);
      throw err;
    });
  cache.set(agentId, { value: entry?.value, at: entry?.at ?? 0, inflight: p });
  return p;
}
