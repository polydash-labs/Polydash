/** Transaction status and a plain-words result. Reads the receipt only. */
import { decodeEventLog, parseAbi, type Hex, type Log } from 'viem';
import { fundFactoryAbi, launchAbi, launchFactoryAbi } from './abis';
import { CHAIN_ID, EXPLORER, SITE_ORIGIN } from './config';
import { ApiError, ethDisplay, unitsDisplay, type Ctx } from './core';
import { allLaunches } from './launches';
import { readAttribution } from './prepared';

const transferEvent = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const known = [...launchAbi, ...launchFactoryAbi, ...fundFactoryAbi] as const;

export async function txStatus(ctx: Ctx, hash: Hex) {
  let receipt;
  try {
    receipt = await ctx.client.getTransactionReceipt({ hash });
  } catch {
    receipt = null;
  }
  if (!receipt) {
    let pending = false;
    try {
      const tx = await ctx.client.getTransaction({ hash });
      pending = !!tx;
    } catch { pending = false; }
    if (!pending) {
      throw new ApiError(404, 'tx_not_found', 'No transaction with that hash was found on Robinhood Chain. It may not have been sent yet.', { hash });
    }
    return { ok: true, chainId: CHAIN_ID, hash, status: 'pending', explorer: `${EXPLORER}/tx/${hash}`, next: 'Check again in a few seconds.' };
  }
  const tx = await ctx.client.getTransaction({ hash }).catch(() => null);
  const launches = await allLaunches(ctx).catch(() => []);
  const symbolAt = (a: string) => launches.find((l) => l.launch.toLowerCase() === a.toLowerCase())?.symbol ?? 'tokens';
  const events: string[] = [];
  let createdToken: string | null = null;
  let createdFund: string | null = null;
  for (const log of receipt.logs as Log[]) {
    const tokenHit = launches.find((l) => l.token.toLowerCase() === log.address.toLowerCase());
    if (tokenHit && tokenHit.phase === 4) {
      // Graduated token: trades go through the Uniswap V4 pool, so read the wallet's token movement.
      try {
        const t = decodeEventLog({ abi: transferEvent, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        const a = t.args as { from: string; to: string; value: bigint };
        if (a.to.toLowerCase() === receipt.from.toLowerCase()) events.push(`Received ${unitsDisplay(a.value)} ${tokenHit.symbol}`);
        else if (a.from.toLowerCase() === receipt.from.toLowerCase()) events.push(`Sent ${unitsDisplay(a.value)} ${tokenHit.symbol}`);
      } catch { /* not a Transfer */ }
      continue;
    }
    try {
      const d = decodeEventLog({ abi: known, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const a = d.args as Record<string, unknown>;
      if (d.eventName === 'Bought') events.push(`Bought ${unitsDisplay(a.tokensOut as bigint)} ${symbolAt(log.address)} for ${ethDisplay(a.ethIn as bigint)} ETH`);
      else if (d.eventName === 'Sold') events.push(`Sold ${unitsDisplay(a.tokensIn as bigint)} ${symbolAt(log.address)} for ${ethDisplay(a.ethOut as bigint)} ETH`);
      else if (d.eventName === 'Graduated') events.push('The token graduated to a Uniswap V4 pool in this transaction');
      else if (d.eventName === 'LaunchCreated') { createdToken = String(a.token); events.push(`Token launched: ${String(a.symbol)}`); }
      else if (d.eventName === 'FundCreated') { createdFund = String(a.fund); events.push('Fund created'); }
    } catch { /* not a known event */ }
  }
  const success = receipt.status === 'success';
  const head = await ctx.client.getBlockNumber();
  const attribution = tx ? readAttribution(tx.input as Hex) : null;
  return {
    ok: true,
    chainId: CHAIN_ID,
    hash,
    status: success ? 'confirmed' : 'failed',
    block: receipt.blockNumber.toString(),
    confirmations: (head - receipt.blockNumber).toString(),
    from: receipt.from,
    to: receipt.to,
    gasUsed: receipt.gasUsed.toString(),
    events,
    result: success ? (events.length ? events.join('. ') + '.' : 'The transaction was confirmed.') : 'The transaction was mined but failed. No state changed except gas spent.',
    ...(createdToken ? { newToken: createdToken, next: `Open https://polypad.family/token/${createdToken}` } : {}),
    ...(createdFund ? { newFund: createdFund, next: `${SITE_ORIGIN}/funds/${createdFund}. As manager, mint your required shares next.` } : {}),
    attribution: attribution ? { ref: attribution.codes[1] ?? null, codes: attribution.codes, viaPolypadAgentApi: attribution.codes[0] === 'polypad' } : null,
    explorer: `${EXPLORER}/tx/${hash}`,
  };
}
