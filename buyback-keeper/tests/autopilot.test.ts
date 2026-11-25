/**
 * Unit + mock-client tests for the keeper gas autopilot. No network, no
 * keys, no chain — the send path is exercised against mock clients, and the
 * live send path is verified separately on a local Anvil fork (see README).
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatEther, parseEther } from 'viem';
import {
  CRITICAL_BALANCE,
  KEEPER_ADDRESS,
  MAX_DAILY_TOP_UP,
  RESERVE_FLOOR,
  STALE_FEED_SECONDS,
  TOP_UP_AMOUNT,
  TRIGGER_BALANCE,
  decideTopUp,
  emptyState,
  isFeedStale,
  loadState,
  newestObservationIndex,
  resetDailyIfNeeded,
  runAutopilot,
  utcDay,
  type AutopilotState,
} from '../src/autopilot.js';
import { ROBINHOOD_CHAIN, TWAP_FEED_ADDRESSES } from '../src/chain.js';
import type { Logger } from '../src/log.js';

const NOW = 1_800_000_000; // fixed "now" (unix seconds)
const RESERVE_ADDRESS = '0x2696a61a51eB47233e19b85A9EF5261dDB40481C' as const;
const TOPUP_TX = `0x${'cd'.repeat(32)}` as const;

// ---------------------------------------------------------------------------
// Pure decision logic
// ---------------------------------------------------------------------------

test('healthy keeper: skip, no top-up considered', () => {
  const d = decideTopUp({
    keeperBalance: parseEther('0.01'),
    reserveBalance: parseEther('0.05'),
    dailySpent: 0n,
    enabled: true,
    killSwitchActive: false,
  });
  assert.deepEqual(d, { action: 'skip', reason: 'keeper-healthy' });
});

test('keeper exactly at the trigger: skip (trigger is strictly below)', () => {
  const d = decideTopUp({
    keeperBalance: TRIGGER_BALANCE,
    reserveBalance: parseEther('0.05'),
    dailySpent: 0n,
    enabled: true,
    killSwitchActive: false,
  });
  assert.equal(d.action, 'skip');
});

test('low keeper + disabled: blocked, never sends while ARMED-OFF', () => {
  const d = decideTopUp({
    keeperBalance: parseEther('0.0000005'),
    reserveBalance: parseEther('0.05'),
    dailySpent: 0n,
    enabled: false,
    killSwitchActive: false,
  });
  assert.equal(d.action, 'blocked');
  if (d.action === 'blocked') assert.equal(d.reason, 'disabled');
});

test('low keeper + enabled + kill file: blocked by kill-switch', () => {
  const d = decideTopUp({
    keeperBalance: parseEther('0.0000005'),
    reserveBalance: parseEther('0.05'),
    dailySpent: 0n,
    enabled: true,
    killSwitchActive: true,
  });
  assert.equal(d.action, 'blocked');
  if (d.action === 'blocked') assert.equal(d.reason, 'kill-switch');
});

test('daily cap: 0.02 spent today blocks, 0.01 spent allows one more, 0.015 blocks', () => {
  const base = {
    keeperBalance: parseEther('0.0000005'),
    reserveBalance: parseEther('0.05'),
    enabled: true,
    killSwitchActive: false,
  };
  const atCap = decideTopUp({ ...base, dailySpent: parseEther('0.02') });
  assert.equal(atCap.action, 'blocked');
  if (atCap.action === 'blocked') assert.equal(atCap.reason, 'daily-cap');

  const oneUsed = decideTopUp({ ...base, dailySpent: parseEther('0.01') });
  assert.deepEqual(oneUsed, { action: 'send', amount: TOP_UP_AMOUNT });

  const partial = decideTopUp({ ...base, dailySpent: parseEther('0.015') });
  assert.equal(partial.action, 'blocked');
  if (partial.action === 'blocked') assert.equal(partial.reason, 'daily-cap');
});

test('reserve floor: 0.014 blocks (would leave 0.004), 0.015 sends (leaves exactly 0.005)', () => {
  const base = {
    keeperBalance: parseEther('0.0000005'),
    dailySpent: 0n,
    enabled: true,
    killSwitchActive: false,
  };
  const low = decideTopUp({ ...base, reserveBalance: parseEther('0.014') });
  assert.equal(low.action, 'blocked');
  if (low.action === 'blocked') assert.equal(low.reason, 'reserve-floor');

  const exact = decideTopUp({ ...base, reserveBalance: parseEther('0.015') });
  assert.deepEqual(exact, { action: 'send', amount: TOP_UP_AMOUNT });
  assert.equal(RESERVE_FLOOR, parseEther('0.005'));
});

test('reserve insufficient (below the 0.01 top-up) and unknown both block', () => {
  const base = {
    keeperBalance: parseEther('0.0000005'),
    dailySpent: 0n,
    enabled: true,
    killSwitchActive: false,
  };
  const poor = decideTopUp({ ...base, reserveBalance: parseEther('0.009') });
  assert.equal(poor.action, 'blocked');
  if (poor.action === 'blocked') assert.equal(poor.reason, 'reserve-insufficient');

  const unknown = decideTopUp({ ...base, reserveBalance: null });
  assert.equal(unknown.action, 'blocked');
  if (unknown.action === 'blocked') assert.equal(unknown.reason, 'reserve-unknown');
});

test('daily cap constant is 0.02 ETH, top-up is exactly 0.01 ETH', () => {
  assert.equal(formatEther(MAX_DAILY_TOP_UP), '0.02');
  assert.equal(formatEther(TOP_UP_AMOUNT), '0.01');
  assert.equal(formatEther(TRIGGER_BALANCE), '0.002');
  assert.equal(formatEther(CRITICAL_BALANCE), '0.0005');
});

test('isFeedStale: null age is stale; 3600s is fresh, 3601s is stale', () => {
  assert.equal(isFeedStale(null), true);
  assert.equal(isFeedStale(0), false);
  assert.equal(isFeedStale(STALE_FEED_SECONDS), false);
  assert.equal(isFeedStale(STALE_FEED_SECONDS + 1), true);
});

test('newestObservationIndex: empty ring is null; capped at ring size 32', () => {
  assert.equal(newestObservationIndex(0n), null);
  assert.equal(newestObservationIndex(1n), 0);
  assert.equal(newestObservationIndex(5n), 4);
  assert.equal(newestObservationIndex(32n), 31);
  assert.equal(newestObservationIndex(40n), 31);
});

test('resetDailyIfNeeded: same day keeps spend, new day resets to zero', () => {
  const state = emptyState();
  state.dailySpentDay = '2026-11-22';
  state.dailySpentEth = '0.01';
  assert.equal(resetDailyIfNeeded(state, '2026-11-22'), false);
  assert.equal(state.dailySpentEth, '0.01');
  assert.equal(resetDailyIfNeeded(state, '2026-11-23'), true);
  assert.equal(state.dailySpentEth, '0');
  assert.equal(state.dailySpentDay, '2026-11-23');
});

// ---------------------------------------------------------------------------
// runAutopilot with mock clients (no network, no keys, no chain)
// ---------------------------------------------------------------------------

function mockLogger() {
  const events: { event: string; fields: Record<string, unknown> }[] = [];
  const log: Logger = {
    log(event, fields = {}) {
      events.push({ event, fields });
    },
  };
  return { log, events };
}

interface MockWorld {
  /** Mutable keeper balance (ETH) the mock reports. */
  keeperEth: string;
  /** Mutable reserve balance (ETH) the mock reports. */
  reserveEth: string;
  /** Per-feed observation age in seconds (default 900 = fresh). */
  feedAge: Map<string, number>;
  /** Receipt status the mock returns for a sent tx. */
  receiptStatus: 'success' | 'reverted';
}

function mockWorld(overrides: Partial<MockWorld> = {}): MockWorld {
  return {
    keeperEth: '0.0000005',
    reserveEth: '0.05',
    feedAge: new Map(),
    receiptStatus: 'success',
    ...overrides,
  };
}

function mockPublic(world: MockWorld) {
  return {
    getBlock: async () => ({ timestamp: BigInt(NOW) }),
    getBalance: async (args: { address: string }) => {
      if (args.address === KEEPER_ADDRESS) return parseEther(world.keeperEth);
      if (args.address === RESERVE_ADDRESS) return parseEther(world.reserveEth);
      return 0n;
    },
    readContract: async (args: { address: string; functionName: string }) => {
      if (args.functionName === 'observationCount') return 10n;
      if (args.functionName === 'observationAt') {
        const age = world.feedAge.get(args.address) ?? 900;
        // viem returns decoded outputs as a tuple: [timestamp, tickCumulative, tick]
        return [BigInt(NOW - age), 0n, 0] as const;
      }
      throw new Error(`unexpected readContract ${args.functionName}`);
    },
    waitForTransactionReceipt: async () => ({ status: world.receiptStatus }),
  };
}

function mockWallet() {
  const sends: Record<string, unknown>[] = [];
  return {
    sends,
    account: { address: RESERVE_ADDRESS },
    chain: ROBINHOOD_CHAIN,
    sendTransaction: async (args: Record<string, unknown>) => {
      sends.push(args);
      return TOPUP_TX;
    },
  };
}

function tempStateFile(seed?: Partial<AutopilotState>): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'autopilot-test-'));
  const path = join(dir, 'autopilot-state.json');
  if (seed) {
    writeFileSync(path, JSON.stringify({ ...emptyState(), ...seed }));
  }
  return { dir, path };
}

function readState(path: string): AutopilotState {
  return JSON.parse(readFileSync(path, 'utf8')) as AutopilotState;
}

test('disabled + low keeper: no send, keeper-low alert raised, state saved', async () => {
  const world = mockWorld();
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: false, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.equal(wallet.sends.length, 0);
  assert.equal(result.toppedUp, false);
  assert.equal(result.decision.action, 'blocked');
  assert.ok(result.alertsRaised.includes('keeper-low'), 'expected keeper-low alert');
  assert.ok(result.alertsRaised.includes('keeper-critical'), 'expected keeper-critical alert at 0.0000005 ETH');
  assert.ok(events.some((e) => e.event === 'autopilot-alert' && e.fields.kind === 'keeper-low'));
  const state = readState(path);
  assert.equal(state.keeperBalanceEth, '0.0000005');
  assert.equal(state.reserveBalanceEth, '0.05');
  assert.equal(state.dailySpentEth, '0');
  assert.deepEqual(state.topUps, []);
  assert.equal(state.enabled, false);
});

test('enabled + low keeper + funded reserve: sends exactly 0.01 ETH, records tx + spend', async () => {
  const world = mockWorld();
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: true, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.equal(wallet.sends.length, 1);
  assert.equal(wallet.sends[0].to, KEEPER_ADDRESS);
  assert.equal(wallet.sends[0].value, TOP_UP_AMOUNT);
  assert.equal(result.toppedUp, true);
  assert.equal(result.txHash, TOPUP_TX);
  const topup = events.find((e) => e.event === 'autopilot-topup');
  assert.ok(topup, 'expected autopilot-topup log entry');
  assert.equal(topup.fields.tx, TOPUP_TX);
  assert.equal(topup.fields.amountEth, '0.01');
  assert.equal(topup.fields.keeperBalanceAfterEth, '0.0000005'); // mock re-reads the same balance
  const state = readState(path);
  assert.equal(state.dailySpentEth, '0.01');
  assert.equal(state.topUps.length, 1);
  assert.equal(state.topUps[0].txHash, TOPUP_TX);
  assert.equal(state.topUps[0].amountEth, '0.01');
});

test('dry-run + enabled + low keeper: plan logged, nothing sent, no spend recorded', async () => {
  const world = mockWorld();
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: true, enabled: true, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.equal(wallet.sends.length, 0);
  assert.equal(result.toppedUp, false);
  assert.equal(result.decision.action, 'send');
  assert.ok(events.some((e) => e.event === 'autopilot-dry-run-plan'));
  const state = readState(path);
  assert.equal(state.dailySpentEth, '0');
  assert.deepEqual(state.topUps, []);
});

test('kill-switch active: no send even when enabled', async () => {
  const world = mockWorld();
  const wallet = mockWallet();
  const { log } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: true, killSwitchActive: true, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.equal(wallet.sends.length, 0);
  assert.equal(result.decision.action, 'blocked');
  if (result.decision.action === 'blocked') assert.equal(result.decision.reason, 'kill-switch');
});

test('daily cap already spent: second top-up blocked, no send', async () => {
  const world = mockWorld();
  const wallet = mockWallet();
  const { log } = mockLogger();
  const today = utcDay(new Date());
  const { path } = tempStateFile({ dailySpentEth: '0.02', dailySpentDay: today });
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: true, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.equal(wallet.sends.length, 0);
  assert.equal(result.decision.action, 'blocked');
  if (result.decision.action === 'blocked') assert.equal(result.decision.reason, 'daily-cap');
});

test('reserve at the floor: no send, blocked with reserve-floor', async () => {
  const world = mockWorld({ reserveEth: '0.014' });
  const wallet = mockWallet();
  const { log } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: true, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.equal(wallet.sends.length, 0);
  assert.equal(result.decision.action, 'blocked');
  if (result.decision.action === 'blocked') assert.equal(result.decision.reason, 'reserve-floor');
});

test('stale feed: listed, alert raised per feed; fresh feeds stay quiet', async () => {
  const staleFeed = TWAP_FEED_ADDRESSES[1];
  const world = mockWorld({ keeperEth: '0.01' }); // healthy keeper: no top-up noise
  world.feedAge.set(staleFeed, 7200); // 2h old
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: false, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.deepEqual(result.staleFeeds, [staleFeed]);
  assert.ok(result.alertsRaised.includes(`feed-stale:${staleFeed}`));
  assert.ok(events.some((e) => e.event === 'autopilot-alert' && e.fields.kind === `feed-stale:${staleFeed}`));
  const state = readState(path);
  assert.equal(state.feeds.length, TWAP_FEED_ADDRESSES.length);
  assert.equal(state.feeds.find((f) => f.address === staleFeed)?.stale, true);
  assert.equal(state.feeds.find((f) => f.address === TWAP_FEED_ADDRESSES[0])?.stale, false);
});

test('alerts clear when the condition ends (same state file, second run)', async () => {
  const world = mockWorld(); // keeper low
  const wallet = mockWallet();
  const { path } = tempStateFile();
  const { log, events } = mockLogger();
  await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: false, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.ok(loadState(path).activeAlerts['keeper-low']);
  world.keeperEth = '0.01'; // keeper healthy again
  const events2 = mockLogger();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: false, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log: events2.log },
  );
  assert.ok(result.alertsCleared.includes('keeper-low'));
  assert.ok(events2.events.some((e) => e.event === 'autopilot-alert-cleared' && e.fields.kind === 'keeper-low'));
  assert.equal(loadState(path).activeAlerts['keeper-low'], undefined);
});

test('reserve-low alert: reserve under 0.01 raises reserve-low and blocks the send', async () => {
  const world = mockWorld({ reserveEth: '0.009' });
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: true, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.ok(result.alertsRaised.includes('reserve-low'));
  assert.equal(wallet.sends.length, 0);
  assert.equal(result.decision.action, 'blocked');
});

test('reverted top-up tx: spend NOT recorded, failure logged', async () => {
  const world = mockWorld({ receiptStatus: 'reverted' });
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const { path } = tempStateFile();
  const result = await runAutopilot(
    { public: mockPublic(world), wallet } as never,
    { dryRun: false, enabled: true, killSwitchActive: false, reserveAddress: RESERVE_ADDRESS, stateFile: path, log },
  );
  assert.equal(wallet.sends.length, 1);
  assert.equal(result.toppedUp, false);
  assert.ok(events.some((e) => e.event === 'autopilot-topup-failed'));
  const state = readState(path);
  assert.equal(state.dailySpentEth, '0');
  assert.deepEqual(state.topUps, []);
});
