// Agent-earn eligibility — server-side, on-chain reads only.
// Two gates, both enforced off-chain BEFORE a transaction reaches the
// contract (the contract itself only enforces first-claim-wins):
//
// 1. Claim gate (brief §1.2): the claiming wallet must belong to a
//    REGISTERED agent with a v2 session-key wallet. No score floor.
//    Agent #1 (Quant Trader) runs from a plain EOA with no session-key
//    policy — it is refused with a plain-language reason. No exception.
// 2. Evaluator gate (brief §1.5): registered, credit score >= 300,
//    session-key wallet. Conflicts (poster, claiming agent) excluded.
//
// Same-owner/operator exclusion is a pilot limitation: the registry does
// not publish an owner per agent, so Atlas curates the first eligible
// list and removes same-operator agents at draw time (the draw UI shows
// the pool and lets Atlas exclude entries before drawing).

import { getAddress, type Address, type Hex } from 'viem';
import { publicClient } from '@/lib/agents/tools';
import { AgentRegistryABI, AgentScoreABI } from '@/lib/contracts/agent-credit-score-abi';
import { getAgentRegistryAddress, getAgentScoreAddress } from '@/lib/contracts/addresses';
import { AgentWalletModuleV2ABI } from '@/lib/agent-wallet/abi-v2';
import { EVALUATOR_MIN_SCORE, PANEL_SIZE } from './constants';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const SESSION_KEY_MODULE_V2 = '0xB8A927dfd18D87f5a041706b14424CBBA59Db270' as Address;

export interface AgentStanding {
  agentId: number;
  name: string;
  wallet: string;
  active: boolean;
  score: number | null;
  hasSessionKey: boolean;
  sessionKeyActive: boolean;
  frozen: boolean;
}

export interface ClaimEligibility {
  eligible: boolean;
  wallet: string;
  agentId: number | null;
  name: string | null;
  /** Plain-language reason when ineligible — shown to the agent. */
  reason: string | null;
}

async function readAgentStanding(agentId: number): Promise<AgentStanding | null> {
  const registry = getAddress(getAgentRegistryAddress() as `0x${string}`);
  const scoreAddr = getAddress(getAgentScoreAddress() as `0x${string}`);
  try {
    const [a, s] = await Promise.all([
      publicClient.readContract({
        address: registry, abi: AgentRegistryABI, functionName: 'getAgent', args: [BigInt(agentId)],
      }) as Promise<{ wallet: string; agentAccount: string; name: string; stake: bigint; registeredAt: bigint; active: boolean }>,
      publicClient.readContract({
        address: scoreAddr, abi: AgentScoreABI, functionName: 'scores', args: [BigInt(agentId)],
      }) as Promise<{ score: number; exists: boolean }>,
    ]);
    const wallet = getAddress(a.wallet);
    const key = (await publicClient.readContract({
      address: SESSION_KEY_MODULE_V2, abi: AgentWalletModuleV2ABI, functionName: 'agentKeyOf', args: [wallet],
    })) as Address;
    let hasSessionKey = false;
    let sessionKeyActive = false;
    let frozen = false;
    if (key && key.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      const [policy, active, frz] = await Promise.all([
        publicClient.readContract({
          address: SESSION_KEY_MODULE_V2, abi: AgentWalletModuleV2ABI, functionName: 'getPolicy', args: [wallet, key],
        }) as Promise<{ exists: boolean }>,
        publicClient.readContract({
          address: SESSION_KEY_MODULE_V2, abi: AgentWalletModuleV2ABI, functionName: 'isKeyActive', args: [wallet, key],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: SESSION_KEY_MODULE_V2, abi: AgentWalletModuleV2ABI, functionName: 'frozen', args: [wallet],
        }) as Promise<boolean>,
      ]);
      hasSessionKey = policy.exists === true;
      sessionKeyActive = active === true;
      frozen = frz === true;
    }
    return {
      agentId,
      name: a.name || `Agent #${agentId}`,
      wallet,
      active: a.active,
      score: s.exists ? Number(s.score) : null,
      hasSessionKey,
      sessionKeyActive,
      frozen,
    };
  } catch {
    return null;
  }
}

/** Claim standing for a connected wallet address. */
export async function getClaimEligibility(wallet: string): Promise<ClaimEligibility> {
  const registry = getAddress(getAgentRegistryAddress() as `0x${string}`);
  let agentId = 0n;
  try {
    agentId = (await publicClient.readContract({
      address: registry, abi: AgentRegistryABI, functionName: 'agentIdByWallet', args: [getAddress(wallet)],
    })) as bigint;
  } catch {
    return { eligible: false, wallet, agentId: null, name: null, reason: 'Could not read the agent registry right now. Try again.' };
  }
  if (agentId === 0n) {
    return { eligible: false, wallet, agentId: null, name: null, reason: 'This wallet is not a registered agent. Register the agent first, then claim from its session-key wallet.' };
  }
  const standing = await readAgentStanding(Number(agentId));
  if (!standing) {
    return { eligible: false, wallet, agentId: Number(agentId), name: null, reason: 'Could not read this agent right now. Try again.' };
  }
  if (!standing.active) {
    return { eligible: false, wallet, agentId: standing.agentId, name: standing.name, reason: `${standing.name} is not active in the registry.` };
  }
  if (!standing.hasSessionKey) {
    // Agent #1 (Quant Trader) lands here: plain EOA, no session-key policy.
    return {
      eligible: false,
      wallet,
      agentId: standing.agentId,
      name: standing.name,
      reason: `${standing.name} runs from a plain wallet with no session-key policy. Pilot jobs can only be claimed from a session-key wallet — move the agent onto one first. No exceptions, not even for the flagship agent.`,
    };
  }
  if (standing.frozen) {
    return { eligible: false, wallet, agentId: standing.agentId, name: standing.name, reason: `${standing.name}'s wallet is frozen. Unfreeze it before claiming.` };
  }
  if (!standing.sessionKeyActive) {
    return { eligible: false, wallet, agentId: standing.agentId, name: standing.name, reason: `${standing.name}'s session key is not active right now (expired or outside its active hours).` };
  }
  return { eligible: true, wallet, agentId: standing.agentId, name: standing.name, reason: null };
}

/** The evaluator pool: registered, active, score >= 300, session-key
 * wallet. `excludeWallets` removes conflicts (poster, claiming agent).
 * `excludeAgentIds` removes same-operator agents Atlas flags by hand. */
export async function getEligibleEvaluators(
  excludeWallets: string[] = [],
  excludeAgentIds: number[] = [],
): Promise<AgentStanding[]> {
  const registry = getAddress(getAgentRegistryAddress() as `0x${string}`);
  const count = Number(await publicClient.readContract({
    address: registry, abi: AgentRegistryABI, functionName: 'agentCount',
  }));
  const excluded = new Set(excludeWallets.map((w) => w.toLowerCase()));
  const excludedIds = new Set(excludeAgentIds);
  const out: AgentStanding[] = [];
  for (let id = 1; id <= count; id++) {
    if (excludedIds.has(id)) continue;
    const s = await readAgentStanding(id);
    if (!s) continue;
    if (!s.active || !s.hasSessionKey || !s.sessionKeyActive || s.frozen) continue;
    if (s.score === null || s.score < EVALUATOR_MIN_SCORE) continue;
    if (excluded.has(s.wallet.toLowerCase())) continue;
    out.push(s);
  }
  return out;
}

// --- Seeded draw (auditable): the same seed + pool always draws the same
// three evaluators, so anyone can re-run the draw from the receipt. ---

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw PANEL_SIZE evaluators from the pool. Returns the drawn agentIds
 * plus the seed that reproduces the draw. */
export function drawPanel(poolAgentIds: number[], seedHex?: Hex): { drawn: number[]; seed: Hex } {
  const seed = seedHex ?? (`0x${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex);
  const seedNum = parseInt(seed.slice(2, 10), 16);
  const rand = mulberry32(seedNum);
  const shuffled = [...poolAgentIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { drawn: shuffled.slice(0, PANEL_SIZE), seed };
}
