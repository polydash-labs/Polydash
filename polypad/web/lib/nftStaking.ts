import { parseAbi } from 'viem';
import { NFT_FACTORY_DEPLOY_BLOCK } from '@/lib/contracts/nft-abis';

export type Addr = `0x${string}`;

/** Set this after deploying the factory from /admin/deploy-nft-staking. null = not deployed yet. */
export const NFT_STAKING_FACTORY_ADDRESS: Addr | null = '0x827b9BB6a176D13Ea7E05b8e5891c8040cb822B1';

/** Log scans for pools start here (pools can only exist after the factory). */
export const NFT_STAKING_FROM_BLOCK: bigint = NFT_FACTORY_DEPLOY_BLOCK;

export const FIXED_NFT_FACTORY: Addr = '0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd';
export const CURVE_NFT_FACTORY: Addr = '0x8bdb1d8Db9aeC18bB464F719d5Bd97cFf8F1Ee94';
export const POLYDASH_TOKEN: Addr = '0x319525528f42167eF7fC18b77b889958080568e4';
export const ERC721_INTERFACE_ID = '0x80ac58cd' as const;

export const DEFAULT_REWARD_AMOUNT = '1000000';
export const DEFAULT_DURATION_DAYS = 14;
export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 3650;
export const DEPLOY_GAS_FLOOR = BigInt(6_000_000);

// Copy
export const NOT_AUDITED_NOTE = 'New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.';
export const STAKED_LOCK_NOTE = "Staked NFTs can't be burned for floor value, sold or listed until withdrawn.";
export const BOOST_NOTE = 'Boosts count from when they are activated, not retroactively.';
export const WITHDRAW_BOOST_WARNING = 'Withdrawing resets the boost timer for those NFTs and may drop your set bonus.';
export const EMERGENCY_WARNING = 'Emergency withdraw returns your NFTs without claiming. Any unclaimed rewards are forfeited.';
export const OUTSIDE_LABEL = 'Outside collection: not launched on Polypad';
export const POLYPAD_LABEL = 'Polypad collection';
export const SHARE_FOOTER = 'Not financial advice. New contract. Bevor-scanned. Not a formal audit.';

// Gas: limit = max(estimate x 1.5, floor)
export type StakingFn =
  | 'createPool' | 'createBoostedPool' | 'fund' | 'stake' | 'withdraw' | 'emergencyWithdraw'
  | 'poke' | 'pokeAndClaim' | 'claim' | 'recoverUnallocated' | 'approve' | 'setApprovalForAll';

export function gasFloor(fn: StakingFn, ids = 0): bigint {
  const n = BigInt(Math.max(0, ids));
  switch (fn) {
    case 'createPool':
    case 'createBoostedPool': return BigInt(3_500_000);
    case 'fund': return BigInt(200_000);
    case 'stake': return BigInt(180_000) + BigInt(45_000) * n;
    case 'withdraw':
    case 'emergencyWithdraw': return BigInt(160_000) + BigInt(45_000) * n;
    case 'poke': return BigInt(100_000) + BigInt(50_000) * n;
    case 'pokeAndClaim': return BigInt(150_000) + BigInt(50_000) * n;
    case 'claim':
    case 'recoverUnallocated': return BigInt(150_000);
    default: return BigInt(0);
  }
}

export function gasLimit(estimate: bigint | null, floor: bigint): bigint {
  const scaled = estimate == null ? BigInt(0) : (estimate * BigInt(3)) / BigInt(2);
  return scaled > floor ? scaled : floor;
}

// Boosts
export interface BoostParams { tierAfter: number[]; tierBps: number[]; setMin: number; setBonusBps: number }
export const MAX_TIERS = 4;
export const MAX_TIER_BPS = 30_000;
export const MAX_SET_BONUS_BPS = 5_000;
export const DAY = 86_400;
export const DEFAULT_TIERS = [
  { days: 0, mult: 1 },
  { days: 3, mult: 1.25 },
  { days: 7, mult: 1.5 },
];
export const DEFAULT_SET = { min: 3, bonusPct: 10 };
export const NO_TIERS = { tierAfter: [0], tierBps: [10_000] };

export function boostTuple(b: BoostParams) {
  return { tierAfter: b.tierAfter, tierBps: b.tierBps, setMin: b.setMin, setBonusBps: b.setBonusBps } as const;
}

export const multLabel = (bps: number | bigint) => `${(Number(bps) / 10_000).toFixed(2).replace(/0$/, '')}x`;

export const isAddr = (a?: string | null): a is Addr => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

// Minimal ERC-721 / ERC-165 reads used for any collection (Polypad or outside).
export const Erc721ReadABI = parseAbi([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export const IsCollectionABI = parseAbi(['function isCollection(address) view returns (bool)']);

export const Erc20MiniABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export type PoolStatus = 'upcoming' | 'active' | 'ending' | 'ended';
export function poolStatus(now: number, start: number, end: number): PoolStatus {
  if (now < start) return 'upcoming';
  if (now >= end) return 'ended';
  if (end - now < 2 * DAY) return 'ending';
  return 'active';
}

export function formatDuration(secs: number): string {
  if (secs <= 0) return '0m';
  const d = Math.floor(secs / DAY), h = Math.floor((secs % DAY) / 3600), m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

/** Resolves ipfs:// and data: JSON token URIs; returns the image field if any. */
export async function fetchTokenImage(uri: string): Promise<string | null> {
  try {
    const s = uri.trim();
    if (!s) return null;
    let json: any;
    if (s.startsWith('data:application/json;base64,')) json = JSON.parse(atob(s.slice(29)));
    else if (s.startsWith('data:application/json')) json = JSON.parse(decodeURIComponent(s.slice(s.indexOf(',') + 1)));
    else {
      const url = s.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${s.slice(7).replace(/^ipfs\//, '')}` : s;
      if (!/^https?:\/\//.test(url)) return null;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (!r.ok) return null;
      json = await r.json();
    }
    const img = typeof json?.image === 'string' ? json.image : typeof json?.image_url === 'string' ? json.image_url : null;
    return img || null;
  } catch {
    return null;
  }
}
