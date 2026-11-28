// Server-only: the paint-critical Tokenized Fund detail read.
//
// The Polyfund detail page's first load failed in the browser (round 3):
// `usePhase3Fund` fired the NFT + vault multicalls (43 contract calls) from
// the browser into the first-load storm — the switch's 3 isFund checks, the
// fund ledger's log scans, proposals, holdings, positions, the allowlist —
// and the official RPC rejected/timed them out (viem's 10s default) often
// enough that all 5 retries exhausted after ~35s and the page showed
// "Could not load this tokenized fund right now". A second try worked
// because the isFund checks were cached by then and the storm had subsided.
//
// The same pattern as the Terminal fix (round 2): the heavy read runs once
// here, on the server, behind /api/fund/detail (cached 30s), and the browser
// makes one cheap request. The server read measures ~0.5s against the live
// RPC. The NAV log and the holder's own share lookup stay client-side — the
// log is its own query now (it only feeds the Value history card and must
// never block the paint), and the share lookup only runs for a connected
// wallet. Bigints travel as decimal strings; the client rehydrates them
// (see fundDetailFromWire).
import type { PublicClient } from 'viem';
import { publicClient } from '@/lib/agents/tools';
import { FundNFTPhase3ABI, FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';

type Addr = `0x${string}`;
type Row = { status: string; result?: unknown };
const pick = <T,>(row: Row | undefined, fallback: T): T =>
  row?.status === 'success' && row.result !== undefined ? (row.result as T) : fallback;
const ZERO = '0x0000000000000000000000000000000000000000';

const NFT_DETAIL = [
  'name', 'symbol', 'imageUri', 'manager', 'vault', 'mintPrice', 'maxSupply', 'totalMinted', 'publicOpen',
  'totalBurned', 'outstanding', 'managerMinted', 'entryFeeBps', 'protocolFeeBps', 'minSkinBps', 'skinRequired', 'skinUnlockTime',
] as const;
const VAULT_DETAIL = [
  'raised', 'raiseCap', 'status', 'templateId', 'raiseDeadline', 'mandateHash', 'mandateUri', 'hwmFeeBps', 'hwmPerNft',
  'peakNavPerNft', 'maxDrawdownBps', 'maxPositionBps', 'maxTradeBps', 'maxDeviationBps', 'navPerNft', 'nav', 'spendableEth',
  'distributionReserved', 'distRound', 'claimablePerformanceFee', 'performanceFeeAccrued', 'claimableEntryFee', 'payoutWallet',
  'lastNavCheckpoint', 'NAV_CHECKPOINT_INTERVAL',
] as const;

/** The detail payload as it travels over JSON: every bigint is a decimal string. */
export type FundDetailWire = {
  address: Addr;
  name: string;
  symbol: string;
  imageUri: string;
  manager: Addr;
  vault: Addr;
  mintPrice: string;
  maxSupply: string;
  totalMinted: string;
  publicOpen: boolean;
  totalBurned: string;
  outstanding: string;
  managerMinted: string;
  entryFeeBps: number;
  protocolFeeBps: number;
  minSkinBps: number;
  skinRequired: string;
  skinUnlockTime: number;
  raised: string;
  raiseCap: string;
  status: number;
  templateId: number;
  raiseDeadline: number;
  mandateHash: Addr;
  mandateUri: string;
  hwmFeeBps: number;
  hwmPerNft: string;
  peakNavPerNft: string;
  maxDrawdownBps: number;
  maxPositionBps: number;
  maxTradeBps: number;
  maxDeviationBps: number;
  navPerNft: string | null;
  nav: string | null;
  spendableEth: string;
  distributionReserved: string;
  distRound: number;
  claimablePerformanceFee: string;
  performanceFeeAccrued: string;
  claimableEntryFee: string;
  payoutWallet: Addr | null;
  lastNavCheckpoint: number;
  checkpointInterval: number;
  vaultEth: string;
  rounds: { id: number; perUnit: string; pot: string }[];
};

/**
 * The core detail read: NFT + vault multicalls, vault ETH balance, and the
 * distribution rounds. Returns null when the address is not a Tokenized Fund
 * (no vault/manager); throws when the chain cannot be read at all.
 */
export async function readFundDetail(address: Addr): Promise<FundDetailWire | null> {
  const client = publicClient as PublicClient;
  const fund = address;
  const n = await client.multicall({ allowFailure: true, contracts: NFT_DETAIL.map((functionName) => ({ address: fund, abi: FundNFTPhase3ABI, functionName })) });
  const vault = pick<Addr | undefined>(n[4], undefined);
  const manager = pick<Addr | undefined>(n[3], undefined);
  if (!vault || !manager || vault === ZERO) return null;
  const v = await client.multicall({ allowFailure: true, contracts: VAULT_DETAIL.map((functionName) => ({ address: vault, abi: FundVaultPhase3ABI, functionName })) });
  const distRound = Number(pick(v[18], 0n));
  const roundIds = Array.from({ length: Math.min(distRound, 200) }, (_, i) => i + 1);
  const [vaultEth, roundRes] = await Promise.all([
    client.getBalance({ address: vault }).catch(() => 0n),
    roundIds.length
      ? client.multicall({ allowFailure: true, contracts: roundIds.map((r) => ({ address: vault, abi: FundVaultPhase3ABI, functionName: 'rounds' as const, args: [BigInt(r)] as const })) })
      : Promise.resolve([]),
  ]);
  const rounds = roundIds.map((id, i) => {
    const r = pick<readonly [bigint, bigint] | null>(roundRes[i] as Row, null);
    return { id, perUnit: (r?.[0] ?? 0n).toString(), pot: (r?.[1] ?? 0n).toString() };
  });
  const optBig = (row: Row | undefined) => (row?.status === 'success' ? (row.result as bigint).toString() : null);
  const payout = pick<Addr | null>(v[22], null);
  return {
    address: fund,
    name: pick(n[0], '') || 'Tokenized Fund',
    symbol: pick(n[1], ''),
    imageUri: pick(n[2], ''),
    manager,
    vault,
    mintPrice: pick(n[5], 0n).toString(),
    maxSupply: pick(n[6], 0n).toString(),
    totalMinted: pick(n[7], 0n).toString(),
    publicOpen: pick(n[8], false),
    totalBurned: pick(n[9], 0n).toString(),
    outstanding: pick(n[10], 0n).toString(),
    managerMinted: pick(n[11], 0n).toString(),
    entryFeeBps: Number(pick(n[12], 0n)),
    protocolFeeBps: Number(pick(n[13], 0n)),
    minSkinBps: Number(pick(n[14], 0n)),
    skinRequired: pick(n[15], 0n).toString(),
    skinUnlockTime: Number(pick(n[16], 0n)),
    raised: pick(v[0], 0n).toString(),
    raiseCap: pick(v[1], 0n).toString(),
    status: Number(pick(v[2], 0)),
    templateId: Number(pick(v[3], 0n)),
    raiseDeadline: Number(pick(v[4], 0n)),
    mandateHash: pick(v[5], '0x' as Addr),
    mandateUri: pick(v[6], ''),
    hwmFeeBps: Number(pick(v[7], 0n)),
    hwmPerNft: pick(v[8], 0n).toString(),
    peakNavPerNft: pick(v[9], 0n).toString(),
    maxDrawdownBps: Number(pick(v[10], 0n)),
    maxPositionBps: Number(pick(v[11], 0n)),
    maxTradeBps: Number(pick(v[12], 0n)),
    maxDeviationBps: Number(pick(v[13], 0n)),
    navPerNft: optBig(v[14]),
    nav: optBig(v[15]),
    spendableEth: pick(v[16], 0n).toString(),
    distributionReserved: pick(v[17], 0n).toString(),
    distRound,
    claimablePerformanceFee: pick(v[19], 0n).toString(),
    performanceFeeAccrued: pick(v[20], 0n).toString(),
    claimableEntryFee: pick(v[21], 0n).toString(),
    payoutWallet: payout && payout !== ZERO ? payout : null,
    lastNavCheckpoint: Number(pick(v[23], 0n)),
    checkpointInterval: Number(pick(v[24], 3600n)),
    vaultEth: vaultEth.toString(),
    rounds,
  };
}
