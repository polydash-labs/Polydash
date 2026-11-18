// Treasury rules (creator-owned, non-custodial treasury tasks): config, gas, labels, decoding and copy. Isomorphic, no RPC.
// ABIs and bytecode live in lib/treasuryArtifacts.ts (owner's file, never retyped).
import { decodeAbiParameters, formatEther, formatUnits, parseAbiParameters, type Hex } from 'viem';
import { gasLimit, isAddr, type Addr } from '@/lib/nftStaking';
import { TREASURY_CHANGE_KIND, TREASURY_DEAD, TREASURY_RULES_TUPLE } from '@/lib/treasuryArtifacts';

export { gasLimit, isAddr };
export type { Addr };

/** Set to the deployed treasury rules factory address to turn the feature on. While null, the token-page panel and setup entry points are hidden, /treasury/* shows TREASURY_NOT_LIVE and /api/treasury/[token] returns {live:false}. */
export const TREASURY_FACTORY_ADDRESS: `0x${string}` | null = '0x2a06dafed9a5cabc7693683e24025f96d7af656f';
export const TREASURY_CONTRACT_URL = 'https://repo.sourcify.dev/4663/0x2A06dafEd9A5CaBC7693683E24025f96D7AF656f';

export const treasuryFactory = (): Addr | null => {
  const a = TREASURY_FACTORY_ADDRESS as string | null;
  return a ? (a.toLowerCase() as Addr) : null;
};
export const treasuryLive = () => !!TREASURY_FACTORY_ADDRESS;
export const sourcifyUrl = (a: string) => `https://repo.sourcify.dev/4663/${a}`;

/** Every write: gas = max(estimate x 1.5, 4,000,000). */
export const GAS_FLOOR = BigInt(4_000_000);
export const treasuryGas = (estimate: bigint | null) => gasLimit(estimate, GAS_FLOOR);

export const DEAD = TREASURY_DEAD.toLowerCase() as Addr;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Addr;
export const isZero = (a?: string | null) => !a || /^0x0{40}$/i.test(a);
export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const POLYDASH_TOKEN_ADDRESS = '0x319525528f42167ef7fc18b77b889958080568e4' as Addr;
export const isPolydashToken = (a?: string | null) => sameAddr(a, POLYDASH_TOKEN_ADDRESS);

// Limits (mirror the contract's checks; the contract stays the source of truth)
export const DAY = 86_400;
export const HOUR = 3_600;
export const MAX_INTERVAL = 30 * DAY;
export const MIN_SLIPPAGE_BPS = 10;
export const MAX_SLIPPAGE_BPS = 3_000;
export const DEFAULT_SLIPPAGE_BPS = 500;
export const MIN_POOL_DAYS = 1;
export const MAX_POOL_DAYS = 3_650;
export const MIN_POOL_FEE_BPS = 100;
export const MAX_POOL_FEE_BPS = 500;
export const MAX_EXECUTORS = 20;
export const DEFAULT_DELAY = 48 * HOUR;
export const MIN_DELAY = 24 * HOUR;
export const MAX_DELAY = 30 * DAY;
export const MIN_CLAIM_DAYS = 1;
export const MAX_CLAIM_DAYS = 365;
export const INTERVAL_PRESETS = [
  { value: HOUR, label: '1 hour' },
  { value: 6 * HOUR, label: '6 hours' },
  { value: DAY, label: '24 hours' },
];

export interface RulesTuple {
  maxEthPerDay: bigint; maxEthPerBuyback: bigint; minInterval: number; maxSlippageBps: number;
  burnBought: boolean; openExecution: boolean; minTokensPerEth: bigint; maxAirdropPerRound: bigint;
  maxPoolReward: bigint; poolMinInterval: number; poolDuration: number; poolClaimFeeBps: number; poolMaxTotalStake: bigint;
}
/** JSON form (bigints as strings) used by the API. */
export type RulesJson = { [K in keyof RulesTuple]: RulesTuple[K] extends bigint ? string : RulesTuple[K] };

export const RULE_FIELDS = [
  'maxEthPerDay', 'maxEthPerBuyback', 'minInterval', 'maxSlippageBps', 'burnBought', 'openExecution', 'minTokensPerEth',
  'maxAirdropPerRound', 'maxPoolReward', 'poolMinInterval', 'poolDuration', 'poolClaimFeeBps', 'poolMaxTotalStake',
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_LABELS: Record<RuleField, string> = {
  maxEthPerDay: 'Max ETH per day',
  maxEthPerBuyback: 'Max ETH per buyback',
  minInterval: 'Minimum time between buybacks',
  maxSlippageBps: 'Max slippage',
  burnBought: 'Bought tokens',
  openExecution: 'Who can trigger actions',
  minTokensPerEth: 'Buyback price limit (min tokens per 1 ETH)',
  maxAirdropPerRound: 'Max airdrop per round',
  maxPoolReward: 'Max reward per pool',
  poolMinInterval: 'Minimum time between reward pools',
  poolDuration: 'Reward pool duration',
  poolClaimFeeBps: 'Reward pool claim fee',
  poolMaxTotalStake: 'Reward pool max total stake',
};

export const fmtDuration = (s: number) => {
  if (!s) return '0';
  if (s % DAY === 0) return `${s / DAY} day${s / DAY === 1 ? '' : 's'}`;
  if (s % HOUR === 0) return `${s / HOUR} hour${s / HOUR === 1 ? '' : 's'}`;
  if (s >= HOUR) return `${(s / HOUR).toFixed(1)} hours`;
  return `${Math.round(s / 60)} min`;
};
export const fmtAmount = (v: bigint | string, decimals = 18, max = 4) => {
  const n = Number(formatUnits(BigInt(v), decimals));
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? max : 8 });
};
export const fmtEth = (v: bigint | string) => `${Number(formatEther(BigInt(v))).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`;
export const fmtDateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

/** Human value for one rule field. */
export function fmtRule(field: RuleField, v: unknown, decimals: number, symbol: string): string {
  switch (field) {
    case 'maxEthPerDay': return BigInt(v as any) === BigInt(0) ? 'Off (buybacks disabled)' : fmtEth(v as any);
    case 'maxEthPerBuyback': return fmtEth(v as any);
    case 'minInterval': case 'poolMinInterval': case 'poolDuration': return fmtDuration(Number(v));
    case 'maxSlippageBps': return `${Number(v) / 100}% (includes the pool fee)`;
    case 'poolClaimFeeBps': return `${Number(v) / 100}%`;
    case 'burnBought': return v ? 'Burned (sent to 0x...dEaD)' : 'Kept in the treasury';
    case 'openExecution': return v ? 'Anyone' : 'Approved agents only';
    case 'minTokensPerEth': case 'maxAirdropPerRound': case 'maxPoolReward': case 'poolMaxTotalStake': {
      const b = BigInt(v as any);
      return b === BigInt(0) ? 'Off' : `${fmtAmount(b, decimals)} ${symbol}`;
    }
  }
}

const RULES_PARAMS = parseAbiParameters(TREASURY_RULES_TUPLE);
export const kindLabel = (k: number) => (TREASURY_CHANGE_KIND as readonly string[])[k] ?? `Kind ${k}`;

export type DecodedChange =
  | { kind: 0; rules: RulesJson }
  | { kind: 1; asset: Addr; amount: string; to: Addr }
  | { kind: 2; executor: Addr }
  | { kind: 3; delay: number }
  | { kind: 4; root: Hex; total: string; claimWindow: number }
  | { kind: number; raw: Hex };

export const rulesToJson = (r: any): RulesJson => {
  const o: any = {};
  for (const f of RULE_FIELDS) {
    const v = r?.[f];
    o[f] = typeof v === 'bigint' ? (['minInterval', 'maxSlippageBps', 'poolMinInterval', 'poolDuration', 'poolClaimFeeBps'].includes(f) ? Number(v) : v.toString()) : v;
  }
  return o as RulesJson;
};

/** Decodes Change.data by kind. Encoding assumed to be abi.encode of the queue function's arguments; falls back to raw hex. */
export function decodeChange(kind: number, data: Hex): DecodedChange {
  try {
    if (kind === 0) {
      const [r] = decodeAbiParameters(RULES_PARAMS, data) as any;
      return { kind: 0, rules: rulesToJson(r) };
    }
    if (kind === 1) {
      const [asset, amount, to] = decodeAbiParameters(parseAbiParameters('address,uint256,address'), data);
      return { kind: 1, asset: asset.toLowerCase() as Addr, amount: amount.toString(), to: to.toLowerCase() as Addr };
    }
    if (kind === 2) {
      const [e] = decodeAbiParameters(parseAbiParameters('address'), data);
      return { kind: 2, executor: e.toLowerCase() as Addr };
    }
    if (kind === 3) {
      const [d] = decodeAbiParameters(parseAbiParameters('uint64'), data);
      return { kind: 3, delay: Number(d) };
    }
    if (kind === 4) {
      const [root, total, w] = decodeAbiParameters(parseAbiParameters('bytes32,uint256,uint64'), data);
      return { kind: 4, root, total: total.toString(), claimWindow: Number(w) };
    }
  } catch (e) {
    console.error('treasury change decode failed', kind, e);
  }
  return { kind, raw: data };
}

// Plain-word contract errors
export const TREASURY_ERRORS: Record<string, string> = {
  DailyCap: 'This would go over the daily ETH limit for buybacks.',
  PerCallCap: 'This is more than the max ETH per buyback.',
  Interval: 'Too soon. The minimum time since the last action has not passed yet.',
  Slippage: 'The output would be below the minimum allowed by the slippage limit.',
  PriceFloor: 'The buyback price limit was not met: 1 ETH would buy fewer tokens than the set limit.',
  IsPaused: 'The treasury is paused by its owner.',
  NotExecutor: 'This wallet is not an approved agent for this treasury.',
  Insufficient: 'Not enough available balance in the treasury for this.',
  InvalidParam: 'One of the values is outside the allowed range.',
  InvalidRules: 'One of the rule values is outside the allowed range.',
  NotOwner: 'Only the treasury owner can do that.',
  NotTokenCreator: "Only the token's launch creator can set up treasury rules.",
  NotPolydashToken: 'This token was not launched through the Polypad factory.',
  AlreadyExists: 'This token already has treasury rules.',
  ZeroAddress: 'An address field is empty.',
  TooEarly: 'The timelock has not ended yet.',
  AlreadyDone: 'This change was already executed or cancelled.',
  AlreadyClaimed: 'This allocation was already claimed.',
  BadProof: 'The proof does not match this round, account and amount.',
  RoundEnded: 'The claim window for this round has ended.',
  RoundOpen: 'The claim window for this round is still open.',
  Expired: 'This has expired.',
  EthSendFailed: 'The ETH transfer failed.',
  ReentrancyGuardReentrantCall: 'Please try again.',
};

// Copy
export const NOT_AUDITED_NOTE = 'New contract. Security-scanned with Bevor. Not a formal audit. Use at your own risk. Not financial advice.';
export const TREASURY_NOT_LIVE = 'Treasury rules are not live yet';
export const NOT_ELIGIBLE = "Treasury rules are available to a token's launch creator.";
export const TIMELOCK_NOTE = 'Withdrawals, rule changes, new agents and airdrop rounds are public and wait for the timelock before they take effect.';
export const AGENTS_NOTE = 'Agents can only trigger the actions above within these limits. They never receive funds.';
export const POOL_NOTE = 'Each reward pool is a new Polydash staking pool funded from the treasury. Existing pools cannot be topped up.';
export const BUYBACK_NOTE = 'A buyback uses treasury ETH to buy the token on-chain within these limits; bought tokens are burned or kept.';
export const SLIPPAGE_NOTE = 'includes the pool fee';
