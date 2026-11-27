// POLYDASH buybacks + POLYDASH Rewards Pool: config, limits, labels and copy.
// Contract ABIs, bytecode and constructor args live in lib/buybackArtifacts.ts (owner file, never retype).
import { formatEther } from 'viem';
import { gasLimit } from '@/lib/nftStaking';
import { BUYBACK_LIMITS, BUYBACK_VAULT_EXPECTED_ADDRESS, REWARDS_POOL_EXPECTED_ADDRESS } from '@/lib/buybackArtifacts';

export type Addr = `0x${string}`;

export const REWARDS_POOL_ADDRESS: `0x${string}` | null = null;
export const REWARDS_POOL_DEPLOY_BLOCK: bigint | null = null;
export const BUYBACK_VAULT_ADDRESS: `0x${string}` | null = null;
export const BUYBACK_VAULT_DEPLOY_BLOCK: bigint | null = null;
export const LAUNCH_FACTORIES = ["0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2", "0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2"] as const;
export const PLATFORM_FEE_WALLET = "0x9a21c75aC263cC43125E70200636f6397f8776d0";
export const POLYDASH = "0x319525528f42167eF7fC18b77b889958080568e4";

export const DEAD = '0x000000000000000000000000000000000000dEaD';
export const ZERO = '0x0000000000000000000000000000000000000000' as Addr;
export const vaultAddress = (): Addr | null => BUYBACK_VAULT_ADDRESS as Addr | null;
export const poolAddress = (): Addr | null => REWARDS_POOL_ADDRESS as Addr | null;
export const buybackLive = () => !!vaultAddress();
export const poolLive = () => !!poolAddress();
export const isZeroAddr = (a?: string | null) => !a || /^0x0{40}$/i.test(a);
export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '-');

export const DEPLOYER_HINT = '0x89df…53F1';
export const POOL_EXPECTED = REWARDS_POOL_EXPECTED_ADDRESS as Addr;
export const VAULT_EXPECTED = BUYBACK_VAULT_EXPECTED_ADDRESS as Addr;
export const POOL_NONCE = 49;
export const VAULT_NONCE = 50;

// Gas: max(estimate x 1.5, floor). Unused gas is not charged.
export const WRITE_GAS_FLOOR = BigInt(1_000_000);
export const POOL_DEPLOY_GAS_FLOOR = BigInt(1_600_000);
export const VAULT_DEPLOY_GAS_FLOOR = BigInt(4_000_000);
export const writeGas = (est: bigint | null) => gasLimit(est, WRITE_GAS_FLOOR);
export const poolDeployGas = (est: bigint | null) => gasLimit(est, POOL_DEPLOY_GAS_FLOOR);
export const vaultDeployGas = (est: bigint | null) => gasLimit(est, VAULT_DEPLOY_GAS_FLOOR);

// Factory target setting
export const TARGET_BPS = 4000;

// Expected read-backs after deploy
export const EXPECTED_POOL_ID = '0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5';
export const EXPECTED_POOL_FEE_BPS = 120;
export const EXPECTED_BURN_SHARE_BPS = 6250;
export const EXPECTED_MAX_BUY_WEI = BigInt('20000000000000000');

export const POOL_ARG_LABEL = 'Stake and reward token: POLYDASH';
export const VAULT_ARG_LABELS: { key: string; label: string; fmt?: 'eth' | 'bps' | 'fee' }[] = [
  { key: 'poolManager', label: 'Uniswap V4 PoolManager' },
  { key: 'weth', label: 'WETH' },
  { key: 'polydash', label: 'POLYDASH' },
  { key: 'hook', label: 'POLYDASH pool hook' },
  { key: 'poolFee', label: 'Pool fee (dynamic)', fmt: 'fee' },
  { key: 'tickSpacing', label: 'Tick spacing' },
  { key: 'factoryA', label: 'Launch factory A' },
  { key: 'factoryB', label: 'Launch factory B' },
  { key: 'maxBuyEth', label: 'Max ETH per buy', fmt: 'eth' },
  { key: 'maxSlippageBps', label: 'Max slippage', fmt: 'bps' },
  { key: 'maxPoolFeeBps', label: 'Max pool fee assumed', fmt: 'bps' },
  { key: 'burnShareBps', label: 'Burned share of each buy (25 of 40)', fmt: 'bps' },
  { key: 'stakingFactory', label: 'Staking factory' },
  { key: 'targetAdmin', label: 'Rewards-target admin (Polydash fee wallet)' },
  { key: 'initialTarget', label: 'Initial rewards target (POLYDASH Rewards Pool)' },
];
export function fmtArg(v: unknown, fmt?: 'eth' | 'bps' | 'fee') {
  if (v == null) return '-';
  if (fmt === 'eth') return `${formatEther(BigInt(v as any))} ETH`;
  if (fmt === 'bps') return `${Number(v) / 100}% (${String(v)} bps)`;
  if (fmt === 'fee') return `${String(v)} (dynamic fee flag)`;
  return String(v);
}

export const LIMITS = BUYBACK_LIMITS;
export const STEP_LABELS: Record<number, string> = { 0: 'Nothing to do', 1: 'Record price', 2: 'Wait', 3: 'Buy' };
/** Received.source enum. Assumed order: 0 Factory, 1 Manual, 2 Direct; anything else is Direct/Other. */
export const sourceKey = (s: number): 'factory' | 'manual' | 'direct' => (s === 0 ? 'factory' : s === 1 ? 'manual' : 'direct');
export const SOURCE_LABELS = { factory: 'Factory', manual: 'Manual', direct: 'Direct/Other' } as const;

export const ERRORS: Record<string, string> = {
  NothingPending: 'There is no ETH waiting in the vault.',
  Cooldown: 'The last buy was less than 10 minutes ago. Try again later.',
  NoFreshObservation: 'Record a price first. A recorded price is valid for 60 minutes.',
  ObservationNotDue: 'Wait 5 minutes after the recorded price before buying.',
  PriceMoved: 'Price moved more than 2% since it was recorded. Record a new price later.',
  Slippage: 'The buy would exceed the 3% slippage limit.',
  NoActiveTarget: 'There is no active rewards target.',
  TargetActive: 'A rewards target is active, so held POLYDASH cannot be burned.',
  TooEarly: 'Too early. Check the countdown.',
  Nothing: 'Nothing to do.',
  NoPending: 'There is no pending target change.',
  TimelockActive: 'The 48-hour timelock has not ended yet.',
  NotTargetAdmin: 'Only the Polydash fee wallet can do this.',
  InvalidTarget: 'Not a valid target: must be a POLYDASH staking pool from the Polydash staking factory with POLYDASH rewards and at least 1 day left',
  InvalidParams: 'Invalid parameters.',
  ZeroAmount: 'Enter an amount above zero.',
  Insufficient: 'The amount is more than your stake.',
  OwnableUnauthorizedAccount: 'Only the factory owner can change this.',
};

export function errorName(e: any): string | undefined {
  let x = e;
  for (let i = 0; i < 6 && x; i++) {
    if (x?.data?.errorName) return x.data.errorName;
    x = x.cause;
  }
  return undefined;
}
export const errorText = (e: any) => {
  const n = errorName(e);
  return (n && ERRORS[n]) || (n ? `Transaction would fail: ${n}` : '') || e?.shortMessage || e?.message || 'Transaction failed';
};

export const sourcifyUrl = (a: string) => `https://repo.sourcify.dev/4663/${a}`;
export const blockscoutAddr = (a: string) => `https://robinhoodchain.blockscout.com/address/${a}`;
export const blockscoutTx = (h: string) => `https://robinhoodchain.blockscout.com/tx/${h}`;

/** Formats a unix timestamp (seconds) in Pacific time with a "PT" label. */
export function fmtPT(ts: number | null | undefined, withTime = true) {
  if (!ts) return '-';
  const s = new Date(ts * 1000).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
  return withTime ? `${s} PT` : s;
}
/** Pacific-time calendar date (YYYY-MM-DD) for chart buckets. */
export function ptDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export function fmtToken(wei: string | bigint | null | undefined, digits = 4) {
  if (wei == null) return '0';
  const n = Number(formatEther(BigInt(wei)));
  if (n === 0) return '0';
  if (n < 0.0001) return '<0.0001';
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : digits });
}

// ---------- Copy ----------
export const SPLIT_PHRASE = '40% of fees go to buybacks: 25% burned, 15% to stakers';
export const NOT_AUDITED = 'New contract. Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.';
export const NOT_LIVE_VAULT = 'Buyback tracking starts when the buyback vault goes live.';
export const NOT_LIVE_POOL = 'The POLYDASH Rewards Pool opens when its contract goes live.';
export const DEPLOY_VAULT_FIRST = 'Deploy the vault first';
export const WHAT_IT_DOES = 'The vault uses ETH it holds to buy POLYDASH on-chain within these limits; part is burned and part goes to stakers.';
export const RUN_EXPLAIN = 'The vault first records the pool price. After 5 minutes and within 60 minutes, anyone can run the buy. It only runs if the price is within 2% of the recorded price, spends at most 0.02 ETH, and stops at the 3% slippage limit. 62.5% of the POLYDASH bought is sent to 0x...dEaD in the same transaction; 37.5% is held for stakers. The caller pays gas and receives nothing.';
export const CONFIG_NOTE = 'The launch factory owner can change the factory setting; the rewards target changes only through a public 48-hour timelock. Every change is listed here.';
export const TARGET_NOTE = 'The initial target is the POLYDASH Rewards Pool. A target must accept reward top-ups. Existing V2 staking pools are funded once and cannot receive top-ups.';
export const SET_CONFIRM = '40% of platform fees from this factory will go to the buyback vault at each fee collection.';
export const POOL_NOTE = 'This is not interest from a bank. Rewards only arrive when Polypad earns fees and buys back POLYDASH. Some weeks that is zero. New contract. Security-scanned with Bevor. Not a formal audit. Not financial advice.';
export const APR_NOTE = 'Changes with every top-up and every stake or unstake. Not a projection.';
export const HOW_IT_WORKS = [
  'Polypad launches pay a 0.2% platform fee.',
  'When fees are collected, 40% goes to the buyback vault on-chain; the rest goes to the Polydash fee wallet.',
  'For NFT and staking fees, 40% is sent to the vault weekly and listed above.',
  "Anyone can run a capped buy of POLYDASH with the vault's ETH.",
  'Of each buy, 25 parts of 40 are burned to 0x000000000000000000000000000000000000dEaD in the same transaction and 15 parts of 40 go to POLYDASH stakers through the rewards target.',
  "If there is no active rewards target, the stakers' share is held; after 30 days without one, anyone can burn it.",
];
