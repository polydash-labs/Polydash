import { parseEther } from 'viem';
import { fundTxError } from '@/lib/fund/model';

// Phase 3 contracts on Robinhood Chain (chain 4663). Verified on Sourcify (exact match).
export const FUND_FACTORY_PHASE3 = '0xb9ba453677a6b2c49290cfd4d0713502ec6bf82b' as const;
export const STRATEGY_TEMPLATE = '0xb2a958a9779e02764de006c8aeebc36174e2e3ba' as const;
export const FUND_SWAP_FACET_PHASE3 = '0x40ef3ae910a46addc14f45f0983060161884f045' as const;
export const FUND_ALLOWLIST = '0x7a42dc64f77711ea20d163efb1b9faccc2ca2c19' as const;
export const FUND_WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as const;
/** Block where FundFactoryPhase3 was deployed. Event scans start here. */
export const PHASE3_DEPLOY_BLOCK = 110_374_048n;
export const PHASE3_LOG_CHUNK = 9_900_000n;

export const P3_BPS = 10_000;
export const P3_DEFAULT_MIN_SKIN_BPS = 500;
export const P3_MAX_ENTRY_FEE_BPS = 500;
export const P3_PROTOCOL_FEE_BPS = 20;
export const P3_MAX_SUPPLY = 10_000n;
export const P3_MIN_MINT_PRICE = 10_000_000_000_000n;
export const P3_MAX_MINT_PRICE = 100n * 10n ** 18n;
export const P3_MIN_DAYS = 1;
export const P3_MAX_DAYS = 30;

export const P3_NOTE = 'New contract, not audited. Not financial advice.';

export const P3_STATUS = { Raising: 0, RaisingClosed: 1, Investing: 2, Failed: 3 } as const;

export function sourcifyUrl(address: string): string {
  return `https://repo.sourcify.dev/4663/${address}`;
}

export function pct(bps: number): string {
  if (!Number.isFinite(bps)) return '0%';
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

export function daysLabel(seconds: number): string {
  if (!seconds) return 'no lock';
  const days = seconds / 86_400;
  if (days >= 1) {
    const d = Number.isInteger(days) ? days : Number(days.toFixed(1));
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function utcDate(seconds: number): string {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' UTC';
}

export type StrategyTemplateView = {
  id: number;
  mandateHash: `0x${string}`;
  mandateUri: string;
  maxPositionBps: number;
  maxTradeBps: number;
  maxDeviationBps: number;
  hwmFeeBps: number;
  maxDrawdownBps: number;
  skinLock: number;
  assets: `0x${string}`[];
};

export function templateName(id: number | bigint): string {
  return `Strategy #${id.toString()}`;
}

/** One plain line built from the template's on-chain settings. The contract stores no name. */
export function templateLine(t: StrategyTemplateView): string {
  const what = t.assets.length === 0
    ? 'Holds ETH and WETH only'
    : `Buys up to ${t.assets.length} approved token${t.assets.length === 1 ? '' : 's'}`;
  const fee = t.hwmFeeBps ? `${pct(t.hwmFeeBps)} fee on new gains only` : 'no performance fee';
  const brake = t.maxDrawdownBps ? `new buys pause after a ${pct(t.maxDrawdownBps)} drop` : 'no drawdown brake';
  const caps = capsLabel(t.maxPositionBps, t.maxTradeBps);
  return `${what}, ${caps ? `${caps}, ` : ''}${fee}, ${brake}, manager shares locked ${daysLabel(t.skinLock)}.`;
}

/** Per-position and per-trade caps from the template. A zero value is left out. */
function capsLabel(positionBps: number, tradeBps: number): string {
  if (positionBps && positionBps === tradeBps) return `max ${pct(positionBps)} of the tokenized fund in one position or one trade`;
  if (positionBps && tradeBps) return `max ${pct(positionBps)} of the tokenized fund in one position and ${pct(tradeBps)} in one trade`;
  if (positionBps) return `max ${pct(positionBps)} of the tokenized fund in one position`;
  if (tradeBps) return `max ${pct(tradeBps)} of the tokenized fund in one trade`;
  return '';
}

/** Drop from the peak value per share, in basis points. Matches the vault's _drawdownBps. */
export function drawdownBps(peak: bigint, current: bigint): number {
  if (peak === 0n || current >= peak) return 0;
  return Number(((peak - current) * 10_000n) / peak);
}

export function brakeActive(maxDrawdownBps: number, drop: number): boolean {
  return maxDrawdownBps !== 0 && drop >= maxDrawdownBps;
}

/** The high-water-mark rule as one sentence plus a worked example (illustration only). */
export function hwmExample(feeBps: number): { rule: string; example: string } {
  const rule = `The manager takes ${pct(feeBps)} only of gains above the highest value per share the tokenized fund has reached so far (the high-water mark), so any drop must be made back before a new fee is charged.`;
  const feePerShare = (0.2 * feeBps) / 10_000;
  const example = `Example for illustration only: a share is worth 1.00 ETH, rises to 1.20 ETH, so the fee is ${pct(feeBps)} of the 0.20 ETH gain, ${feePerShare.toFixed(4).replace(/\.?0+$/, '')} ETH per share. If it then falls to 1.10 ETH and climbs back to 1.20 ETH, no new fee is charged.`;
  return { rule, example };
}

export function p3StatusText(status: number, publicOpen: boolean): { label: string; explain: string } {
  if (status === P3_STATUS.Failed) return { label: 'Refund available — get your money back', explain: 'The raise missed its goal in time. Holders can return their shares and get their ETH back (fees are not refunded).' };
  if (status === P3_STATUS.Investing) return { label: 'Investing your money', explain: 'The raise is over. The manager can trade only inside the locked strategy.' };
  if (status === P3_STATUS.RaisingClosed) return { label: 'Closed', explain: 'The raise is full. The manager can start investing once their shares are bought.' };
  if (!publicOpen) return { label: 'Waiting for the manager to join', explain: 'The manager must buy their own required shares before anyone else can join.' };
  return { label: 'Open for investments', explain: 'Anyone can buy shares with ETH until the goal or the deadline is reached.' };
}

export function phase3TxError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('drawdownbrakeactive')) return 'New buys are paused because the tokenized fund dropped past its drawdown brake.';
  if (m.includes('skinlocked')) return 'The manager\'s locked shares cannot move before the unlock date.';
  if (m.includes('notmanager')) return 'Only the tokenized fund manager can do that.';
  if (m.includes('badamount')) return 'That amount does not work. Check it is above zero, within the ETH the tokenized fund can spend, and at least 1 wei per share.';
  if (m.includes('badtemplate')) return 'That strategy does not exist.';
  if (m.includes('templatelocked')) return 'The strategy is locked and cannot be changed.';
  return fundTxError(message);
}

export type Phase3Draft = {
  name: string;
  symbol: string;
  imageUri: string;
  mintPriceEth: string;
  raiseCapEth: string;
  raiseDays: string;
  templateId: number | null;
  entryFeeBps: number;
  skinBps: number;
};

export const DEFAULT_PHASE3_DRAFT: Phase3Draft = {
  name: '',
  symbol: '',
  imageUri: '',
  mintPriceEth: '0.01',
  raiseCapEth: '1',
  raiseDays: '7',
  templateId: null,
  entryFeeBps: 0,
  skinBps: P3_DEFAULT_MIN_SKIN_BPS,
};

export type Phase3Field = 'name' | 'symbol' | 'imageUri' | 'mintPriceEth' | 'raiseCapEth' | 'raiseDays' | 'templateId' | 'entryFeeBps' | 'skinBps';
export type Phase3Issue = { field: Phase3Field; message: string };

export type Phase3Params = {
  templateId: bigint;
  name: string;
  symbol: string;
  imageUri: string;
  baseURI: string;
  mintPrice: bigint;
  raiseCap: bigint;
  entryFeeBps: bigint;
  minSkinBps: bigint;
  raiseDuration: bigint;
};

export type Phase3Preview = {
  maxSupply: bigint;
  dust: bigint;
  skinRequired: bigint;
  managerEth: bigint;
  protocolFeeOnManager: bigint;
};

const bytes = (s: string) => new TextEncoder().encode(s).length;

function ethOf(raw: string): bigint | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  try { return parseEther(t); } catch { return null; }
}

/** Mirrors FundFactoryPhase3.createFund checks so the wallet is only asked when the call can pass. */
export function checkPhase3Draft(d: Phase3Draft): { issues: Phase3Issue[]; preview: Phase3Preview | null; params: Phase3Params | null } {
  const issues: Phase3Issue[] = [];
  const name = d.name.trim();
  const symbol = d.symbol.trim();
  const imageUri = d.imageUri.trim();
  if (!name) issues.push({ field: 'name', message: 'Give the tokenized fund a name.' });
  else if (bytes(name) > 64) issues.push({ field: 'name', message: 'Keep the name to 64 characters or fewer.' });
  if (!symbol) issues.push({ field: 'symbol', message: 'Add a short ticker, like FUND.' });
  else if (bytes(symbol) > 16) issues.push({ field: 'symbol', message: 'Keep the ticker to 16 characters or fewer.' });
  if (bytes(imageUri) > 512) issues.push({ field: 'imageUri', message: 'The image link is too long.' });

  const mintPrice = ethOf(d.mintPriceEth);
  const raiseCap = ethOf(d.raiseCapEth);
  let preview: Phase3Preview | null = null;
  if (mintPrice === null) issues.push({ field: 'mintPriceEth', message: 'Enter a share price in ETH, like 0.01.' });
  else if (mintPrice < P3_MIN_MINT_PRICE || mintPrice > P3_MAX_MINT_PRICE) issues.push({ field: 'mintPriceEth', message: 'The share price must be between 0.00001 and 100 ETH.' });
  if (raiseCap === null) issues.push({ field: 'raiseCapEth', message: 'Enter a goal in ETH, like 1.' });
  if (mintPrice !== null && raiseCap !== null && mintPrice > 0n) {
    const maxSupply = raiseCap / mintPrice;
    if (raiseCap < mintPrice || maxSupply === 0n) issues.push({ field: 'raiseCapEth', message: 'The goal must be at least one share price.' });
    else if (maxSupply > P3_MAX_SUPPLY) issues.push({ field: 'raiseCapEth', message: 'That makes more than 10,000 shares. Raise the share price or lower the goal.' });
    else {
      const skinBps = BigInt(d.skinBps);
      const skinRequired = (maxSupply * skinBps + 9_999n) / 10_000n;
      const managerEth = skinRequired * mintPrice;
      preview = {
        maxSupply,
        dust: raiseCap % mintPrice,
        skinRequired,
        managerEth,
        protocolFeeOnManager: (managerEth * BigInt(P3_PROTOCOL_FEE_BPS)) / 10_000n,
      };
    }
  }
  const days = /^\d+$/.test(d.raiseDays.trim()) ? Number(d.raiseDays.trim()) : NaN;
  if (!Number.isInteger(days) || days < P3_MIN_DAYS || days > P3_MAX_DAYS) issues.push({ field: 'raiseDays', message: `Pick ${P3_MIN_DAYS} to ${P3_MAX_DAYS} days.` });
  if (d.templateId === null) issues.push({ field: 'templateId', message: 'Pick a strategy.' });
  if (!Number.isInteger(d.entryFeeBps) || d.entryFeeBps < 0 || d.entryFeeBps > P3_MAX_ENTRY_FEE_BPS) issues.push({ field: 'entryFeeBps', message: 'The entry fee can be 0% to 5%.' });
  if (!Number.isInteger(d.skinBps) || d.skinBps < P3_DEFAULT_MIN_SKIN_BPS || d.skinBps > P3_BPS) issues.push({ field: 'skinBps', message: 'Your stake must be 5% to 100% of the shares.' });

  const params: Phase3Params | null = issues.length || !preview || mintPrice === null || raiseCap === null || d.templateId === null
    ? null
    : {
      templateId: BigInt(d.templateId),
      name,
      symbol,
      imageUri,
      baseURI: '',
      mintPrice,
      raiseCap,
      entryFeeBps: BigInt(d.entryFeeBps),
      minSkinBps: d.skinBps === P3_DEFAULT_MIN_SKIN_BPS ? 0n : BigInt(d.skinBps),
      raiseDuration: BigInt(days * 86_400),
    };
  return { issues, preview, params };
}

/** Sum of unpaid distribution rounds for the given share ids. claimed[r][i] is true when id i was paid in round r. */
export function claimableTotal(perUnit: bigint[], claimed: boolean[][]): bigint {
  let total = 0n;
  perUnit.forEach((per, r) => {
    if (per === 0n) return;
    const row = claimed[r] ?? [];
    for (const paid of row) if (!paid) total += per;
  });
  return total;
}
