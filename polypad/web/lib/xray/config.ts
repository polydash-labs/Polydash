// Bundle & Sniper X-ray thresholds and known addresses (all addresses lowercase).
import { COMMIT_VAULTS, KNOWN_ROUTERS, POLYPAD_HOOKS, POOL_MANAGER } from '@/lib/promises/routers';

export const XRAY = {
  /** S2: blocks after T0 counted as "early" (at least this many, or antiSniperCapBlocks if larger). */
  earlyBlocksMin: 3,
  /** S2: seconds after tradingStartTime counted as "early". */
  earlySeconds: 30,
  /** B1: same-block cluster window (blocks after T0) and minimum distinct buyers in one block. */
  clusterWindowBlocks: 50,
  clusterMinBuyers: 3,
  /** B2/B4/C1: early-buyer window (blocks after T0) and the funding look-back. */
  earlyWindowBlocks: 200,
  fundingWindowSec: 60 * 60,
  maxFundingWallets: 60,
  /** B3: buys within this fraction of the group median count as "similar size". */
  similarSizeTolerance: 0.1,
  /** B4: fresh wallet = funded < fundingWindowSec before buying and at most this many txs before the buy. */
  freshMaxTxs: 3,
  /** C1: any ETH transfer from the creator of at least this much in the 24h before the first buy. */
  creatorFundingMinEth: 0.01,
  creatorFundingWindowSec: 24 * 60 * 60,
  /** C2: token transfer from the creator of at least this share of supply (basis points). */
  creatorTransferMinBps: 10, // 0.1%
  /** Verdict thresholds (% of supply held now by medium+ clusters). */
  cleanMaxPct: 3,
  heavyMinPct: 15,
  clusterSomePct: 1,
  clusterHeavyPct: 5,
  creatorHeavyPct: 3,
  /** Status thresholds (% of bought tokens sold). */
  trimmingPct: 10,
  mostlySoldPct: 50,
  exitedHeldPct: 1,
  /** Dumping now: sold >= this share of holdings in 1h / 24h. */
  dump1hPct: 10,
  dump24hPct: 25,
  /** Scan cadence. */
  throttleMs: 60_000,
  incrementalChunk: 10_000,
  backfillChunk: 99_999,
  snapshotEveryMs: 10 * 60_000,
  alertBucketMs: 6 * 60 * 60_000,
} as const;

export const PLATFORM_WALLETS = ['0x9a21c75ac263cc43125e70200636f6397f8776d0'];
export const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDR = '0x000000000000000000000000000000000000dead';

/** Addresses never flagged (their balances count as "Pools & contracts"). Staking pools and the launch are added per scan. */
export const STATIC_KNOWN = [ZERO_ADDR, DEAD_ADDR, POOL_MANAGER, ...POLYPAD_HOOKS, ...COMMIT_VAULTS, ...PLATFORM_WALLETS];
/** Destinations that count as a sale (plus the launch contract itself = bonding-curve sell). */
export const SELL_DESTINATIONS = KNOWN_ROUTERS;
export { COMMIT_VAULTS };
