// Agent-earn pilot board — fixed facts (Jon, Nov 27, 2026).
// The escrow + panel multisig are DEPLOYED on Robinhood Chain 4663 and
// Sourcify-verified (exact_match). These are real addresses, never
// placeholders. Do not change them without a redeploy + a new review.

/** AgentEarnEscrowV2 — deployed Nov 28, 2026, Sourcify exact_match.
 * v2: assigned-agent claims (poster names the agent at lock; only that
 * address can claim). Replaces v1 0xb0A3fE7240a0b1a10177651FE985c3FDbB9dda7c,
 * whose permissionless claim() let any address claim a job and submit a
 * fake delivery. v1 holds 0 USDG and is unused. */
export const AGENT_EARN_ESCROW_ADDRESS = '0x4fce4b5f7f3ce323861883a2449b172ca792918b' as const;
/** Panel executor — 2-of-3 Safe proxy (singleton v1.3.0), deployed Nov 27, 2026. */
export const AGENT_EARN_PANEL_EXECUTOR = '0xB33F146d25C85F9E1ECaf0E82691CB1335fF521d' as const;
/** Settlement token: USDG (6 decimals). */
export const AGENT_EARN_TOKEN = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
/** Fee recipient: the Polypad fee wallet. */
export const AGENT_EARN_FEE_RECIPIENT = '0x9a21c75aC263cC43125E70200636f6397f8776d0' as const;
/** Platform fee, 2.5% (250 bps) — snapshotted into each lock at lock time. */
export const AGENT_EARN_FEE_BPS = 250 as const;
export const AGENT_EARN_BPS_DENOMINATOR = 10_000 as const;
/** USDG has 6 decimals. */
export const AGENT_EARN_TOKEN_DECIMALS = 6 as const;

/** Minimum job price, board-enforced (the contract has no minimum): $10. */
export const MIN_JOB_PRICE_USD = 10 as const;
export const MIN_JOB_PRICE_USDG_UNITS = 10_000_000n;
/** Maximum job price for the pilot, board-enforced: $500. */
export const MAX_JOB_PRICE_USD = 500 as const;
export const MAX_JOB_PRICE_USDG_UNITS = 500_000_000n;

/** Poster accept/dispute window after delivery: 72 hours. */
export const DISPUTE_WINDOW_SECONDS = 72 * 3600;
/** Evaluator panel size (contract PANEL_SIZE). */
export const PANEL_SIZE = 3 as const;
/** Minimum credit score to evaluate a dispute. */
export const EVALUATOR_MIN_SCORE = 300 as const;
/** Evaluator pay per dispute, flat, Polypad-funded, paid off-chain. */
export const EVALUATOR_PAY_USD = 2 as const;
/** Max uncompleted claims per agent at a time (pilot default, brief §4). */
export const MAX_CONCURRENT_CLAIMS = 1 as const;
/** Pilot size: 5 curated jobs, invited posters. */
export const PILOT_JOB_LIMIT = 5 as const;

/** Job states. The on-chain lock state is the source of truth for money;
 * these off-chain states track the board flow (screening, dispute, panel).
 * A job is only visible on the public board once screened-in AND locked. */
export const JOB_STATUSES = [
  'pending_screening',
  'screened_out',
  'screened_in',
  'locked',
  'claimed',
  'delivered',
  'disputed',
  'panel',
  'settled',
  'refunded',
  'lapsed',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** States in which a job shows on the public board. */
export const BOARD_VISIBLE_STATUSES: JobStatus[] = ['locked', 'claimed'];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending_screening: 'Awaiting screening',
  screened_out: 'Not listed',
  screened_in: 'Approved — awaiting lock',
  locked: 'Open',
  claimed: 'Claimed',
  delivered: 'Delivered — awaiting decision',
  disputed: 'Disputed — panel forming',
  panel: 'Panel deciding',
  settled: 'Settled',
  refunded: 'Refunded',
  lapsed: 'Lapsed',
};

/** Panel outcomes (contract Outcome enum, minus None). */
export const PANEL_OUTCOMES = ['PayFull', 'PayPart', 'NoPay'] as const;
export type PanelOutcome = (typeof PANEL_OUTCOMES)[number];

/** The honest line, required on the pilot page (brief §3). */
export const EARN_DISCLOSURE =
  'Security-scanned, not a formal audit. Use at your own risk. Not financial advice.';
