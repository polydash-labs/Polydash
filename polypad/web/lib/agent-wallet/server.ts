// Agent Wallets — SERVER-side chain reads for the wallet-detail page.
//
// Why this exists (Nov 23, 2026): the wallet-detail page used to read chain
// state directly from the visitor's browser (wagmi usePublicClient ->
// https://rpc.mainnet.chain.robinhood.com). The identical calls work fine
// from a server (verified with viem: the whole data path completes in <4s),
// CORS is open on the RPC, and the production bundle has the right
// addresses — but the reads fail in the browser (cloud browser + headless
// renders both see the balance error out after ~15-20s of retries, the
// policy never loads, and the stake section sticks on "…"). The failure is
// specific to the browser's network path to the official RPC, so the page
// now reads through this server route instead (the prices-API pattern).
// No private key material here — every read is public on-chain data.
//
// The client hook useWalletServerState (lib/agent-wallet/client.ts) fetches
// GET /api/agents/wallets/[address]/state and converts the string bigints
// back. Bigints cross the wire as decimal strings; block numbers too.
import { createPublicClient, erc20Abi, formatEther, formatUnits, getAddress, http, isAddress, parseAbiItem } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { AgentWalletFactoryABI, AgentWalletModuleABI } from './abi';
import { AgentWalletFactoryV2ABI, AgentWalletModuleV2ABI } from './abi-v2';
import { AgentRegistryABI, AgentScoreABI } from '@/lib/contracts/agent-credit-score-abi';
import { POLYDASH_ADDRESS, USDG_ADDRESS } from '@/lib/x402/constants';
import { shortenAddress } from '@/lib/format';

export type Addr = `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Addr;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }),
});

/** Plain env address, or undefined when unset — same rule as client.ts envAddr. */
function envAddr(v: string | undefined): Addr | undefined {
  if (!v || v === '' || v.toLowerCase() === ZERO_ADDRESS) return undefined;
  return v as Addr;
}

const FACTORY_V1 = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_FACTORY_ADDRESS);
const MODULE_V1 = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_MODULE_ADDRESS);
const FACTORY_V2 = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_FACTORY_V2_ADDRESS);
const MODULE_V2 = envAddr(process.env.NEXT_PUBLIC_AGENT_WALLET_MODULE_V2_ADDRESS);
const USDG = USDG_ADDRESS as Addr;
const POLYDASH = POLYDASH_ADDRESS as Addr;
/** AgentRegistry + AgentScore (live since Nov 17, 2026) — canonical addresses. */
const REGISTRY = '0x514e352A12F3DB3d4cA649dD328776390e1725eF' as Addr;
const SCORE = '0x1F7ebaAf16aEAa2F519D2Cc69B6091f908C6C92b' as Addr;
/** Flagship POLYDASH staking pool (verified on-chain Nov 21, 2026). */
const STAKING_POOL = '0x0F50043E172B8652bb786C4F14f30c415E5760AB' as Addr;
/** Superseded Nov 21 v2 factory — wallets it created keep their original
 * creation block, so the created-block scan checks it as a fallback. */
const FACTORY_V2_PREVIOUS = '0x1e32825c6Dc7C14b72ae2bbC6e6a4Fe4De50e6Ae' as Addr;
/** Block the current v2 factory deployed in. */
const FACTORY_V2_DEPLOY_BLOCK = 121006574n;
/** Previous v2 factory deploy block (Nov 21). */
const FACTORY_V2_PREVIOUS_DEPLOY_BLOCK = 120285357n;
/** v1 factory deployed Nov 20, 2026; this is just before that day's first
 * block (~119.42M), so the v1 scans start here instead of latest − 5M. */
const V1_SCAN_START = 119400000n;
const LOG_CHUNK = 99_000n;

const STAKING_POOL_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'earned', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

// ---------------------------------------------------------------- events
const WalletCreatedEvent = parseAbiItem('event WalletCreated(address indexed safe, address indexed owner, address indexed agentKey)');
const WalletCreatedV2Event = parseAbiItem('event WalletCreatedV2(address indexed safe, address indexed owner, address indexed agentKey, uint256 dailyCap)');
const KeyRotatedEvent = parseAbiItem('event KeyRotated(address indexed safe, address indexed oldKey, address indexed newKey)');
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
const TransferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

// ---------------------------------------------------------------- shapes
export interface WalletDetailStateJson {
  version: 'v1' | 'v2';
  eth: string;
  usdg: string;
  frozen: boolean;
  polydash: { held: string; staked: string; earned: string };
  agentKey: string | null;
  /** v1 carries perPaymentCapUsdg / weeklyCapUsdg / spentThisWeekUsdg too;
   * v2 is daily-only. Bigints are decimal strings. */
  policy: {
    perPaymentCapUsdg?: string;
    dailyCapUsdg: string;
    weeklyCapUsdg?: string;
    spentTodayUsdg: string;
    spentThisWeekUsdg?: string;
    expiry: number;
    startHour: number;
    endHour: number;
    revoked: boolean;
    active: boolean;
  } | null;
  polyCap: { capped: boolean; daily: string; registryAllowance: string | null } | null;
  createdBlock: string | null;
  score: { registered: boolean; agentId: number | null; scored: boolean; score: number | null; components: number[] | null; updatedAt: number | null };
  activity: ActivityJson[];
  ledger: LedgerJson[];
}

export interface ActivityJson {
  kind: string;
  label: string;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  actor: string;
  to?: string;
  value?: string;
  token?: string;
  amount?: string;
}

export interface LedgerJson {
  id: string;
  direction: 'in' | 'out';
  token: 'ETH' | 'USDG' | 'POLYDASH';
  amount: string;
  decimals: number;
  label: string;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  actor: 'agent' | 'owner' | 'other';
  timestamp?: number;
}

// ---------------------------------------------------------------- helpers
function usdg(amount: bigint): string {
  const [int, frac] = formatUnits(amount, 6).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Run fn over items with at most `size` in flight. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunks(from: bigint, to: bigint): { fromBlock: bigint; toBlock: bigint }[] {
  const out: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let s = from; s <= to; s += LOG_CHUNK) {
    const e = s + LOG_CHUNK - 1n;
    out.push({ fromBlock: s, toBlock: e > to ? to : e });
  }
  return out;
}

/** One topic-filtered getLogs over the full range — fast (~0.2s) because the
 * topic filter (safe / from / to) narrows the result set. Falls back to
 * 99k-block chunks when the RPC rejects the call for exceeding its 10,000-log
 * result limit (only for very active wallets). The 99k chunking in the
 * client hooks exists for the same limit; the server keeps it as fallback. */
async function getLogsFull(params: {
  address: Addr;
  event: ReturnType<typeof parseAbiItem>;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await client.getLogs(params as any)) as any[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (!/exceeds limit|10000/i.test(msg)) throw e;
    const ranges = chunks(params.fromBlock, params.toBlock);
    const parts = await mapPool(ranges, 6, async ({ fromBlock, toBlock }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await client.getLogs({ ...params, fromBlock, toBlock } as any)) as any[],
    );
    return parts.flat();
  }
}

function describeExecuted(args: { target: string; token: string; amount: bigint; value: bigint }): string {
  const to = `${args.target.slice(0, 10)}…`;
  if (args.token === ZERO_ADDRESS) return `Agent sent ${formatEther(args.value)} ETH to ${to}`;
  if (args.token.toLowerCase() === USDG.toLowerCase()) return `Agent moved $${usdg(args.amount)} USDG to ${to}`;
  return `Agent moved ${args.amount.toString()} of ${args.token.slice(0, 10)}… to ${to}`;
}

// ---------------------------------------------------------------- reads
/** v2 when the new factory knows the wallet (factory.isPolypadWallet is
 * authoritative); anything else is v1. Fallback (same as client.ts
 * useWalletVersion): a wallet migrated from the superseded Nov 21 factory
 * to the new modules is NOT in the new factory's registry, so it also
 * counts as v2 when the new module holds a policy for it (agentKeyOf != 0)
 * — without this the migrated wallet would render the v1 UI and v1 reads. */
async function readVersion(safe: Addr): Promise<'v1' | 'v2'> {
  if (!FACTORY_V2) return 'v1';
  try {
    const isV2 = (await client.readContract({
      address: FACTORY_V2, abi: AgentWalletFactoryV2ABI, functionName: 'isPolypadWallet', args: [safe],
    })) as boolean;
    if (isV2) return 'v2';
    if (!MODULE_V2) return 'v1';
    const agentKey = (await client.readContract({
      address: MODULE_V2, abi: AgentWalletModuleV2ABI, functionName: 'agentKeyOf', args: [safe],
    })) as string;
    return agentKey !== ZERO_ADDRESS ? 'v2' : 'v1';
  } catch {
    return 'v1';
  }
}

async function readState(safe: Addr, version: 'v1' | 'v2'): Promise<{ eth: bigint; usdg: bigint; frozen: boolean }> {
  const moduleAddress = version === 'v2' ? MODULE_V2 : MODULE_V1;
  const abi = version === 'v2' ? AgentWalletModuleV2ABI : AgentWalletModuleABI;
  const [eth, usdgBal, frozen] = await Promise.all([
    client.getBalance({ address: safe }),
    client.readContract({ address: USDG, abi: erc20Abi, functionName: 'balanceOf', args: [safe] }) as Promise<bigint>,
    moduleAddress
      ? (client.readContract({ address: moduleAddress, abi, functionName: 'frozen', args: [safe] }) as Promise<boolean>).catch(() => false)
      : Promise.resolve(false),
  ]);
  return { eth, usdg: usdgBal, frozen };
}

async function readPolydash(safe: Addr): Promise<{ held: bigint; staked: bigint; earned: bigint }> {
  const [held, staked, earned] = await Promise.all([
    client.readContract({ address: POLYDASH, abi: erc20Abi, functionName: 'balanceOf', args: [safe] }) as Promise<bigint>,
    client.readContract({ address: STAKING_POOL, abi: STAKING_POOL_ABI, functionName: 'balanceOf', args: [safe] }) as Promise<bigint>,
    client.readContract({ address: STAKING_POOL, abi: STAKING_POOL_ABI, functionName: 'earned', args: [safe] }) as Promise<bigint>,
  ]);
  return { held, staked, earned };
}

async function readScore(safe: Addr): Promise<WalletDetailStateJson['score']> {
  const none: WalletDetailStateJson['score'] = { registered: false, agentId: null, scored: false, score: null, components: null, updatedAt: null };
  try {
    const id = Number(await client.readContract({ address: REGISTRY, abi: AgentRegistryABI, functionName: 'agentIdByWallet', args: [safe] }));
    if (!id) return none;
    const s = (await client.readContract({ address: SCORE, abi: AgentScoreABI, functionName: 'scores', args: [BigInt(id)] })) as unknown as {
      score: number; performance: number; history: number; activity: number; stake: number; conduct: number; updatedAt: bigint; exists: boolean;
    };
    const scored = s.exists === true;
    return {
      registered: true, agentId: id, scored,
      score: scored ? Number(s.score) : null,
      components: scored ? [Number(s.performance), Number(s.history), Number(s.activity), Number(s.stake), Number(s.conduct)] : null,
      updatedAt: scored ? Number(s.updatedAt) : null,
    };
  } catch {
    return none;
  }
}

async function readAgentKeyV2(safe: Addr): Promise<string | null> {
  if (!MODULE_V2) return null;
  const key = (await client.readContract({
    address: MODULE_V2, abi: AgentWalletModuleV2ABI, functionName: 'agentKeyOf', args: [safe],
  })) as string;
  return key === ZERO_ADDRESS ? null : key;
}

async function readAgentKeyV1(safe: Addr, latest: bigint): Promise<string | null> {
  if (!FACTORY_V1 || !MODULE_V1) return null;
  let key: string | null = null;
  // Created events first, then rotations in block order; the last one wins.
  const created = await getLogsFull({ address: FACTORY_V1, event: WalletCreatedEvent, args: { safe }, fromBlock: V1_SCAN_START, toBlock: latest });
  for (const part of created) key = (part.args as { agentKey: string }).agentKey;
  const rotated = await getLogsFull({ address: MODULE_V1, event: KeyRotatedEvent, args: { safe }, fromBlock: V1_SCAN_START, toBlock: latest });
  const sorted = [...rotated].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber),
  );
  for (const l of sorted) key = (l.args as { newKey: string }).newKey;
  return key;
}

async function readCreatedBlockV2(safe: Addr, latest: bigint): Promise<bigint | null> {
  const scan = async (factory: Addr, from: bigint): Promise<bigint | null> => {
    const logs = await getLogsFull({ address: factory, event: WalletCreatedV2Event, args: { safe }, fromBlock: from, toBlock: latest });
    return logs.length ? (logs[0].blockNumber as bigint) : null;
  };
  if (!FACTORY_V2) return null;
  return (await scan(FACTORY_V2, FACTORY_V2_DEPLOY_BLOCK)) ?? (await scan(FACTORY_V2_PREVIOUS, FACTORY_V2_PREVIOUS_DEPLOY_BLOCK));
}

async function readCreatedBlockV1(safe: Addr, latest: bigint): Promise<bigint | null> {
  if (!FACTORY_V1) return null;
  const logs = await getLogsFull({ address: FACTORY_V1, event: WalletCreatedEvent, args: { safe }, fromBlock: V1_SCAN_START, toBlock: latest });
  return logs.length ? (logs[0].blockNumber as bigint) : null;
}

async function readPolicy(
  safe: Addr, agentKey: string, version: 'v1' | 'v2',
): Promise<WalletDetailStateJson['policy']> {
  const moduleAddress = version === 'v2' ? MODULE_V2 : MODULE_V1;
  if (!moduleAddress) return null;
  const abi = version === 'v2' ? AgentWalletModuleV2ABI : AgentWalletModuleABI;
  const key = agentKey as Addr;
  if (version === 'v2') {
    const [policy, caps, spent, active] = await Promise.all([
      client.readContract({ address: moduleAddress, abi, functionName: 'getPolicy', args: [safe, key] }) as Promise<{ expiry: bigint; startHour: number; endHour: number; exists: boolean }>,
      client.readContract({ address: moduleAddress, abi, functionName: 'getTokenCaps', args: [safe, key, USDG] }) as Promise<{ daily: bigint }>,
      client.readContract({ address: moduleAddress, abi, functionName: 'getSpent', args: [safe, key, USDG] }) as Promise<[bigint, bigint]>,
      client.readContract({ address: moduleAddress, abi, functionName: 'isKeyActive', args: [safe, key] }) as Promise<boolean>,
    ]);
    if (!policy.exists) return null;
    return {
      dailyCapUsdg: caps.daily.toString(), spentTodayUsdg: spent[0].toString(),
      expiry: Number(policy.expiry), startHour: Number(policy.startHour), endHour: Number(policy.endHour),
      revoked: false, active,
    };
  }
  const [policy, caps, spent, active] = await Promise.all([
    client.readContract({ address: moduleAddress, abi, functionName: 'getPolicy', args: [safe, key] }) as Promise<{ expiry: bigint; startHour: number; endHour: number; exists: boolean }>,
    client.readContract({ address: moduleAddress, abi, functionName: 'getTokenCaps', args: [safe, key, USDG] }) as Promise<{ perPayment: bigint; daily: bigint; weekly: bigint }>,
    client.readContract({ address: moduleAddress, abi, functionName: 'getSpent', args: [safe, key, USDG] }) as Promise<[bigint, bigint, bigint, bigint]>,
    client.readContract({ address: moduleAddress, abi, functionName: 'isKeyActive', args: [safe, key] }) as Promise<boolean>,
  ]);
  if (!policy.exists) return null;
  return {
    perPaymentCapUsdg: caps.perPayment.toString(), dailyCapUsdg: caps.daily.toString(), weeklyCapUsdg: caps.weekly.toString(),
    spentTodayUsdg: spent[0].toString(), spentThisWeekUsdg: spent[1].toString(),
    expiry: Number(policy.expiry), startHour: Number(policy.startHour), endHour: Number(policy.endHour),
    revoked: false, active,
  };
}

async function readPolyCap(
  safe: Addr, agentKey: string, version: 'v1' | 'v2',
): Promise<WalletDetailStateJson['polyCap']> {
  const moduleAddress = version === 'v2' ? MODULE_V2 : MODULE_V1;
  if (!moduleAddress) return null;
  const abi = version === 'v2' ? AgentWalletModuleV2ABI : AgentWalletModuleABI;
  const key = agentKey as Addr;
  const [caps, tokens, allowance] = await Promise.all([
    client.readContract({ address: moduleAddress, abi, functionName: 'getTokenCaps', args: [safe, key, POLYDASH] }) as Promise<{ daily: bigint }>,
    client.readContract({ address: moduleAddress, abi, functionName: 'getPolicyTokens', args: [safe, key] }) as Promise<string[]>,
    (client.readContract({ address: POLYDASH, abi: erc20Abi, functionName: 'allowance', args: [safe, REGISTRY] }) as Promise<bigint>).catch(() => undefined),
  ]);
  return {
    capped: tokens.some((t) => t.toLowerCase() === POLYDASH.toLowerCase()),
    daily: (caps.daily ?? 0n).toString(),
    registryAllowance: allowance === undefined ? null : allowance.toString(),
  };
}

type ActivityRaw = {
  kind: string; label: string; txHash: string; blockNumber: bigint; logIndex: number;
  actor: string; to?: string; value?: bigint; token?: string; amount?: bigint;
};

async function readActivity(
  safe: Addr, fromBlock: bigint, latest: bigint, version: 'v1' | 'v2',
): Promise<ActivityRaw[]> {
  const moduleAddress = version === 'v2' ? MODULE_V2 : MODULE_V1;
  if (!moduleAddress) return [];
  const isV2 = version === 'v2';
  const items: ActivityRaw[] = [];
  // One topic-filtered call per event type over the full range (each ~0.2s);
  // the 99k chunking lives in getLogsFull as the >10k-result fallback.
  const [exec, policy, caps, revoked, frozen, unfrozen, rotated, rotI, rotX, rotC, ok, fail] = await Promise.all([
    getLogsFull({ address: moduleAddress, event: ExecutedEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: KeyPolicySetEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: isV2 ? TokenCapsSetEventV2 : TokenCapsSetEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: KeyRevokedEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: FrozenEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: UnfrozenEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: KeyRotatedEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: RotationInitiatedEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: RotationCancelledEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: moduleAddress, event: RotationCompletedEvent, args: { safe }, fromBlock, toBlock: latest }),
    getLogsFull({ address: safe, event: ExecutionSuccessEvent, fromBlock, toBlock: latest }),
    getLogsFull({ address: safe, event: ExecutionFailureEvent, fromBlock, toBlock: latest }),
  ]);
  for (const l of exec as { args: { target: string; token: string; amount: bigint; value: bigint; key: string }; blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
    items.push({
      kind: 'executed',
      label: describeExecuted({ target: l.args.target, token: l.args.token, amount: l.args.amount, value: l.args.value }),
      txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex,
      actor: l.args.key, to: l.args.target, value: l.args.value, token: l.args.token, amount: l.args.amount,
    });
  }
  const push = (logs: unknown[], kind: string, label: (a: Record<string, unknown>) => string) => {
    for (const l of logs as { args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
      items.push({ kind, label: label(l.args), txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex, actor: String(l.args.key ?? l.args.safe ?? '') });
    }
  };
  push(policy, 'policy', (a) => {
    const exp = new Date(Number(a.expiry as bigint) * 1000).toLocaleDateString();
    const win = (a.startHour as number) !== 0 || (a.endHour as number) !== 0
      ? `, works ${(a.startHour as number)}:00–${(a.endHour as number)}:00 UTC` : '';
    return `Key limits set: key expires ${exp}${win}`;
  });
  push(caps, 'caps', (a) => {
    const token = (a.token as string).toLowerCase() === USDG.toLowerCase() ? 'USDG' : (a.token as string).slice(0, 10);
    if (isV2) return `Daily limit set for ${token}: up to $${usdg((a.daily as bigint) ?? 0n)} a day — the daily limit is the only bound`;
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
  for (const l of [...ok, ...fail] as { blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
    items.push({ kind: 'safe-exec', label: 'Owner-signed wallet action executed', txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex, actor: '' });
  }
  return items.sort((a, b) => (b.blockNumber === a.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
}

type LedgerRaw = {
  id: string; direction: 'in' | 'out'; token: 'ETH' | 'USDG' | 'POLYDASH'; amount: bigint; decimals: number;
  label: string; txHash: string; blockNumber: bigint; logIndex: number; actor: 'agent' | 'owner' | 'other';
  timestamp?: number;
};

async function readLedger(
  safe: Addr, fromBlock: bigint, latest: bigint, activity: ActivityRaw[],
): Promise<LedgerRaw[]> {
  const rows: LedgerRaw[] = [];
  const tokens: { address: Addr; symbol: 'USDG' | 'POLYDASH'; decimals: number }[] = [
    { address: USDG, symbol: 'USDG', decimals: 6 },
    { address: POLYDASH, symbol: 'POLYDASH', decimals: 18 },
  ];
  // One topic-filtered call per direction/token over the full range (each
  // ~0.2s); getLogsFull falls back to 99k chunks only if the RPC rejects the
  // call for exceeding its 10,000-log result limit.
  const parts = await Promise.all(
    tokens.flatMap((t) => [
      getLogsFull({ address: t.address, event: TransferEvent, args: { from: safe }, fromBlock, toBlock: latest }),
      getLogsFull({ address: t.address, event: TransferEvent, args: { to: safe }, fromBlock, toBlock: latest }),
    ]),
  );
  parts.forEach((logs, i) => {
      const t = tokens[Math.floor(i / 2)];
      const isOut = i % 2 === 0;
      for (const l of logs as { args: { from: string; to: string; value: bigint }; blockNumber: bigint; logIndex: number; transactionHash: string }[]) {
        const other = isOut ? l.args.to : l.args.from;
        const isStaking =
          t.symbol === 'POLYDASH' &&
          (isOut
            ? l.args.to.toLowerCase() === STAKING_POOL.toLowerCase()
            : l.args.from.toLowerCase() === STAKING_POOL.toLowerCase());
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
  // Agent payments, from the activity feed's Executed events. A token payment
  // shows up as BOTH an Executed event and a Transfer-out in the same
  // transaction — the Transfer row is dropped and the Executed row kept.
  for (const item of activity) {
    if (item.kind !== 'executed' || !item.token) continue;
    const isEth = item.token.toLowerCase() === ZERO_ADDRESS;
    const tokenLower = item.token.toLowerCase();
    if (!isEth && tokenLower !== USDG.toLowerCase() && tokenLower !== POLYDASH.toLowerCase()) continue;
    const token: 'ETH' | 'USDG' | 'POLYDASH' = isEth ? 'ETH' : tokenLower === USDG.toLowerCase() ? 'USDG' : 'POLYDASH';
    const amount = isEth ? (item.value ?? 0n) : (item.amount ?? 0n);
    if (amount <= 0n) continue;
    const dup = !isEth
      ? rows.findIndex((r) => r.direction === 'out' && r.token === token && r.txHash === item.txHash && r.amount === amount)
      : -1;
    if (dup >= 0) {
      rows[dup] = { ...rows[dup], label: `Agent paid ${shortenAddress(item.to ?? '')}`, actor: 'agent' };
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
  const out = rows.sort((a, b) => (b.blockNumber === a.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
  return out.map((r) => ({ ...r, timestamp: times.get(r.blockNumber) }));
}

// ---------------------------------------------------------------- entry
/** Everything the wallet-detail page needs, read from the server so the
 * visitor's browser never has to reach the chain RPC itself. All reads are
 * public on-chain data. Throws on RPC failure — the route turns that into
 * a 500 and the page shows its existing error state. */
export async function getWalletDetailState(safeInput: string): Promise<WalletDetailStateJson> {
  // Normalize to the EIP-55 checksum first: callers pass the URL casing,
  // which may not be canonical (a link or bookmark can carry any casing),
  // and viem's readContract rejects non-checksummed addresses with
  // InvalidAddressError — which 500s the whole route. getAddress throws on
  // invalid input; the route validates with isAddress(strict:false) first.
  const safe = getAddress(safeInput) as Addr;
  const latest = await client.getBlockNumber();
  const version = await readVersion(safe);
  const [state, polydash, score, agentKey, createdBlock] = await Promise.all([
    readState(safe, version),
    readPolydash(safe),
    readScore(safe),
    version === 'v2' ? readAgentKeyV2(safe) : readAgentKeyV1(safe, latest),
    version === 'v2' ? readCreatedBlockV2(safe, latest) : readCreatedBlockV1(safe, latest),
  ]);
  const fromBlock = createdBlock ?? (version === 'v2' ? FACTORY_V2_DEPLOY_BLOCK : V1_SCAN_START);
  const [policy, polyCap, activity] = await Promise.all([
    agentKey ? readPolicy(safe, agentKey, version) : Promise.resolve(null),
    agentKey ? readPolyCap(safe, agentKey, version) : Promise.resolve(null),
    readActivity(safe, fromBlock, latest, version),
  ]);
  const ledgerRaw = await readLedger(safe, fromBlock, latest, activity);
  return {
    version,
    eth: state.eth.toString(),
    usdg: state.usdg.toString(),
    frozen: state.frozen,
    polydash: { held: polydash.held.toString(), staked: polydash.staked.toString(), earned: polydash.earned.toString() },
    agentKey,
    policy,
    polyCap,
    createdBlock: createdBlock === null ? null : createdBlock.toString(),
    score,
    activity: activity.map((a) => ({
      kind: a.kind, label: a.label, txHash: a.txHash,
      blockNumber: a.blockNumber.toString(), logIndex: a.logIndex, actor: a.actor,
      to: a.to, value: a.value === undefined ? undefined : a.value.toString(),
      token: a.token, amount: a.amount === undefined ? undefined : a.amount.toString(),
    })),
    ledger: ledgerRaw.map((r) => ({
      id: r.id, direction: r.direction, token: r.token, amount: r.amount.toString(),
      decimals: r.decimals, label: r.label, txHash: r.txHash,
      blockNumber: r.blockNumber.toString(), logIndex: r.logIndex, actor: r.actor,
      timestamp: r.timestamp,
    })),
  };
}
