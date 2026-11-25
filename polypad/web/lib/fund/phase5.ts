import { envAddress } from '@/lib/fund/phase4';
import { p3StatusText, phase3TxError } from '@/lib/fund/phase3';

// Read literally so the values are inlined into the browser bundle.
export const FUND_PHASE5 = envAddress(process.env.NEXT_PUBLIC_FUND_PHASE5_ADDRESS);
export const FUND_MARKET = envAddress(process.env.NEXT_PUBLIC_FUND_SECONDARY_MARKET_ADDRESS);
export const FUND_RENDERER = envAddress(process.env.NEXT_PUBLIC_FUND_SHARE_RENDERER_ADDRESS);
export const FUND_LOCKS = envAddress(process.env.NEXT_PUBLIC_FUND_CONVICTION_LOCK_ADDRESS);
export const FUND_CARRY = envAddress(process.env.NEXT_PUBLIC_FUND_CARRY_RIGHTS_ADDRESS);
export const FUND_NAV_FLOOR = envAddress(process.env.NEXT_PUBLIC_FUND_NAV_FLOOR_ADDRESS);
export const PHASE3_FACTORY = '0xb9ba453677a6b2c49290cfd4d0713502ec6bf82b';

/** Phase 5 panels send nothing unless every address is set. */
export function phase5Live(): boolean {
  return !!(FUND_PHASE5 && FUND_MARKET && FUND_RENDERER && FUND_LOCKS && FUND_CARRY && FUND_NAV_FLOOR);
}

export const PHASE5_DEPLOY_BLOCK = 110_620_386n;
export const P5_TIERS = [30, 90, 180] as const;

export const P5_COPY = {
  notLive: 'Share trading is not live on this site yet. No share-trading transaction can be sent from here.',
  mismatch: 'The share-trading registry on Robinhood Chain does not match this site. No share-trading transaction can be sent from here.',
  nfa: 'Not financial advice.',
  note: 'Share-trading contracts on Robinhood Chain (chain id 4663). Sourcify exact match. Not audited. Not financial advice.',
  listTip: 'You set a fixed ETH price. The share can stay in your wallet if you approve this market, or you can send it into escrow. A share in a conviction lock cannot be listed. After a sale, you withdraw the ETH yourself. This is not leaving the tokenized fund. Not financial advice.',
  buyTip: 'A listing is a fixed price set by the seller. It is not a net-value quote. The tokenized fund does not pay anyone. Not financial advice.',
  artTip: "This image is drawn onchain from the tokenized fund's current readings. The figures are vault readings, not a quote of what a buyer will pay. If a price feed cannot be read, the art says so and still returns. Not financial advice.",
  lockTip: 'You can lock one share for 30, 90, or 180 days. Until the time is up, you cannot transfer it, list it, or leave the tokenized fund with that share. There is no payment for locking. This is not yield. Not financial advice.',
  carryWarning: "The manager can change the tokenized fund's payout wallet later. If that happens, new fees stop reaching this Carry NFT. Anyone who buys the Carry NFT is relying on the manager. The same payout wallet also receives the manager's entry fees, not only performance fees. Protocol fees still go to the platform. The token does not promise a payment. Not financial advice.",
  exitTip: "You send one share into a one-day queue, then this contract calls the share's existing exit, or a refund if the raise failed. You get the assets in kind: ETH, WETH, and the tokenized fund's tokens, in the amounts the vault already pays. This is not a trade. You can cancel and take the share back before you redeem. The share's own exit stays available if you have not queued here. Not financial advice.",
} as const;

const ERRORS: Record<string, string> = {
  alreadylisted: 'This share is already listed.',
  badprice: 'Enter a price above zero.',
  notapproved: 'Approve the contract for this share first.',
  sharelocked: 'This share is in a conviction lock.',
  skinlocked: 'This share is still in the manager lock.',
  notholder: 'Only the recorded holder can do this.',
  notseller: 'Only the seller can cancel this listing.',
  selffill: 'You cannot buy your own listing.',
  badvalue: 'The ETH sent does not match the price.',
  nothingtowithdraw: 'There is nothing to withdraw.',
  alreadylocked: 'This share is already locked.',
  badtier: 'Pick 30, 90, or 180 days.',
  tooearly: 'It is too early for this step.',
  notlocked: 'This share is not locked.',
  alreadyarmed: 'The Carry NFT already exists for this tokenized fund.',
  notarmed: 'The Carry NFT has not been created yet.',
  payoutnotset: 'Set the payout wallet to the Carry contract first.',
  notmanager: 'Only the manager can do this.',
  nothingtoclaim: 'There is nothing to claim.',
  transferblocked: 'This transfer is blocked right now.',
  alreadyqueued: 'This share is already queued.',
  coolingdown: 'The one-day wait has not passed yet.',
  listed: 'This share is listed. Cancel the listing first.',
  notexitable: 'This share cannot exit right now.',
  notqueued: 'This share is not queued.',
  notfund: 'This tokenized fund does not support share trading.',
};

// Tuple parsers. viem returns single-struct outputs (listing) as objects and multi-output
// functions (positions, queues, quote) as arrays; these accept either shape.
type A = `0x${string}`;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export const tupleField = (v: any, i: number, k: string) => (Array.isArray(v) ? v[i] : v?.[k]);
const holderOrNull = (a: unknown) => (a && String(a).toLowerCase() !== ZERO_ADDR ? (a as A) : null);

export function parseListing(v: unknown) {
  return {
    seller: tupleField(v, 0, 'seller') as A, nft: tupleField(v, 1, 'nft') as A, tokenId: tupleField(v, 2, 'tokenId') as bigint,
    price: tupleField(v, 3, 'price') as bigint, mode: Number(tupleField(v, 4, 'mode')), active: !!tupleField(v, 5, 'active'),
  };
}
export function parsePosition(v: unknown) {
  return { holder: holderOrNull(tupleField(v, 0, 'holder')), expiry: Number(tupleField(v, 1, 'expiry') ?? 0), tierDays: Number(tupleField(v, 2, 'tierDays') ?? 0) };
}
export function parseQueue(v: unknown) {
  return { holder: holderOrNull(tupleField(v, 0, 'holder')), readyAt: Number(tupleField(v, 1, 'readyAt') ?? 0) };
}
export function parseQuote(v: unknown) {
  return { ethShare: tupleField(v, 0, 'ethShare') as bigint, supply: tupleField(v, 1, 'supply') as bigint, status: Number(tupleField(v, 2, 'status')) };
}

/** Quote status uses the vault enum (0 Raising, 1 RaisingClosed, 2 Investing, 3 Failed); falls back to the fund's own status. */
export function quoteStatusLabel(quoteStatus: number | null | undefined, fundStatus: number, publicOpen: boolean): string {
  return p3StatusText(quoteStatus ?? fundStatus, publicOpen).label;
}

/** Typed share number, else the holder's first share, else share #1. */
export function defaultShareId(typed: string, myIds: readonly bigint[]): bigint {
  const t = typed.trim();
  if (/^\d+$/.test(t)) return BigInt(t);
  return myIds[0] ?? 1n;
}

export function phase5TxError(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(ERRORS)) if (key === k || key.startsWith(k)) return v;
  return phase3TxError(raw);
}
