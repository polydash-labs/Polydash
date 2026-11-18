/**
 * Configuration from environment variables.
 * The keeper key comes ONLY from KEEPER_PRIVATE_KEY. It is never written to
 * a file and never logged. Dry-run mode needs no key at all.
 *
 * The AgentRegistry / AgentScore addresses are NOT deployed yet, so they
 * have no defaults — set REGISTRY_ADDRESS (always required) and
 * SCORE_ADDRESS (required unless --dry-run) after deploying.
 */
import 'dotenv/config';
import type { Address, Hex } from 'viem';
import { FUND_FACTORIES, LAUNCH_FACTORY, POLYDASH_ADDRESS, STAKING_FACTORIES } from './chain.js';

export interface ScorerConfig {
  rpcUrl: string;
  chainId: number;
  /** 0x-prefixed 32-byte hex key. Null in dry-run mode. */
  keeperPrivateKey: Hex | null;
  dryRun: boolean;
  registryAddress: Address;
  /** Null in dry-run mode (no posting). */
  scoreAddress: Address | null;
  fundFactories: Address[];
  stakingFactories: Address[];
  launchFactory: Address;
  polydashAddress: Address;
  /** How far back to look for logs, in blocks. Default 200_000 (~23 days
   *  at ~10s/block on Robinhood Chain — covers the 30-day windows with
   *  headroom; the scorer clamps to the 30-day window by timestamp). */
  lookbackBlocks: bigint;
  /** JSON output file for the computed scores (the site API reads this). */
  outputFile: string;
  /** JSONL log file path. */
  logFile: string;
}

function envAddressList(name: string, fallback: Address[]): Address[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((s) => {
    const a = s.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`Invalid address in ${name}: ${a}`);
    return a as Address;
  });
}

function envAddress(name: string): Address | null {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`Invalid ${name}: ${raw}`);
  return raw as Address;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

export function loadConfig(opts: { dryRun: boolean }): ScorerConfig {
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
    throw new Error('KEEPER_PRIVATE_KEY is required (or run with --dry-run, which sends nothing)');
  }
  const registryAddress = envAddress('REGISTRY_ADDRESS');
  if (!registryAddress) {
    throw new Error('REGISTRY_ADDRESS is required (deploy AgentRegistry first, then set it)');
  }
  const scoreAddress = envAddress('SCORE_ADDRESS');
  if (!opts.dryRun && !scoreAddress) {
    throw new Error('SCORE_ADDRESS is required (deploy AgentScore first, then set it)');
  }
  return {
    rpcUrl,
    chainId: 4663,
    keeperPrivateKey,
    dryRun: opts.dryRun,
    registryAddress,
    scoreAddress,
    fundFactories: envAddressList('FUND_FACTORIES', FUND_FACTORIES),
    stakingFactories: envAddressList('STAKING_FACTORIES', STAKING_FACTORIES),
    launchFactory: envAddress('LAUNCH_FACTORY') ?? LAUNCH_FACTORY,
    polydashAddress: envAddress('POLYDASH_ADDRESS') ?? POLYDASH_ADDRESS,
    lookbackBlocks: BigInt(envInt('LOOKBACK_BLOCKS', 200_000)),
    outputFile: process.env.OUTPUT_FILE ?? './data/scores.json',
    logFile: process.env.LOG_FILE ?? './data/scorer.log.jsonl',
  };
}
