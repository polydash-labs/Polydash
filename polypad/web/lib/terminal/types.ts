// Terminal activity row types. Pure types only — no imports — so both the
// client hook (lib/terminal/use-terminal.ts) and the server scan
// (lib/terminal/server.ts) can share them without pulling server code into
// the browser bundle or client code into a route handler.

export type TradeActivity = {
  kind: 'trade';
  launch: `0x${string}`;
  isBuy: boolean;
  trader: string;
  eth: number;
  tokens: number;
  txHash: string;
  block: bigint;
  timestamp: number;
};
export type MintActivity = {
  kind: 'mint';
  fund: `0x${string}`;
  to: string;
  tokenId: bigint;
  txHash: string;
  block: bigint;
  timestamp: number;
};
export type StakeActivity = {
  kind: 'stake';
  pool: string;
  name: string;
  stakeSymbol: string;
  rewardSymbol: string;
  creator: string | null;
  timestamp: number;
};
export type ActivityRow = TradeActivity | MintActivity | StakeActivity;
export type TickerRow = { launch: string; volumeEth: number; trades: number };

/** The activity payload, as served by /api/terminal/activity and consumed by the Terminal page. */
export type TerminalActivity = {
  rows: ActivityRow[];
  ticker: TickerRow[];
  updatedAt: number;
  degraded: boolean;
};
