/**
 * Keeper gas autopilot CLI — one check (and, when armed, at most one
 * top-up) per run. Cron-friendly; use flock so overlapping runs cannot
 * collide (see README.md).
 *
 *   npm run autopilot:dry-run   Read chain state, log alerts + the plan. Sends nothing, needs no key.
 *   npm run autopilot           One check; sends ONLY when armed (see below).
 *
 * Arming (separate step, after Jon funds the reserve):
 *   1. Fund the reserve wallet (address in .env.autopilot-reserve's key)
 *      with 0.05 or 0.10 ETH.
 *   2. Set AUTOPILOT_ENABLED=true (in .env.autopilot-reserve or the env).
 *   3. Create the 15-min cron (flock) and watch the first live top-up.
 *
 * Kill-switch: AUTOPILOT_ENABLED must be exactly `true` (default off) AND
 * no data/autopilot.kill file may exist. Either one off stops all sends.
 *
 * Env overrides (ops/testing): AUTOPILOT_RPC_URL, AUTOPILOT_STATE_FILE,
 * AUTOPILOT_LOG_FILE, AUTOPILOT_KILL_FILE.
 */
import dotenv from 'dotenv';
import { createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { existsSync } from 'node:fs';
import type { Hex } from 'viem';
import { KEEPER_ADDRESS, runAutopilot } from './autopilot.js';
import { ROBINHOOD_CHAIN } from './chain.js';
import { createLogger } from './log.js';

// .env holds RPC_URL; .env.autopilot-reserve holds the reserve key only.
// dotenv never overwrites a variable that is already set, so real env wins.
dotenv.config();
dotenv.config({ path: '.env.autopilot-reserve' });

function usage(): void {
  console.log(`keeper autopilot — checks the keeper balance + V4 feed freshness, alerts, and (when armed) tops the keeper up from the reserve.

Usage: tsx src/autopilot-run.ts [--dry-run] [--help]

  --dry-run   Read state, log alerts + the plan. Sends no transactions, needs no key.
  --help      Show this help.

Arming: fund the reserve wallet, then set AUTOPILOT_ENABLED=true. Kill-switch:
unset AUTOPILOT_ENABLED, or touch data/autopilot.kill. Default: ARMED-OFF.
`);
}

function parseEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return raw.toLowerCase() === 'true' || raw === '1';
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    usage();
    return;
  }
  const dryRun = args.has('--dry-run');
  const enabled = parseEnabled(process.env.AUTOPILOT_ENABLED);
  const killFile = process.env.AUTOPILOT_KILL_FILE ?? './data/autopilot.kill';
  const killSwitchActive = existsSync(killFile);
  const stateFile = process.env.AUTOPILOT_STATE_FILE ?? './data/autopilot-state.json';
  const logFile = process.env.AUTOPILOT_LOG_FILE ?? './data/autopilot.log.jsonl';
  const rpcUrl = process.env.AUTOPILOT_RPC_URL ?? process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';

  const log = createLogger(logFile);

  const rawKey = process.env.AUTOPILOT_RESERVE_PRIVATE_KEY ?? '';
  let reserveKey: Hex | null = null;
  if (rawKey !== '') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
      throw new Error('AUTOPILOT_RESERVE_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key');
    }
    reserveKey = rawKey as Hex;
  }
  if (!dryRun && enabled && !reserveKey) {
    throw new Error(
      'Autopilot is enabled but AUTOPILOT_RESERVE_PRIVATE_KEY is missing (see .env.autopilot-reserve). Refusing to run armed without a reserve key.',
    );
  }

  const publicClient = createPublicClient({
    chain: ROBINHOOD_CHAIN,
    transport: http(rpcUrl),
  });

  let wallet: Parameters<typeof runAutopilot>[0]['wallet'] = null;
  let reserveAddress: `0x${string}` | null = null;
  if (reserveKey) {
    const account = privateKeyToAccount(reserveKey);
    reserveAddress = account.address;
    if (!dryRun && enabled) {
      wallet = createWalletClient({
        account,
        chain: ROBINHOOD_CHAIN,
        transport: http(rpcUrl),
      });
    }
  }

  log.log('autopilot-start', {
    mode: dryRun ? 'dry-run' : 'live',
    enabled,
    killSwitchActive,
    armed: enabled && !killSwitchActive && !dryRun,
    keeper: KEEPER_ADDRESS,
    reserve: reserveAddress,
    rpcUrl,
  });
  if (!reserveKey) {
    log.log('autopilot-note', {
      note: 'No reserve key configured — reserve balance is unknown and no top-up can ever send. See .env.autopilot-reserve.',
    });
  }

  const result = await runAutopilot(
    { public: publicClient, wallet },
    { dryRun, enabled, killSwitchActive, reserveAddress, stateFile, log },
  );

  log.log('autopilot-done', {
    keeperBalanceEth: formatEther(result.keeperBalance),
    reserveBalanceEth: result.reserveBalance === null ? null : formatEther(result.reserveBalance),
    decision: result.decision.action,
    toppedUp: result.toppedUp,
    tx: result.txHash,
    alertsRaised: result.alertsRaised,
    alertsCleared: result.alertsCleared,
    staleFeedCount: result.staleFeeds.length,
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
