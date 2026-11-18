import { parseUnits } from 'viem';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const PROTECTION_BITS = {
  custody: 1,
  allowlist: 2,
  hwm: 4,
  skin: 8,
  source: 16,
  timelock: 32,
} as const;

export const PROTECTION_TOTAL = 6;

export type ProtectionId = 'custody' | 'allowlist' | 'hwm' | 'skin' | 'source' | 'timelock';

export type ProtectionRow = {
  id: ProtectionId;
  label: string;
  met: boolean;
  detail: string;
};

export type HoldingRow = {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  balance: bigint;
  cost: bigint;
  kind: 'eth' | 'weth' | 'asset';
};

export type BlotterRow = {
  asset: `0x${string}`;
  side: number;
  timestamp: number;
  size: bigint;
  price: bigint;
  navAfter: bigint;
};

export type FundInvestView = {
  mandateHash: `0x${string}`;
  /** Where the mandate text lives. Empty on funds created before the mandate URI was stored. */
  mandateUri: string;
  universeHash: `0x${string}`;
  weth: `0x${string}`;
  allowlist: `0x${string}`;
  nav: bigint;
  navPerNft: bigint;
  /** False when the vault read reverted. A zero figure is not a price in that case. */
  navKnown: boolean;
  /** Unix time of the last hourly NAV checkpoint, 0 when no checkpoint has been written yet. */
  lastNavCheckpoint: number;
  lastCheckpointNavPerNft: bigint;
  spendableEth: bigint;
  claimableFees: bigint;
  swapsPaused: boolean;
  allowlistPaused: boolean;
  timelockDelay: bigint;
  investBlock: bigint;
  assets: `0x${string}`[];
  holdings: HoldingRow[];
  routers: `0x${string}`[];
  trades: BlotterRow[];
  protectionBits: number;
  isExecutor: boolean;
};

export type SwapMode = 'buy' | 'sell' | 'wrap' | 'unwrap';

export type SwapCall = {
  router: `0x${string}`;
  assetIn: `0x${string}`;
  assetOut: `0x${string}`;
  amountIn: bigint;
  minAmountOut: bigint;
  data: `0x${string}`;
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; message: string };

const ROWS: { id: ProtectionId; bit: number; label: string }[] = [
  { id: 'custody', bit: PROTECTION_BITS.custody, label: 'Money stays in the vault' },
  { id: 'allowlist', bit: PROTECTION_BITS.allowlist, label: 'Approved tokens only (allowlist)' },
  { id: 'hwm', bit: PROTECTION_BITS.hwm, label: 'Fees only on new highs (high-water mark)' },
  { id: 'skin', bit: PROTECTION_BITS.skin, label: 'Manager invested before others' },
  { id: 'source', bit: PROTECTION_BITS.source, label: 'Public code' },
  { id: 'timelock', bit: PROTECTION_BITS.timelock, label: 'Waiting period for changes (timelock)' },
];

function detailFor(id: ProtectionId, met: boolean, phase2: boolean): string {
  if (id === 'custody') {
    return met
      ? 'The vault has no way to send the money raised to any wallet, including the manager\'s.'
      : 'This fund does not record that the money is locked in the vault.';
  }
  if (id === 'allowlist') {
    if (!met) return phase2 ? 'This fund has no approved list of tokens it may buy (the allowlist).' : 'This fund only collects ETH and does not buy tokens.';
    return 'The manager can only trade through approved trading routes and buy tokens from the approved list of tokens the fund may buy (the allowlist).';
  }
  if (id === 'hwm') return met ? 'The manager only takes fees when fund value per share reaches a new high (the high-water mark).' : 'Not in this version.';
  if (id === 'skin') {
    return met ? 'The manager bought their required shares with their own ETH.' : 'The manager has not bought their required shares yet.';
  }
  if (id === 'source') return 'The contract code is public so anyone can read it. Unaudited.';
  if (!met) return phase2 ? 'Changes to the approved list wait less than one day.' : 'Not in this version.';
  return 'Changes to the approved list only take effect after a waiting period of at least one day (the timelock). Pausing trading works right away.';
}

/** Score the protections this fund actually exposes. High-water mark stays off unless the vault sets that bit. */
export function fundProtections(input: { bits: number | null; skinMet: boolean }): {
  rows: ProtectionRow[];
  met: number;
  total: number;
} {
  const phase2 = input.bits !== null;
  const rows = ROWS.map((row) => {
    const met = phase2 ? (input.bits! & row.bit) !== 0 : row.id === 'custody' || row.id === 'source' || (row.id === 'skin' && input.skinMet);
    return { id: row.id, label: row.label, met, detail: detailFor(row.id, met, phase2) };
  });
  return { rows, met: rows.filter((row) => row.met).length, total: PROTECTION_TOTAL };
}

export function tapePoints(
  newestFirst: { t: number; nav: bigint }[],
  now: { t: number; nav: bigint },
): { t: number; nav: bigint }[] {
  const rows = [...newestFirst].reverse();
  const last = rows[rows.length - 1];
  if (!last || last.t !== now.t || last.nav !== now.nav) rows.push(now);
  return rows;
}

/** `priceWad` is quote wei per 1e18 raw token units, matching NAVReader.price. */
export function quotePerToken(priceWad: bigint, decimals: number): bigint {
  if (decimals < 0 || decimals > 36) return priceWad;
  if (decimals >= 18) return priceWad * 10n ** BigInt(decimals - 18);
  return priceWad / 10n ** BigInt(18 - decimals);
}

export function parseTokenAmount(raw: string, decimals: number): Ok<{ amount: bigint }> | Err {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: 'Enter an amount.' };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, message: 'Use a plain number.' };
  const places = Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18;
  const frac = trimmed.split('.')[1] ?? '';
  if (frac.length > places) return { ok: false, message: `Use at most ${places} decimal places.` };
  try {
    const amount = parseUnits(trimmed, places);
    if (amount <= 0n) return { ok: false, message: 'Enter an amount greater than zero.' };
    return { ok: true, amount };
  } catch {
    return { ok: false, message: 'That amount is not valid.' };
  }
}

export function parseRouterData(raw: string): Ok<{ data: `0x${string}` }> | Err {
  const text = raw.trim();
  if (text === '' || text === '0x') return { ok: true, data: '0x' };
  if (!/^0x[0-9a-fA-F]*$/.test(text) || text.length % 2 !== 0) {
    return { ok: false, message: 'Router data must be hex, or leave it blank.' };
  }
  return { ok: true, data: text as `0x${string}` };
}

function isAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function buildSwap(input: {
  mode: SwapMode;
  quote: 'eth' | 'weth';
  weth: `0x${string}`;
  asset: `0x${string}`;
  router: string;
  amountIn: bigint;
  minAmountOut: bigint;
  data: `0x${string}`;
}): Ok<{ call: SwapCall }> | Err {
  if (input.amountIn <= 0n) return { ok: false, message: 'Enter an amount greater than zero.' };
  if (input.mode === 'wrap' || input.mode === 'unwrap') {
    const assetIn = input.mode === 'wrap' ? ZERO_ADDRESS : input.weth;
    const assetOut = input.mode === 'wrap' ? input.weth : ZERO_ADDRESS;
    return {
      ok: true,
      call: {
        router: ZERO_ADDRESS,
        assetIn,
        assetOut,
        amountIn: input.amountIn,
        minAmountOut: input.amountIn,
        data: '0x',
      },
    };
  }
  if (input.minAmountOut <= 0n) return { ok: false, message: 'Enter a minimum amount back to the vault.' };
  if (!isAddress(input.router) || input.router.toLowerCase() === ZERO_ADDRESS) {
    return { ok: false, message: 'Choose an allowlisted router.' };
  }
  const quote = input.quote === 'eth' ? ZERO_ADDRESS : input.weth;
  if (input.asset.toLowerCase() === quote.toLowerCase() || input.asset === ZERO_ADDRESS) {
    return { ok: false, message: 'Choose an allowlisted asset.' };
  }
  return {
    ok: true,
    call: {
      router: input.router,
      assetIn: input.mode === 'buy' ? quote : input.asset,
      assetOut: input.mode === 'buy' ? input.asset : quote,
      amountIn: input.amountIn,
      minAmountOut: input.minAmountOut,
      data: input.data,
    },
  };
}
