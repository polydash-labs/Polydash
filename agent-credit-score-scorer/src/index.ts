/**
 * Agent Credit Score scorer CLI.
 *
 *   npm run start:dry-run   Compute every registered agent's score and
 *                           print it + write data/scores.json. Sends nothing.
 *   npm run start:once      Compute and post updateScore on-chain, then exit.
 *   npm start -- --watch    Loop forever (use cron daily instead if you prefer).
 *
 * The keeper key comes ONLY from KEEPER_PRIVATE_KEY (see config.ts). It is
 * never written to a file and never logged. Dry-run mode needs no key.
 * Schedule it with cron daily; see README.md. Use flock so overlapping
 * runs cannot collide.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROBINHOOD_CHAIN } from './chain.js';
import { loadConfig } from './config.js';
import { runScorer } from './scorer.js';
import { createLogger } from './log.js';

function usage(): void {
  console.log(`agent-credit-score-scorer — computes the Agent Credit Score (300-850) for every registered agent and posts it on-chain.

Usage: tsx src/index.ts [--once] [--watch] [--dry-run] [--help]

  --once      Run one scoring pass and exit (default; cron-friendly).
  --watch     Loop passes forever with POLL_INTERVAL_SECONDS between them.
  --dry-run   Compute scores and write data/scores.json. Sends no transactions, needs no key.
  --help      Show this help.
`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    usage();
    return;
  }
  const dryRun = args.has('--dry-run');
  const watch = args.has('--watch');
  const config = loadConfig({ dryRun });
  const log = createLogger(config.logFile);

  const publicClient = createPublicClient({
    chain: ROBINHOOD_CHAIN,
    transport: http(config.rpcUrl),
  });

  let walletClient: Parameters<typeof runScorer>[0]['walletClient'] = null;
  if (!dryRun && config.keeperPrivateKey) {
    const account = privateKeyToAccount(config.keeperPrivateKey);
    walletClient = createWalletClient({
      account,
      chain: ROBINHOOD_CHAIN,
      transport: http(config.rpcUrl),
    });
    const balance = await publicClient.getBalance({ address: account.address });
    log.log('start', {
      mode: watch ? 'watch' : 'once',
      keeper: account.address,
      keeperBalanceEth: balance.toString(),
      registry: config.registryAddress,
      score: config.scoreAddress,
    });
  } else {
    log.log('start', {
      mode: watch ? 'watch' : 'once',
      dryRun: true,
      registry: config.registryAddress,
    });
  }

  const runOnce = async () => {
    const results = await runScorer({ publicClient, walletClient, config, log });
    mkdirSync(dirname(config.outputFile), { recursive: true });
    writeFileSync(config.outputFile, JSON.stringify({ scoredAt: new Date().toISOString(), results }, null, 2));
    log.log('output_written', { file: config.outputFile, agents: results.length });
  };

  await runOnce();
  if (watch) {
    const intervalMs = 86_400_000; // daily; override via POLL_INTERVAL_SECONDS if needed
    log.log('watching', { intervalMs });
    for (;;) {
      await new Promise((r) => setTimeout(r, intervalMs));
      await runOnce();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
