/**
 * Buyback keeper: runs the observePrice -> buy -> releaseToTarget cycle the
 * PolydashBuybackVault needs from an external caller.
 *
 * Contract rules (src/buyback/PolydashBuybackVault.sol, Robinhood Chain 4663):
 * - buy() spends at most maxBuyEth (0.02 ETH) of the vault's ETH balance.
 * - buy() needs a price observation 5-60 minutes old (OBS_DELAY 300s,
 *   OBS_MAX_AGE 3600s). A fresh observation older than 1h cannot be reused.
 * - buy() reverts if spot moved more than 2% from the observation
 *   (MAX_DEVIATION_BPS 200) or if a buy ran in the last 10 minutes
 *   (BUY_COOLDOWN 600s).
 * - A buy burns 62.5% of the POLYDASH to 0x...dEaD and holds 37.5% for
 *   stakers. Held POLYDASH leaves only via releaseToTarget(), which streams
 *   it to the rewards pool over 30 days.
 * - The keeper pays gas and receives nothing. It never holds user funds.
 *
 * Failure policy: a reverted buy is logged and the cycle ends. There is no
 * in-cycle retry loop — the next scheduled run re-evaluates from chain state.
 */
import { formatEther, parseEventLogs } from 'viem';
import type { PublicClient, WalletClient } from 'viem';
import {
  REWARDS_POOL_ADDRESS,
  TWAP_FEED_ADDRESSES,
  VAULT_ADDRESS,
  buybackVaultAbi,
  rewardsPoolAbi,
  twapFeedAbi,
} from './chain.js';
import type { KeeperConfig } from './config.js';
import type { Logger } from './log.js';

/** Contract timing, in seconds. Mirrors the vault's constants. */
export const OBS_DELAY_SECONDS = 300;
export const OBS_MAX_AGE_SECONDS = 3600;
export const BUY_COOLDOWN_SECONDS = 600;

export interface VaultState {
  /** Latest block timestamp (chain time — the contract uses block.timestamp). */
  now: number;
  pendingEth: bigint;
  obsTime: bigint;
  lastBuyTime: bigint;
  heldForStakers: bigint;
  targetActive: boolean;
  buyCount: bigint;
  totalBurned: bigint;
  totalEthSpent: bigint;
  maxBuyEth: bigint;
}

export type Decision =
  | {
      kind: 'skip';
      reason: 'insufficient-balance' | 'cooldown';
      pendingEth: bigint;
      minBuyEth: bigint;
      cooldownRemainingSeconds?: number;
    }
  | { kind: 'observe'; reason: 'no-observation' | 'observation-expired'; observationAgeSeconds: number | null }
  | { kind: 'wait'; reason: 'observation-too-fresh'; waitSeconds: number; observationAgeSeconds: number }
  | { kind: 'buy'; reason: 'observation-fresh'; observationAgeSeconds: number };

/**
 * Pure decision function: given the vault state and the minimum buy size,
 * decide what the keeper should do next. No network, no side effects —
 * unit-tested in tests/keeper.test.ts.
 */
export function decide(state: VaultState, minBuyEth: bigint): Decision {
  if (state.pendingEth < minBuyEth) {
    return { kind: 'skip', reason: 'insufficient-balance', pendingEth: state.pendingEth, minBuyEth };
  }
  if (state.lastBuyTime !== 0n) {
    const cooldownEnds = Number(state.lastBuyTime) + BUY_COOLDOWN_SECONDS;
    if (state.now < cooldownEnds) {
      return {
        kind: 'skip',
        reason: 'cooldown',
        pendingEth: state.pendingEth,
        minBuyEth,
        cooldownRemainingSeconds: cooldownEnds - state.now,
      };
    }
  }
  if (state.obsTime === 0n) {
    return { kind: 'observe', reason: 'no-observation', observationAgeSeconds: null };
  }
  const age = Math.max(0, state.now - Number(state.obsTime));
  if (age < OBS_DELAY_SECONDS) {
    // Wait until the observation is 6 minutes old (1 minute of margin past
    // the 5-minute minimum), then buy in the same cycle.
    return { kind: 'wait', reason: 'observation-too-fresh', waitSeconds: 360 - age, observationAgeSeconds: age };
  }
  if (age <= OBS_MAX_AGE_SECONDS) {
    return { kind: 'buy', reason: 'observation-fresh', observationAgeSeconds: age };
  }
  return { kind: 'observe', reason: 'observation-expired', observationAgeSeconds: age };
}

/** Held POLYDASH should be released whenever there is any and the target is live. */
export function shouldRelease(state: VaultState): boolean {
  return state.heldForStakers > 0n && state.targetActive;
}

export interface CycleClients {
  public: PublicClient;
  /** Null in dry-run mode (no wallet, nothing is sent). */
  wallet: WalletClient | null;
}

export interface CycleResult {
  observed: boolean;
  bought: boolean;
  buyEthIn: bigint | null;
  buyBurned: bigint | null;
  buyToStakers: bigint | null;
  released: bigint | null;
  /** True when this cycle's poke() landed on-chain. */
  poked: boolean;
  /** True when this cycle's poke() was attempted but failed (see poke-failed log). */
  pokeFailed: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readState(publicClient: PublicClient): Promise<VaultState> {
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  const now = Number(block.timestamp);
  const [
    pendingEth,
    heldForStakers,
    obsTime,
    lastBuyTime,
    targetActive,
    buyCount,
    totalBurned,
    totalEthSpent,
    maxBuyEth,
  ] = await Promise.all([
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'pendingEth' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'heldForStakers' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'obsTime' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'lastBuyTime' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'targetActive' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'buyCount' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'totalBurned' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'totalEthSpent' }),
    publicClient.readContract({ address: VAULT_ADDRESS, abi: buybackVaultAbi, functionName: 'maxBuyEth' }),
  ]);
  return {
    now,
    pendingEth,
    heldForStakers,
    targetActive,
    buyCount,
    totalBurned,
    totalEthSpent,
    maxBuyEth,
    obsTime,
    lastBuyTime,
  };
}

async function readRewardsPool(publicClient: PublicClient) {
  const [totalStaked, rewardRate, periodFinish, totalNotified] = await Promise.all([
    publicClient.readContract({ address: REWARDS_POOL_ADDRESS, abi: rewardsPoolAbi, functionName: 'totalStaked' }),
    publicClient.readContract({ address: REWARDS_POOL_ADDRESS, abi: rewardsPoolAbi, functionName: 'rewardRate' }),
    publicClient.readContract({ address: REWARDS_POOL_ADDRESS, abi: rewardsPoolAbi, functionName: 'periodFinish' }),
    publicClient.readContract({ address: REWARDS_POOL_ADDRESS, abi: rewardsPoolAbi, functionName: 'totalNotified' }),
  ]);
  return { totalStaked, rewardRate, periodFinish, totalNotified };
}

/**
 * Poke the PolydashTwapFeed (Phase 6): record one price observation in its
 * 30-minute ring buffer. The feed is self-observing — it has no oracle of
 * its own — so `latestPrice` reverts until the ring holds observations
 * spanning 30 minutes, and fails closed again if the newest observation
 * goes stale (maxObservationAge 1800s). Poking once per 15-minute cycle
 * keeps it live. A second poke in the same block is a no-op in the feed
 * (it returns the last observation), so poking every cycle is safe.
 *
 * Best-effort by design: a poke failure is logged as `poke-failed` and the
 * cycle continues normally. The feed keeps its last observation and the
 * next cycle retries. A poke failure must never fail the run or block a buy.
 */
async function pokeTwapFeed(
  clients: CycleClients,
  config: KeeperConfig,
  log: Logger,
): Promise<{ poked: boolean; failed: boolean }> {
  if (config.dryRun) {
    log.log('dry-run-plan', { would: 'poke() the TWAP feeds', feeds: TWAP_FEED_ADDRESSES });
    return { poked: false, failed: false };
  }
  const { public: publicClient, wallet } = clients;
  if (!wallet || !wallet.account) {
    log.log('poke-failed', {
      feeds: TWAP_FEED_ADDRESSES,
      error: 'No wallet client (dry-run is off but no key was provided)',
      note: 'The feeds keep their last observations; the next cycle retries.',
    });
    return { poked: false, failed: true };
  }
  // Poke every feed in the list, best-effort per feed: one feed failing must
  // never fail the run or block the others (or a buy). The Polydash feed is
  // the buyback's price source; the four V4 feeds keep their 30-min TWAP
  // windows full ahead of their allowlist execution (Sat Nov 14 14:35 PST).
  let poked = 0;
  let failed = 0;
  for (const feed of TWAP_FEED_ADDRESSES) {
    try {
      const hash = await wallet.writeContract({
        address: feed,
        abi: twapFeedAbi,
        functionName: 'poke',
        chain: wallet.chain,
        account: wallet.account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === 'reverted') {
        log.log('poke-failed', {
          tx: hash,
          feed,
          note: 'poke() reverted on-chain; the feed keeps its last observation and the next cycle retries.',
        });
        failed++;
        continue;
      }
      const events = parseEventLogs({ abi: twapFeedAbi, logs: receipt.logs, eventName: 'Poked' });
      const e = events[0]?.args;
      log.log('poked', {
        tx: hash,
        feed,
        timestamp: e?.timestamp === undefined ? null : e.timestamp.toString(),
        tick: e?.tick === undefined ? null : e.tick.toString(),
      });
      poked++;
    } catch (err) {
      log.log('poke-failed', {
        feed,
        error: err instanceof Error ? err.message.split('\n')[0] : String(err),
        note: 'poke() failed to send; the cycle continues normally and the next cycle retries.',
      });
      failed++;
    }
  }
  return { poked: poked > 0, failed: failed > 0 };
}

/**
 * One keeper cycle: poke the TWAP feed, then observe (if needed), wait, buy,
 * release. Returns a summary. A reverted buy is logged and ends the cycle
 * without retrying.
 */
export async function runCycle(
  clients: CycleClients,
  config: KeeperConfig,
  log: Logger,
): Promise<CycleResult> {
  const { public: publicClient, wallet } = clients;
  const result: CycleResult = {
    observed: false,
    bought: false,
    buyEthIn: null,
    buyBurned: null,
    buyToStakers: null,
    released: null,
    poked: false,
    pokeFailed: false,
  };

  // 0. Poke the TWAP feed first, independent of the buyback decision: the
  // feed must be poked even when the vault is empty and the buyback skips.
  const poke = await pokeTwapFeed(clients, config, log);
  result.poked = poke.poked;
  result.pokeFailed = poke.failed;

  const state = await readState(publicClient);
  log.log('state', {
    now: state.now,
    pendingEth: formatEther(state.pendingEth),
    heldForStakers: formatEther(state.heldForStakers),
    targetActive: state.targetActive,
    buyCount: state.buyCount.toString(),
    totalBurned: formatEther(state.totalBurned),
    totalEthSpent: formatEther(state.totalEthSpent),
    maxBuyEth: formatEther(state.maxBuyEth),
    obsAgeSeconds: state.obsTime === 0n ? null : Math.max(0, state.now - Number(state.obsTime)),
    lastBuyAgeSeconds: state.lastBuyTime === 0n ? null : Math.max(0, state.now - Number(state.lastBuyTime)),
  });

  const decision = decide(state, config.minBuyEth);
  log.log('decision', { ...decision, minBuyEth: formatEther(config.minBuyEth) });

  if (config.dryRun) {
    // Dry run: describe the plan, send nothing, wait for nothing.
    if (decision.kind === 'observe' || decision.kind === 'wait' || decision.kind === 'buy') {
      log.log('dry-run-plan', {
        would: 'observePrice() -> wait 6 min -> buy() up to maxBuyEth, then releaseToTarget() if held POLYDASH > 0',
        pendingEth: formatEther(state.pendingEth),
        wouldRelease: shouldRelease(state),
      });
    } else {
      log.log('dry-run-plan', { would: 'nothing', reason: decision.reason });
    }
    return result;
  }
  if (!wallet || !wallet.account) throw new Error('No wallet client (dry-run is off but no key was provided)');

  let shouldBuy = false;
  if (decision.kind === 'observe') {
    log.log('observe', { reason: decision.reason });
    const hash = await wallet.writeContract({
      address: VAULT_ADDRESS,
      abi: buybackVaultAbi,
      functionName: 'observePrice',
      chain: wallet.chain,
      account: wallet.account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      log.log('observe-failed', { tx: hash, note: 'observePrice reverted; will retry on the next scheduled run' });
      return result;
    }
    log.log('observed', { tx: hash });
    result.observed = true;
    shouldBuy = true;
  } else if (decision.kind === 'wait') {
    log.log('wait-observation', { waitSeconds: decision.waitSeconds });
    shouldBuy = true;
  } else if (decision.kind === 'buy') {
    shouldBuy = true;
  }

  if (shouldBuy) {
    const waitSeconds = decision.kind === 'observe' ? config.observeWaitSeconds : decision.kind === 'wait' ? decision.waitSeconds : 0;
    if (waitSeconds > 0) {
      log.log('wait-before-buy', { waitSeconds });
      await sleep(waitSeconds * 1000);
    }
    try {
      const hash = await wallet.writeContract({
        address: VAULT_ADDRESS,
        abi: buybackVaultAbi,
        functionName: 'buy',
        chain: wallet.chain,
        account: wallet.account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === 'reverted') {
        log.log('buy-failed', {
          tx: hash,
          note: 'buy() reverted on-chain (likely PriceMoved: spot moved >2% from the observation, or Slippage). No retry in this cycle; next scheduled run re-evaluates.',
        });
      } else {
        const events = parseEventLogs({ abi: buybackVaultAbi, logs: receipt.logs, eventName: 'BoughtAndBurned' });
        const e = events[0]?.args;
        result.bought = true;
        result.buyEthIn = e?.ethIn ?? null;
        result.buyBurned = e?.polydashBurned ?? null;
        result.buyToStakers = e?.polydashToStakers ?? null;
        log.log('bought', {
          tx: hash,
          ethIn: result.buyEthIn === null ? null : formatEther(result.buyEthIn),
          burned: result.buyBurned === null ? null : formatEther(result.buyBurned),
          toStakers: result.buyToStakers === null ? null : formatEther(result.buyToStakers),
        });
      }
    } catch (err) {
      // writeContract reverts at gas estimation when buy() would fail
      // (PriceMoved / Slippage / Cooldown / NoFreshObservation).
      log.log('buy-failed', {
        error: err instanceof Error ? err.message.split('\n')[0] : String(err),
        note: 'buy() would revert. No retry in this cycle; next scheduled run re-evaluates.',
      });
    }
  }

  // Sweep any POLYDASH held for stakers into the rewards pool.
  const after = await readState(publicClient);
  if (shouldRelease(after)) {
    log.log('release', { heldForStakers: formatEther(after.heldForStakers) });
    try {
      const hash = await wallet.writeContract({
        address: VAULT_ADDRESS,
        abi: buybackVaultAbi,
        functionName: 'releaseToTarget',
        chain: wallet.chain,
        account: wallet.account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === 'reverted') {
        log.log('release-failed', { tx: hash });
      } else {
        const events = parseEventLogs({ abi: buybackVaultAbi, logs: receipt.logs, eventName: 'RewardsReleased' });
        result.released = events[0]?.args.amount ?? null;
        const pool = await readRewardsPool(publicClient);
        log.log('released', {
          tx: hash,
          amount: result.released === null ? null : formatEther(result.released),
          rewardsPool: {
            totalStaked: formatEther(pool.totalStaked),
            rewardRate: pool.rewardRate.toString(),
            periodFinish: pool.periodFinish.toString(),
            totalNotified: formatEther(pool.totalNotified),
          },
        });
      }
    } catch (err) {
      log.log('release-failed', { error: err instanceof Error ? err.message.split('\n')[0] : String(err) });
    }
  }

  return result;
}
