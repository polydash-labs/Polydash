/**
 * Unit tests for the keeper's decision logic. No network, no keys, no chain.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEther } from 'viem';
import {
  BUY_COOLDOWN_SECONDS,
  decide,
  shouldRelease,
  type VaultState,
} from '../src/keeper.js';

const MIN_BUY = parseEther('0.005');
const NOW = 1_800_000_000; // fixed "now" (unix seconds)

function state(overrides: Partial<VaultState> = {}): VaultState {
  return {
    now: NOW,
    pendingEth: parseEther('0.02'),
    obsTime: 0n,
    lastBuyTime: 0n,
    heldForStakers: 0n,
    targetActive: true,
    buyCount: 0n,
    totalBurned: 0n,
    totalEthSpent: 0n,
    maxBuyEth: parseEther('0.02'),
    ...overrides,
  };
}

test('below the minimum balance: skip, insufficient-balance', () => {
  const d = decide(state({ pendingEth: parseEther('0.004') }), MIN_BUY);
  assert.equal(d.kind, 'skip');
  assert.equal(d.reason, 'insufficient-balance');
});

test('exactly at the minimum balance: does not skip for balance', () => {
  const d = decide(state({ pendingEth: MIN_BUY }), MIN_BUY);
  assert.equal(d.kind, 'observe');
});

test('cooldown active: skip with remaining seconds', () => {
  const d = decide(state({ lastBuyTime: BigInt(NOW - 300) }), MIN_BUY);
  assert.equal(d.kind, 'skip');
  assert.equal(d.reason, 'cooldown');
  if (d.kind === 'skip') assert.equal(d.cooldownRemainingSeconds, 300);
});

test('cooldown just expired: proceeds', () => {
  const d = decide(state({ lastBuyTime: BigInt(NOW - BUY_COOLDOWN_SECONDS) }), MIN_BUY);
  assert.equal(d.kind, 'observe');
});

test('no observation: observe', () => {
  const d = decide(state(), MIN_BUY);
  assert.deepEqual(d, { kind: 'observe', reason: 'no-observation', observationAgeSeconds: null });
});

test('observation 2 minutes old: wait until 6 minutes old', () => {
  const d = decide(state({ obsTime: BigInt(NOW - 120) }), MIN_BUY);
  assert.equal(d.kind, 'wait');
  if (d.kind === 'wait') {
    assert.equal(d.waitSeconds, 240);
    assert.equal(d.observationAgeSeconds, 120);
  }
});

test('observation 6 minutes old: buy', () => {
  const d = decide(state({ obsTime: BigInt(NOW - 360) }), MIN_BUY);
  assert.equal(d.kind, 'buy');
  if (d.kind === 'buy') assert.equal(d.observationAgeSeconds, 360);
});

test('observation 59 minutes old: still buyable', () => {
  const d = decide(state({ obsTime: BigInt(NOW - 3540) }), MIN_BUY);
  assert.equal(d.kind, 'buy');
});

test('observation 61 minutes old: expired, observe again', () => {
  const d = decide(state({ obsTime: BigInt(NOW - 3660) }), MIN_BUY);
  assert.equal(d.kind, 'observe');
  assert.equal(d.reason, 'observation-expired');
});

test('observation timestamp in the future (clock skew): treated as fresh, wait', () => {
  const d = decide(state({ obsTime: BigInt(NOW + 60) }), MIN_BUY);
  assert.equal(d.kind, 'wait');
});

test('shouldRelease: only when held > 0 and target is active', () => {
  assert.equal(shouldRelease(state({ heldForStakers: parseEther('1') })), true);
  assert.equal(shouldRelease(state({ heldForStakers: parseEther('1'), targetActive: false })), false);
  assert.equal(shouldRelease(state({ heldForStakers: 0n })), false);
});

// ---------------------------------------------------------------------------
// Poke step (runCycle with mock clients — no network, no keys, no chain).
// ---------------------------------------------------------------------------

import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { HOOKR_TWAP_FEED_ADDRESS, ROBINHOOD_CHAIN, TWAP_FEED_ADDRESSES, TWAP_FEED_ADDRESS, twapFeedAbi } from '../src/chain.js';
import type { KeeperConfig } from '../src/config.js';
import { runCycle, type CycleClients } from '../src/keeper.js';
import type { Logger } from '../src/log.js';

const KEEPER_ADDRESS = '0x3e298C64B4073ccFfd9df671eBaEdb886Dcb9270' as const;
const POKE_TX = `0x${'ab'.repeat(32)}` as const;

function mockLogger() {
  const events: { event: string; fields: Record<string, unknown> }[] = [];
  const log: Logger = {
    log(event, fields = {}) {
      events.push({ event, fields });
    },
  };
  return { log, events };
}

function mockConfig(overrides: Partial<KeeperConfig> = {}): KeeperConfig {
  return {
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    chainId: 4663,
    keeperPrivateKey: null,
    dryRun: false,
    minBuyEth: MIN_BUY,
    observeWaitSeconds: 360,
    pollIntervalSeconds: 60,
    logFile: '',
    ...overrides,
  };
}

/** Vault reads: empty vault, so the buyback decision is always a skip. */
function mockPublic(receipt: { status: 'success' | 'reverted'; logs: unknown[] }) {
  const views: Record<string, unknown> = {
    pendingEth: 0n,
    heldForStakers: 0n,
    obsTime: 0n,
    lastBuyTime: 0n,
    targetActive: true,
    buyCount: 0n,
    totalBurned: 0n,
    totalEthSpent: 0n,
    maxBuyEth: parseEther('0.02'),
  };
  return {
    getBlock: async () => ({ timestamp: BigInt(NOW) }),
    readContract: async (args: { functionName: string }) => views[args.functionName],
    waitForTransactionReceipt: async () => receipt,
  };
}

function mockWallet(opts: { throwOnWrite?: Error } = {}) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    account: { address: KEEPER_ADDRESS },
    chain: ROBINHOOD_CHAIN,
    writeContract: async (args: Record<string, unknown>) => {
      calls.push(args);
      if (opts.throwOnWrite) throw opts.throwOnWrite;
      return POKE_TX;
    },
  };
}

function pokedReceipt() {
  const topics = encodeEventTopics({
    abi: twapFeedAbi,
    eventName: 'Poked',
    args: { timestamp: BigInt(NOW) },
  });
  const data = encodeAbiParameters(
    [
      { type: 'int256', name: 'tickCumulative' },
      { type: 'int24', name: 'tick' },
    ],
    [123456n, -456],
  );
  return {
    status: 'success' as const,
    logs: [
      {
        address: TWAP_FEED_ADDRESS,
        topics,
        data,
        blockHash: `0x${'00'.repeat(32)}`,
        blockNumber: 1n,
        logIndex: 0,
        transactionHash: POKE_TX,
        transactionIndex: 0,
        removed: false,
      },
    ],
  };
}

function clientsFor(publicClient: unknown, wallet: unknown): CycleClients {
  return { public: publicClient, wallet: wallet } as unknown as CycleClients;
}

test('poke runs on every cycle, even when the buyback skips (empty vault)', async () => {
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const result = await runCycle(
    clientsFor(mockPublic(pokedReceipt()), wallet),
    mockConfig(),
    log,
  );
  // One poke call per feed in the keeper's poke list (6 feeds since HOOKR).
  assert.equal(wallet.calls.length, TWAP_FEED_ADDRESSES.length);
  assert.deepEqual(
    wallet.calls.map((c) => c.address),
    TWAP_FEED_ADDRESSES,
  );
  assert.ok(wallet.calls.every((c) => c.functionName === 'poke'));
  assert.equal(result.poked, true);
  assert.equal(result.pokeFailed, false);
  const poked = events.find((e) => e.event === 'poked');
  assert.ok(poked, 'expected a poked log entry');
  assert.equal(poked.fields.tx, POKE_TX);
  assert.equal(poked.fields.timestamp, String(NOW));
  assert.equal(poked.fields.tick, '-456');
  const decision = events.find((e) => e.event === 'decision');
  assert.ok(decision, 'expected the buyback decision to still be logged');
  assert.equal(decision.fields.kind, 'skip');
  assert.equal(decision.fields.reason, 'insufficient-balance');
});

test('poke uses the keeper wallet account and chain', async () => {
  const wallet = mockWallet();
  const { log } = mockLogger();
  await runCycle(clientsFor(mockPublic(pokedReceipt()), wallet), mockConfig(), log);
  const call = wallet.calls[0];
  assert.equal((call.account as { address: string }).address, KEEPER_ADDRESS);
  assert.equal((call.chain as { id: number }).id, 4663);
});

test('a reverted poke does not break the buyback cycle', async () => {
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const result = await runCycle(
    clientsFor(mockPublic({ status: 'reverted', logs: [] }), wallet),
    mockConfig(),
    log,
  );
  assert.equal(result.poked, false);
  assert.equal(result.pokeFailed, true);
  assert.ok(events.some((e) => e.event === 'poke-failed'), 'expected a poke-failed log entry');
  // The cycle still ran to completion: decision logged, no throw.
  const decision = events.find((e) => e.event === 'decision');
  assert.ok(decision, 'expected the buyback decision to still be logged after a failed poke');
  assert.equal(decision.fields.kind, 'skip');
});

test('a poke that fails to send does not break the buyback cycle', async () => {
  const wallet = mockWallet({ throwOnWrite: new Error('insufficient funds for gas') });
  const { log, events } = mockLogger();
  const result = await runCycle(
    clientsFor(mockPublic(pokedReceipt()), wallet),
    mockConfig(),
    log,
  );
  assert.equal(result.poked, false);
  assert.equal(result.pokeFailed, true);
  const failed = events.find((e) => e.event === 'poke-failed');
  assert.ok(failed, 'expected a poke-failed log entry');
  assert.match(String(failed.fields.error), /insufficient funds/);
  const decision = events.find((e) => e.event === 'decision');
  assert.ok(decision, 'expected the buyback decision to still be logged after a failed poke');
});

test('dry-run: poke is planned, not sent', async () => {
  const wallet = mockWallet();
  const { log, events } = mockLogger();
  const result = await runCycle(
    clientsFor(mockPublic(pokedReceipt()), wallet),
    mockConfig({ dryRun: true }),
    log,
  );
  assert.equal(wallet.calls.length, 0);
  assert.equal(result.poked, false);
  assert.equal(result.pokeFailed, false);
  const plan = events.find((e) => e.event === 'dry-run-plan' && String(e.fields.would).includes('poke'));
  assert.ok(plan, 'expected a dry-run plan entry for the poke');
  // The poke plan lists every feed (not a single `feed` field).
  assert.ok(Array.isArray(plan.fields.feeds), 'expected the poke plan to list feeds');
  assert.ok(plan.fields.feeds.includes(TWAP_FEED_ADDRESS));
  assert.ok(plan.fields.feeds.includes(HOOKR_TWAP_FEED_ADDRESS));
});
