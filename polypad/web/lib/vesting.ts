// Creator vesting ("Lock & stake"): config, gas floors, schedule presets and copy. Isomorphic, no RPC.
// ABIs and bytecode live in lib/vestingArtifacts.ts (owner's file, never retyped).
import { parseAbi } from 'viem';
import { gasLimit, isAddr, type Addr } from '@/lib/nftStaking';

export { gasLimit, isAddr };
export type { Addr };

/** Set to the deployed VestingFactory address to turn the feature on. While null, every vesting surface shows NOT_LIVE and disables actions. */
export const VESTING_FACTORY_ADDRESS: `0x${string}` | null = '0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022';
export const VESTING_CONTRACT_URL = 'https://sourcify.dev/#/lookup/0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022';
export const V2_STAKING_FACTORY: Addr = '0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0';
export const POLYDASH_TOKEN_ADDRESS: Addr = '0x319525528f42167eF7fC18b77b889958080568e4';
export const ZERO_ADDRESS: Addr = '0x0000000000000000000000000000000000000000';

export const vestingFactory = (): Addr | null => VESTING_FACTORY_ADDRESS as Addr | null;
export const isPolydashToken = (a?: string | null) => !!a && a.toLowerCase() === POLYDASH_TOKEN_ADDRESS.toLowerCase();
export const isZero = (a?: string | null) => !a || /^0x0{40}$/i.test(a);

export const DAY = 86_400;
export const BADGE_MIN_CLIFF_DAYS = 30;
export const BADGE_MIN_DURATION_DAYS = 180;
export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 3650;
export const MAX_START_AHEAD_DAYS = 365;

export const meetsBadge = (cliffSec: number, durationSec: number) =>
  cliffSec >= BADGE_MIN_CLIFF_DAYS * DAY && durationSec >= BADGE_MIN_DURATION_DAYS * DAY;

export type PresetId = 'hp' | 'long' | 'custom';
export const PRESETS: { id: Exclude<PresetId, 'custom'>; label: string; cliffDays: number; durationDays: number }[] = [
  { id: 'hp', label: '30-day cliff, 180-day vest (Holder Protections minimum)', cliffDays: 30, durationDays: 180 },
  { id: 'long', label: '90-day cliff, 365-day vest', cliffDays: 90, durationDays: 365 },
];

export type VestingFn =
  | 'deploy' | 'approve' | 'createVault' | 'claimRewards' | 'release' | 'stakeIdle' | 'exitEndedPool'
  | 'migrate' | 'emergencyExitPool' | 'extendSchedule' | 'proposeBeneficiary' | 'acceptBeneficiary';

export const GAS_FLOORS: Record<VestingFn, bigint> = {
  deploy: BigInt(4_500_000),
  approve: BigInt(100_000),
  createVault: BigInt(3_500_000),
  claimRewards: BigInt(500_000),
  release: BigInt(600_000),
  stakeIdle: BigInt(400_000),
  exitEndedPool: BigInt(500_000),
  migrate: BigInt(700_000),
  emergencyExitPool: BigInt(400_000),
  extendSchedule: BigInt(150_000),
  proposeBeneficiary: BigInt(150_000),
  acceptBeneficiary: BigInt(300_000),
};

// Copy (exact owner wording where given).
export const VESTING_NOT_LIVE = 'Creator vesting is not live yet';
export const VESTING_NOTE = 'New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.';
export const NOT_POLYPAD_TOKEN = 'Only tokens launched on Polypad can be locked here.';
export const NO_ADMIN_WARNING = 'There is no admin. A lost beneficiary wallet cannot be recovered.';
export const EMERGENCY_CONFIRM = 'Pending rewards are forfeited. Principal stays locked.';
export const COVERAGE_NOTE = "Covers only tokens deposited into these vaults, not the creator's other wallets.";
export const POOL_ENDS_NOTE = 'Principal returns to the vault when the pool ends and stays locked; you can move it to a new pool.';
export const HOW_IT_WORKS = [
  'Staking rewards are paid to the beneficiary right away.',
  'The locked principal only unlocks on the schedule.',
  'Nobody, including Polydash, can shorten the schedule.',
];

// Minimal reads that are not in the vesting artifacts.
export const Erc20VestABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);
export const V2FactoryViewABI = parseAbi([
  'struct PoolInfo { address pool; address creator; address stakeToken; address rewardToken; string name; string description; uint256 startTime; uint256 endTime; uint256 totalRewards; uint256 rewardRate; uint256 totalStaked; uint256 maxTotalStake; uint256 stakerCount; uint256 claimFeeBps; bool verified; }',
  'function poolsLength() view returns (uint256)',
  'function getPoolAddresses(uint256 offset, uint256 limit) view returns (address[])',
  'function isPool(address) view returns (bool)',
  'function getPoolInfo(address pool) view returns (PoolInfo)',
]);
export const V2PoolViewABI = parseAbi([
  'function name() view returns (string)',
  'function endTime() view returns (uint256)',
  'function funded() view returns (bool)',
]);

export function fmtDate(sec: number): string {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(sec: number): string {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const days = (sec: number | bigint) => Math.round(Number(sec) / DAY);
