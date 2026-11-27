import { formatEther, formatUnits } from 'viem';

export function formatEth(wei: bigint | undefined | null, decimals = 4): string {
  if (wei == null) return '0';
  const val = Number(formatEther(wei));
  if (val === 0) return '0';
  if (val < 0.0001) return '<0.0001';
  return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/** ETH value with enough precision to show small per-share figures exactly (no 0.0001 floor).
 *  Use this for value-per-share and fund totals, never for general ETH amounts. */
export function formatNavEth(wei: bigint | null | undefined): string {
  if (wei == null) return '—';
  const v = Number(formatEther(wei));
  if (v === 0) return '0';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
}

export function formatTokens(wei: bigint | undefined | null, decimals = 18, display = 2): string {
  if (wei == null) return '0';
  const val = Number(formatUnits(wei, decimals));
  if (val === 0) return '0';
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(display)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(display)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(display)}K`;
  return val.toLocaleString('en-US', { maximumFractionDigits: display });
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/**
 * Small numbers without scientific notation. Four or more leading zeros collapse into a
 * subscript count: 0.00000000187 -> "0.0₈187". Larger values use up to `sig` significant digits.
 */
export function formatSmall(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return 'n/a';
  if (v === 0) return '0';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 0.0001) return sign + a.toLocaleString('en-US', { maximumSignificantDigits: sig, useGrouping: false });
  let zeros = Math.floor(-Math.log10(a));
  // `zeros` = zeros right after the decimal point; `digits` = the first `sig` significant digits.
  let digits = Math.round(a * 10 ** (zeros + sig));
  if (digits >= 10 ** sig) { digits = Math.round(digits / 10); zeros -= 1; }
  const sub = String(zeros).split('').map((d) => SUBSCRIPT[Number(d)]).join('');
  const body = String(digits).replace(/0+$/, '') || '0';
  return `${sign}0.0${sub}${body}`;
}

export function formatUsd(val: number | undefined | null): string {
  if (val == null) return '$0';
  if (val > 0 && val < 0.01) return `$${formatSmall(val)}`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
  return `$${val.toFixed(2)}`;
}

export function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (v >= 1) return v.toFixed(2);
  if (v === 0) return '0';
  return formatSmall(v);
}

export function shortenAddress(addr: string | undefined | null): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function bpsToPercent(bps: bigint | number | undefined | null): string {
  if (bps == null) return '0%';
  return `${(Number(bps) / 100).toFixed(2)}%`;
}
