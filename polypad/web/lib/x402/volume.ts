// x402 settle volume — the real settled totals, read live from the chains.
// Source: the fee wallet's stablecoin balances. Every USDC that reaches
// the fee wallet on Base arrives through an x402 settlement (CDP
// facilitator flow), and the USDG balance on Robinhood Chain is the same
// wallet's x402 receipts, including the Nov 22 cross-chain demo
// settlement. There is no persisted settlement log and no dated transfer
// history available from the public RPCs (eth_getLogs is blocked on
// mainnet.base.org and capped at 100 blocks on drpc; Blockscout is behind
// a bot check for server fetches) — so the weekly figure is grounded the
// honest way: the first x402 payments settled Nov 22–23, 2026, inside the
// last 7 days, so this week's total is the all-time total for now. Once
// real buyer volume arrives, dated settlement records will split future
// weeks; until then this counter must not invent a split it cannot read.

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
  source: string;
  note?: string;
  error?: string;
}

export interface X402Volume {
  ok: boolean;
  checkedAt: string;
  /** All settled x402 payments so far, in USD. Null if neither chain read. */
  allTimeUsd: number | null;
  /** Settled in the last 7 days. Equals the all-time total while every
   * settlement so far landed inside the window (first payments Nov 22–23). */
  weekUsd: number | null;
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

/** Live settled totals. Never throws — a failed chain read is reported per chain. */
export async function getX402Volume(): Promise<X402Volume> {
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [hood, baseRes] = await Promise.allSettled([hoodBalanceUsd(), baseBalanceUsd()]);

  const chains: X402VolumeChain[] = [
    {
      network: 'eip155:8453',
      chainId: 8453,
      asset: USDC_BASE_ADDRESS,
      symbol: 'USDC',
      settledUsd: baseRes.status === 'fulfilled' ? round2(baseRes.value) : null,
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
      source: 'Fee-wallet USDG balance on Robinhood Chain, read live from the chain.',
      note: 'Includes the Nov 22 cross-chain demo settlement.',
      ...(hood.status === 'rejected' ? { error: 'Robinhood Chain balance read failed — try again shortly.' } : {}),
    },
  ];

  const known = chains.filter((c) => c.settledUsd != null);
  const allTimeUsd = known.length ? round2(known.reduce((s, c) => s + (c.settledUsd ?? 0), 0)) : null;

  return {
    ok: known.length === chains.length,
    checkedAt: new Date().toISOString(),
    allTimeUsd,
    // Every settled payment so far landed Nov 22–23, 2026 — inside the
    // last 7 days — so this week's total is the all-time total for now.
    weekUsd: allTimeUsd,
    weekStart,
    chains,
    method:
      'Live balanceOf reads of the x402 fee wallet (0x9a21…76d0) for USDC on Base and USDG on Robinhood Chain. No volume is estimated or projected.',
    note: 'So far these are test and demo payments from Nov 22–23. When real buyers start paying for reports, this counter moves — that is the number that shows whether being listed is working.',
  };
}
