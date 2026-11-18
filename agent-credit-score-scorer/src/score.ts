/**
 * Pure scoring math for the Agent Credit Score (a FICO for agents, 300-850).
 *
 * This module has no chain access and no side effects, so it is unit-tested
 * in isolation (tests/score.test.ts). The weighted total mirrors the
 * on-chain `AgentScore.weightedScore` exactly (same integer math), so a
 * score computed here is always accepted by `updateScore`.
 *
 * Component order everywhere: [performance, history, activity, stake, conduct].
 * Each component is 0-1000. Weights: Performance 35, History 20, Activity 15,
 * Stake 15, Conduct 15. Score = 300 + (weighted sum * 550) / 100000.
 * All-zero components give 300; all-1000 give 850.
 *
 * Vouching (others staking on an agent) is deferred to Phase 2 and is NOT
 * part of the v1 Stake component. In v1, Stake is the agent's OWN committed
 * POLYDASH: its registration bond (1,000) + what it staked in the staking
 * pools.
 */

export const MIN_SCORE = 300;
export const MAX_SCORE = 850;
export const MAX_COMPONENT = 1000;

export const WEIGHTS = {
  performance: 35,
  history: 20,
  activity: 15,
  stake: 15,
  conduct: 15,
} as const;

export type Components = {
  performance: number;
  history: number;
  activity: number;
  stake: number;
  conduct: number;
};

export function clampComponent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MAX_COMPONENT, Math.floor(v)));
}

/**
 * Canonical total from the five components. Integer math, identical to
 * AgentScore.weightedScore: score = 300 + floor(W * 550 / 100000), where
 * W = 35*perf + 20*hist + 15*act + 15*stake + 15*conduct.
 */
export function weightedScore(c: Components): number {
  const w =
    WEIGHTS.performance * clampComponent(c.performance) +
    WEIGHTS.history * clampComponent(c.history) +
    WEIGHTS.activity * clampComponent(c.activity) +
    WEIGHTS.stake * clampComponent(c.stake) +
    WEIGHTS.conduct * clampComponent(c.conduct);
  return MIN_SCORE + Math.floor((w * 550) / 100_000);
}

/** Band: 0 New (<500), 1 Building (500-599), 2 Standard (600-699),
 *  3 Prime (700-799), 4 Elite (800-850). Mirrors AgentScore.bandForScore. */
export function bandForScore(score: number): number {
  if (score >= 800) return 4;
  if (score >= 700) return 3;
  if (score >= 600) return 2;
  if (score >= 500) return 1;
  return 0;
}

export const BAND_NAMES = ['New', 'Building', 'Standard', 'Prime', 'Elite'] as const;

/**
 * Performance: risk-adjusted NAV growth of the agent's funds vs. holding
 * ETH, over the last 30 days. The fund NAV is denominated in ETH, so the
 * navPerNft return IS the return vs. holding ETH (no separate ETH price
 * feed needed). `returnBps` is the aggregate navPerNft return in basis
 * points across the agent's funds (NAV-weighted). `hasFunds` is false when
 * the agent manages no fund with NAV history — a new agent scores 0 here.
 * Mapping: <= -2000 bps (-20%) -> 0; >= +5000 bps (+50%) -> 1000; linear.
 */
export function performanceScore(returnBps: number | null, hasFunds: boolean): number {
  if (!hasFunds || returnBps === null || !Number.isFinite(returnBps)) return 0;
  if (returnBps <= -2000) return 0;
  if (returnBps >= 5000) return 1000;
  return clampComponent(((returnBps + 2000) * 1000) / 7000);
}

/**
 * History: longevity + consistency. daysActive counts days since the agent
 * registered; fundsManaged counts funds it created. Days contribute up to
 * 500 (100 days), funds up to 500 (5 funds). A brand-new agent scores 0.
 */
export function historyScore(daysActive: number, fundsManaged: number): number {
  const daysPart = Math.min(500, Math.max(0, daysActive) * 5);
  const fundsPart = Math.min(500, Math.max(0, fundsManaged) * 100);
  return clampComponent(daysPart + fundsPart);
}

/**
 * Activity: real usage in the last 30 days — proposals made, trades
 * executed, token launches, funds created. Each action counts once.
 * 20 actions in 30 days saturates the component.
 */
export function activityScore(actions30d: number): number {
  return clampComponent(Math.max(0, actions30d) * 50);
}

/**
 * Stake: the agent's OWN committed POLYDASH, in whole tokens — its
 * registration bond (1,000) + what it staked in the staking pools.
 * 100,000 POLYDASH committed saturates the component. Vouching (others
 * staking on the agent) is Phase 2 and is NOT counted here.
 */
export function stakeScore(polydashCommitted: number): number {
  return clampComponent(Math.floor(Math.max(0, polydashCommitted) / 100));
}

/**
 * Conduct: starts neutral at 500 for an agent with no proposal history
 * (innocent until it has a record, but not perfect). Clean proposals
 * (executed at/after their 2-day readyAt) earn +50 each, up to +500.
 * A wait violation (executed before readyAt) costs -200 each, capped at
 * -600. A holder exit (fund NFT burned) inside a proposal's wait window
 * costs -25 each, capped at -250. Dividends paid are a positive signal and
 * count as clean conduct (+50 per distribution round, within the same
 * +500 cap as clean proposals).
 */
export function conductScore(args: {
  cleanProposals: number;
  waitViolations: number;
  exitsDuringWait: number;
  distributions: number;
}): number {
  const cleanBonus = Math.min(500, (Math.max(0, args.cleanProposals) + Math.max(0, args.distributions)) * 50);
  const violationPenalty = Math.min(600, Math.max(0, args.waitViolations) * 200);
  const exitPenalty = Math.min(250, Math.max(0, args.exitsDuringWait) * 25);
  return clampComponent(500 + cleanBonus - violationPenalty - exitPenalty);
}
