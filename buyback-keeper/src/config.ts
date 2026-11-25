/**
 * Configuration from environment variables.
 * The keeper key comes ONLY from KEEPER_PRIVATE_KEY. It is never written to a
 * file and never logged. Dry-run mode needs no key at all.
 */
import 'dotenv/config';
import { parseEther } from 'viem';
import type { Hex } from 'viem';

export interface KeeperConfig {
  rpcUrl: string;
  chainId: number;
  /** 0x-prefixed 32-byte hex key. Null in dry-run mode. */
  keeperPrivateKey: Hex | null;
  dryRun: boolean;
  /** Minimum vault ETH balance that triggers a buy (wei). Default 0.005 ETH. */
  minBuyEth: bigint;
  /** Seconds to wait after observePrice() before buy(). Default 360 (6 min). */
  observeWaitSeconds: number;
  /** Poll interval between cycles in --watch mode. Default 60s. */
  pollIntervalSeconds: number;
  /** JSONL log file path. */
  logFile: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function envEth(name: string, fallback: string): bigint {
  const raw = process.env[name] ?? fallback;
  try {
    return parseEther(raw as `${number}`);
  } catch {
    throw new Error(`Invalid ${name}: ${raw} (expected ETH, e.g. 0.005)`);
  }
}

export function loadConfig(opts: { dryRun: boolean }): KeeperConfig {
  const rpcUrl = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
  const rawKey = process.env.KEEPER_PRIVATE_KEY ?? '';
  let keeperPrivateKey: Hex | null = null;
  if (rawKey !== '') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
      throw new Error('KEEPER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key');
    }
    keeperPrivateKey = rawKey as Hex;
  }
  if (!opts.dryRun && !keeperPrivateKey) {
    throw new Error(
      'KEEPER_PRIVATE_KEY is required (or run with --dry-run, which sends nothing)',
    );
  }
  const observeWaitSeconds = envInt('OBSERVE_WAIT_SECONDS', 360);
  if (observeWaitSeconds < 300 || observeWaitSeconds > 3600) {
    throw new Error(
      'OBSERVE_WAIT_SECONDS must be 300..3600: the vault requires buy() 5-60 minutes after observePrice()',
    );
  }
  return {
    rpcUrl,
    chainId: 4663,
    keeperPrivateKey,
    dryRun: opts.dryRun,
    minBuyEth: envEth('MIN_BUY_ETH', '0.005'),
    observeWaitSeconds,
    pollIntervalSeconds: envInt('POLL_INTERVAL_SECONDS', 60),
    logFile: process.env.LOG_FILE ?? './data/keeper.log.jsonl',
  };
}
