// Terminal activity payload as it travels over JSON — pure types + converters
// (Nov 26). BigInts cannot go over JSON or into client-component props, so
// blocks travel as numbers and tokenIds as decimal strings; these two
// functions convert between the wire shape and the in-memory shape. Shared
// by the server scan (via lib/first-paint.ts) and the client hook
// (lib/terminal/use-terminal.ts) so the first paint can start from the
// server-read activity instead of the "Updating…" skeleton.

import type { ActivityRow, MintActivity, StakeActivity, TerminalActivity, TickerRow, TradeActivity } from './types';

/** The activity payload as it arrives over JSON: blocks are numbers and tokenIds strings. */
export type ActivityWireRow =
  | (Omit<TradeActivity, 'block'> & { block: number })
  | (Omit<MintActivity, 'block' | 'tokenId'> & { block: number; tokenId: string })
  | StakeActivity;

export type ActivityWire = {
  rows: ActivityWireRow[];
  ticker: TickerRow[];
  updatedAt: number;
  degraded: boolean;
};

export function activityToWire(a: TerminalActivity): ActivityWire {
  return {
    rows: a.rows.map((row) =>
      row.kind === 'trade'
        ? { ...row, block: Number(row.block) }
        : row.kind === 'mint'
          ? { ...row, block: Number(row.block), tokenId: row.tokenId.toString() }
          : row,
    ),
    ticker: a.ticker,
    updatedAt: a.updatedAt,
    degraded: a.degraded,
  };
}

export function activityFromWire(j: ActivityWire): TerminalActivity {
  const rows: ActivityRow[] = j.rows.map((row) =>
    row.kind === 'trade'
      ? { ...row, block: BigInt(row.block) }
      : row.kind === 'mint'
        ? { ...row, block: BigInt(row.block), tokenId: BigInt(row.tokenId) }
        : row,
  );
  return { rows, ticker: j.ticker, updatedAt: j.updatedAt, degraded: j.degraded };
}
