'use client';

import { useQuery } from '@tanstack/react-query';
import { ledgerFromWire, type LedgerWire } from '@/lib/fund/list-wire';

type Addr = `0x${string}`;

export type LedgerTrade = { asset: Addr; side: 'Buy' | 'Sell'; size: bigint; price: bigint; navAfter: bigint; block: bigint; tx: string };
export type LedgerDistribution = { roundId: number; pot: bigint; perUnit: bigint; block: bigint; tx: string };
export type LedgerFee = { kind: 'Counted' | 'Withdrawn'; amount: bigint; block: bigint; tx: string };
export type FundLedger = {
  holders: number;
  trades: LedgerTrade[];
  distributions: LedgerDistribution[];
  fees: LedgerFee[];
  feesWithdrawn: bigint;
  brakeEvents: number;
};

/**
 * Holder count, trade blotter, distributions and fee events, read from Robinhood Chain logs.
 * The two log scans used to run directly from the browser (NFT Transfers + all vault events,
 * ~10M blocks each); on a first load they fired into the same storm that broke the detail
 * page, so Holders showed "Not available" and the trade/fee cards had no data (round 5).
 * The scans now run on the server behind /api/fund/ledger and the browser makes one cheap
 * request.
 */
const LEDGER_TIMEOUT_MS = 15_000;
export function useFundLedger(nft: Addr | undefined, vault: Addr | undefined) {
  return useQuery({
    queryKey: ['ledger', nft ?? '', vault ?? ''],
    enabled: !!nft && !!vault,
    refetchInterval: 60_000,
    // The route's cold read takes ~7s against its 8s bound, so under load
    // it 502s and the page's refresh cycle restarts the pending state —
    // Holders sat on "Counting…" and Trades on "…" for minutes on Polycat
    // (round 7). Retry with backoff (same pattern as useV3Funds) so a cold
    // 502 resolves on its own instead of sticking.
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    queryFn: async (): Promise<FundLedger> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), LEDGER_TIMEOUT_MS);
      try {
        const r = await fetch(`/api/fund/ledger?nft=${nft}&vault=${vault}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`Ledger read failed: ${r.status}`);
        return ledgerFromWire((await r.json()) as LedgerWire);
      } finally {
        clearTimeout(t);
      }
    },
  });
}
