/**
 * Buyback keeper CLI.
 *
 *   npm run start:dry-run   Read chain state and log what WOULD happen. Sends nothing.
 *   npm run start:once      Run one full cycle (observe -> wait -> buy -> release) and exit.
 *   npm start -- --watch    Loop cycles forever (use cron instead if you prefer).
 *
 * One cycle takes ~6-7 minutes when it observes (the vault requires buy() 5-60
 * minutes after observePrice()). Schedule it with cron every 15 minutes; see
 * README.md. Use flock so overlapping runs cannot collide.
 */
import { createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROBINHOOD_CHAIN, VAULT_ADDRESS } from './chain.js';
import { loadConfig } from './config.js';
import { runCycle } from './keeper.js';
import { createLogger } from './log.js';

function usage(): void {
  console.log(`buyback-keeper — runs the PolydashBuybackVault observe/buy/release cycle.

Usage: tsx src/index.ts [--once] [--watch] [--dry-run] [--help]

  --once      Run one cycle and exit (default; cron-friendly).
  --watch     Loop cycles forever with POLL_INTERVAL_SECONDS between them.
  --dry-run   Read state and log the plan. Sends no transactions, needs no key.
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

  let wallet: Parameters<typeof runCycle>[0]['wallet'] = null;
  let keeperAddress: string | null = null;
  if (!dryRun && config.keeperPrivateKey) {
    const account = privateKeyToAccount(config.keeperPrivateKey);
    keeperAddress = account.address;
    wallet = createWalletClient({
      account,
      chain: ROBINHOOD_CHAIN,
      transport: http(config.rpcUrl),
    });
    const balance = await publicClient.getBalance({ address: account.address });
    log.log('start', {
      mode: watch ? 'watch' : 'once',
      keeper: account.address,
      keeperEthBalance: formatEther(balance),
      vault: VAULT_ADDRESS,
      minBuyEth: formatEther(config.minBuyEth),
      observeWaitSeconds: config.observeWaitSeconds,
    });
    if (balance === 0n) {
      throw new Error(
        `Keeper wallet ${account.address} holds 0 ETH and cannot pay gas. Fund it with a few dollars of ETH (see README.md).`,
      );
    }
  } else {
    log.log('start', {
      mode: `dry-run (${watch ? 'watch' : 'once'})`,
      vault: VAULT_ADDRESS,
      minBuyEth: formatEther(config.minBuyEth),
      observeWaitSeconds: config.observeWaitSeconds,
    });
  }

  const runOnce = async () => {
    const result = await runCycle({ public: publicClient, wallet }, config, log);
    log.log('cycle-done', {
      observed: result.observed,
      bought: result.bought,
      buyEthIn: result.buyEthIn === null ? null : formatEther(result.buyEthIn),
      buyBurned: result.buyBurned === null ? null : formatEther(result.buyBurned),
      buyToStakers: result.buyToStakers === null ? null : formatEther(result.buyToStakers),
      released: result.released === null ? null : formatEther(result.released),
      poked: result.poked,
      pokeFailed: result.pokeFailed,
    });
  };

  if (!watch) {
    await runOnce();
    return;
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  while (!stopping) {
    try {
      await runOnce();
    } catch (err) {
      log.log('cycle-error', { error: err instanceof Error ? err.message.split('\n')[0] : String(err) });
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSeconds * 1000));
  }
  log.log('stop', {});
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
