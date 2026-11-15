import type { AbiEvent } from 'viem';
import type { Ctx } from './core';

/** The chain RPC caps eth_getLogs at 100,000 blocks, or 10,000,000 when the filter has one value per position. */
const WIDE = 9_900_000n;
const NARROW = 99_000n;

type Range = { address: `0x${string}`; event: AbiEvent; args?: Record<string, unknown>; fromBlock: bigint; toBlock?: bigint };

export async function getLogsChunked(ctx: Ctx, r: Range): Promise<readonly unknown[]> {
  const latest = r.toBlock ?? (await ctx.client.getBlockNumber());
  const out: unknown[] = [];
  const step = WIDE;
  for (let from = r.fromBlock; from <= latest; from += step + 1n) {
    const to = from + step > latest ? latest : from + step;
    const logs = await ctx.client.getLogs({
      address: r.address,
      event: r.event,
      args: r.args as never,
      fromBlock: from,
      toBlock: to,
    });
    out.push(...logs);
  }
  return out;
}

export const NARROW_STEP = NARROW;

/** Roughly 9 blocks per second on Robinhood Chain. Measured, not assumed. */
export async function blocksPerSecond(ctx: Ctx): Promise<number> {
  const key = 'bps';
  const hit = ctx.cache.get(key);
  if (hit && ctx.now() - hit.at < 3_600_000) return hit.value as number;
  const n = await ctx.client.getBlockNumber();
  const [a, b] = await Promise.all([ctx.client.getBlock({ blockNumber: n }), ctx.client.getBlock({ blockNumber: n - 50_000n })]);
  const dt = Number(a.timestamp - b.timestamp);
  const bps = dt > 0 ? 50_000 / dt : 4;
  ctx.cache.set(key, { at: ctx.now(), value: bps });
  return bps;
}
