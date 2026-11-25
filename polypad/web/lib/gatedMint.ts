// Holder mint (token-gated NFT collections): config, gas, limits and copy. Isomorphic, no RPC.
// ABIs and bytecode live in lib/gatedArtifacts.ts (owner's file, never retyped).
import { parseAbi, parseEther } from 'viem';
import { gasLimit, isAddr, type Addr } from '@/lib/nftStaking';
import { GATED_FACTORY_BYTECODE, GATED_PHASE } from '@/lib/gatedArtifacts';

export { gasLimit, isAddr };
export type { Addr };

/** Set to the deployed gated NFT factory address to turn the feature on. While null, the wizard sale type and token card are hidden and /nfts/holder/* shows GATED_NOT_LIVE. */
export const GATED_FACTORY_ADDRESS: `0x${string}` | null = '0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d';
/** Sourcify exact match for the deployed factory. */
export const GATED_CONTRACT_URL = 'https://repo.sourcify.dev/4663/0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d';

export const gatedFactory = (): Addr | null => GATED_FACTORY_ADDRESS as Addr | null;
export const gatedLive = () => !!GATED_FACTORY_ADDRESS;
/** True while lib/gatedArtifacts.ts is still the placeholder (no bytecode). */
export const artifactsMissing = () => String(GATED_FACTORY_BYTECODE ?? '0x').length <= 2;

/** Every write: gas = max(estimate x 1.5, 4,000,000). */
export const GAS_FLOOR = BigInt(4_000_000);
export const gatedGas = (estimate: bigint | null) => gasLimit(estimate, GAS_FLOOR);

export const POLYDASH_TOKEN_ADDRESS: Addr = '0x319525528f42167eF7fC18b77b889958080568e4';
export const isPolydashToken = (a?: string | null) => !!a && a.toLowerCase() === POLYDASH_TOKEN_ADDRESS.toLowerCase();
export const isZero = (a?: string | null) => !a || /^0x0{40}$/i.test(a);
export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Addr;

// Limits (mirrors the factory's parameter checks)
export const MIN_SUPPLY = 1;
export const MAX_SUPPLY = 10_000;
export const MIN_PRICE = parseEther('0.00001');
export const MAX_PRICE = parseEther('100');
export const MAX_PER_WALLET = 100;
export const MAX_START_AHEAD = 30 * 86_400;
export const MIN_HOLDER_DURATION = 3_600;
export const MAX_HOLDER_DURATION = 30 * 86_400;
export const PLATFORM_FEE_BPS = 20; // 0.2%
export const DURATION_PRESETS = [
  { value: 86_400, label: '24 hours' },
  { value: 3 * 86_400, label: '3 days' },
  { value: 7 * 86_400, label: '7 days' },
];

/** Phase index = on-chain phase(): 0 Not started, 1 Holder phase, 2 Public mint, 3 Ended. */
export const PHASE_NOT_STARTED = 0;
export const PHASE_HOLDER = 1;
export const PHASE_PUBLIC = 2;
export const PHASE_ENDED = 3;
export const phaseLabel = (p: number) => (GATED_PHASE as readonly string[])[p] ?? 'Unknown';

// Minimal ABIs (standard interfaces only; the gated contracts' ABIs come from gatedArtifacts.ts)
export const LaunchCreatorABI = parseAbi(['function creator() view returns (address)']);
export const Erc20GateABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]);
export const Erc721GateABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function ownerOf(uint256) view returns (address)',
]);

// Copy
export const NOT_AUDITED_NOTE = 'New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.';
export const HOLDER_CHECK_NOTE = 'Holder check is a balance check at mint time. It is not a snapshot. Tokens moved to another wallet can qualify that wallet too; per-wallet limits apply.';
export const GATED_NOT_LIVE = 'Holder mint is not live yet';
export const NOT_ELIGIBLE = "Holder mint is available to a token's launch creator.";
export const EOA_NOTE = 'Holder mint must be sent from a regular wallet address (EOA). Smart-contract wallets can use the public mint.';

export const fmtDateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
