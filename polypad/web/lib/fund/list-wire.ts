// Wire shapes for the server-side fund reads (round 4).
//
// The /funds lists, the Terminal leaderboard NAVs, and the detail-page kind
// check used to read the chain directly from the browser. On a first load
// they all fired at once into the official RPC and it rejected/timed them
// out often enough that the Polyfund page failed its first visit and the
// /funds lists sat on "Loading tokenized funds…" for 20+s. The reads now
// run once on the server behind /api/funds/list, /api/terminal/leaderboard
// and /api/fund/kind (cached 30s, same pattern as /api/fund/detail), and
// the browser makes one cheap request each.
//
// Bigints travel as decimal strings; these revivers turn them back. This
// file is pure (type imports only) so both the server readers and the
// client hooks can use it without pulling server code into the browser
// bundle.
import type { FundStatus } from '@/lib/fund/model';
import type { Phase3Summary, NavPoint } from '@/lib/fund/use-phase3';
import type { V3FundSummary } from '@/lib/fund/use-v3';
import type { FundSummary } from '@/lib/fund/use-funds';
import type { FundLedger } from '@/lib/fund/use-fund-ledger';
import type { AllowlistToken } from '@/lib/fund/use-allowlist';
import type { Offer } from '@/lib/fund/use-phase4';

type Addr = `0x${string}`;

/** Which page a fund address belongs to (from /api/fund/kind). */
export type FundKind = 'phase3' | 'v2' | 'v3' | 'legacy';

export type Phase3SummaryWire = {
  address: Addr;
  index: number;
  name: string;
  symbol: string;
  imageUri: string;
  manager: Addr;
  vault: Addr;
  mintPrice: string;
  maxSupply: string;
  totalMinted: string;
  publicOpen: boolean;
  raised: string;
  raiseCap: string;
  status: number;
  templateId: number;
};

export type V3FundSummaryWire = Phase3SummaryWire & { raiseDeadline: number };

export type FundSummaryWire = {
  address: Addr;
  index: number;
  name: string;
  symbol: string;
  imageUri: string;
  manager: Addr;
  vault: Addr;
  mintPrice: string;
  maxSupply: string;
  totalMinted: string;
  managerMinted: string;
  publicOpen: boolean;
  entryFeeBps: number;
  skinRequired: string;
  minSkinBps: number;
  raiseCap: string;
  raised: string;
  vaultStatus: number;
  raiseDeadline: number;
  status: FundStatus;
  balance: string;
  generation: 1 | 2;
};

export type FundsListWire = {
  phase3: Phase3SummaryWire[];
  v2: Phase3SummaryWire[];
  v3: V3FundSummaryWire[];
  legacy: FundSummaryWire[];
};

export function phase3SummaryFromWire(w: Phase3SummaryWire): Phase3Summary {
  const b = (s: string) => BigInt(s);
  return {
    address: w.address,
    index: w.index,
    name: w.name,
    symbol: w.symbol,
    imageUri: w.imageUri,
    manager: w.manager,
    vault: w.vault,
    mintPrice: b(w.mintPrice),
    maxSupply: b(w.maxSupply),
    totalMinted: b(w.totalMinted),
    publicOpen: w.publicOpen,
    raised: b(w.raised),
    raiseCap: b(w.raiseCap),
    status: w.status,
    templateId: w.templateId,
  };
}

export function v3FundSummaryFromWire(w: V3FundSummaryWire): V3FundSummary {
  return { ...phase3SummaryFromWire(w), raiseDeadline: w.raiseDeadline };
}

export function fundSummaryFromWire(w: FundSummaryWire): FundSummary {
  const b = (s: string) => BigInt(s);
  return {
    address: w.address,
    index: w.index,
    name: w.name,
    symbol: w.symbol,
    imageUri: w.imageUri,
    manager: w.manager,
    vault: w.vault,
    mintPrice: b(w.mintPrice),
    maxSupply: b(w.maxSupply),
    totalMinted: b(w.totalMinted),
    managerMinted: b(w.managerMinted),
    publicOpen: w.publicOpen,
    entryFeeBps: w.entryFeeBps,
    skinRequired: b(w.skinRequired),
    minSkinBps: w.minSkinBps,
    raiseCap: b(w.raiseCap),
    raised: b(w.raised),
    vaultStatus: w.vaultStatus,
    raiseDeadline: w.raiseDeadline,
    status: w.status,
    balance: b(w.balance),
    generation: w.generation,
  };
}

// ---------- Round 5: detail-page secondary reads ----------
//
// The Polyfund detail page's first load was fixed in rounds 3–4, but its
// secondary reads still went straight from the browser into the first-load
// storm and failed the same way: the value-history log scan, the fund
// ledger (holders, trades, distributions, fees), the allowlist menu, and
// the Phase 4 offers list. They now run once on the server behind
// /api/fund/nav-log, /api/fund/ledger, /api/funds/allowlist and
// /api/fund/offers, and the browser makes one cheap request each.

export type NavPointWire = {
  timestamp: number;
  nav: string;
  navPerNft: string;
  hwmPerNft: string;
  drawdownBps: number;
  tx: string;
};

export type NavLogWire = { log: NavPointWire[]; updatedAt: number };

export function navLogFromWire(w: NavLogWire): NavPoint[] {
  const b = (s: string) => BigInt(s);
  return w.log.map((p) => ({ timestamp: p.timestamp, nav: b(p.nav), navPerNft: b(p.navPerNft), hwmPerNft: b(p.hwmPerNft), drawdownBps: p.drawdownBps, tx: p.tx }));
}

export type LedgerTradeWire = { asset: Addr; side: 'Buy' | 'Sell'; size: string; price: string; navAfter: string; block: string; tx: string };
export type LedgerDistributionWire = { roundId: number; pot: string; perUnit: string; block: string; tx: string };
export type LedgerFeeWire = { kind: 'Counted' | 'Withdrawn'; amount: string; block: string; tx: string };

export type LedgerWire = {
  holders: number;
  trades: LedgerTradeWire[];
  distributions: LedgerDistributionWire[];
  fees: LedgerFeeWire[];
  feesWithdrawn: string;
  brakeEvents: number;
  updatedAt: number;
};

export function ledgerFromWire(w: LedgerWire): FundLedger {
  const b = (s: string) => BigInt(s);
  return {
    holders: w.holders,
    trades: w.trades.map((t) => ({ asset: t.asset, side: t.side, size: b(t.size), price: b(t.price), navAfter: b(t.navAfter), block: b(t.block), tx: t.tx })),
    distributions: w.distributions.map((d) => ({ roundId: d.roundId, pot: b(d.pot), perUnit: b(d.perUnit), block: b(d.block), tx: d.tx })),
    fees: w.fees.map((f) => ({ kind: f.kind, amount: b(f.amount), block: b(f.block), tx: f.tx })),
    feesWithdrawn: b(w.feesWithdrawn),
    brakeEvents: w.brakeEvents,
  };
}

export type AllowlistWire = { tokens: AllowlistToken[]; updatedAt: number };

export type OfferWire = {
  id: string;
  bidder: Addr;
  tokenId: string;
  amount: string;
  expiry: number;
  open: boolean;
  expired: boolean;
  withinNav: boolean;
  navPerShare: string;
  holder: Addr | null;
  approved: boolean;
};

export type OffersWire = { offers: OfferWire[]; updatedAt: number };

export function offersFromWire(w: OffersWire): Offer[] {
  const b = (s: string) => BigInt(s);
  return w.offers.map((o) => ({
    id: b(o.id),
    bidder: o.bidder,
    tokenId: b(o.tokenId),
    amount: b(o.amount),
    expiry: o.expiry,
    open: o.open,
    expired: o.expired,
    withinNav: o.withinNav,
    navPerShare: b(o.navPerShare),
    holder: o.holder,
    approved: o.approved,
  }));
}

