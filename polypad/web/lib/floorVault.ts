// Token-backed floor vault: config, gas, limits, step logic and copy. Isomorphic, no RPC.
// ABIs and bytecode live in lib/floorVaultArtifacts.ts (owner's file, never retyped).
import { parseEther } from 'viem';
import { gasLimit, isAddr, type Addr } from '@/lib/nftStaking';
import { TOKEN_FLOOR_LIMITS } from '@/lib/floorVaultArtifacts';
import { isPolydashToken, isZero, sameAddr, ZERO_ADDRESS } from '@/lib/gatedMint';

export { gasLimit, isAddr, isPolydashToken, isZero, sameAddr, ZERO_ADDRESS };
export type { Addr };

/** Set to the deployed token floor factory address to turn the feature on. While null, the wizard option, token card and agent task are hidden and /nfts/floor/* shows FLOOR_NOT_LIVE. */
export const TOKEN_FLOOR_FACTORY_ADDRESS: `0x${string}` | null = '0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c';
export const FLOOR_CONTRACT_URL = 'https://repo.sourcify.dev/4663/0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c';
export const FLOOR_IMPL_URL = 'https://repo.sourcify.dev/4663/0xFa23E496f7244d1674fA8bE5C42556bd054140EA';

export const floorFactory = (): Addr | null => TOKEN_FLOOR_FACTORY_ADDRESS as Addr | null;
export const floorLive = () => !!TOKEN_FLOOR_FACTORY_ADDRESS;

/** Expected factory address when deployed from 0x89df...53F1 at nonce 48. */
export const EXPECTED_FACTORY_ADDRESS = '0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c';
export const ARG_LABELS = [
  'Current Polydash launch factory',
  'Earlier Polydash launch factory',
  'Polypad NFT factory (platform fee wallet)',
  'Uniswap V4 PoolManager',
];

/** Every write: gas = max(estimate x 1.5, 4,000,000). */
export const GAS_FLOOR = BigInt(4_000_000);
export const floorGas = (estimate: bigint | null) => gasLimit(estimate, GAS_FLOOR);

// Limits (wizard; factory checks are authoritative)
export const L = TOKEN_FLOOR_LIMITS;
export const MIN_PRICE = parseEther('0.00001');
export const MAX_PRICE = parseEther('100');
export const MIN_BUY = parseEther(L.maxBuyEth.min);
export const MAX_BUY = parseEther(L.maxBuyEth.max);
export const MAX_START_AHEAD = 30 * 86_400;
export const PLATFORM_FEE_BPS = 20; // 0.2%
export const BPS = 10_000;

// Vault buy step logic
export type FloorStep = 'record_price' | 'buy' | 'wait' | 'none';
export interface StepInput {
  graduated: boolean; tokenShareActive: boolean; pendingEth: bigint; obsTime: number; lastBuyTime: number;
}
export interface StepResult {
  step: FloorStep; at: number | null; upcoming: 'record_price' | 'buy' | null;
  recordReady: boolean; buyReady: boolean; buyOpensAt: number | null; obsExpiresAt: number | null; cooldownEndsAt: number;
}

export function floorStep(s: StepInput, now: number): StepResult {
  const cooldownEndsAt = s.lastBuyTime ? s.lastBuyTime + L.buyCooldownSec : 0;
  const obsExpiresAt = s.obsTime ? s.obsTime + L.obsMaxAgeSec : null;
  const buyOpensAt = s.obsTime ? Math.max(s.obsTime + L.obsDelaySec, cooldownEndsAt) : null;
  const recordReady = !s.obsTime || now > s.obsTime + L.obsMaxAgeSec;
  const buyReady = !!s.obsTime && now >= s.obsTime + L.obsDelaySec && now <= s.obsTime + L.obsMaxAgeSec && now >= cooldownEndsAt;
  const base = { recordReady, buyReady, buyOpensAt, obsExpiresAt, cooldownEndsAt };
  if (!s.graduated || !s.tokenShareActive || s.pendingEth <= BigInt(0)) return { ...base, step: 'none', at: null, upcoming: null };
  if (recordReady) return { ...base, step: 'record_price', at: now, upcoming: 'record_price' };
  if (buyReady) return { ...base, step: 'buy', at: now, upcoming: 'buy' };
  // Fresh observation exists but the buy window is not open yet
  if (buyOpensAt != null && obsExpiresAt != null && buyOpensAt <= obsExpiresAt) return { ...base, step: 'wait', at: buyOpensAt, upcoming: 'buy' };
  return { ...base, step: 'wait', at: (obsExpiresAt ?? now) + 1, upcoming: 'record_price' };
}

export const switchAvailableAt = (createdAt: number) => createdAt + L.graduationWindowSec;

// Per-NFT split for the wizard summary
export function floorSplit(price: bigint, floorBps: number, tokenShareBps: number) {
  const vault = (price * BigInt(floorBps)) / BigInt(BPS);
  const toToken = (vault * BigInt(tokenShareBps)) / BigInt(BPS);
  const fee = (price * BigInt(PLATFORM_FEE_BPS)) / BigInt(BPS);
  const creator = price > vault + fee ? price - vault - fee : BigInt(0);
  return { vault, toToken, toEth: vault - toToken, fee, creator };
}

// Copy
export const FLOOR_NOT_LIVE = 'Token-backed floor vaults are not live yet';
export const NOT_ELIGIBLE = "Token-backed floor vaults are available to a token's launch creator.";
export const riskCopy = (symbol?: string) =>
  `Token-backed floor: part of each mint is held as ${symbol || 'the token'} and part as ETH. Burning an NFT pays your share of both. The vault value moves with the token price, and the token part can fall to zero, so the burn value is not fixed. Vault buys run in small capped batches after graduation with price checks, and can still be affected by market moves. New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.`;
export const BUY_EXPLAIN = 'The vault first records the pool price. After 5 minutes and within 60 minutes, anyone can run the buy. It only runs if the price is within 2% of the recorded price, and stops at the slippage limit. The caller pays gas and receives nothing.';
export const BUY_WHAT = 'Uses ETH queued in the vault to buy the token on-chain within these limits; bought tokens are held for NFT holders.';
export const ACK_TEXT = 'I understand the token part of the vault moves with the token price and can fall to zero.';
export const SLIPPAGE_NOTE = "The token's buy fee is accounted for separately.";
export const BURN_NOTE = 'Final amounts are computed at burn time.';
export const OWED_NOTE = 'If the token cannot be transferred at burn time, the ETH is still paid and the tokens stay claimable here.';
export const CREATOR_NOTE = 'The creator cannot withdraw vault funds.';
export const SHARE_ENDED = 'Token share ended; the vault now adds ETH only';

export const ERRORS: Record<string, string> = {
  InvalidParams: 'One of the collection settings is outside the allowed range. Check the fields above.',
  NotCreator: 'Only the launch creator of this token can do that.',
  NotLaunchToken: 'This token was not launched through the Polypad factory.',
  NotGraduated: 'The token has not graduated yet, so vault buys are not open.',
  NothingPending: 'There is no ETH waiting to swap.',
  Cooldown: 'A vault buy ran less than 10 minutes ago. Try again after the cooldown.',
  NoFreshObservation: 'There is no recorded price in the 5 to 60 minute window. Record a price first.',
  PriceMoved: 'Price moved more than 2% since it was recorded. Record a new price later.',
  ObservationNotDue: 'A recorded price is still valid. A new one can be recorded after it is 60 minutes old.',
  Slippage: 'The buy would exceed the slippage limit, so it did not run.',
  BadPayment: 'The ETH sent does not match quantity x price.',
  NotStarted: 'The mint has not started yet.',
  SoldOut: 'Not enough supply left for that quantity.',
  WalletCap: 'That quantity is above your per-wallet limit.',
  Frozen: 'The base URI can only be changed before the first mint.',
  Inactive: 'The token share has already ended.',
  TooEarly: 'This is not available yet.',
  Nothing: 'Nothing to withdraw or claim yet.',
  NotOwnerOf: 'You do not own one of the selected NFTs.',
  ZeroAddress: 'An address field is empty.',
  TransferFailed: 'The transfer failed. Please try again.',
  ReentrancyGuardReentrantCall: 'Please try again.',
};

export const fmtDateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
