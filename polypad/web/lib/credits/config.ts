/**
 * Poly credits config — read from process.env with safe defaults (spec §5.1).
 * Money is integer cents. Starter $25 = 2500 cents.
 * Invalid values (non-integer, ≤ 0 for starter/cap, < 0 for expiry) fall
 * back to the default; never throws at import time.
 */

function parseIntEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) return fallback;
  return n;
}

/** Per-product prices in integer cents. */
export const POLY_CREDIT_PRICES = {
  "token-report": 1,
  "fund-nav": 1,
  "cto-report": 5,
} as const;

export type PolyCreditProductId = keyof typeof POLY_CREDIT_PRICES;

export const polyCreditsConfig = {
  /** Starter grant amount in cents. Default 2500 ($25). */
  starterCents: parseIntEnv("POLY_CREDITS_STARTER_CENTS", 2500, 1),
  /** Starter grant lifetime in days. Default 180. */
  starterExpiryDays: parseIntEnv("POLY_CREDITS_STARTER_EXPIRY_DAYS", 180, 0),
  /** Whether topups are matched 1:1 (up to the cap). Default false. */
  matchEnabled: process.env.POLY_CREDITS_MATCH_ENABLED === "true",
  /** Total matched cents allowed per account, across all matches. Default 500000 ($5,000). */
  matchCapCents: parseIntEnv("POLY_CREDITS_MATCH_CAP_CENTS", 500000, 1),
} as const;

export type PolyCreditsConfig = typeof polyCreditsConfig;
