// Server-only: first-paint readers for /funds, /stake, /terminal (Nov 26).
//
// The three pages used to render a shell and let the browser fetch the
// on-chain figures after hydration — on a cold start that meant several
// seconds of "Loading tokenized funds…" / "Updating…" skeletons while the
// chain reads ran. The pages now read the same figures here, on the server,
// and hand them to the client hooks as initial data, so first paint carries
// real numbers. The underlying reads are cached server-side (30s for the
// fund lists, activity scan and NAVs; 60s for staking and TVL — see the
// in-module caches in lib/fund/list-server.ts, lib/terminal/server.ts,
// lib/staking/server.ts and lib/total-tvl.ts), so the figures stay fresh
// within that TTL; the client hooks keep refetching in the background on
// their usual intervals. (export const revalidate = 30 on the pages is
// inert while the root layout forces dynamic rendering — the freshness
// comes from those caches, not ISR; if force-dynamic is ever lifted, ISR
// takes over.)
//
// Every read is bounded by a timeout and falls back to null: a slow or
// failed chain read must never block the page render or fail the build —
// with no initial data the client hooks fetch exactly as before. Never
// import this file from client code.
import { readFundsList } from '@/lib/fund/list-server';
import type { FundsListWire } from '@/lib/fund/list-wire';
import { getStakingOverview } from '@/lib/staking/server';
import type { PoolsResponse } from '@/lib/staking/shared';
import { readNavs, scanTerminalActivity, type VaultNavs } from '@/lib/terminal/server';
import { activityToWire, type ActivityWire } from '@/lib/terminal/activity-wire';
import { getTotalTvl, type TotalTvl } from '@/lib/total-tvl';

/** The funds-list read is bounded by the same 8s the /api/funds/list route uses. */
const FUNDS_WAIT_MS = 8_000;
/** First attempt at the funds list gets half the budget; a fast RPC rejection then still leaves room for one retry (below). */
const FUNDS_FIRST_WAIT_MS = 4_000;
/** The staking overview scan is bounded by the same 8s the /api/stake/pools route uses. */
const STAKE_WAIT_MS = 8_000;
/**
 * The full overview (pools + event analytics) gets a short bound: on a
 * warm instance it answers in milliseconds, on a cold instance the event
 * scan alone burns 5s and the pools would miss the page.
 */
const STAKE_FULL_WAIT_MS = 4_000;

/** A promise that never settles — used to drop a timed-out attempt out of a race. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}
/** The Terminal activity scan alone takes ~5.4s against the live RPC, so the Terminal read gets a longer bound. */
const TERMINAL_WAIT_MS = 12_000;

/** Race a promise against a timeout; a slow read or a rejection both yield null. */
function bounded<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]).catch(() => null);
}

/**
 * The funds-list read, with one retry inside the same 8s budget. The
 * official RPC rejects a cold funds-list read about half the time (two
 * failed first paints on Production/Preview, Nov 26) and a rejection must
 * not wipe first paint: the retry usually lands (the warm request seconds
 * later always did). A slow-but-healthy read is not duplicated — the
 * in-module cache dedupes the in-flight read, so the retry just waits for
 * it to finish. Worst case is unchanged (8s, then the client fetch).
 */
async function readFundsListWithRetry(): Promise<FundsListWire | null> {
  const first = await bounded(readFundsList(), FUNDS_FIRST_WAIT_MS);
  if (first) return first;
  return bounded(readFundsList(), FUNDS_WAIT_MS - FUNDS_FIRST_WAIT_MS);
}

/** All four fund lists (Phase 3, V2, V3, legacy), for /funds and /terminal. */
export async function getInitialFundsWire(): Promise<FundsListWire | null> {
  return readFundsListWithRetry();
}

/** Total TVL (staking + fund vaults, priced on-chain), for /funds. */
export async function getInitialTvl(): Promise<TotalTvl | null> {
  return bounded(getTotalTvl(), FUNDS_WAIT_MS);
}

/**
 * The unfiltered staking overview, for /stake. The full read (pools +
 * event analytics) races the light read (pools only — the analytics
 * arrive via the client hook's 4s refetch once the scan completes) and
 * the first one that returns pools wins: on a warm instance the full read
 * wins in milliseconds with everything; on a cold instance the light read
 * wins as soon as the pools answer (~2s) instead of waiting out the
 * event scan. A timed-out attempt drops out of the race; the overall 8s
 * bound falls back to the client fetch. The losing attempt keeps running
 * in the background and warms the cache. Either attempt may come back
 * null (a slow or failed chain read) and the client hooks fetch exactly
 * as before.
 */
export async function getInitialStakeOverview(): Promise<PoolsResponse | null> {
  return Promise.race([
    bounded(getStakingOverview(), STAKE_FULL_WAIT_MS).then((v) => (v ? v : never<PoolsResponse>())),
    bounded(getStakingOverview(undefined, { skipEvents: true }), STAKE_WAIT_MS).then((v) => (v ? v : never<PoolsResponse>())),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), STAKE_WAIT_MS)),
  ]);
}

export type InitialTerminal = {
  wire: FundsListWire;
  activity: ActivityWire;
  navs: VaultNavs | null;
};

/**
 * Everything /terminal needs on first paint: the fund lists, the 24h
 * activity scan, and the NAVs per vault. The activity scan and the NAV read
 * run in parallel once the lists answer; the NAVs may come back null (a
 * slow chain read) while the rest still seeds the page. The activity scan
 * never comes back null: its trade read fails whenever the official RPC
 * rejects it (twice during the Preview check, Nov 26) and a failed scan
 * must not wipe the whole first paint — the fallback is an empty,
 * degraded activity object, so the funds + NAVs still paint with real
 * figures, the activity sections render their empty state, and the client
 * hook's background refetch fills in the rows when the RPC recovers.
 */
export async function getInitialTerminal(): Promise<InitialTerminal | null> {
  const wire = await readFundsListWithRetry();
  if (!wire) return null;
  const funds = [...wire.v3, ...wire.v2, ...wire.phase3];
  const addresses = funds.map((f) => f.address);
  const vaults = funds.map((f) => f.vault);
  const [activity, navs] = await Promise.all([
    bounded(scanTerminalActivity(addresses), TERMINAL_WAIT_MS).then((a) => (a ? activityToWire(a) : null)),
    bounded(readNavs(vaults), FUNDS_WAIT_MS),
  ]);
  return {
    wire,
    activity: activity ?? { rows: [], ticker: [], updatedAt: Date.now(), degraded: true },
    navs,
  };
}
