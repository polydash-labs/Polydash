/**
 * Keeper gas autopilot — Tier B mechanism with Tier A alerting as the
 * foundation (decision doc:
 * ~/workspace/goals/polypad-phase-2-tokenized-funds/hidden_files/keeper-gas-autopilot-decision-2026-11-22.md).
 *
 * Problem it solves: the buyback keeper wallet (0x3e29…) runs dry every few
 * days; when it does, all 24 V4 TWAP feed pokes fail, feeds go stale, and
 * V4-asset fund buys fail closed. Manual top-up is the failure mode.
 *
 * What it does, once per run (cron drives the cadence, same 15 min as the
 * keeper cycle — this is a separate step, it never touches keeper.ts):
 *   1. Reads the keeper balance, the reserve balance, and every V4 feed's
 *      newest-observation age (see `readFeedStatus` — feed age comes from
 *      `observationCount` + `observationAt`, NOT from `latestPrice`, whose
 *      `updatedAt` is always block.timestamp by construction).
 *   2. Raises/clears structured alerts (JSON log + state file): keeper
 *      < 0.002 ETH (~14h cover), again at < 0.0005 ETH (~3.5h), any V4 feed
 *      stale > 1h, reserve < 0.01 ETH.
 *   3. If armed and the keeper is below 0.002 ETH, sends exactly 0.01 ETH
 *      from the dedicated reserve wallet to the keeper — subject to the hard
 *      caps below. Every top-up is logged with amount + tx hash + the
 *      keeper's new balance.
 *
 * Hard caps (enforced in `decideTopUp`, unit-tested):
 *   - Max 0.01 ETH per top-up.
 *   - Max 0.02 ETH per UTC day (persisted in the state file).
 *   - Refuse if the send would drop the reserve below 0.005 ETH.
 *   - Refuse if the reserve balance is unknown (no key / read failed).
 *   - NEVER draws from the deployer wallet or the fee wallet — reserve only.
 *
 * Kill-switch (both must pass for a send):
 *   - `AUTOPILOT_ENABLED` must be exactly `true` (or `1`). Default: off.
 *   - No `data/autopilot.kill` file present (its presence is an off switch).
 * This build ships ARMED-OFF: the flag is unset and the reserve is unfunded.
 * Arming (fund reserve → set AUTOPILOT_ENABLED=true → create cron → verify
 * the first live top-up) happens separately, after Jon funds the reserve.
 *
 * Safety: `--dry-run` plans but never sends and needs no key. A live run
 * without a reserve key throws before touching the chain. The reserve key
 * is never logged (the JSONL logger drops secret-looking fields) and only
 * the reserve address appears in logs/state.
 */
import { formatEther, parseEther } from 'viem';
import type { Address, PublicClient, WalletClient } from 'viem';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TWAP_FEED_ADDRESSES } from './chain.js';
import type { Logger } from './log.js';

/** The buyback keeper wallet — the only recipient of autopilot top-ups. */
export const KEEPER_ADDRESS = '0x3e298C64B4073ccFfd9df671eBaEdb886Dcb9270' as Address;

/** Top up when the keeper falls below this (~14h of cover at current burn). */
export const TRIGGER_BALANCE = parseEther('0.002');
/** Second alert tier (~3.5h of cover left). */
export const CRITICAL_BALANCE = parseEther('0.0005');
/** Exactly this much per top-up — never more. */
export const TOP_UP_AMOUNT = parseEther('0.01');
/** Max total top-ups per UTC day (i.e. at most two 0.01 ETH top-ups). */
export const MAX_DAILY_TOP_UP = parseEther('0.02');
/** Refuse a send that would leave the reserve below this. */
export const RESERVE_FLOOR = parseEther('0.005');
/** Alert when the reserve falls below this. */
export const RESERVE_LOW_ALERT = parseEther('0.01');
/** A V4 feed is stale when its newest observation is older than this. */
export const STALE_FEED_SECONDS = 3600;
/** Observations held per feed ring buffer (see GenericV4TwapFeed). */
export const FEED_RING_SIZE = 32;

/** Minimal feed ABI for reading observation age. `latestPrice` is NOT used
 *  here: it returns updatedAt = block.timestamp, so it can never report age. */
export const feedAgeAbi = [
  {
    type: 'function',
    name: 'observationCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'observationAt',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'timestamp', type: 'uint64' },
      { name: 'tickCumulative', type: 'int256' },
      { name: 'tick', type: 'int24' },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// State file (data/autopilot-state.json)
// ---------------------------------------------------------------------------

export interface FeedStatus {
  address: Address;
  /** Seconds since the feed's newest observation; null when unreadable. */
  ageSeconds: number | null;
  stale: boolean;
  /** Read error, if the feed could not be read (best-effort per feed). */
  error?: string;
}

export interface TopUpRecord {
  ts: string;
  amountEth: string;
  txHash: string;
  keeperBalanceAfterEth: string;
}

export interface AlertRecord {
  ts: string;
  kind: string;
  detail: string;
}

export interface AutopilotState {
  version: 1;
  lastCheck: string | null;
  keeperBalanceEth: string | null;
  reserveAddress: string | null;
  reserveBalanceEth: string | null;
  /** ETH topped up so far today (UTC). Resets when the UTC date changes. */
  dailySpentEth: string;
  dailySpentDay: string | null;
  topUps: TopUpRecord[];
  /** Every alert ever raised (append-only history). */
  alerts: AlertRecord[];
  /** Currently-active alert conditions: kind -> ts raised. */
  activeAlerts: Record<string, string>;
  feeds: FeedStatus[];
  enabled: boolean;
  killSwitchActive: boolean;
}

export function emptyState(): AutopilotState {
  return {
    version: 1,
    lastCheck: null,
    keeperBalanceEth: null,
    reserveAddress: null,
    reserveBalanceEth: null,
    dailySpentEth: '0',
    dailySpentDay: null,
    topUps: [],
    alerts: [],
    activeAlerts: {},
    feeds: [],
    enabled: false,
    killSwitchActive: false,
  };
}

export function loadState(path: string): AutopilotState {
  try {
    if (!existsSync(path)) return emptyState();
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AutopilotState>;
    if (parsed.version !== 1) return emptyState();
    return { ...emptyState(), ...parsed };
  } catch {
    // A corrupt state file must never block the check — start fresh.
    return emptyState();
  }
}

export function saveState(path: string, state: AutopilotState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

/** UTC date string (YYYY-MM-DD) for the daily-spend bucket. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Reset the daily spend when the UTC day has changed. Returns true when a
 * reset happened. Pure — unit-tested.
 */
export function resetDailyIfNeeded(state: AutopilotState, today: string): boolean {
  if (state.dailySpentDay === today) return false;
  state.dailySpentEth = '0';
  state.dailySpentDay = today;
  return true;
}

// ---------------------------------------------------------------------------
// Pure decision logic (no network, no side effects — unit-tested)
// ---------------------------------------------------------------------------

export type TopUpDecision =
  | { action: 'send'; amount: bigint }
  | { action: 'skip'; reason: 'keeper-healthy' }
  | {
      action: 'blocked';
      reason: 'disabled' | 'kill-switch' | 'daily-cap' | 'reserve-floor' | 'reserve-insufficient' | 'reserve-unknown';
      detail: string;
    };

export function decideTopUp(input: {
  keeperBalance: bigint;
  /** Null when the reserve balance could not be read. */
  reserveBalance: bigint | null;
  dailySpent: bigint;
  enabled: boolean;
  killSwitchActive: boolean;
}): TopUpDecision {
  if (input.keeperBalance >= TRIGGER_BALANCE) {
    return { action: 'skip', reason: 'keeper-healthy' };
  }
  if (!input.enabled) {
    return {
      action: 'blocked',
      reason: 'disabled',
      detail: 'AUTOPILOT_ENABLED is not true — alerting only, no send (ships ARMED-OFF)',
    };
  }
  if (input.killSwitchActive) {
    return {
      action: 'blocked',
      reason: 'kill-switch',
      detail: 'data/autopilot.kill exists — autopilot stopped by kill-switch',
    };
  }
  if (input.reserveBalance === null) {
    return {
      action: 'blocked',
      reason: 'reserve-unknown',
      detail: 'Reserve balance unknown (no key or read failed) — refusing to send blind',
    };
  }
  if (input.dailySpent + TOP_UP_AMOUNT > MAX_DAILY_TOP_UP) {
    return {
      action: 'blocked',
      reason: 'daily-cap',
      detail: `Daily cap ${formatEther(MAX_DAILY_TOP_UP)} ETH reached (spent ${formatEther(input.dailySpent)} ETH today)`,
    };
  }
  if (input.reserveBalance < TOP_UP_AMOUNT) {
    return {
      action: 'blocked',
      reason: 'reserve-insufficient',
      detail: `Reserve holds ${formatEther(input.reserveBalance)} ETH, less than the ${formatEther(TOP_UP_AMOUNT)} ETH top-up`,
    };
  }
  if (input.reserveBalance - TOP_UP_AMOUNT < RESERVE_FLOOR) {
    return {
      action: 'blocked',
      reason: 'reserve-floor',
      detail: `Sending ${formatEther(TOP_UP_AMOUNT)} ETH would drop the reserve below the ${formatEther(RESERVE_FLOOR)} ETH floor (reserve ${formatEther(input.reserveBalance)} ETH)`,
    };
  }
  return { action: 'send', amount: TOP_UP_AMOUNT };
}

/** A feed is stale when its newest observation is older than the threshold,
 *  or when it has no readable observations at all. */
export function isFeedStale(ageSeconds: number | null): boolean {
  return ageSeconds === null || ageSeconds > STALE_FEED_SECONDS;
}

/** Ring-buffer index of the newest observation (0 = oldest still held).
 *  Returns null when the feed holds no observations. */
export function newestObservationIndex(observationCount: bigint): number | null {
  if (observationCount === 0n) return null;
  const stored = observationCount < BigInt(FEED_RING_SIZE) ? Number(observationCount) : FEED_RING_SIZE;
  return stored - 1;
}

// ---------------------------------------------------------------------------
// Chain reads
// ---------------------------------------------------------------------------

export interface FeedRead {
  status: FeedStatus;
}

/** Read one feed's newest-observation age. Best-effort: a feed that cannot
 *  be read is reported stale with the error, never throws. */
export async function readFeedStatus(
  publicClient: PublicClient,
  feed: Address,
  nowSeconds: number,
): Promise<FeedStatus> {
  try {
    const count = (await publicClient.readContract({
      address: feed,
      abi: feedAgeAbi,
      functionName: 'observationCount',
    })) as bigint;
    const index = newestObservationIndex(count);
    if (index === null) {
      return { address: feed, ageSeconds: null, stale: true, error: 'no observations recorded' };
    }
    const obs = (await publicClient.readContract({
      address: feed,
      abi: feedAgeAbi,
      functionName: 'observationAt',
      args: [BigInt(index)],
    })) as readonly [timestamp: bigint, tickCumulative: bigint, tick: number];
    const age = Math.max(0, nowSeconds - Number(obs[0]));
    return { address: feed, ageSeconds: age, stale: isFeedStale(age) };
  } catch (err) {
    return {
      address: feed,
      ageSeconds: null,
      stale: true,
      error: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// One autopilot run
// ---------------------------------------------------------------------------

export interface AutopilotClients {
  public: PublicClient;
  /** Null in dry-run mode (no wallet, nothing is sent). */
  wallet: WalletClient | null;
}

export interface AutopilotRunOptions {
  dryRun: boolean;
  /** AUTOPILOT_ENABLED resolved by the CLI (default false). */
  enabled: boolean;
  /** data/autopilot.kill exists. */
  killSwitchActive: boolean;
  /** Derived from the reserve key; null when no key is configured. */
  reserveAddress: Address | null;
  stateFile: string;
  log: Logger;
}

export interface AutopilotRunResult {
  keeperBalance: bigint;
  reserveBalance: bigint | null;
  decision: TopUpDecision;
  /** True when a top-up actually landed on-chain this run. */
  toppedUp: boolean;
  txHash: string | null;
  alertsRaised: string[];
  alertsCleared: string[];
  staleFeeds: Address[];
}

export async function runAutopilot(
  clients: AutopilotClients,
  opts: AutopilotRunOptions,
): Promise<AutopilotRunResult> {
  const { public: publicClient, wallet } = clients;
  const { log } = opts;
  const now = new Date();
  const today = utcDay(now);

  const state = loadState(opts.stateFile);
  resetDailyIfNeeded(state, today);

  const block = await publicClient.getBlock({ blockTag: 'latest' });
  const nowSeconds = Number(block.timestamp);

  const [keeperBalance, reserveBalance] = await Promise.all([
    publicClient.getBalance({ address: KEEPER_ADDRESS }),
    opts.reserveAddress ? publicClient.getBalance({ address: opts.reserveAddress }) : Promise.resolve(null),
  ]);

  // Feed freshness: every V4 feed, best-effort per feed, in parallel.
  const feeds = await Promise.all(
    TWAP_FEED_ADDRESSES.map((feed) => readFeedStatus(publicClient, feed, nowSeconds)),
  );
  const staleFeeds = feeds.filter((f) => f.stale).map((f) => f.address);

  // --- Alerts: raise on transition into a condition, clear on exit. ---
  const activeKinds = new Set<string>();
  if (keeperBalance < TRIGGER_BALANCE) activeKinds.add('keeper-low');
  if (keeperBalance < CRITICAL_BALANCE) activeKinds.add('keeper-critical');
  if (reserveBalance !== null && reserveBalance < RESERVE_LOW_ALERT) activeKinds.add('reserve-low');
  for (const feed of feeds) {
    if (feed.stale) activeKinds.add(`feed-stale:${feed.address}`);
  }
  const alertsRaised: string[] = [];
  const alertsCleared: string[] = [];
  const ts = now.toISOString();
  for (const kind of activeKinds) {
    if (!(kind in state.activeAlerts)) {
      const detail =
        kind === 'keeper-low'
          ? `Keeper balance ${formatEther(keeperBalance)} ETH < ${formatEther(TRIGGER_BALANCE)} ETH trigger (~14h cover left)`
          : kind === 'keeper-critical'
            ? `Keeper balance ${formatEther(keeperBalance)} ETH < ${formatEther(CRITICAL_BALANCE)} ETH (~3.5h cover left)`
            : kind === 'reserve-low'
              ? `Reserve balance ${formatEther(reserveBalance ?? 0n)} ETH < ${formatEther(RESERVE_LOW_ALERT)} ETH — fund the reserve`
              : `Feed ${kind.slice('feed-stale:'.length)} stale > ${STALE_FEED_SECONDS}s (newest observation ${feeds.find((f) => f.address === kind.slice('feed-stale:'.length))?.ageSeconds ?? 'unknown'}s old)`;
      state.activeAlerts[kind] = ts;
      state.alerts.push({ ts, kind, detail });
      alertsRaised.push(kind);
      log.log('autopilot-alert', { kind, detail });
    }
  }
  for (const kind of Object.keys(state.activeAlerts)) {
    if (!activeKinds.has(kind)) {
      delete state.activeAlerts[kind];
      alertsCleared.push(kind);
      log.log('autopilot-alert-cleared', { kind });
    }
  }

  // --- Top-up decision (pure logic, caps enforced in code). ---
  const decision = decideTopUp({
    keeperBalance,
    reserveBalance,
    dailySpent: parseEther(state.dailySpentEth),
    enabled: opts.enabled,
    killSwitchActive: opts.killSwitchActive,
  });
  log.log('autopilot-check', {
    keeperBalanceEth: formatEther(keeperBalance),
    reserveBalanceEth: reserveBalance === null ? null : formatEther(reserveBalance),
    reserveAddress: opts.reserveAddress,
    enabled: opts.enabled,
    killSwitchActive: opts.killSwitchActive,
    dailySpentEth: state.dailySpentEth,
    dailyCapEth: formatEther(MAX_DAILY_TOP_UP),
    staleFeedCount: staleFeeds.length,
    decision: decision.action,
    reason: decision.action === 'send' ? undefined : decision.reason,
    detail: decision.action === 'blocked' ? decision.detail : undefined,
  });

  let toppedUp = false;
  let txHash: string | null = null;

  if (decision.action === 'send') {
    if (opts.dryRun) {
      log.log('autopilot-dry-run-plan', {
        would: `send ${formatEther(decision.amount)} ETH from reserve ${opts.reserveAddress} to keeper ${KEEPER_ADDRESS}`,
        note: 'Dry run: no transaction sent. Arm with AUTOPILOT_ENABLED=true and a funded reserve to send for real.',
      });
    } else {
      if (!wallet || !wallet.account) {
        throw new Error('No reserve wallet client (enabled but no key was provided)');
      }
      const hash = await wallet.sendTransaction({
        to: KEEPER_ADDRESS,
        value: decision.amount,
        chain: wallet.chain,
        account: wallet.account,
      });
      txHash = hash;
      let receiptStatus: string;
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        receiptStatus = receipt.status;
      } catch (err) {
        // The tx was sent but the receipt could not be confirmed (e.g.
        // RPC timeout). Log the hash so it can be checked by hand; do NOT
        // record the spend — the next run re-reads balances from chain.
        log.log('autopilot-topup-unknown', {
          tx: hash,
          amountEth: formatEther(decision.amount),
          error: err instanceof Error ? err.message.split('\n')[0] : String(err),
          note: 'Top-up tx sent but receipt unconfirmed; spend NOT recorded. Check the tx hash and the keeper balance by hand.',
        });
        receiptStatus = 'unknown';
      }
      if (receiptStatus === 'success') {
        const [keeperAfter, reserveAfter] = await Promise.all([
          publicClient.getBalance({ address: KEEPER_ADDRESS }),
          opts.reserveAddress ? publicClient.getBalance({ address: opts.reserveAddress }) : Promise.resolve(null),
        ]);
        toppedUp = true;
        state.dailySpentEth = formatEther(parseEther(state.dailySpentEth) + decision.amount);
        state.topUps.push({
          ts: new Date().toISOString(),
          amountEth: formatEther(decision.amount),
          txHash: hash,
          keeperBalanceAfterEth: formatEther(keeperAfter),
        });
        log.log('autopilot-topup', {
          amountEth: formatEther(decision.amount),
          tx: hash,
          keeper: KEEPER_ADDRESS,
          keeperBalanceAfterEth: formatEther(keeperAfter),
          reserveBalanceAfterEth: reserveAfter === null ? null : formatEther(reserveAfter),
          dailySpentEth: state.dailySpentEth,
        });
      } else if (receiptStatus === 'reverted') {
        log.log('autopilot-topup-failed', {
          tx: hash,
          amountEth: formatEther(decision.amount),
          note: 'Top-up tx reverted on-chain; spend NOT recorded. Next run re-evaluates from chain state.',
        });
      }
    }
  }

  // --- Persist the check (balances, feeds, alerts, spend). ---
  state.lastCheck = new Date().toISOString();
  state.keeperBalanceEth = formatEther(keeperBalance);
  state.reserveAddress = opts.reserveAddress;
  state.reserveBalanceEth = reserveBalance === null ? null : formatEther(reserveBalance);
  state.feeds = feeds;
  state.enabled = opts.enabled;
  state.killSwitchActive = opts.killSwitchActive;
  saveState(opts.stateFile, state);

  return {
    keeperBalance,
    reserveBalance,
    decision,
    toppedUp,
    txHash,
    alertsRaised,
    alertsCleared,
    staleFeeds,
  };
}
