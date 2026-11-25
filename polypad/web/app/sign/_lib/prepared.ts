import { concatHex, formatEther, keccak256, toHex, type Hex } from 'viem';
import { ADDR, CHAIN_ID, EXPLORER } from '@/lib/agents-api/v2/config';

export { CHAIN_ID, EXPLORER };

export type Step = {
  step: number;
  kind: string;
  description: string;
  chainId: number;
  from: string;
  to: string;
  data: Hex;
  value: string;
  gas: string | null;
};

export type Prepared = {
  ok: true;
  action: string;
  chainId: number;
  summary: {
    headline: string;
    lines: string[];
    youPay?: string;
    youReceiveAtLeast?: string;
    fees?: Record<string, unknown>;
    slippageBps?: number;
    risks: string[];
    notAudited?: string;
  };
  transactions: Step[];
  signing?: { checksum?: string; expiresInSeconds?: number };
  warnings: string[];
  [k: string]: unknown;
};

export type ApiFailure = { ok: false; error: { code: string; message: string; [k: string]: unknown } };

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;

/** Same as the API's checksumOf: keccak256(to || selector || value || chainId), leading 12 hex characters. */
export function fingerprint(tx: { to: string; data: Hex; value: string }): string {
  return keccak256(concatHex([tx.to as Hex, tx.data.slice(0, 10) as Hex, toHex(BigInt(tx.value), { size: 32 }), toHex(CHAIN_ID, { size: 4 })])).slice(2, 14);
}

function collectAddresses(v: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || v === null || v === undefined) return;
  if (typeof v === 'string') {
    if (ADDR_RE.test(v)) out.add(v.toLowerCase());
    return;
  }
  if (Array.isArray(v)) { v.forEach((x) => collectAddresses(x, out, depth + 1)); return; }
  if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => collectAddresses(x, out, depth + 1));
}

/**
 * Addresses the API returned for this action (outside the transactions themselves), the Polypad contract
 * addresses the API is built on, and the addresses named in the link.
 */
export function allowedTargets(p: Prepared, linkAddresses: string[]): Set<string> {
  const out = new Set<string>();
  const { transactions: _t, signing: _s, ...rest } = p;
  collectAddresses(rest, out);
  const fixed = [ADDR.weth, ADDR.permit2, ADDR.universalRouter, ADDR.nftMarket, ADDR.nftFactory, ADDR.nftCurveFactory, ...ADDR.launchFactories.map((f) => f.factory), ...ADDR.fundFactories.map((f) => f.factory)];
  fixed.forEach((a) => out.add(a.toLowerCase()));
  linkAddresses.forEach((a) => out.add(a.toLowerCase()));
  return out;
}

/** Returns a refusal message, or null when every step may be sent. */
export function checkSteps(p: Prepared, wallet: string, linkAddresses: string[]): string | null {
  if (p.chainId !== CHAIN_ID) return 'Refused: the prepared action is not for Robinhood Chain (chain id 4663).';
  if (!Array.isArray(p.transactions) || p.transactions.length === 0) return 'Refused: the API returned no transactions.';
  const allowed = allowedTargets(p, linkAddresses);
  for (const s of p.transactions) {
    if (s.chainId !== CHAIN_ID) return `Refused: step ${s.step} is not for Robinhood Chain (chain id 4663).`;
    if (!ADDR_RE.test(s.to) || !allowed.has(s.to.toLowerCase())) return `Refused: step ${s.step} sends to an address the API did not return for this action.`;
    if (!HEX_RE.test(s.data) || !/^\d{1,40}$/.test(s.value) || (s.gas !== null && !/^\d{1,12}$/.test(s.gas))) return `Refused: step ${s.step} is malformed.`;
    if (s.from.toLowerCase() !== wallet.toLowerCase()) return `Refused: step ${s.step} was built for a different wallet.`;
  }
  return null;
}

export function ethOf(wei: string): string {
  try {
    return `${formatEther(BigInt(wei))} ETH`;
  } catch {
    return `${wei} wei`;
  }
}

/** Fee entries as plain text. Keys ending in Wei are shown in ETH. */
export function feeLines(fees: Record<string, unknown> | undefined): string[] {
  if (!fees || typeof fees !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(fees)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const label = k.replace(/Wei$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    if (/Wei$/.test(k) && /^\d{1,40}$/.test(String(v))) out.push(`${label}: ${ethOf(String(v))}`);
    else if (/Bps$/.test(k) && typeof v === 'number') out.push(`${label.replace(/ bps$/, '')}: ${(v / 100).toFixed(2)}%`);
    else out.push(`${label}: ${String(v)}`);
  }
  return out.slice(0, 12);
}

export function dataBytes(data: string): number {
  return Math.max(0, (data.length - 2) / 2);
}
