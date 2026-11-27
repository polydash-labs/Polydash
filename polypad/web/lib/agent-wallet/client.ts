// Agent Wallets — chain layer. ALL wallet chain calls go through here so the
// swap to the final contract ABIs is lib/agent-wallet/abi.ts + env vars only.
//
// SECURITY — the agent key: generated in the browser (viem generatePrivateKey),
// held in page state only. It is NEVER sent to Polypad's server, NEVER stored
// in localStorage / sessionStorage / IndexedDB, NEVER logged. No function in
// this file takes a private key, and no fetch in this file carries one. The
// only key material that ever leaves the browser is the agent key's ADDRESS
// (a public identifier) in the createWallet call.
//
// PROVISIONAL: factory + module ABIs are derived from the brief (see abi.ts).
// Until NEXT_PUBLIC_AGENT_WALLET_FACTORY_ADDRESS is set, the factory is not
// live and creation is honestly gated in the UI — nothing is faked.
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from 'wagmi';
import {
  encodeFunctionData, formatEther, formatUnits, isAddress, parseAbiItem, parseUnits,
} from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { AgentWalletFactoryABI, AgentWalletModuleABI, SafeABI } from './abi';
import { AgentWallet4337ModuleABI, AgentWalletFactoryV2ABI, AgentWalletModuleV2ABI, AgentWalletPaymasterABI, IdentityRegistryABI } from './abi-v2';
import { REGISTRY_ADDRESS, SCORE_ADDRESS, useAgentScoreByWallet, type WalletScore } from '@/lib/agents/credit-score';
import { SPEND_VAULT_ADDRESS } from '@/lib/agents/spend-vault';
import { USDG_ADDRESS, POLYDASH_ADDRESS } from '@/lib/x402/constants';
import { erc20Abi, stakingPoolAbi } from '@/lib/staking/shared';
// Type-only: erased at compile time, so the server module (viem client, no
// wagmi) never enters the client bundle.
import type { WalletDetailStateJson } from './server';

export type Addr = `0x${string}`;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Addr;

function envAddr(v: string | undefined): Addr | undefined {
  if (!v || v === '' || v.toLowerCase() === ZERO_ADDRESS) return undefined;
  return v as Addr;
}

export const AGENT_WALLET_FACTORY_ADDRESS = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_FACTORY_ADDRESS);
export const AGENT_WALLET_MODULE_ADDRESS = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_MODULE_ADDRESS);
/** True only once the wallet factory is deployed and wired up. */
export const isFactoryLive = !!AGENT_WALLET_FACTORY_ADDRESS && !!AGENT_WALLET_MODULE_ADDRESS;

export const SAFE_SINGLETON_V130 = '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552' as Addr;
// Checksum verified with viem getAddress Nov 20, 2026 — the old
// ...C4F9c8A4f820ec67 casing is wrong and viem rejects it at runtime.
export const SAFE_PROXY_FACTORY_V141 = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Addr;
export const RELAY_ONRAMP_URL = 'https://relay.link/onramp/robinhood';
export const MCP_URL = 'https://polypad.family/api/mcp';
export const REGISTRATION_BOND_POLYDASH = 1000n * 10n ** 18n;

/** First block to scan for WalletCreated events. The factory is new, so the
 * default window (latest − 5,000,000 blocks, ~6 days at ~0.1s blocks) covers
 * every wallet it could have created; set the env var for a precise start. */
const FACTORY_DEPLOY_BLOCK = (() => {
  const v = process.env.NEXT_PUBLIC_AGENT_WALLET_FACTORY_DEPLOY_BLOCK;
  if (v && /^\d+$/.test(v)) return BigInt(v);
  return null;
})();
const LOG_CHUNK = 99_000n;

export function explorerAddress(address: string) { return getExplorerAddressUrl(address); }
export function explorerTx(hash: string) { return getExplorerTxUrl(hash); }

// ---------------------------------------------------------------- presets

export interface WalletPreset {
  key: 'small' | 'medium' | 'large';
  label: string;
  blurb: string;
  perPaymentUsdg: string; // dollars, human units
  dailyUsdg: string;
  weeklyUsdg: string;
}

export const WALLET_PRESETS: WalletPreset[] = [
  { key: 'small', label: 'Small', blurb: 'Pocket money. Good for trying things out and paying for small reports.', perPaymentUsdg: '0.10', dailyUsdg: '1', weeklyUsdg: '7' },
  { key: 'medium', label: 'Medium', blurb: 'A working agent. Pays for reports, small trades, and day-to-day jobs.', perPaymentUsdg: '1', dailyUsdg: '10', weeklyUsdg: '70' },
  { key: 'large', label: 'Large', blurb: 'A busy agent. Bigger jobs, bigger trades — still capped every day.', perPaymentUsdg: '10', dailyUsdg: '100', weeklyUsdg: '700' },
];

export const FUNDING_AMOUNTS = [5, 25, 100] as const;
export const DEFAULT_EXPIRY_DAYS = 90;
/** 2-day recovery timelock, matching the tokenized-fund wait. */
export const RECOVERY_TIMELOCK_HOURS = 48;

/** Default allowlist: Polypad's own contracts + standard token activity.
 * The module requires every target to be allowlisted — an EMPTY allowlist
 * means NOTHING is allowed, not "any target". The wizard always starts
 * from these defaults and only replaces them with a valid custom list. */
export const DEFAULT_ALLOWED_TARGETS: Addr[] = [
  SPEND_VAULT_ADDRESS,
  REGISTRY_ADDRESS,
  SCORE_ADDRESS,
].filter((a): a is Addr => !!a);

/**
 * The wizard/dashboard view of a key's limits, in USDG (6 decimals).
 * On-chain the caps are PER TOKEN (module TokenCaps per token address) and
 * the base policy is KeyPolicy{key, expiry, startHour, endHour, exists} —
 * see useWalletPolicy, which reads getPolicy + getTokenCaps + getSpent.
 * This type is the USDG slice of that on-chain policy, plus the allowlist
 * the wizard chose at creation (the allowlist is not enumerable on-chain).
 */
export interface WalletPolicy {
  perPaymentCapUsdg: bigint;
  dailyCapUsdg: bigint;
  weeklyCapUsdg: bigint;
  expiry: number; // unix seconds
  startHour: number; // 0–23, UTC; 0/0 = no window
  endHour: number;
  allowedTargets: Addr[];
}

/** Build the factory's PolicyInput struct from a WalletPolicy: USDG caps
 * on the USDG token, plus the allowlist. Any other token needs a separate
 * setTokenCaps call (owner-signed) after creation. */
export function policyToInput(policy: WalletPolicy) {
  return {
    expiry: BigInt(policy.expiry),
    startHour: policy.startHour,
    endHour: policy.endHour,
    tokens: [USDG_TOKEN_ADDRESS as Addr],
    caps: [{
      perPayment: policy.perPaymentCapUsdg,
      daily: policy.dailyCapUsdg,
      weekly: policy.weeklyCapUsdg,
    }],
    allowedTargets: policy.allowedTargets,
  };
}

/** Random salt for the factory's CREATE2 proxy address — unique per wallet. */
export function randomSaltNonce(): bigint {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return BigInt(`0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`);
}

export function presetToPolicy(preset: WalletPreset, expiryDays = DEFAULT_EXPIRY_DAYS): WalletPolicy {
  return {
    perPaymentCapUsdg: parseUnits(preset.perPaymentUsdg, 6),
    dailyCapUsdg: parseUnits(preset.dailyUsdg, 6),
    weeklyCapUsdg: parseUnits(preset.weeklyUsdg, 6),
    expiry: Math.floor(Date.now() / 1000) + expiryDays * 86400,
    startHour: 0,
    endHour: 0,
    allowedTargets: [...DEFAULT_ALLOWED_TARGETS],
  };
}

export function usdg(amount: bigint): string {
  const [int, frac] = formatUnits(amount, 6).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

// ---------------------------------------------------------------- discovery

export interface AgentWalletRow {
  safe: Addr;
  owner: Addr;
  agentKey: Addr;
  createdBlock: bigint;
  txHash: string;
}

const WalletCreatedEvent = parseAbiItem(
  'event WalletCreated(address indexed safe, address indexed owner, address indexed agentKey)',
);

/** Every wallet the connected owner created, newest first. Reads factory
 * WalletCreated events in ≤99k-block chunks (the RPC rejects larger spans). */
export function useAgentWallets(owner: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!owner && isAddress(owner, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'fleet', owner?.toLowerCase()],
    enabled: !!client && valid && isFactoryLive,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AgentWalletRow[]> => {
      if (!client || !valid || !AGENT_WALLET_FACTORY_ADDRESS) return [];
      const latest = await client.getBlockNumber();
      const from = FACTORY_DEPLOY_BLOCK ?? (latest > 5_000_000n ? latest - 5_000_000n : 0n);
      const logs: { args: { safe: string; owner: string; agentKey: string }; blockNumber: bigint; transactionHash: string }[] = [];
      for (let s = from; s <= latest; s += LOG_CHUNK) {
        const e = s + LOG_CHUNK - 1n;
        const part = await client.getLogs({
          address: AGENT_WALLET_FACTORY_ADDRESS, event: WalletCreatedEvent,
          args: { owner: owner as Addr },
          fromBlock: s, toBlock: e > latest ? latest : e,
        });
        logs.push(...(part as typeof logs));
      }
      return logs
        .map((l) => ({
          safe: l.args.safe as Addr,
          owner: l.args.owner as Addr,
          agentKey: l.args.agentKey as Addr,
          createdBlock: l.blockNumber,
          txHash: l.transactionHash,
        }))
        .reverse();
    },
  });
}

/** One wallet's on-chain state: ETH + USDG held directly, frozen flag.
 * The agent key is NOT readable from the module (there is no agentKeyOf) —
 * it comes from the WalletCreated / KeyRotated events; see useAgentKeyForSafe. */
export function useWalletState(safe: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'state', safe?.toLowerCase()],
    enabled: !!client && valid,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !valid) return null;
      const [eth, usdgBal, frozen] = await Promise.all([
        client.getBalance({ address: safe as Addr }),
        client.readContract({ address: USDG_ADDRESS as Addr, abi: erc20Abi, functionName: 'balanceOf', args: [safe as Addr] }) as Promise<bigint>,
        isFactoryLive && AGENT_WALLET_MODULE_ADDRESS
          ? (client.readContract({ address: AGENT_WALLET_MODULE_ADDRESS, abi: AgentWalletModuleABI, functionName: 'frozen', args: [safe as Addr] }) as Promise<boolean>).catch(() => false)
          : Promise.resolve(false),
      ]);
      return { eth, usdg: usdgBal, frozen };
    },
  });
}

/** v2 wallets read their frozen flag from the v2 module, not the v1 one. */
export function useWalletStateV2(safe: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'state-v2', safe?.toLowerCase()],
    enabled: !!client && valid && isFactoryV2Live,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !valid) return null;
      const [eth, usdgBal, frozen] = await Promise.all([
        client.getBalance({ address: safe as Addr }),
        client.readContract({ address: USDG_ADDRESS as Addr, abi: erc20Abi, functionName: 'balanceOf', args: [safe as Addr] }) as Promise<bigint>,
        AGENT_WALLET_MODULE_V2_ADDRESS
          ? (client.readContract({ address: AGENT_WALLET_MODULE_V2_ADDRESS, abi: AgentWalletModuleV2ABI, functionName: 'frozen', args: [safe as Addr] }) as Promise<boolean>).catch(() => false)
          : Promise.resolve(false),
      ]);
      return { eth, usdg: usdgBal, frozen };
    },
  });
}

const KeyRotatedEvent = parseAbiItem(
  'event KeyRotated(address indexed safe, address indexed oldKey, address indexed newKey)',
);

/** The wallet's CURRENT agent key, from on-chain events: the WalletCreated
 * event names the original key; a later KeyRotated event (if any) names the
 * replacement. The module stores no "current key" getter, so events are the
 * source of truth. Returns undefined while loading / before deployment. */
export function useAgentKeyForSafe(safe: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'agent-key', safe?.toLowerCase()],
    enabled: !!client && valid && isFactoryLive,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Addr | undefined> => {
      if (!client || !valid || !AGENT_WALLET_FACTORY_ADDRESS || !AGENT_WALLET_MODULE_ADDRESS) return undefined;
      const latest = await client.getBlockNumber();
      const from = FACTORY_DEPLOY_BLOCK ?? (latest > 5_000_000n ? latest - 5_000_000n : 0n);
      let key: Addr | undefined;
      for (let s = from; s <= latest; s += LOG_CHUNK) {
        const e = s + LOG_CHUNK - 1n;
        const to = e > latest ? latest : e;
        const [created, rotated] = await Promise.all([
          client.getLogs({ address: AGENT_WALLET_FACTORY_ADDRESS, event: WalletCreatedEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: AGENT_WALLET_MODULE_ADDRESS, event: KeyRotatedEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
        ]);
        for (const l of created as { args: { agentKey: string } }[]) key = l.args.agentKey as Addr;
        // Rotations are in block order within the chunk; the last one wins.
        const sorted = [...(rotated as { args: { newKey: string }; blockNumber: bigint; logIndex: number }[])].sort(
          (a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)),
        );
        for (const l of sorted) key = l.args.newKey as Addr;
      }
      return key;
    },
  });
}

/** The agent key's live policy + what it spent today (module layer).
 * Real on-chain shape: getPolicy(safe, key) -> KeyPolicy{key, expiry,
 * startHour, endHour, exists}; caps are per token via
 * getTokenCaps(safe, key, token); spent per token via getSpent.
 * `revoked` means the policy no longer exists (revokeKey deletes it).
 * The allowlist is NOT enumerable on-chain, so it comes back empty here —
 * the wizard's chosen list lives in the creation call, and per-target
 * checks use allowedTargets(safe, target) directly. */
export function useWalletPolicy(safe: string | undefined, agentKey: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!agentKey && isAddress(agentKey, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'policy', safe?.toLowerCase(), agentKey?.toLowerCase()],
    enabled: !!client && valid && isFactoryLive,
    refetchInterval: 30_000,
    queryFn: async (): Promise<(WalletPolicy & { revoked: boolean; active: boolean; spentTodayUsdg: bigint; spentThisWeekUsdg: bigint }) | null> => {
      if (!client || !valid || !AGENT_WALLET_MODULE_ADDRESS) return null;
      const [policy, caps, spent, active] = await Promise.all([
        client.readContract({
          address: AGENT_WALLET_MODULE_ADDRESS, abi: AgentWalletModuleABI, functionName: 'getPolicy', args: [safe as Addr, agentKey as Addr],
        }) as Promise<{ key: string; expiry: bigint; startHour: number; endHour: number; exists: boolean }>,
        client.readContract({
          address: AGENT_WALLET_MODULE_ADDRESS, abi: AgentWalletModuleABI, functionName: 'getTokenCaps', args: [safe as Addr, agentKey as Addr, USDG_TOKEN_ADDRESS as Addr],
        }) as Promise<{ perPayment: bigint; daily: bigint; weekly: bigint }>,
        client.readContract({
          address: AGENT_WALLET_MODULE_ADDRESS, abi: AgentWalletModuleABI, functionName: 'getSpent', args: [safe as Addr, agentKey as Addr, USDG_TOKEN_ADDRESS as Addr],
        }) as Promise<[bigint, bigint, bigint, bigint]>,
        client.readContract({
          address: AGENT_WALLET_MODULE_ADDRESS, abi: AgentWalletModuleABI, functionName: 'isKeyActive', args: [safe as Addr, agentKey as Addr],
        }) as Promise<boolean>,
      ]);
      // Named access only: viem decodes tuples as named-key objects —
      // p[0] would be undefined (same lesson as the scores directory, Nov 20).
      if (!policy.exists) return null;
      return {
        allowedTargets: [],
        perPaymentCapUsdg: caps.perPayment,
        dailyCapUsdg: caps.daily,
        weeklyCapUsdg: caps.weekly,
        expiry: Number(policy.expiry),
        startHour: Number(policy.startHour),
        endHour: Number(policy.endHour),
        revoked: false,
        active,
        spentTodayUsdg: spent[0],
        spentThisWeekUsdg: spent[1],
      };
    },
  });
}

/** The wallet's credit score, read via the registry entry (getAgent, never the
 * public `agents` mapping getter — see lib/agents/credit-score.ts). */
export function useWalletScore(safe: string | undefined) {
  return useAgentScoreByWallet(safe);
}

// ---------------------------------------------------------------- creation

export function usePredictWalletAddress() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  async function predict(owner: Addr, backupKey: Addr, agentKey: Addr, policy: WalletPolicy): Promise<Addr | null> {
    if (!client || !AGENT_WALLET_FACTORY_ADDRESS) return null;
    try {
      // predictWalletAddress depends only on owner + saltNonce on-chain, but
      // the other params are positional in the ABI — pass the real values.
      return (await client.readContract({
        address: AGENT_WALLET_FACTORY_ADDRESS, abi: AgentWalletFactoryABI, functionName: 'predictWalletAddress',
        args: [owner, backupKey, agentKey, policyToInput(policy), randomSaltNonce()],
      })) as Addr;
    } catch {
      return null;
    }
  }
  return { predict };
}

/** Deploy a wallet: one factory call, owner signs. Returns the new Safe address
 * (from the WalletCreated event in the receipt). The factory's PolicyInput
 * carries the USDG caps + allowlist; any other token needs a separate
 * owner-signed setTokenCaps after creation. */
export function useCreateWallet() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  async function createWallet(owner: Addr, backupKey: Addr, agentKey: Addr, policy: WalletPolicy): Promise<{ safe: Addr; txHash: string }> {
    if (!client || !address || !AGENT_WALLET_FACTORY_ADDRESS) throw new Error('Connect your wallet first — and the wallet factory is not live yet.');
    if (!isAddress(backupKey, { strict: false })) throw new Error('That backup address is not valid.');
    if (backupKey.toLowerCase() === owner.toLowerCase()) throw new Error('The backup key must be a different address from your owner wallet — a spare wallet or hardware wallet.');
    if (backupKey.toLowerCase() === agentKey.toLowerCase()) throw new Error('The backup key must be different from the agent key.');
    const hash = await writeContractAsync({
      address: AGENT_WALLET_FACTORY_ADDRESS, abi: AgentWalletFactoryABI, functionName: 'createWallet',
      args: [owner, backupKey, agentKey, policyToInput(policy), randomSaltNonce()],
      chainId: robinhoodChain.id,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const log = receipt.logs.find((l) => l.address.toLowerCase() === AGENT_WALLET_FACTORY_ADDRESS!.toLowerCase());
    // WalletCreated topics: [sig, safe, owner, agentKey] — address is topic[1].
    const safe = log && log.topics[1] ? (`0x${log.topics[1].slice(26)}` as Addr) : null;
    await queryClient.invalidateQueries({ queryKey: ['agent-wallets'] });
    if (!safe) throw new Error('Wallet deployed but the address could not be read from the receipt — find it on the explorer.');
    return { safe, txHash: hash };
  }

  return { createWallet, connected: !!address, address };
}

// ------------------------------------------------- owner-signed Safe calls
//
// Module admin calls (freeze, rotate, caps) are Safe-only: the owner signs a
// Safe transaction (EIP-712, Safe v1.3.0 domain) and submits execTransaction.
// Threshold is 1 for a single-owner wallet, so one owner signature executes.

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export function useSafeOwnerCall() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  /** Execute `data` on `to` through the Safe, signed by the connected owner. */
  async function execViaSafe(safe: Addr, to: Addr, data: `0x${string}`, value = 0n): Promise<string> {
    if (!client || !address) throw new Error('Connect your wallet first.');
    const nonce = (await client.readContract({ address: safe, abi: SafeABI, functionName: 'nonce' })) as bigint;
    const txHash = (await client.readContract({
      address: safe, abi: SafeABI, functionName: 'getTransactionHash',
      args: [to, value, data, 0, 0n, 0n, 0n, ZERO_ADDRESS, ZERO_ADDRESS, nonce],
    })) as `0x${string}`;
    void txHash;
    const signature = await signTypedDataAsync({
      domain: { name: 'Safe', version: '1.3.0', chainId: robinhoodChain.id, verifyingContract: safe },
      types: SAFE_TX_TYPES,
      primaryType: 'SafeTx',
      message: {
        to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
        gasToken: ZERO_ADDRESS, refundReceiver: ZERO_ADDRESS, nonce,
      },
    });
    const hash = await writeContractAsync({
      address: safe, abi: SafeABI, functionName: 'execTransaction',
      args: [to, value, data, 0, 0n, 0n, 0n, ZERO_ADDRESS, ZERO_ADDRESS, signature],
      chainId: robinhoodChain.id,
    });
    await client.waitForTransactionReceipt({ hash });
    await queryClient.invalidateQueries({ queryKey: ['agent-wallets'] });
    return hash;
  }

  function moduleCall(functionName: 'setFrozen' | 'unfreeze' | 'revokeKey' | 'rotateKey' | 'setKeyPolicy' | 'setTokenCaps' | 'setAllowedTarget', args: unknown[]) {
    if (!AGENT_WALLET_MODULE_ADDRESS) throw new Error('The wallet module is not live yet.');
    return encodeFunctionData({ abi: AgentWalletModuleABI, functionName, args: args as never });
  }

  async function setFrozen(safe: Addr, frozen: boolean): Promise<string> {
    // setFrozen(safe, false) emits Unfrozen; unfreeze(safe) does the same.
    return execViaSafe(safe, AGENT_WALLET_MODULE_ADDRESS!, moduleCall('setFrozen', [safe, frozen]));
  }
  async function revokeAgentKey(safe: Addr, key: Addr): Promise<string> {
    // Module revoke + vault revoke are independent stops; the caller revokes
    // the vault key separately via useSpendingKeys().revokeKey.
    return execViaSafe(safe, AGENT_WALLET_MODULE_ADDRESS!, moduleCall('revokeKey', [safe, key]));
  }
  async function rotateAgentKey(safe: Addr, oldKey: Addr, newKey: Addr): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_ADDRESS!, moduleCall('rotateKey', [safe, oldKey, newKey]));
  }
  async function setKeyPolicy(safe: Addr, key: Addr, policy: WalletPolicy): Promise<string> {
    // Real signature: setKeyPolicy(safe, key, expiry, startHour, endHour).
    // Caps are per token and set separately — see setCaps below.
    return execViaSafe(safe, AGENT_WALLET_MODULE_ADDRESS!, moduleCall('setKeyPolicy', [
      safe, key, BigInt(policy.expiry), policy.startHour, policy.endHour,
    ]));
  }
  async function setTokenCaps(safe: Addr, key: Addr, token: Addr, caps: { perPayment: bigint; daily: bigint; weekly: bigint }): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_ADDRESS!, moduleCall('setTokenCaps', [safe, key, token, caps]));
  }
  async function setAllowedTarget(safe: Addr, target: Addr, allowed: boolean): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_ADDRESS!, moduleCall('setAllowedTarget', [safe, target, allowed]));
  }
  /** Update the full USDG limits: expiry/window first, then the USDG caps.
   * Two owner-signed Safe transactions — the caps editor calls this. */
  async function setCaps(safe: Addr, key: Addr, policy: WalletPolicy): Promise<string[]> {
    const h1 = await setKeyPolicy(safe, key, policy);
    const h2 = await setTokenCaps(safe, key, USDG_TOKEN_ADDRESS as Addr, {
      perPayment: policy.perPaymentCapUsdg,
      daily: policy.dailyCapUsdg,
      weekly: policy.weeklyCapUsdg,
    });
    return [h1, h2];
  }
  return { execViaSafe, setFrozen, revokeAgentKey, rotateAgentKey, setKeyPolicy, setTokenCaps, setAllowedTarget, setCaps, connected: !!address };
}

// ---------------------------------------------------------------- activity

export interface WalletActivityItem {
  kind: string;
  label: string;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  actor: string;
  to?: string;
  value?: bigint;
  success?: boolean;
  /** For kind === 'executed': the token moved (ZERO address = ETH) and its raw amount. */
  token?: string;
  amount?: bigint;
}

const ExecutedEvent = parseAbiItem('event Executed(address indexed safe, address indexed key, address indexed target, address token, uint256 amount, uint256 value)');
const KeyPolicySetEvent = parseAbiItem('event KeyPolicySet(address indexed safe, address indexed key, uint256 expiry, uint8 startHour, uint8 endHour)');
const TokenCapsSetEvent = parseAbiItem('event TokenCapsSet(address indexed safe, address indexed key, address indexed token, uint256 perPayment, uint256 daily, uint256 weekly)');
const TokenCapsSetEventV2 = parseAbiItem('event TokenCapsSet(address indexed safe, address indexed key, address indexed token, uint256 daily)');
const KeyRevokedEvent = parseAbiItem('event KeyRevoked(address indexed safe, address indexed key)');
const FrozenEvent = parseAbiItem('event Frozen(address indexed safe)');
const UnfrozenEvent = parseAbiItem('event Unfrozen(address indexed safe)');
const RotationInitiatedEvent = parseAbiItem('event RotationInitiated(address indexed safe, address indexed oldOwner, address indexed newOwner, uint256 executeAfter)');
const RotationCancelledEvent = parseAbiItem('event RotationCancelled(address indexed safe, address indexed newOwner)');
const RotationCompletedEvent = parseAbiItem('event RotationCompleted(address indexed safe, address indexed oldOwner, address indexed newOwner)');
const ExecutionSuccessEvent = parseAbiItem('event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)');
const ExecutionFailureEvent = parseAbiItem('event ExecutionFailure(bytes32 indexed txHash, uint256 payment)');

/** What moved in an Executed event, in human terms. `approve` counts as
 * spent immediately on-chain, so the feed says so plainly. */
function describeExecuted(args: { target: string; token: string; amount: bigint; value: bigint }): string {
  const to = `${args.target.slice(0, 10)}…`;
  if (args.token === ZERO_ADDRESS) return `Agent sent ${formatEther(args.value)} ETH to ${to}`;
  if (args.token.toLowerCase() === (USDG_TOKEN_ADDRESS as string).toLowerCase()) {
    return `Agent moved $${usdg(args.amount)} USDG to ${to}`;
  }
  return `Agent moved ${args.amount.toString()} of ${args.token.slice(0, 10)}… to ${to}`;
}

/** Full activity feed for one wallet: module events + Safe executions,
 * newest first. Each row links to Blockscout. Pass opts.v2 + the v2 module
 * address for a v2 wallet — its TokenCapsSet carries only the daily cap. */
export function useWalletActivity(safe: string | undefined, fromBlock: bigint | undefined, opts?: { moduleAddress?: Addr; v2?: boolean }) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  const moduleAddress = opts?.moduleAddress ?? AGENT_WALLET_MODULE_ADDRESS;
  const factoryLive = opts?.v2 ? (isFactoryLive || isFactoryV2Live) : isFactoryLive;
  return useQuery({
    queryKey: ['agent-wallets', 'activity', safe?.toLowerCase(), fromBlock?.toString(), opts?.v2 ? 'v2' : 'v1'],
    enabled: !!client && valid && factoryLive && fromBlock !== undefined,
    refetchInterval: 60_000,
    queryFn: async (): Promise<WalletActivityItem[]> => {
      if (!client || !valid || !moduleAddress || fromBlock === undefined) return [];
      const latest = await client.getBlockNumber();
      const items: WalletActivityItem[] = [];
      const push = (logs: unknown[], kind: string, label: (a: Record<string, unknown>) => string) => {
        for (const l of logs as { args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
          items.push({
            kind, label: label(l.args), txHash: l.transactionHash, blockNumber: l.blockNumber,
            logIndex: l.logIndex, actor: String(l.args.key ?? l.args.safe ?? ''),
          });
        }
      };
      for (let s = fromBlock; s <= latest; s += LOG_CHUNK) {
        const e = s + LOG_CHUNK - 1n;
        const to = e > latest ? latest : e;
        const [exec, policy, caps, revoked, frozen, unfrozen, rotated, rotI, rotX, rotC] = await Promise.all([
          client.getLogs({ address: moduleAddress, event: ExecutedEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: KeyPolicySetEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: opts?.v2 ? TokenCapsSetEventV2 : TokenCapsSetEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: KeyRevokedEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: FrozenEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: UnfrozenEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: KeyRotatedEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: RotationInitiatedEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: RotationCancelledEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
          client.getLogs({ address: moduleAddress, event: RotationCompletedEvent, args: { safe: safe as Addr }, fromBlock: s, toBlock: to }),
        ]);
        for (const l of exec as { args: { target: string; token: string; amount: bigint; value: bigint; key: string }; blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
          items.push({
            kind: 'executed',
            label: describeExecuted({ target: l.args.target, token: l.args.token, amount: l.args.amount, value: l.args.value }),
            txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex,
            actor: l.args.key, to: l.args.target, value: l.args.value,
            token: l.args.token, amount: l.args.amount,
          });
        }
        push(policy, 'policy', (a) => {
          const exp = new Date(Number(a.expiry as bigint) * 1000).toLocaleDateString();
          const win = (a.startHour as number) !== 0 || (a.endHour as number) !== 0
            ? `, works ${(a.startHour as number)}:00–${(a.endHour as number)}:00 UTC` : '';
          return `Key limits set: key expires ${exp}${win}`;
        });
        push(caps, 'caps', (a) => {
          const token = (a.token as string).toLowerCase() === (USDG_TOKEN_ADDRESS as string).toLowerCase()
            ? 'USDG' : (a.token as string).slice(0, 10);
          if (opts?.v2) return `Daily limit set for ${token}: up to $${usdg((a.daily as bigint) ?? 0n)} a day — the daily limit is the only bound`;
          return `Caps set for ${token}: up to $${usdg((a.perPayment as bigint) ?? 0n)} per payment, $${usdg((a.daily as bigint) ?? 0n)} a day, $${usdg((a.weekly as bigint) ?? 0n)} a week`;
        });
        push(revoked, 'revoked', () => 'Agent key revoked by the owner');
        push(frozen, 'frozen', () => 'Wallet frozen by the owner');
        push(unfrozen, 'frozen', () => 'Wallet unfrozen by the owner');
        push(rotated, 'rotated', () => 'Agent key replaced — the old key stopped working immediately');
        push(rotI, 'rotation', (a) => `Owner recovery started — completes after ${new Date(Number(a.executeAfter as bigint) * 1000).toLocaleDateString()}`);
        push(rotX, 'rotation', () => 'Owner recovery cancelled by the owner');
        push(rotC, 'rotation', () => 'Owner recovery completed');
        // Safe-level executions (owner-signed calls) for the same window.
        const [ok, fail] = await Promise.all([
          client.getLogs({ address: safe as Addr, event: ExecutionSuccessEvent, fromBlock: s, toBlock: to }),
          client.getLogs({ address: safe as Addr, event: ExecutionFailureEvent, fromBlock: s, toBlock: to }),
        ]);
        for (const l of [...ok, ...fail] as { blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
          items.push({ kind: 'safe-exec', label: 'Owner-signed wallet action executed', txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex, actor: '' });
        }
      }
      return items.sort((a, b) => (b.blockNumber === a.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
    },
  });
}

export const POLYDASH_TOKEN_ADDRESS = POLYDASH_ADDRESS as Addr;
export const USDG_TOKEN_ADDRESS = USDG_ADDRESS as Addr;

/** Flagship POLYDASH staking pool — verified on-chain Nov 21, 2026:
 * stakeToken = rewardToken = POLYDASH, 10,088,508,040 POLYDASH staked,
 * isActive = true. Created by the older staking factory, not the V2 one. */
export const FLAGSHIP_STAKING_POOL_ADDRESS = '0x0F50043E172B8652bb786C4F14f30c415E5760AB' as Addr;

// ---------------------------------------------------------------- checking account

export interface WalletPrices {
  ethUsd: number;
  polydashUsd: number;
  usdgUsd: number;
}

/** Live prices for the checking-account view, from /api/agents/wallets/prices
 * (ETH/USD Coinbase spot; POLYDASH/USD on-chain V4 pool, Dexscreener fallback;
 * USDG = $1). A price of 0 means "unavailable right now" — the UI must show
 * that, never a guessed price. */
export function useWalletPrices() {
  return useQuery({
    queryKey: ['agent-wallets', 'prices'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<WalletPrices | null> => {
      try {
        const r = await fetch('/api/agents/wallets/prices');
        if (!r.ok) return null;
        const j = await r.json().catch(() => null);
        if (!j || typeof j.ethUsd !== 'number') return null;
        return {
          ethUsd: j.ethUsd,
          polydashUsd: typeof j.polydashUsd === 'number' ? j.polydashUsd : 0,
          usdgUsd: 1,
        };
      } catch {
        return null;
      }
    },
  });
}

/** Everything the wallet-detail page needs, read server-side (see
 * lib/agent-wallet/server.ts + GET /api/agents/wallets/[address]/state).
 * The page used to read this from the visitor's browser, but the browser's
 * network path to the official RPC fails — the balance errored out after
 * ~15-20s, the policy never loaded, and the stake section stuck on "…".
 * The identical calls work from the server, so this hook fetches the route
 * and converts the string bigints back to the shapes the page already uses.
 * Throws on a non-200 so the page shows its existing error state. */
export interface WalletServerState {
  version: 'v1' | 'v2';
  walletState: { eth: bigint; usdg: bigint; frozen: boolean };
  polydash: { held: bigint; staked: bigint; earned: bigint };
  agentKey: string | undefined;
  policy: (WalletPolicy & { revoked: boolean; active: boolean; spentTodayUsdg: bigint; spentThisWeekUsdg: bigint }) | WalletPolicyV2 | null;
  polyCap: WalletTokenCap | null;
  createdBlock: bigint | undefined;
  score: WalletScore;
  activity: WalletActivityItem[];
  ledger: LedgerRow[];
}

export function useWalletServerState(safe: string | undefined) {
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'server-state', safe?.toLowerCase()],
    enabled: valid,
    refetchInterval: 30_000,
    queryFn: async (): Promise<WalletServerState> => {
      const r = await fetch(`/api/agents/wallets/${safe}/state`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Wallet state read failed: ${r.status}`);
      const j = (await r.json()) as WalletDetailStateJson;
      const policy = j.policy === null ? null : 'perPaymentCapUsdg' in j.policy
        ? {
            perPaymentCapUsdg: BigInt(j.policy.perPaymentCapUsdg ?? '0'),
            dailyCapUsdg: BigInt(j.policy.dailyCapUsdg),
            weeklyCapUsdg: BigInt(j.policy.weeklyCapUsdg ?? '0'),
            expiry: j.policy.expiry,
            startHour: j.policy.startHour,
            endHour: j.policy.endHour,
            // The allowlist is not enumerable on-chain — same as useWalletPolicy.
            allowedTargets: [] as Addr[],
            revoked: j.policy.revoked,
            active: j.policy.active,
            spentTodayUsdg: BigInt(j.policy.spentTodayUsdg),
            spentThisWeekUsdg: BigInt(j.policy.spentThisWeekUsdg ?? '0'),
          }
        : {
            dailyCapUsdg: BigInt(j.policy.dailyCapUsdg),
            spentTodayUsdg: BigInt(j.policy.spentTodayUsdg),
            expiry: j.policy.expiry,
            startHour: j.policy.startHour,
            endHour: j.policy.endHour,
            revoked: j.policy.revoked,
            active: j.policy.active,
          };
      return {
        version: j.version,
        walletState: { eth: BigInt(j.eth), usdg: BigInt(j.usdg), frozen: j.frozen },
        polydash: { held: BigInt(j.polydash.held), staked: BigInt(j.polydash.staked), earned: BigInt(j.polydash.earned) },
        agentKey: j.agentKey ?? undefined,
        policy,
        polyCap: j.polyCap === null ? null : {
          capped: j.polyCap.capped,
          daily: BigInt(j.polyCap.daily),
          registryAllowance: j.polyCap.registryAllowance === null ? undefined : BigInt(j.polyCap.registryAllowance),
        },
        createdBlock: j.createdBlock === null ? undefined : BigInt(j.createdBlock),
        score: j.score,
        activity: j.activity.map((a) => ({
          kind: a.kind, label: a.label, txHash: a.txHash,
          blockNumber: BigInt(a.blockNumber), logIndex: a.logIndex, actor: a.actor,
          to: a.to, value: a.value === undefined ? undefined : BigInt(a.value),
          token: a.token, amount: a.amount === undefined ? undefined : BigInt(a.amount),
        })),
        ledger: j.ledger.map((l) => ({
          id: l.id, direction: l.direction, token: l.token, amount: BigInt(l.amount),
          decimals: l.decimals, label: l.label, txHash: l.txHash,
          blockNumber: BigInt(l.blockNumber), logIndex: l.logIndex, actor: l.actor,
          timestamp: l.timestamp,
        })),
      };
    },
  });
}

/** USD value (6 dp) of a token amount at a USD price. The price is carried
 * at 12 dp because POLYDASH (~$0.00000026) would round to 0 at 6 dp. */
export function usd6ForAmount(amountWei: bigint, decimals: number, priceUsd: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || amountWei <= 0n) return 0n;
  const price12 = BigInt(Math.round(priceUsd * 1e12));
  if (price12 <= 0n) return 0n;
  return (amountWei * price12) / 10n ** BigInt(decimals + 6);
}

/** "$1,234.56" from a 6-dp USD value (floored to cents). */
export function formatUsd6(v6: bigint): string {
  const neg = v6 < 0n;
  const abs = neg ? -v6 : v6;
  const whole = abs / 1_000_000n;
  const cents = (abs % 1_000_000n / 10_000n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}$${whole.toLocaleString('en-US')}.${cents}`;
}

export type LedgerToken = 'ETH' | 'USDG' | 'POLYDASH';

export interface LedgerRow {
  id: string;
  direction: 'in' | 'out';
  token: LedgerToken;
  amount: bigint;
  decimals: number;
  /** Plain words, e.g. "Money in from 0x…" / "Agent paid 0x…". */
  label: string;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  /** Who moved it: the agent key, the owner, or someone else. */
  actor: 'agent' | 'owner' | 'other';
  /** Block time when it could be read; otherwise show the block number. */
  timestamp?: number;
}

const TransferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

const LEDGER_TOKENS: { address: Addr; symbol: LedgerToken; decimals: number }[] = [
  { address: USDG_TOKEN_ADDRESS, symbol: 'USDG', decimals: 6 },
  { address: POLYDASH_TOKEN_ADDRESS, symbol: 'POLYDASH', decimals: 18 },
];

/** The wallet's bank statement: every money move since it was created.
 *
 * Built from on-chain event logs — the same kind of read the activity feed
 * already does, no new contracts:
 * - ERC-20 Transfer events (USDG, POLYDASH) to/from the wallet: money in and out.
 * - Module Executed events (from the activity feed): agent payments. A token
 *   payment shows up as BOTH an Executed event and a Transfer-out in the same
 *   transaction — the Transfer row is dropped and the Executed row kept, so each
 *   payment appears once, labeled as the agent's payment.
 *
 * Honest limit, stated in the UI: plain ETH sent straight to the wallet (a gas
 * top-up) leaves no event on-chain, so it has no line of its own. It is counted
 * in the starting balance instead — the component computes that residual from the
 * live total, so the statement always ends at the real balance. */
export function useWalletLedger(
  safe: string | undefined,
  fromBlock: bigint | undefined,
  activity: WalletActivityItem[] | undefined,
  opts?: { moduleAddress?: Addr; v2?: boolean },
) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  const moduleAddress = opts?.moduleAddress ?? AGENT_WALLET_MODULE_ADDRESS;
  return useQuery({
    queryKey: ['agent-wallets', 'ledger', safe?.toLowerCase(), fromBlock?.toString(), opts?.v2 ? 'v2' : 'v1'],
    enabled: !!client && valid && fromBlock !== undefined && !!activity,
    refetchInterval: 60_000,
    queryFn: async (): Promise<LedgerRow[]> => {
      if (!client || !valid || fromBlock === undefined || !activity) return [];
      const latest = await client.getBlockNumber();
      const rows: LedgerRow[] = [];
      const lower = safe.toLowerCase();
      for (let s = fromBlock; s <= latest; s += LOG_CHUNK) {
        const e = s + LOG_CHUNK - 1n;
        const to = e > latest ? latest : e;
        const parts = await Promise.all(
          LEDGER_TOKENS.flatMap((t) => [
            client.getLogs({ address: t.address, event: TransferEvent, args: { from: safe as Addr }, fromBlock: s, toBlock: to }),
            client.getLogs({ address: t.address, event: TransferEvent, args: { to: safe as Addr }, fromBlock: s, toBlock: to }),
          ]),
        );
        parts.forEach((logs, i) => {
          const t = LEDGER_TOKENS[Math.floor(i / 2)];
          const isOut = i % 2 === 0;
          for (const l of logs as { args: { from: string; to: string; value: bigint }; blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
            const other = isOut ? l.args.to : l.args.from;
            const isStaking =
              t.symbol === 'POLYDASH' &&
              (isOut
                ? l.args.to.toLowerCase() === FLAGSHIP_STAKING_POOL_ADDRESS.toLowerCase()
                : l.args.from.toLowerCase() === FLAGSHIP_STAKING_POOL_ADDRESS.toLowerCase());
            rows.push({
              id: `${l.transactionHash}-${l.logIndex}`,
              direction: isOut ? 'out' : 'in',
              token: t.symbol,
              amount: l.args.value,
              decimals: t.decimals,
              label: isStaking
                ? isOut ? 'Staked POLYDASH' : 'Staking rewards paid in'
                : isOut ? `Money out to ${shortenAddress(other)}` : `Money in from ${shortenAddress(other)}`,
              txHash: l.transactionHash,
              blockNumber: l.blockNumber,
              logIndex: l.logIndex,
              actor: 'other',
            });
          }
        });
      }
      // Agent payments, from the activity feed's Executed events. ETH has no
      // Transfer event, so these are the only ETH-out rows; token payments
      // dedupe against the Transfer-out row in the same transaction.
      for (const item of activity) {
        if (item.kind !== 'executed' || !item.token) continue;
        const isEth = item.token.toLowerCase() === ZERO_ADDRESS;
        const lower = item.token.toLowerCase();
        // Unknown tokens have no price and no place in the statement — skip them.
        if (!isEth && lower !== USDG_TOKEN_ADDRESS.toLowerCase() && lower !== POLYDASH_TOKEN_ADDRESS.toLowerCase()) continue;
        const token: LedgerToken =
          isEth ? 'ETH' : lower === USDG_TOKEN_ADDRESS.toLowerCase() ? 'USDG' : 'POLYDASH';
        const amount = isEth ? (item.value ?? 0n) : (item.amount ?? 0n);
        if (amount <= 0n) continue;
        const dup = !isEth
          ? rows.findIndex((r) => r.direction === 'out' && r.token === token && r.txHash === item.txHash && r.amount === amount)
          : -1;
        if (dup >= 0) {
          rows[dup] = {
            ...rows[dup],
            label: `Agent paid ${shortenAddress(item.to ?? '')}`,
            actor: 'agent',
          };
          continue;
        }
        rows.push({
          id: `${item.txHash}-${item.logIndex}`,
          direction: 'out',
          token,
          amount,
          decimals: token === 'ETH' ? 18 : token === 'USDG' ? 6 : 18,
          label: `Agent paid ${shortenAddress(item.to ?? '')}`,
          txHash: item.txHash,
          blockNumber: item.blockNumber,
          logIndex: item.logIndex,
          actor: 'agent',
        });
      }
      // Dates: one block read per distinct block (wallets have little activity).
      const blocks = [...new Set(rows.map((r) => r.blockNumber))].slice(0, 100);
      const times = new Map<bigint, number>();
      await Promise.all(
        blocks.map(async (b) => {
          try {
            const blk = await client.getBlock({ blockNumber: b });
            times.set(b, Number(blk.timestamp));
          } catch { /* date falls back to the block number */ }
        }),
      );
      for (const r of rows) {
        const t = times.get(r.blockNumber);
        if (t) r.timestamp = t;
      }
      return rows.sort((a, b) => (b.blockNumber === a.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
    },
  });
}

export interface WalletTokenCap {
  /** True when the token is in the agent key's capped-token list (a cap was set). */
  capped: boolean;
  daily: bigint;
  perPayment?: bigint;
  weekly?: bigint;
  /** POLYDASH allowance the wallet gave the Agent Registry (the pull-target
   * that takes the 1,000 POLYDASH bond). Only read for POLYDASH. */
  registryAllowance?: bigint;
}

/** One token's daily cap for the agent key — the L7 check. A cap of 0 with
 * capped === false means "no cap was ever set": pulls of that token are not
 * counted against any limit, so the owner must not grant allowances for it to
 * pull-targets. Read-only. */
export function useWalletTokenCap(
  safe: string | undefined,
  agentKey: string | undefined,
  token: Addr,
  isV2: boolean,
) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false }) && !!agentKey && isAddress(agentKey, { strict: false });
  const moduleAddress = isV2 ? AGENT_WALLET_MODULE_V2_ADDRESS : AGENT_WALLET_MODULE_ADDRESS;
  const isPolydash = token.toLowerCase() === POLYDASH_TOKEN_ADDRESS.toLowerCase();
  return useQuery({
    queryKey: ['agent-wallets', 'token-cap', safe?.toLowerCase(), agentKey?.toLowerCase(), token.toLowerCase(), isV2 ? 'v2' : 'v1'],
    enabled: !!client && valid && !!moduleAddress,
    refetchInterval: 30_000,
    queryFn: async (): Promise<WalletTokenCap | null> => {
      if (!client || !valid || !moduleAddress) return null;
      const abi = isV2 ? AgentWalletModuleV2ABI : AgentWalletModuleABI;
      const [caps, tokens, allowance] = await Promise.all([
        client.readContract({
          address: moduleAddress, abi, functionName: 'getTokenCaps', args: [safe as Addr, agentKey as Addr, token],
        }) as Promise<{ perPayment?: bigint; daily: bigint; weekly?: bigint }>,
        client.readContract({
          address: moduleAddress, abi, functionName: 'getPolicyTokens', args: [safe as Addr, agentKey as Addr],
        }) as Promise<string[]>,
        isPolydash
          ? (client.readContract({
              address: POLYDASH_TOKEN_ADDRESS, abi: erc20Abi, functionName: 'allowance',
              args: [safe as Addr, REGISTRY_ADDRESS as Addr],
            }) as Promise<bigint>).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      return {
        capped: tokens.some((t) => t.toLowerCase() === token.toLowerCase()),
        daily: caps.daily ?? 0n,
        perPayment: caps.perPayment,
        weekly: caps.weekly,
        registryAllowance: allowance,
      };
    },
  });
}

// ---------------------------------------------------------------- receipts

export interface VerifiableReceipt {
  identity: string; // who acted (agent key or owner)
  authority: string; // what policy allowed it
  approval: string; // how it was approved (agent key alone / owner signature)
  settlement: { txHash: string; blockNumber: bigint; status: 'success' | 'reverted' };
}

/** Build a verifiable receipt for one activity item: identity → authority →
 * approval → settlement, from the tx receipt + the policy that authorized it.
 * Nothing here is asserted without an on-chain source. */
export async function buildReceipt(
  client: { getTransactionReceipt: (o: { hash: `0x${string}` }) => Promise<{ status: string; blockNumber: bigint }> },
  item: WalletActivityItem,
  policyText: string,
): Promise<VerifiableReceipt> {
  const receipt = await client.getTransactionReceipt({ hash: item.txHash as `0x${string}` });
  const agentActed = item.kind === 'executed';
  return {
    identity: agentActed ? `Agent key ${item.actor}` : 'Owner (human)',
    authority: policyText,
    approval: agentActed
      ? 'Agent key alone — inside its caps, allowlist, and expiry'
      : 'Owner signature on the Safe (threshold 1)',
    settlement: {
      txHash: item.txHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status === 'success' ? 'success' : 'reverted',
    },
  };
}

// ---------------------------------------------------------------- connect

export function buildMcpConfig(walletAddress: string, agentKeyAddress: string): string {
  return JSON.stringify({
    mcpServers: {
      polypad: {
        url: MCP_URL,
        headers: {},
        env: {
          POLYPAD_AGENT_WALLET: walletAddress,
          POLYPAD_AGENT_KEY_ADDRESS: agentKeyAddress,
        },
      },
    },
    notes: 'The agent signs with its own key (shown once in the wizard). Add a Pro key as x-api-key for 10x limits — see /agents/accounts.',
  }, null, 2);
}

export function buildConnectCommand(): string {
  return 'npx -y polypad-agent connect';
}

// ------------------------------------------------------------ gas budget
// A preference, not key material — localStorage is fine for this.

const GAS_BUDGET_KEY = 'polypad-agent-wallet-gas-budget-v1';

export function getGasBudget(safe: string): { budgetEth: string; warnBelowEth: string } {
  try {
    const raw = localStorage.getItem(`${GAS_BUDGET_KEY}:${safe.toLowerCase()}`);
    if (raw) return JSON.parse(raw) as { budgetEth: string; warnBelowEth: string };
  } catch { /* ignore */ }
  return { budgetEth: '0.01', warnBelowEth: '0.002' };
}

export function setGasBudget(safe: string, budgetEth: string, warnBelowEth: string) {
  try {
    localStorage.setItem(`${GAS_BUDGET_KEY}:${safe.toLowerCase()}`, JSON.stringify({ budgetEth, warnBelowEth }));
  } catch { /* ignore */ }
}

/** Low-gas check for the dashboard warning. */
export function isGasLow(ethBalance: bigint, warnBelowEth: string): boolean {
  try {
    return ethBalance < parseUnits(warnBelowEth || '0.002', 18);
  } catch {
    return false;
  }
}

export function formatEthShort(wei: bigint | undefined | null): string {
  if (wei == null) return '0';
  return formatEther(wei);
}

export const SPEND_VAULT = SPEND_VAULT_ADDRESS;
export { REGISTRY_ADDRESS, SCORE_ADDRESS };

// ------------------------------------------------------- agent wallet v2
//
// v2 = ERC-8004 identity binding at creation + ERC-4337 path (Safe 4337
// module + paymaster, native ETH gas only) + a daily-cap-only session-key
// module (Jon's decision 5: the daily cap is the ONLY bound — no separate
// per-payment cap, no owner co-sign gate for big moves; anything over the
// daily cap fails on-chain). First deployed Nov 21, 2026 on Robinhood Chain
// 4663; REDEPLOYED Nov 22, 2026 (Warden fix rounds 1-3, commit 9f43140 —
// H-01 pull-pattern cap bypass, M-01 factory owner check, M-02 paymaster
// reservation, L-06 rotate dedupe, I-04 DeltaCharged event, I-05 NatSpec,
// I-06 rotation cap preservation; Warden Phase 4 GREEN HOLDS). All four
// contracts Sourcify exact_match. ADDITIVE: the v1 factory, v1 module, and
// the 3 live v1 wallets are untouched and keep working.
// Design: ~/workspace/goals/ai-agent-defi-economy-infrastructure/files/agent-wallet-v2-design.md
//
// Base (8453) is prepared, not deployed: the same four contracts deploy
// there once the deployer holds Base ETH (~0.01 ETH for the deployments +
// a test wallet, plus 0.01 ETH for the Base paymaster). The wizard's chain
// picker shows Base as coming soon until then.

export const AGENT_WALLET_FACTORY_V2_ADDRESS = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_FACTORY_V2_ADDRESS);
export const AGENT_WALLET_MODULE_V2_ADDRESS = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_MODULE_V2_ADDRESS);
export const AGENT_WALLET_4337_MODULE_ADDRESS = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_4337_MODULE_ADDRESS);
export const AGENT_WALLET_PAYMASTER_ADDRESS = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_PAYMASTER_ADDRESS);

/** Hood 4663 v2 deployments, Nov 22 2026 (Sourcify exact_match). Supersedes
 * the Nov 21 set (module 0xA8eEa6e2EB81ae31d95566dC28F7e4BC1bb7Aec9, 4337
 * 0x987bBCBcD83b023361DB96967D74A32672FfdaF7, paymaster
 * 0xaD8ac233C8307D18dc2136ACF16502a0b856911F, factory
 * 0x1e32825c6Dc7C14b72ae2bbC6e6a4Fe4De50e6Ae). */
export const AGENT_WALLET_V2_HOOD = {
  moduleV2: '0xB8A927dfd18D87f5a041706b14424CBBA59Db270' as Addr,
  agent4337Module: '0x49F49C72FE7B3A7EE418c5936Bd84af2dB57c8E5' as Addr,
  paymaster: '0x03db6aaf03CAb9B4DA5fc27BF3C20fAC333e86EA' as Addr,
  factoryV2: '0x944E225D5f53c25aa4C019CFD9B42f0a40b9AC22' as Addr,
} as const;

/** The Nov 21 v2 factory, superseded Nov 22 by the Warden fix-round
 * redeploy. Kept only so a wallet created by the old factory and migrated
 * to the new modules can still be found by the creation-block scan
 * (useCreatedBlockV2 checks the old factory when the new one has no
 * WalletCreatedV2 event for the safe). */
export const AGENT_WALLET_FACTORY_V2_PREVIOUS_ADDRESS = '0x1e32825c6Dc7C14b72ae2bbC6e6a4Fe4De50e6Ae' as Addr;

export const isFactoryV2Live = !!AGENT_WALLET_FACTORY_V2_ADDRESS && !!AGENT_WALLET_MODULE_V2_ADDRESS;
export const isPaymasterLive = !!AGENT_WALLET_PAYMASTER_ADDRESS;

/** ERC-8004 Identity registry — canonical CREATE2, same address on Hood + Base. */
export const IDENTITY_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as Addr;
/** EntryPoint v0.7 — canonical, same address on Hood + Base. */
export const ENTRYPOINT_V07_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Addr;

/** Block the CURRENT v2 factory deployed in (121,006,574) — the earliest
 * block a wallet created by the new factory can exist at. Wallets created
 * by the superseded Nov 21 factory are found via
 * AGENT_WALLET_FACTORY_V2_PREVIOUS_ADDRESS in useCreatedBlockV2. */
export const FACTORY_V2_DEPLOY_BLOCK = 121006574n;

/** Jon's decision 3: the daily cap is a free pick, $1–$5,000 (USDG, 6 dec). */
export const DAILY_CAP_MIN_USD = 1;
export const DAILY_CAP_MAX_USD = 5000;

export function dailyCapValidUsd(n: number): boolean {
  return Number.isFinite(n) && n >= DAILY_CAP_MIN_USD && n <= DAILY_CAP_MAX_USD;
}

/** The on-chain identity page for a wallet — what the 8004 agentURI points
 * to. The Safe wallet itself owns the identity (the agent's on-chain
 * identity IS its wallet). */
export function identityURIFor(safe: string): string {
  return `https://polypad.family/agents/wallets/${safe.toLowerCase()}`;
}

/** Which generation a wallet is: v2 = created by the v2 factory
 * (factory.isPolypadWallet is authoritative); anything else is v1.
 * Fallback: a wallet migrated from the superseded Nov 21 factory to the
 * new modules is NOT in the new factory's registry, so it also counts as
 * v2 when the new module holds a policy for it (agentKeyOf != 0) — without
 * this the migrated wallet would render the v1 UI and v1 owner calls. */
export function useWalletVersion(safe: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'version', safe?.toLowerCase()],
    enabled: !!client && valid && isFactoryV2Live,
    queryFn: async (): Promise<'v2' | 'v1'> => {
      if (!client || !valid || !AGENT_WALLET_FACTORY_V2_ADDRESS) return 'v1';
      const isV2 = (await client.readContract({
        address: AGENT_WALLET_FACTORY_V2_ADDRESS, abi: AgentWalletFactoryV2ABI, functionName: 'isPolypadWallet', args: [safe as Addr],
      })) as boolean;
      if (isV2) return 'v2';
      if (!AGENT_WALLET_MODULE_V2_ADDRESS) return 'v1';
      const agentKey = (await client.readContract({
        address: AGENT_WALLET_MODULE_V2_ADDRESS, abi: AgentWalletModuleV2ABI, functionName: 'agentKeyOf', args: [safe as Addr],
      })) as Addr;
      return agentKey !== ZERO_ADDRESS ? 'v2' : 'v1';
    },
  });
}

/** v2 only: the module stores the current agent key on-chain (agentKeyOf) —
 * no event scan needed, unlike v1. Returns undefined for a v1 wallet. */
export function useAgentKeyForSafeV2(safe: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'agent-key-v2', safe?.toLowerCase()],
    enabled: !!client && valid && isFactoryV2Live,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Addr | undefined> => {
      if (!client || !valid || !AGENT_WALLET_MODULE_V2_ADDRESS) return undefined;
      const key = (await client.readContract({
        address: AGENT_WALLET_MODULE_V2_ADDRESS, abi: AgentWalletModuleV2ABI, functionName: 'agentKeyOf', args: [safe as Addr],
      })) as Addr;
      return key === ZERO_ADDRESS ? undefined : key;
    },
  });
}

export interface WalletPolicyV2 {
  dailyCapUsdg: bigint;
  spentTodayUsdg: bigint;
  expiry: number;
  startHour: number;
  endHour: number;
  revoked: boolean;
  active: boolean;
}

/** v2 policy: daily cap only (no per-payment, no weekly). getSpent returns
 * (dailySpent, day) — NOT (today, week) like v1. */
export function useWalletPolicyV2(safe: string | undefined, agentKey: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!agentKey && isAddress(agentKey, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'policy-v2', safe?.toLowerCase(), agentKey?.toLowerCase()],
    enabled: !!client && valid && isFactoryV2Live,
    refetchInterval: 30_000,
    queryFn: async (): Promise<WalletPolicyV2 | null> => {
      if (!client || !valid || !AGENT_WALLET_MODULE_V2_ADDRESS) return null;
      const [policy, caps, spent, active] = await Promise.all([
        client.readContract({
          address: AGENT_WALLET_MODULE_V2_ADDRESS, abi: AgentWalletModuleV2ABI, functionName: 'getPolicy', args: [safe as Addr, agentKey as Addr],
        }) as Promise<{ key: string; expiry: bigint; startHour: number; endHour: number; exists: boolean }>,
        client.readContract({
          address: AGENT_WALLET_MODULE_V2_ADDRESS, abi: AgentWalletModuleV2ABI, functionName: 'getTokenCaps', args: [safe as Addr, agentKey as Addr, USDG_TOKEN_ADDRESS as Addr],
        }) as Promise<{ daily: bigint }>,
        client.readContract({
          address: AGENT_WALLET_MODULE_V2_ADDRESS, abi: AgentWalletModuleV2ABI, functionName: 'getSpent', args: [safe as Addr, agentKey as Addr, USDG_TOKEN_ADDRESS as Addr],
        }) as Promise<[bigint, bigint]>,
        client.readContract({
          address: AGENT_WALLET_MODULE_V2_ADDRESS, abi: AgentWalletModuleV2ABI, functionName: 'isKeyActive', args: [safe as Addr, agentKey as Addr],
        }) as Promise<boolean>,
      ]);
      if (!policy.exists) return null;
      return {
        dailyCapUsdg: caps.daily,
        spentTodayUsdg: spent[0],
        expiry: Number(policy.expiry),
        startHour: Number(policy.startHour),
        endHour: Number(policy.endHour),
        revoked: false,
        active,
      };
    },
  });
}

/** Deploy a v2 wallet: one factory call, owner signs. The factory deploys
 * the Safe (fallback handler = 4337 module), enables the v2 module + 4337
 * module, sets the key policy (90 days, always active) + the USDG daily cap
 * + the allowlist, registers the ERC-8004 identity for the Safe
 * (best-effort — creation succeeds even if registration fails), and removes
 * itself as owner. The daily cap is a free pick, $1–$5,000 (Jon, Nov 21). */
export function useCreateWalletV2() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  async function createWalletV2(
    owner: Addr, backupKey: Addr, agentKey: Addr, dailyCapUsd: number, allowedTargets?: Addr[],
  ): Promise<{ safe: Addr; txHash: string }> {
    if (!client || !address || !AGENT_WALLET_FACTORY_V2_ADDRESS) throw new Error('Connect your wallet first — and the v2 wallet factory is not live yet.');
    if (!isAddress(backupKey, { strict: false })) throw new Error('That backup address is not valid.');
    if (backupKey.toLowerCase() === owner.toLowerCase()) throw new Error('The backup key must be a different address from your owner wallet — a spare wallet or hardware wallet.');
    if (backupKey.toLowerCase() === agentKey.toLowerCase()) throw new Error('The backup key must be different from the agent key.');
    if (!dailyCapValidUsd(dailyCapUsd)) throw new Error(`Pick a daily limit between $${DAILY_CAP_MIN_USD} and $${DAILY_CAP_MAX_USD}.`);
    const dailyCap = parseUnits(String(dailyCapUsd), 6);
    const targets = allowedTargets?.length ? allowedTargets : (DEFAULT_ALLOWED_TARGETS as Addr[]);
    const hash = await writeContractAsync({
      address: AGENT_WALLET_FACTORY_V2_ADDRESS, abi: AgentWalletFactoryV2ABI, functionName: 'createWallet',
      args: [owner, backupKey, agentKey, dailyCap, targets, randomSaltNonce()],
      chainId: robinhoodChain.id,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const log = receipt.logs.find((l) => l.address.toLowerCase() === AGENT_WALLET_FACTORY_V2_ADDRESS!.toLowerCase());
    // WalletCreatedV2 topics: [sig, safe, owner, agentKey] — address is topic[1].
    const safe = log && log.topics[1] ? (`0x${log.topics[1].slice(26)}` as Addr) : null;
    await queryClient.invalidateQueries({ queryKey: ['agent-wallets'] });
    if (!safe) throw new Error('Wallet deployed but the address could not be read from the receipt — find it on the explorer.');
    return { safe, txHash: hash };
  }

  return { createWalletV2, connected: !!address, address };
}

/** The block a v2 wallet was created in (WalletCreatedV2 on the v2
 * factory) — the activity feed's start block. A wallet created by the
 * superseded Nov 21 factory has its event on the PREVIOUS factory, so the
 * old factory is scanned as a fallback (migrated wallets keep their
 * original creation block, which the 8004 identity scan also needs). */
export function useCreatedBlockV2(safe: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'created-block-v2', safe?.toLowerCase()],
    enabled: !!client && valid && isFactoryV2Live,
    queryFn: async (): Promise<bigint | undefined> => {
      if (!client || !valid || !AGENT_WALLET_FACTORY_V2_ADDRESS) return undefined;
      const latest = await client.getBlockNumber();
      const scan = async (factory: Addr, from: bigint): Promise<bigint | undefined> => {
        for (let s = from; s <= latest; s += LOG_CHUNK) {
          const e = s + LOG_CHUNK - 1n;
          const logs = await client.getLogs({
            address: factory, event: WalletCreatedV2Event, args: { safe: safe as Addr },
            fromBlock: s, toBlock: e > latest ? latest : e,
          });
          if (logs.length) return logs[0].blockNumber;
        }
        return undefined;
      };
      return (await scan(AGENT_WALLET_FACTORY_V2_ADDRESS, FACTORY_V2_DEPLOY_BLOCK))
        ?? (await scan(AGENT_WALLET_FACTORY_V2_PREVIOUS_ADDRESS, 120285357n));
    },
  });
}

const WalletCreatedV2Event = parseAbiItem(
  'event WalletCreatedV2(address indexed safe, address indexed owner, address indexed agentKey, uint256 dailyCap)',
);

/** The wallet's ERC-8004 identity, if it has one. The registry has NO
 * enumerable list and NO totalSupply — the agentId comes ONLY from the
 * Registered event (owner topic), so this scans from the v2 factory deploy
 * block (any identity linked through this UI is newer than that). Returns
 * null while no identity exists. */
export function useWalletIdentity(safe: string | undefined, fromBlock?: bigint) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'identity-8004', safe?.toLowerCase()],
    enabled: !!client && valid,
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ agentId: bigint; agentURI: string } | null> => {
      if (!client || !valid) return null;
      const latest = await client.getBlockNumber();
      const from = fromBlock ?? FACTORY_V2_DEPLOY_BLOCK;
      let found: { agentId: bigint; agentURI: string } | null = null;
      for (let s = from; s <= latest; s += LOG_CHUNK) {
        const e = s + LOG_CHUNK - 1n;
        const logs = await client.getLogs({
          address: IDENTITY_REGISTRY_ADDRESS, event: IdentityRegisteredEvent, args: { owner: safe as Addr },
          fromBlock: s, toBlock: e > latest ? latest : e,
        });
        for (const l of logs as { args: { agentId: bigint; agentURI: string } }[]) {
          found = { agentId: l.args.agentId, agentURI: l.args.agentURI };
        }
      }
      return found;
    },
  });
}

const IdentityRegisteredEvent = parseAbiItem(
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
);

/** The wallet's POLYDASH: what it holds, what it has staked in the flagship
 * pool, and what it has earned (for the Stake button). */
export function useWalletPolydashBalance(safe: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!safe && isAddress(safe, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'polydash-balance', safe?.toLowerCase()],
    enabled: !!client && valid,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !valid) return { held: 0n, staked: 0n, earned: 0n };
      const [held, staked, earned] = await Promise.all([
        client.readContract({ address: POLYDASH_TOKEN_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [safe as Addr] }) as Promise<bigint>,
        client.readContract({ address: FLAGSHIP_STAKING_POOL_ADDRESS, abi: stakingPoolAbi, functionName: 'balanceOf', args: [safe as Addr] }) as Promise<bigint>,
        client.readContract({ address: FLAGSHIP_STAKING_POOL_ADDRESS, abi: stakingPoolAbi, functionName: 'earned', args: [safe as Addr] }) as Promise<bigint>,
      ]);
      return { held, staked, earned };
    },
  });
}

/** Owner-signed Safe calls against the v2 module. Same shapes as the v1
 * owner calls, except setTokenCaps takes a daily-only cap
 * ({ daily }) — there is no per-payment or weekly cap in v2. The v2 admin
 * functions (setFrozen / revokeKey / rotateKey / setKeyPolicy /
 * setAllowedTarget) are identical to v1's, so this mirrors useSafeOwnerCall
 * against the v2 module instead of sharing its hardcoded v1 address. */
export function useSafeOwnerCallV2() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  /** Execute `data` on `to` through the Safe, signed by the connected owner. */
  async function execViaSafe(safe: Addr, to: Addr, data: `0x${string}`, value = 0n): Promise<string> {
    if (!client || !address) throw new Error('Connect your wallet first.');
    const nonce = (await client.readContract({ address: safe, abi: SafeABI, functionName: 'nonce' })) as bigint;
    const signature = await signTypedDataAsync({
      domain: { name: 'Safe', version: '1.3.0', chainId: robinhoodChain.id, verifyingContract: safe },
      types: SAFE_TX_TYPES,
      primaryType: 'SafeTx',
      message: {
        to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
        gasToken: ZERO_ADDRESS, refundReceiver: ZERO_ADDRESS, nonce,
      },
    });
    const hash = await writeContractAsync({
      address: safe, abi: SafeABI, functionName: 'execTransaction',
      args: [to, value, data, 0, 0n, 0n, 0n, ZERO_ADDRESS, ZERO_ADDRESS, signature],
      chainId: robinhoodChain.id,
    });
    await client.waitForTransactionReceipt({ hash });
    await queryClient.invalidateQueries({ queryKey: ['agent-wallets'] });
    return hash;
  }

  function moduleCall(functionName: 'setFrozen' | 'unfreeze' | 'revokeKey' | 'rotateKey' | 'setKeyPolicy' | 'setTokenCaps' | 'setAllowedTarget', args: unknown[]) {
    if (!AGENT_WALLET_MODULE_V2_ADDRESS) throw new Error('The v2 wallet module is not live yet.');
    return encodeFunctionData({ abi: AgentWalletModuleV2ABI, functionName, args: args as never });
  }

  async function setFrozen(safe: Addr, frozen: boolean): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_V2_ADDRESS!, moduleCall('setFrozen', [safe, frozen]));
  }
  async function revokeAgentKey(safe: Addr, key: Addr): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_V2_ADDRESS!, moduleCall('revokeKey', [safe, key]));
  }
  async function rotateAgentKey(safe: Addr, oldKey: Addr, newKey: Addr): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_V2_ADDRESS!, moduleCall('rotateKey', [safe, oldKey, newKey]));
  }
  async function setKeyPolicy(safe: Addr, key: Addr, expiry: number, startHour: number, endHour: number): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_V2_ADDRESS!, moduleCall('setKeyPolicy', [safe, key, BigInt(expiry), startHour, endHour]));
  }
  async function setDailyCap(safe: Addr, key: Addr, token: Addr, dailyCapUsdg: bigint): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_V2_ADDRESS!, moduleCall('setTokenCaps', [safe, key, token, { daily: dailyCapUsdg }]));
  }
  async function setAllowedTarget(safe: Addr, target: Addr, allowed: boolean): Promise<string> {
    return execViaSafe(safe, AGENT_WALLET_MODULE_V2_ADDRESS!, moduleCall('setAllowedTarget', [safe, target, allowed]));
  }
  /** Update the full USDG limits for a v2 wallet: expiry/window first, then
   * the daily cap. Two owner-signed Safe transactions. */
  async function setCaps(safe: Addr, key: Addr, policy: { expiry: number; startHour: number; endHour: number; dailyCapUsdg: bigint }): Promise<string[]> {
    const h1 = await setKeyPolicy(safe, key, policy.expiry, policy.startHour, policy.endHour);
    const h2 = await setDailyCap(safe, key, USDG_TOKEN_ADDRESS as Addr, policy.dailyCapUsdg);
    return [h1, h2];
  }

  /** Link (or re-link) an ERC-8004 identity for a v1 wallet that was created
   * before v2 — or a v2 wallet whose best-effort registration at creation
   * failed. One owner-signed Safe transaction calling
   * IdentityRegistry.register(agentURI); the identity is minted to the Safe
   * itself. The agentId comes back only via the Registered event. */
  async function linkIdentity(safe: Addr): Promise<string> {
    const data = encodeFunctionData({ abi: IdentityRegistryABI, functionName: 'register', args: [identityURIFor(safe)] });
    return execViaSafe(safe, IDENTITY_REGISTRY_ADDRESS, data);
  }

  /** Stake POLYDASH held by the wallet into the flagship pool — owner flow.
   * Two owner-signed Safe transactions: approve the pool, then stake. The
   * agent key CANNOT do this unless the owner explicitly allowlists the pool
   * and sets a POLYDASH daily cap (off by default — see the design doc). */
  async function stakePolydash(safe: Addr, amount: bigint): Promise<string[]> {
    if (amount <= 0n) throw new Error('Enter an amount above zero.');
    const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [FLAGSHIP_STAKING_POOL_ADDRESS, amount] });
    const h1 = await execViaSafe(safe, POLYDASH_TOKEN_ADDRESS, approveData);
    const stakeData = encodeFunctionData({ abi: stakingPoolAbi, functionName: 'stake', args: [amount] });
    const h2 = await execViaSafe(safe, FLAGSHIP_STAKING_POOL_ADDRESS, stakeData);
    return [h1, h2];
  }

  return { execViaSafe, setFrozen, revokeAgentKey, rotateAgentKey, setKeyPolicy, setDailyCap, setAllowedTarget, setCaps, linkIdentity, stakePolydash, connected: !!address };
}

/** The paymaster's live state (for the wizard's sponsored-gas note). The
 * paymaster is deployed UNFUNDED and INACTIVE until Jon approves funding:
 * recommended 0.01 ETH per chain (Hood + Base), ~1,200–2,500 sponsored
 * UserOps at current gas. */
export function usePaymasterState() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['agent-wallets', 'paymaster-state'],
    enabled: !!client && isPaymasterLive,
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ active: boolean; perWalletDailyCapEth: bigint; globalDailyCapEth: bigint } | null> => {
      if (!client || !AGENT_WALLET_PAYMASTER_ADDRESS) return null;
      const [active, perWallet, global] = await Promise.all([
        client.readContract({ address: AGENT_WALLET_PAYMASTER_ADDRESS, abi: AgentWalletPaymasterABI, functionName: 'active' }) as Promise<boolean>,
        client.readContract({ address: AGENT_WALLET_PAYMASTER_ADDRESS, abi: AgentWalletPaymasterABI, functionName: 'perWalletDailyCap' }) as Promise<bigint>,
        client.readContract({ address: AGENT_WALLET_PAYMASTER_ADDRESS, abi: AgentWalletPaymasterABI, functionName: 'globalDailyCap' }) as Promise<bigint>,
      ]);
      return { active, perWalletDailyCapEth: perWallet, globalDailyCapEth: global };
    },
  });
}

// The staking pool ABI lives in lib/staking/shared.ts (imported at the top).
