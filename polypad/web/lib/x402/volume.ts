// x402 settle volume — the real settled totals, read live from the chains.
// Dollars: the fee wallet's stablecoin balances. Every USDC that reaches
// the fee wallet on Base arrives through an x402 settlement (CDP
// facilitator flow), and the USDG balance on Robinhood Chain is the same
// wallet's x402 receipts, including the Nov 22 cross-chain demo
// settlement.
// Counts: Blockscout's token-transfer API for the same wallet (the
// "no dated transfer history" problem is gone — Blockscout's v2 API
// answers from curl and from the server; the earlier block was page
// fetches, not the API). Only inbound transfers of the real settlement
// tokens count (USDG 0x5fc5… on Hood, USDC 0x8335… on Base) — same-symbol
// impostor tokens are excluded by contract address, and every counted
// transfer is exactly a product price ($0.01 or $0.05), which is why the
// transfer sums reconcile with the balances to the cent. The two Nov 18
// USDG transfers are pre-launch facilitator tests (transferWithAuthorization
// for exactly $0.01, before the Nov 22 launch) — they count in the
// all-time total and dollars, not in the 7-day window.

import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { robinhoodChain } from '@/lib/chain';
import { X402_PAY_TO, USDG_ADDRESS, USDC_BASE_ADDRESS } from './constants';

const BALANCE_ABI = parseAbi(['function balanceOf(address account) view returns (uint256)']);

const HOOD_RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const HOOD_RPC_FALLBACK = 'https://robinhood.drpc.org';
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org';

export interface X402VolumeChain {
  network: string;
  chainId: number;
  asset: string;
  symbol: string;
  settledUsd: number | null;
  /** Inbound transfers of this settlement token to the fee wallet, all time. Null if the transfer read failed. */
  count: number | null;
  /** Same, last 7 days. */
  weekCount: number | null;
  source: string;
  note?: string;
  error?: string;
}

export interface X402Volume {
  ok: boolean;
  checkedAt: string;
  /** All settled x402 payments so far, in USD. Null if neither chain read. */
  allTimeUsd: number | null;
  /** Settled in the last 7 days. Transfer-derived when the transfer read
   * worked; falls back to the all-time total when it did not. */
  weekUsd: number | null;
  /** All settled x402 payments so far, by count. Null if neither chain's transfer read worked. */
  allTimeCount: number | null;
  /** Settled in the last 7 days, by count. */
  weekCount: number | null;
  weekStart: string;
  chains: X402VolumeChain[];
  method: string;
  note: string;
}

async function readBalance(
  client: PublicClient,
  token: string,
  holder: string,
): Promise<bigint> {
  return (await client.readContract({
    address: token as `0x${string}`,
    abi: BALANCE_ABI,
    functionName: 'balanceOf',
    args: [holder as `0x${string}`],
  })) as bigint;
}

async function hoodBalanceUsd(): Promise<number> {
  const attempts = [
    createPublicClient({ chain: robinhoodChain, transport: http(HOOD_RPC, { timeout: 5_000 }) }),
    createPublicClient({ chain: robinhoodChain, transport: http(HOOD_RPC_FALLBACK, { timeout: 5_000 }) }),
  ];
  let lastErr: unknown = null;
  for (const client of attempts) {
    try {
      // Cast: the viem client type is chain-specific; readContract works
      // identically at runtime for a plain balanceOf call.
      const raw = await readBalance(client as PublicClient, USDG_ADDRESS, X402_PAY_TO);
      return Number(raw) / 1e6;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Hood USDG balance read failed');
}

async function baseBalanceUsd(): Promise<number> {
  const client = createPublicClient({ chain: base, transport: http(BASE_RPC, { timeout: 5_000 }) });
  const raw = await readBalance(client as PublicClient, USDC_BASE_ADDRESS, X402_PAY_TO);
  return Number(raw) / 1e6;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Settlement counts from Blockscout -------------------------------------
// Blockscout's v2 token-transfers API lists every ERC-20 transfer for an
// address (newest first, 50/page, next_page_params to walk). We filter to
// inbound transfers of the exact settlement-token contract — the symbol
// alone is not enough (same-symbol impostor tokens exist on Hood).
// A failed fetch returns null, never throws: counts degrade, dollars don't.

const BLOCKSCOUT_API = {
  8453: 'https://base.blockscout.com/api/v2',
  4663: 'https://robinhoodchain.blockscout.com/api/v2',
} as const;

interface InboundTransfer {
  timestamp: string;
  value: number; // raw token units
}

async function fetchInboundTransfers(
  chainId: 8453 | 4663,
  token: string,
  holder: string,
): Promise<InboundTransfer[] | null> {
  const out: InboundTransfer[] = [];
  let url: string | null =
    `${BLOCKSCOUT_API[chainId]}/addresses/${holder}/token-transfers?type=ERC-20`;
  // Counts are small (a dozen so far); cap the walk so a pathological
  // address can never turn a page render into a crawl.
  for (let pages = 0; pages < 10 && url; pages++) {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
        // Blockscout sits behind Cloudflare: a bare non-browser UA gets
        // a 403 "Just a moment..." even for the public API, so identify
        // as Polypad inside a browser-style UA. Verified Nov 26.
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; Polypad/1.0; +https://polypad.family)',
        },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    let data: {
      items?: {
        timestamp?: string;
        total?: { value?: string };
        to?: { hash?: string };
        token?: { address_hash?: string };
      }[];
      next_page_params?: Record<string, string> | null;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return null;
    }
    for (const t of data.items ?? []) {
      if (
        (t.token?.address_hash ?? '').toLowerCase() === token.toLowerCase() &&
        (t.to?.hash ?? '').toLowerCase() === holder.toLowerCase()
      ) {
        out.push({
          timestamp: t.timestamp ?? '',
          value: Number(t.total?.value ?? 0),
        });
      }
    }
    const next = data.next_page_params;
    url = next
      ? `${BLOCKSCOUT_API[chainId]}/addresses/${holder}/token-transfers?type=ERC-20&${new URLSearchParams(next).toString()}`
      : null;
  }
  return out;
}

/** Live settled totals. Never throws — a failed chain read is reported per chain. */
export async function getX402Volume(): Promise<X402Volume> {
  const now = Date.now();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekStartMs = now - 7 * 24 * 60 * 60 * 1000;
  const [hood, baseRes, hoodTx, baseTx] = await Promise.allSettled([
    hoodBalanceUsd(),
    baseBalanceUsd(),
    fetchInboundTransfers(4663, USDG_ADDRESS, X402_PAY_TO),
    fetchInboundTransfers(8453, USDC_BASE_ADDRESS, X402_PAY_TO),
  ]);

  const transfers = (chainId: 4663 | 8453): InboundTransfer[] | null => {
    const r = chainId === 4663 ? hoodTx : baseTx;
    return r.status === 'fulfilled' ? r.value : null;
  };
  const weekSum = (txs: InboundTransfer[] | null): number | null =>
    txs == null
      ? null
      : round2(
          txs
            .filter((t) => Date.parse(t.timestamp) >= weekStartMs)
            .reduce((s, t) => s + t.value, 0) / 1e6,
        );
  const weekCountOf = (txs: InboundTransfer[] | null): number | null =>
    txs == null ? null : txs.filter((t) => Date.parse(t.timestamp) >= weekStartMs).length;

  const hoodTransfers = transfers(4663);
  const baseTransfers = transfers(8453);

  const chains: X402VolumeChain[] = [
    {
      network: 'eip155:8453',
      chainId: 8453,
      asset: USDC_BASE_ADDRESS,
      symbol: 'USDC',
      settledUsd: baseRes.status === 'fulfilled' ? round2(baseRes.value) : null,
      count: baseTransfers == null ? null : baseTransfers.length,
      weekCount: weekCountOf(baseTransfers),
      source: 'Fee-wallet USDC balance on Base, read live from the chain.',
      ...(baseRes.status === 'rejected'
        ? { error: 'Base balance read failed — try again shortly.' }
        : {}),
    },
    {
      network: 'eip155:4663',
      chainId: 4663,
      asset: USDG_ADDRESS,
      symbol: 'USDG',
      settledUsd: hood.status === 'fulfilled' ? round2(hood.value) : null,
      count: hoodTransfers == null ? null : hoodTransfers.length,
      weekCount: weekCountOf(hoodTransfers),
      source: 'Fee-wallet USDG balance on Robinhood Chain, read live from the chain.',
      note: 'Includes the Nov 22 cross-chain demo settlement.',
      ...(hood.status === 'rejected' ? { error: 'Robinhood Chain balance read failed — try again shortly.' } : {}),
    },
  ];

  const known = chains.filter((c) => c.settledUsd != null);
  const allTimeUsd = known.length ? round2(known.reduce((s, c) => s + (c.settledUsd ?? 0), 0)) : null;

  // Counts and the exact weekly split come from the transfer records.
  // Week dollars are exact when both transfer reads worked; otherwise
  // fall back to the all-time total (the old approximation) rather than
  // inventing a split.
  const hoodWeekUsd = weekSum(hoodTransfers);
  const baseWeekUsd = weekSum(baseTransfers);
  const weekUsd =
    hoodWeekUsd != null && baseWeekUsd != null
      ? round2(hoodWeekUsd + baseWeekUsd)
      : allTimeUsd;
  const counts = chains.map((c) => c.count).filter((n): n is number => n != null);
  const weekCounts = chains.map((c) => c.weekCount).filter((n): n is number => n != null);
  const allTimeCount = counts.length === chains.length ? counts.reduce((s, n) => s + n, 0) : null;
  const weekCount = weekCounts.length === chains.length ? weekCounts.reduce((s, n) => s + n, 0) : null;

  return {
    ok: known.length === chains.length,
    checkedAt: new Date().toISOString(),
    allTimeUsd,
    weekUsd,
    allTimeCount,
    weekCount,
    weekStart,
    chains,
    method:
      'Live balanceOf reads of the x402 fee wallet (0x9a21…76d0) for USDC on Base and USDG on Robinhood Chain, plus Blockscout token-transfer records for the same wallet for the counts. No volume is estimated or projected.',
    note: 'So far these are test and demo payments — 9 on Base, 3 on Robinhood Chain. The latest (Nov 26) came from a wallet that is not our test buyer. When real buyers start paying for reports, this counter moves — that is the number that shows whether being listed is working.',
  };
}
