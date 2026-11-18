// Creator bond: config, gas floors, presets and copy. Isomorphic, no RPC.
// ABIs and bytecode live in lib/bondArtifacts.ts (owner's file, never retyped).
import { parseAbi, parseEther } from 'viem';
import { gasLimit, isAddr, type Addr } from '@/lib/nftStaking';
import { BOND_STATUS } from '@/lib/bondArtifacts';

export { gasLimit, isAddr, BOND_STATUS };
export type { Addr };

/** Set to the deployed CreatorBondFactory address to turn the feature on. While null, every bond surface shows BOND_NOT_LIVE and disables actions. */
export const BOND_FACTORY_ADDRESS: `0x${string}` | null = '0x876170251e30F99E27119AF0e90648A88D508f97';
export const BOND_CONTRACT_URL = 'https://repo.sourcify.dev/4663/0x876170251e30F99E27119AF0e90648A88D508f97';

export const BADGE_MIN_BOND_WEI = parseEther('0.1');
export const BADGE_MIN_DURATION = 90 * 86_400;
export const DEFAULT_ALLOWANCE_BPS = 1000;
export const MAX_ALLOWANCE_BPS = 2000;
export const MAX_WALLETS = 10;
export const MIN_DURATION_DAYS = 7;
export const MAX_DURATION_DAYS = 730;
export const DAY = 86_400;

export const POLYDASH_TOKEN_ADDRESS: Addr = '0x319525528f42167eF7fC18b77b889958080568e4';
export const bondFactory = (): Addr | null => BOND_FACTORY_ADDRESS as Addr | null;
export const isPolydashToken = (a?: string | null) => !!a && a.toLowerCase() === POLYDASH_TOKEN_ADDRESS.toLowerCase();
export const isZero = (a?: string | null) => !a || /^0x0{40}$/i.test(a);
export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Status indexes match BOND_STATUS: 0 Pending, 1 Active, 2 Refunded, 3 Slashed, 4 Cancelled. */
export const STATUS_PENDING = 0;
export const STATUS_ACTIVE = 1;
export const STATUS_REFUNDED = 2;
export const STATUS_SLASHED = 3;
export const STATUS_CANCELLED = 4;
export const statusLabel = (s: number) => BOND_STATUS[s] ?? 'Unknown';

export const inputsMeetBadge = (amountWei: bigint, durationSec: number) => amountWei >= BADGE_MIN_BOND_WEI && durationSec >= BADGE_MIN_DURATION;
export const bondMeetsBadge = (status: number, amountWei: bigint, durationSec: number) => status === STATUS_ACTIVE && inputsMeetBadge(amountWei, durationSec);
export const floorOf = (committed: bigint, allowanceBps: number) => (committed * BigInt(10_000 - allowanceBps)) / BigInt(10_000);

export type PresetId = '30' | '90' | '180' | '365' | 'custom';
export const PRESETS: { id: Exclude<PresetId, 'custom'>; label: string; days: number }[] = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days (Holder Protections minimum)', days: 90 },
  { id: '180', label: '180 days', days: 180 },
  { id: '365', label: '365 days', days: 365 },
];

export type BondFn = 'deploy' | 'createBond' | 'confirmWallet' | 'cancel' | 'slash' | 'refund' | 'approve' | 'redeem';
export const GAS_FLOORS: Record<BondFn, bigint> = {
  deploy: BigInt(3_000_000),
  createBond: BigInt(2_500_000),
  confirmWallet: BigInt(300_000),
  cancel: BigInt(150_000),
  slash: BigInt(300_000),
  refund: BigInt(300_000),
  approve: BigInt(100_000),
  redeem: BigInt(300_000),
};

// Copy (owner wording).
export const BOND_NOT_LIVE = 'Creator bond is not live yet';
export const BOND_NOTE = 'New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.';
export const NOT_POLYPAD_TOKEN = 'Only tokens launched on Polypad can be bonded.';
export const NOT_CREATOR = "Only this token's launch creator can post a bond.";
export const BADGE_HINT = 'Holder Protections credit needs at least 0.1 ETH and at least 90 days';
export const WALLETS_NOTE = 'Every wallet other than yours must connect and confirm on the bond page. The bond stays Pending until all confirm. Wallets are bound for the life of the bond and cannot be removed.';
export const CONFIRM_NOTE = "Activates the bond if this is the last confirmation; needs the wallets' total to be at least the committed amount.";
export const OUTCOME = 'If the registered wallets fall below the floor before the bond ends, anyone can trigger the bond. Holders can then redeem tokens for ETH at a fixed rate. If the floor holds, the creator gets the ETH back after the bond ends.';
export const LIMITATIONS = [
  'Only the registered wallets are covered. Other wallets are not.',
  'Staking or locking committed tokens in a vesting vault lowers the wallet balance and counts as a move. Burning also counts.',
  'A bond can only be triggered while the balance is below the floor; someone has to call it. Selling and buying back before that is not caught.',
  'Nothing is enforced after the bond ends. Unclaimed ETH stays in the contract.',
];
export const floorSentence = (floor: string, symbol: string) => `Registered wallets together must keep at least ${floor} ${symbol} until the bond ends.`;

export const Erc20BondABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);
export const LaunchCreatorABI = parseAbi(['function creator() view returns (address)']);

export function fmtDate(sec: number): string {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
export const days = (sec: number | bigint) => Math.round(Number(sec) / DAY);
export function timeLeft(endSec: number, nowSec: number): string {
  const s = endSec - nowSec;
  if (s <= 0) return 'Ended';
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / 3600);
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${Math.floor((s % 3600) / 60)}m left`;
}
