/**
 * Polypad agent API v2: constants.
 *
 * Every address here is already recorded in deployments/robinhood-chain.json or docs/DEPLOYMENTS.md,
 * except the Uniswap entries, which come from Uniswap's published Robinhood Chain deployment list.
 * Nothing in this folder reads a private key. The API only returns unsigned transactions.
 */
import { getAddress } from 'viem';

export const API_VERSION = 'v2';
export const CHAIN_ID = 4663;
export const CHAIN_NAME = 'Robinhood Chain';
export const SITE_ORIGIN = 'https://polypad.family';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const NATIVE = '0x0000000000000000000000000000000000000000' as const;

const a = (v: string) => getAddress(v);

export const ADDR = {
  weth: a('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
  polydashToken: a('0x319525528f42167eF7fC18b77b889958080568e4'),
  /** Launch factories: newest listed at the top. Each launch is bound to the hook of the factory that created it. */
  launchFactories: [
    { id: 'current', factory: a('0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2'), hook: a('0x4d3066bBfF889023def912D2fDe36c44357fA0cC') },
    { id: 'earlier', factory: a('0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2'), hook: a('0x04990E6671C98e1B43034E52366Af11396d960CC') },
  ] as const,
  /** Fund factories. All share the same createFund(Params) shape except Phase 1a/2, which are not creatable here. */
  fundFactories: [
    { id: 'phase6', label: 'Tokenized Funds V2 (Phase 6)', factory: a('0xe50Da719947E83f316977d9c425DF95672E7B27e'), creatable: true },
    { id: 'phase3', label: 'Tokenized Funds Phase 3', factory: a('0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B'), creatable: true },
    { id: 'phase2', label: 'Tokenized Funds Phase 2', factory: a('0xd3c6ae470c25989cC8d2876c1855fB570B98894E'), creatable: false },
    { id: 'phase1a', label: 'Tokenized Funds Phase 1a', factory: a('0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878'), creatable: false },
    { id: 'v3', label: 'Tokenized Funds V3', factory: a('0xB5251BaC3CFE2A057B7703D4477Bf80f10B8154B'), creatable: true },
  ] as const,
  strategyTemplates: a('0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba'),
  fundAllowlist: a('0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19'),
  nftFactory: a('0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd'),
  nftCurveFactory: a('0x8bdb1d8Db9aeC18bB464F719d5Bd97cFf8F1Ee94'),
  nftMarket: a('0x4Ff1d0E3Aa767C05b2D9983e14dDbC243CB0120A'),
  stakingFactoryV2: a('0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0'),
  vestingFactory: a('0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022'),
  bondFactory: a('0x876170251e30F99E27119AF0e90648A88D508f97'),
  /** Uniswap deployment on Robinhood Chain (docs.uniswap.org/contracts/v4/deployments). */
  poolManager: a('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
  universalRouter: a('0x8876789976decbfcbbbe364623c63652db8c0904'),
  v4Quoter: a('0x8dc178efb8111bb0973dd9d722ebeff267c98f94'),
  stateView: a('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'),
  permit2: a('0x000000000022D473030F116dDEE9F6B43aC78BA3'),
  /** Fee wallet. The API never builds a transaction from it and never signs with it. */
  feeWallet: a('0x9a21c75aC263cC43125E70200636f6397f8776d0'),
  /** Longbow lending on Morpho Blue (Robinhood Chain). Verified on-chain Nov 28, 2026. */
  morpho: a('0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010'),
  bundler3: a('0x6478e9393d4C5bB4d53ee881d1DE78786A0344a6'),
  usdg: a('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
  bowToken: a('0x451b42a15100c340ca12f7c66de06fac5ea2d751'),
  bowStaking: a('0xeba502e1177f5fad9432c2deb273569d8381e01a'),
  rebateDistributor: a('0x23e99d72e24dc538c955b9bade710d2ce3a7fca4'),
} as const;

export const POOL_TICK_SPACING = 200;
export const POOL_LP_FEE = 0;

/** Launch phases as the contract enum reports them. */
export const PHASE_NAME: Record<number, string> = {
  0: 'uninitialized',
  1: 'commit_window',
  2: 'processing_commitments',
  3: 'trading',
  4: 'graduated',
};
export const FUND_STATUS: Record<number, string> = { 0: 'raising', 1: 'raise_closed', 2: 'investing', 3: 'failed' };

export const LIMITS = {
  defaultSlippageBps: 100,
  maxSlippageBps: 1000,
  /** Above this a buy or mint needs confirmLarge: true. */
  confirmLargeWei: 10n ** 18n,
  /** Hard cap for one prepared action. */
  maxActionWei: 25n * 10n ** 18n,
  minCommitWei: 10n ** 14n,
  maxBodyBytes: 16_384,
  /** Requests per window per client IP. */
  rate: {
    read: { limit: 120, windowMs: 60_000 },
    prepare: { limit: 30, windowMs: 60_000 },
    perWalletPrepare: { limit: 12, windowMs: 60_000 },
    intent: { limit: 40, windowMs: 60_000 },
  },
  /**
   * Pro (keyed) limits: 10x the free limits — decided by Jon Nov 18, 2026 ("Pro free while
   * growing"). A Pro key buys more calls per minute, never bigger transactions: the 25 ETH
   * per-action cap and the 1 ETH confirmLarge rule do not change. Note: the keys design doc
   * proposed keeping per-wallet prepares at 12/min for Pro; the approved 10x numbers make it
   * 120/min, and the approved numbers win.
   */
  ratePro: {
    read: { limit: 1200, windowMs: 60_000 },
    prepare: { limit: 300, windowMs: 60_000 },
    perWalletPrepare: { limit: 120, windowMs: 60_000 },
    intent: { limit: 400, windowMs: 60_000 },
  },
  listMax: 50,
  deadlineSeconds: 20 * 60,
} as const;

export const DEFAULT_REF = 'grok';
export const ATTRIBUTION_CODES = ['polypad', 'grok'] as const;

export const WORDING = {
  notAudited: 'Not audited.',
  scan: 'Scans are not audits.',
} as const;

export function rpcUrl(): string {
  return process.env.POLYPAD_RPC_URL?.trim() || process.env.NEXT_PUBLIC_RPC_URL?.trim() || 'https://rpc.mainnet.chain.robinhood.com';
}

export function siteOrigin(): string {
  const raw = process.env.POLYPAD_SITE_ORIGIN?.trim();
  return raw && /^https:\/\/[a-z0-9.-]+$/i.test(raw) ? raw : SITE_ORIGIN;
}

/** Lower bound for log scans: before any Polypad contract existed on Robinhood Chain. */
export const CHAIN_FIRST_BLOCK = 85_000_000n;
