// Where a launch's creator fees are paid: creator wallet, treasury rules vault, or another wallet. Read-only, 30 s cache per token.
import { createPublicClient, getAddress, http, parseAbi, zeroAddress, type Abi, type Address, type Hex, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { TREASURY_FACTORY_ABI } from '@/lib/treasuryArtifacts';
import { treasuryFactory } from '@/lib/treasury';

const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }) }) as PublicClient;

// Lowercase: the mixed-case forms in the spec are not valid EIP-55 checksums.
const FACTORIES: Address[] = ['0xfdfd0a095966c8b56639f7eaa13f4b0188fc08c2', '0x2c84cfcd8d283ef750e09fbed735d67f67845db2'];
const TTL = 30_000;
const ZERO_ID = `0x${'0'.repeat(64)}` as Hex;

const FACTORY_ABI = parseAbi(['function launchOfToken(address token) view returns (address)']);
const LAUNCH_ABI = parseAbi([
  'function creator() view returns (address)',
  'function creatorPayoutWallet() view returns (address)',
  'function pendingPayoutWallet() view returns (address)',
  'function payoutWalletChangeAt() view returns (uint256)',
  'function creatorFeesAccrued() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function hook() view returns (address)',
  'function poolId() view returns (bytes32)',
]);
const HOOK_ABI = parseAbi([
  'function pools(bytes32) view returns (address launchAddress, address token, uint24 platformFeeBps, uint24 creatorFeeBps, uint24 sellSpikeBps, uint64 sellSpikeEnd, uint128 liquidity, uint256 platformFeesAccrued, uint256 creatorFeesAccrued, bool active)',
]);
const RULES_ABI = TREASURY_FACTORY_ABI as unknown as Abi;

export type PayoutDestinationKind = 'creator_wallet' | 'treasury_vault' | 'other';
export type PayoutDestination = {
  token: Address;
  launch: Address;
  creator: Address;
  payoutWallet: Address;
  vault: Address | null;
  destination: PayoutDestinationKind;
  pending: null | { newWallet: Address; executeAt: number; pendingIsVault: boolean };
  graduated: boolean;
  /** Launch accrued + hook pool accrued after graduation: what claimCreatorFees() would pay now. */
  claimableWei: string;
  updatedAt: string;
};

const cache = new Map<string, { at: number; value: PayoutDestination | null }>();
const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const nz = (a?: string | null) => !!a && a !== zeroAddress && !/^0x0{40}$/i.test(a);

async function load(token: Address): Promise<PayoutDestination | null> {
  const factory = treasuryFactory();
  // Multicall 1: launch lookup on both factories + treasury vault.
  const first = await client.multicall({
    contracts: [
      ...FACTORIES.map((address) => ({ address, abi: FACTORY_ABI, functionName: 'launchOfToken' as const, args: [token] as const })),
      ...(factory ? [{ address: factory, abi: RULES_ABI, functionName: 'rulesOf', args: [token] }] : []),
    ] as any,
    allowFailure: true,
  });
  const [a0, a1] = [first[0]!, first[1]!];
  if (a0.status === 'failure' && a1.status === 'failure') throw new Error(`launchOfToken failed on both factories: ${String(a0.error)}`);
  const launchRaw = [a0, a1].map((r) => (r.status === 'success' ? (r.result as Address) : null)).find((a) => nz(a));
  if (!launchRaw) return null;
  const launch = getAddress(launchRaw);
  if (factory && first[2]?.status === 'failure') throw new Error(`rulesOf failed: ${String(first[2].error)}`);
  const vaultRaw = factory && first[2]?.status === 'success' ? (first[2].result as Address) : null;
  const vault = nz(vaultRaw) ? getAddress(vaultRaw!) : null;

  // Multicall 2: launch views.
  const fn = ['creator', 'creatorPayoutWallet', 'pendingPayoutWallet', 'payoutWalletChangeAt', 'creatorFeesAccrued', 'graduated', 'hook', 'poolId'] as const;
  const v = await client.multicall({ contracts: fn.map((functionName) => ({ address: launch, abi: LAUNCH_ABI, functionName })), allowFailure: true });
  for (const i of [0, 1]) if (v[i].status !== 'success') throw new Error(`launch view ${fn[i]} failed`);
  const get = <T,>(i: number, fallback: T): T => (v[i].status === 'success' ? (v[i].result as T) : fallback);
  const creator = getAddress(get<Address>(0, zeroAddress));
  const payoutRaw = get<Address>(1, zeroAddress);
  const payoutWallet = nz(payoutRaw) ? getAddress(payoutRaw) : creator;
  const pendingRaw = get<Address>(2, zeroAddress);
  const executeAt = Number(get<bigint>(3, BigInt(0)));
  const graduated = get<boolean>(5, false);
  const hook = get<Address>(6, zeroAddress);
  const poolId = get<Hex>(7, ZERO_ID);

  let claimable = get<bigint>(4, BigInt(0));
  if (graduated && nz(hook) && poolId !== ZERO_ID) {
    try {
      const pool = await client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pools', args: [poolId] });
      claimable += pool[8];
    } catch (e) {
      console.error('hook pools read failed', e);
    }
  }

  const destination: PayoutDestinationKind = vault && eq(payoutWallet, vault) ? 'treasury_vault' : eq(payoutWallet, creator) ? 'creator_wallet' : 'other';
  const pending = nz(pendingRaw)
    ? { newWallet: getAddress(pendingRaw), executeAt, pendingIsVault: !!vault && eq(pendingRaw, vault) }
    : null;

  return { token, launch, creator, payoutWallet, vault, destination, pending, graduated, claimableWei: claimable.toString(), updatedAt: new Date().toISOString() };
}

/** null = not a Polydash factory launch. Throws on RPC failure. `fresh` skips the 30 s cache (used right after a payout tx). */
export async function getPayoutDestination(tokenIn: string, fresh = false): Promise<PayoutDestination | null> {
  const token = getAddress(tokenIn);
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load(token);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** API shape shared by /api/creator-fees and /api/treasury. */
export function payoutApiFields(d: PayoutDestination | null) {
  if (!d) return { payoutDestination: null, vault: null, pendingPayoutWallet: null, feeRouting: null };
  return {
    payoutDestination: d.destination,
    payoutWallet: d.payoutWallet,
    vault: d.vault ? (d.vault.toLowerCase() as Address) : null,
    pendingPayoutWallet: d.pending ? { address: d.pending.newWallet, executeAt: d.pending.executeAt, isVault: d.pending.pendingIsVault } : null,
    feeRouting: { destination: d.destination, claimableWei: d.claimableWei, launch: d.launch, creator: d.creator, payoutWallet: d.payoutWallet },
  };
}
