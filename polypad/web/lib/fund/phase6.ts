import { FUND_ALLOWLIST, FUND_FACTORY_PHASE3, STRATEGY_TEMPLATE, phase3TxError } from '@/lib/fund/phase3';
import { FUND_FACTORY_V3, LP_NAME, isLpTemplate } from '@/lib/fund/phase7';

// Phase 6 contracts on Robinhood Chain (chain 4663). Verified on Sourcify.
export const FUND_FACTORY_V2 = '0xe50da719947e83f316977d9c425df95672e7b27e' as const;
export const FUND_SWAP_FACET_V2 = '0x7dc767e1d0b0ac89282cb72a784174ce29cddac7' as const;
export const POLYDASH_TWAP_FEED = '0x5fde0db5aafa8e20e76ca0d763c2c3ed49af84fc' as const;
export const UNIV4_ROUTER_ADAPTER = '0x25eb10357213f17b2862b54773287fccfeb92b7a' as const;
export const RNJ_V3_TWAP_FEED = '0x2707fdbdf3e108c0040150d712e385b59fd3da2c' as const;
export const FUND_PHASE5_V2 = '0x0827e73353beb5c688c96723bb33834cac202d0e' as const;
export const POLYDASH_TOKEN = '0x319525528f42167ef7fc18b77b889958080568e4' as const;
export { FUND_ALLOWLIST, FUND_FACTORY_PHASE3, STRATEGY_TEMPLATE };

/** The Polydash Growth templates (#2 and its fee variants #3–#5) run on the V2 factory. Every other template stays on the Phase 3 factory. */
export const V2_TEMPLATE_IDS = [2, 3, 4, 5] as const;
export function factoryForTemplate(id: number): `0x${string}` {
  if (isLpTemplate(id)) return FUND_FACTORY_V3;
  return (V2_TEMPLATE_IDS as readonly number[]).includes(id) ? FUND_FACTORY_V2 : FUND_FACTORY_PHASE3;
}

const TEMPLATE_NAMES: Record<number, string> = { 1: 'Strategy #1', 2: 'Polydash Growth Tokenized Fund', 3: 'Polydash Growth Tokenized Fund', 4: 'Polydash Growth Tokenized Fund', 5: 'Polydash Growth Tokenized Fund', 6: LP_NAME, 7: LP_NAME, 8: LP_NAME, 9: LP_NAME };
export function templateTitle(id: number): string {
  return TEMPLATE_NAMES[id] ?? `Strategy #${id}`;
}

/** Polydash Growth performance-fee choice: same strategy, one template per fee. 5% (Template #2) is the default. */
export const GROWTH_FEE_OPTIONS = [
  { feeBps: 0, templateId: 3 },
  { feeBps: 500, templateId: 2 },
  { feeBps: 1000, templateId: 4 },
  { feeBps: 2000, templateId: 5 },
] as const;
export const GROWTH_DEFAULT_TEMPLATE_ID = 2;
export const GROWTH_FEE_COPY = 'Performance fee — the share of new gains the manager keeps. Charged only when the fund makes new gains above its highest value so far. 0% means the manager takes no performance fee.';
export function isGrowthTemplate(id: number | null | undefined): boolean {
  return id != null && GROWTH_FEE_OPTIONS.some((o) => o.templateId === id);
}
/** True when an on-chain template has the Polydash Growth strategy (POLYDASH only, 80/10/5, 20% brake, 30-day lock) and the fee its id maps to. */
export function matchesGrowthStrategy(t: { id: number; assets: readonly string[]; maxPositionBps: number; maxTradeBps: number; maxDeviationBps: number; hwmFeeBps: number; maxDrawdownBps: number; skinLock: number }): boolean {
  const opt = GROWTH_FEE_OPTIONS.find((o) => o.templateId === t.id);
  return !!opt && t.hwmFeeBps === opt.feeBps && t.assets.length === 1 && t.assets[0].toLowerCase() === POLYDASH_TOKEN
    && t.maxPositionBps === 8000 && t.maxTradeBps === 1000 && t.maxDeviationBps === 500 && t.maxDrawdownBps === 2000 && t.skinLock === 2_592_000;
}
/** Template #2's plain rules with the fee line set to the picked fee. */
export function growthLines(feeBps: number): string[] {
  const feeLine = feeBps ? `${feeBps / 100}% performance fee on new gains only` : 'No performance fee (0%)';
  return TEMPLATE2.lines.map((l) => (l === '5% performance fee on new gains only' ? feeLine : l));
}
/** Card/review title, e.g. "Polydash Growth Fund · 0% performance fee (Template #3)". */
export function growthLabel(id: number, feeBps: number): string {
  return `${templateTitle(id)} · ${feeBps / 100}% performance fee (Strategy #${id})`;
}

export const TEMPLATE2 = {
  id: 2,
  name: 'Polydash Growth Tokenized Fund',
  mandateUri: 'ipfs://bafybeidy4qmoeg2mo4xz2czni7pxgmycv4ttsxt2spgif7pxzp2tv4zmki',
  lines: [
    'Buys POLYDASH only',
    'At most 80% of the tokenized fund in its strategy asset, POLYDASH (this strategy\'s own cap; other newly proposed assets default to 30%)',
    'At most 10% of the tokenized fund per trade',
    'Trades blocked if the price is more than 5% away from the time-weighted average price (TWAP)',
    '5% performance fee on new gains only',
    'New buys pause after a 20% drop (drawdown brake)',
    'Manager shares locked 30 days (skin lock)',
  ],
} as const;

export const ALLOWLIST_DATE = 'Nov 12';
export const ALLOWLIST_NOTE = `POLYDASH is on the approved list (allowlist) since ${ALLOWLIST_DATE}, so this tokenized fund can be created and bought.`;

/** Template #2 card stays disabled until this moment (Nov 12 2026, 00:00 UTC). */
export const TEMPLATE2_AVAILABLE_AT_MS = Date.UTC(2026, 10, 12);
export const TEMPLATE2_BADGE = 'Available Nov 12';

export const PROPOSAL_DELAY_SECONDS = 172_800;
export const DEFAULT_ASSET_CAP_BPS = 3_000;
export const MAX_TEXT_BYTES = 512;
export const THESIS_LINES = 3;

export const P6_COPY = {
  guardrails: [
    'No single asset can go above 30% of the tokenized fund unless the proposal says less (per-asset cap).',
    'Every new asset waits 2 days in public before the manager can add it (waiting period).',
    'You can leave the tokenized fund at any time during the wait. Exits are always allowed.',
    'Only tokens on the approved list (allowlist) can be added.',
  ],
  nfa: 'Not financial advice.',
  proposeTip: 'Pick a token from the live list. You never type a contract address. The proposal is public for 2 days before you can add it.',
} as const;

/** POLYDASH / WETH Uniswap V4 pool id (GeckoTerminal pool address). */
export const POLYDASH_POOL_ID = '0xc37d18932ac3bf4d8482ae1b210bbc640a367e708fedda95cfa6724f685274b5';
/** RNJ token = the asset of RNJ_V3_TWAP_FEED; its RNJ / WETH 0.05% Uniswap V3 pool. */
export const RNJ_TOKEN = '0x66e3f409c0bf871b26977a85f7287839748699dd';
export const RNJ_POOL_ID = '0x4d59cfd33331a4d9611274b5997099b57ddd445c';
/** Announced allowlist execution for RNJ: Nov 12 2026 07:40 PST (15:40 UTC). */
export const RNJ_ALLOWLIST_AT = Date.UTC(2026, 10, 12, 15, 40) / 1000;

export type FundAsset = {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  priceEth: number | null;
  poolUsd: number;
  volume24h: number | null;
  change24h: number | null;
  version: 'v3' | 'v4';
  dexLabel: string;
  pairName: string;
  quoteIsWeth: boolean;
  /** Pool appeared in GeckoTerminal's new pools feed or was created in the last 7 days. */
  isNew: boolean;
  /** Unix seconds the pool was created, when known. */
  createdAt: number | null;
  isPons: boolean;
  isPolypad: boolean;
  allowed: boolean;
  /** Unix seconds when a pending allowlist proposal for this token can execute, else null. */
  allowlistAt: number | null;
  pairUrl: string;
};

export function allowlistLabel(a: Pick<FundAsset, 'allowed' | 'allowlistAt' | 'address'>): string {
  if (a.allowed) return 'On the approved list';
  if (a.allowlistAt) {
    const d = new Date(a.allowlistAt * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    return `allowlist executes ${d}`;
  }
  if (a.address.toLowerCase() === POLYDASH_TOKEN) return 'On the approved list';
  return 'Not on the approved list yet';
}

/** Plain decimal with 3 significant digits for 0 < n < 1. Never scientific notation, never "0" for a non-zero value. */
export function smallDecimal(n: number, sig = 3): string {
  const digits = Math.min(20, Math.max(2, sig - Math.floor(Math.log10(n)) - 1));
  const s = n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  return /^0(\.0*)?$/.test(s) ? `<0.${'0'.repeat(19)}1` : s;
}

export function ethLabel(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0 ETH';
  if (n >= 1) return `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH`;
  return `${smallDecimal(n)} ETH`;
}

export function changeLabel(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** Pacific time, e.g. "Nov 12, 7:40 AM PST". */
export function ptDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function usdLabel(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${smallDecimal(n)}`;
}

/** Pools under this size get a thin-pool note. */
export const THIN_POOL_USD = 1_000;

/** Token names and symbols that are never listed (slurs). */
const BLOCKED_NAME = /n[i1!]gg|f[a@4]gg?[o0]t|\bk[i1]ke\b|retard|\bch[i1]nk\b|\bsp[i1]c\b|\btr[a@]nn(y|ie)\b|\bwetback\b|\bcoon\b/i;
export function isBlockedName(a: { name: string; symbol: string }): boolean {
  return BLOCKED_NAME.test(a.name) || BLOCKED_NAME.test(a.symbol);
}

/** One row per token: keeps the deepest pool when a token is listed more than once. */
export function dedupeAssets(list: FundAsset[]): FundAsset[] {
  const best = new Map<string, FundAsset>();
  for (const a of list) {
    const k = a.address.toLowerCase();
    const cur = best.get(k);
    if (!cur || a.poolUsd > cur.poolUsd) best.set(k, a);
  }
  const bySymbol = new Map<string, FundAsset>();
  for (const a of best.values()) {
    const k = `${a.symbol.trim().toLowerCase()}|${a.name.trim().toLowerCase()}`;
    const cur = bySymbol.get(k);
    if (!cur || a.poolUsd > cur.poolUsd) bySymbol.set(k, a);
  }
  return Array.from(bySymbol.values());
}

/** One-line plain-English meaning of each term on the tokenized fund page. Always shown under the term. */
export const GLOSS = {
  nav: 'NAV (net asset value): everything the tokenized fund owns, minus what it owes, split per share.',
  hwm: 'High-water mark: the highest value per share so far. The manager earns a fee only above it.',
  ret: 'How far the value per share is above or below that highest point.',
  aum: 'Assets under management: the total value the tokenized fund holds right now.',
  holders: 'Wallets that hold at least one share right now.',
  shares: 'Shares bought so far out of the most that can ever exist.',
  twap: 'TWAP (time-weighted average price): the average price over a recent window, harder to push around than the spot price.',
  brake: 'Drawdown brake: if value per share falls this far below its peak, new buys stop until it recovers. Selling still works.',
  tradeCap: 'Per-trade cap: the most of the tokenized fund one single buy or sell can move.',
  assetCap: 'Per-asset cap: the most of the tokenized fund one token may ever make up.',
  perfFee: 'Performance fee: the manager\'s share of new gains, counted only above the high-water mark.',
  skin: 'Manager stake (skin lock): shares the manager bought with their own ETH and cannot move until the unlock date.',
  strategy: 'Strategy: the fixed rule set chosen at launch; nobody can swap it later.',
  allowlist: 'Allowlist wait: the public 2-day safety wait before a new asset can be bought. Anyone can leave the tokenized fund during it.',
  deviation: 'Price check: a trade is refused if the price is too far from the TWAP.',
} as const;

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;
/** CID and optional path from an ipfs:// URI, or null when it is not a real IPFS address. */
export function parseIpfs(uri: string | null | undefined): { cid: string; path: string } | null {
  const u = (uri ?? '').trim();
  if (!u.startsWith('ipfs://')) return null;
  const rest = u.slice(7).replace(/^ipfs\//, '');
  const [cid, ...p] = rest.split('/');
  return CID_RE.test(cid) ? { cid, path: p.join('/') } : null;
}

export const PROPOSAL_STATUS = ['Waiting', 'Added', 'Cancelled'] as const;
export const PROPOSAL_KIND = ['Add', 'Remove'] as const;

export type ProposalView = {
  id: number;
  asset: `0x${string}`;
  capBps: number;
  reason: string;
  thesisUri: string;
  readyAt: number;
  status: number;
  kind: number;
};

export function capOf(bps: number): number {
  return bps > 0 ? bps : DEFAULT_ASSET_CAP_BPS;
}

export function countdownLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Wait is over';
  const d = Math.floor(secondsLeft / 86_400);
  const h = Math.floor((secondsLeft % 86_400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = Math.floor(secondsLeft % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

const byteLen = (s: string) => new TextEncoder().encode(s).length;

/** Keeps at most 3 lines and 512 bytes. */
export function clampThesis(text: string): string {
  let out = text.replace(/\r/g, '').split('\n').slice(0, THESIS_LINES).join('\n');
  while (byteLen(out) > MAX_TEXT_BYTES) out = out.slice(0, -1);
  return out;
}

export function checkThesisUri(uri: string): string | null {
  const u = uri.trim();
  if (!u) return 'Add a link to the full write-up.';
  if (!/^(ipfs:\/\/\S+|https:\/\/\S+)$/.test(u)) return 'The link must start with ipfs:// or https://.';
  if (byteLen(u) > MAX_TEXT_BYTES) return 'The link is too long.';
  return null;
}

/** Public https link for an ipfs:// or https:// URI. Empty for anything else (never a raw ipfs:// link). */
export function ipfsToHttp(uri: string | null | undefined): string {
  const u = (uri ?? '').trim();
  if (u.startsWith('ipfs://')) {
    const p = parseIpfs(u);
    return p ? `https://dweb.link/ipfs/${p.cid}${p.path ? `/${p.path}` : ''}` : '';
  }
  return /^https:\/\/\S+$/.test(u) ? u : '';
}

/** Proposal status for display: a waiting proposal whose wait is over is executable. */
export function proposalStage(p: Pick<ProposalView, 'status' | 'readyAt'>, now: number): 'Waiting' | 'Executable' | 'Executed' | 'Cancelled' {
  if (p.status === 1) return 'Executed';
  if (p.status === 2) return 'Cancelled';
  return now && p.readyAt <= now ? 'Executable' : 'Waiting';
}

/** Share of each value in basis points. Zero total gives zeros. */
export function holdingsBps(values: bigint[]): number[] {
  const total = values.reduce((a, b) => a + b, 0n);
  if (total === 0n) return values.map(() => 0);
  return values.map((v) => Number((v * 10_000n) / total));
}

export function trackRecord(list: ProposalView[]) {
  return {
    total: list.length,
    added: list.filter((p) => p.status === 1 && p.kind === 0).length,
    removed: list.filter((p) => p.status === 1 && p.kind === 1).length,
    cancelled: list.filter((p) => p.status === 2).length,
    waiting: list.filter((p) => p.status === 0).length,
  };
}

const ERRORS: Record<string, string> = {
  badproposal: 'This proposal does not exist.',
  notpending: 'This proposal is no longer waiting.',
  alreadyinmandate: 'This token is already in the tokenized fund.',
  notsellable: 'This token cannot be sold back right now.',
  baduri: 'The write-up link is empty or too long.',
  toomany: 'The tokenized fund already holds the most tokens it can.',
  notinmandate: 'This token is not in the tokenized fund.',
  notallowlisted: 'This token is not on the approved list (allowlist) yet.',
  tooearly: 'The 2-day waiting period is not over yet.',
  notmanager: 'Only the manager can do this.',
  badpair: 'This token cannot be proposed.',
  badvalue: 'Pick a cap between 1% and 30%.',
};

export function phase6TxError(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(ERRORS)) if (key.includes(k)) return v;
  return phase3TxError(raw);
}
