'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePhase3Funds, type Phase3Summary } from '@/lib/fund/use-phase3';
import { useV3Funds } from '@/lib/fund/use-v3';
import { useV2Funds } from '@/lib/fund/use-phase6';
import type { ActivityRow, MintActivity, StakeActivity, TerminalActivity, TickerRow, TradeActivity } from './types';

export type { ActivityRow, MintActivity, StakeActivity, TerminalActivity, TickerRow, TradeActivity } from './types';

export type TerminalFundRow = Phase3Summary & {
  generation: 'V3' | 'Phase 3' | 'V2';
  /** null when the live NAV read failed or timed out — never silently replaced with the mint price. */
  navPerNft: bigint | null;
  totalNav: bigint | null;
  /** True when this value is the last good read, not a fresh one. */
  navStale: boolean;
  /** When the last good NAV read happened (ms), if this row is stale. */
  navUpdatedAt: number | null;
};

/** NAV reads that take longer than this are treated as failed, not left hanging. */
export const NAV_TIMEOUT_MS = 15_000;
/** Activity reads that take longer than this are treated as failed, not left hanging. */
export const ACTIVITY_TIMEOUT_MS = 20_000;

export function strategyLabel(templateId: number): string {
  if (templateId >= 6 && templateId <= 9) return `Strategy #${templateId} · LP-Dividend`;
  if (templateId === 1) return 'Strategy #1 · Growth';
  if (templateId >= 2 && templateId <= 5) return `Strategy #${templateId} · Growth`;
  return `Strategy #${templateId}`;
}

/** Every live Tokenized Fund (V3 + Phase 3 + V2 factories), ranked by NAV per share. */
export function useTerminalFunds() {
  const v3 = useV3Funds();
  const p3 = usePhase3Funds();
  const v2 = useV2Funds();

  const funds = useMemo(() => {
    const seen = new Set<string>();
    const out: (Phase3Summary & { generation: TerminalFundRow['generation'] })[] = [];
    const push = (list: Phase3Summary[] | undefined, generation: TerminalFundRow['generation']) => {
      for (const f of list ?? []) {
        const key = f.address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...f, generation });
      }
    };
    push(v3.data, 'V3');
    push(p3.data, 'Phase 3');
    push(v2.data, 'V2');
    return out;
  }, [v3.data, p3.data, v2.data]);

  const key = funds.map((f) => f.address.toLowerCase()).join(',');
  // Last good NAV per fund, so a failed read can show a labelled stale value
  // instead of silently falling back to the mint price.
  const lastGood = useRef(new Map<string, { nav: bigint; total: bigint; at: number }>());
  const nav = useQuery({
    queryKey: ['terminal-nav', key],
    enabled: funds.length > 0,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async (): Promise<TerminalFundRow[]> => {
      // The NAV reads used to run in the browser (a multicall per vault
      // plus a balance per vault) into the first-load storm; they timed out
      // often enough that the leaderboard cycled "Value unavailable,
      // retrying" → "Could not load the leaderboard right now" → recovered
      // (round 4). The read now runs once on the server behind
      // /api/terminal/leaderboard (cached 30s); the browser makes one cheap
      // request. The route takes the vault addresses because the Terminal
      // already has the fund list from /api/funds/list — re-reading the
      // factory lists in the route would triple the cold cost. A slow chain
      // must not leave the page hanging on a stale-looking value: the fetch
      // times out at 15s and the UI marks the row unavailable (it retries
      // in 30s).
      const vaults = funds.map((f) => f.vault).join(',');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), NAV_TIMEOUT_MS);
      try {
        const r = await fetch(`/api/terminal/leaderboard?vaults=${encodeURIComponent(vaults)}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`Could not read the leaderboard: ${r.status}`);
        const j = (await r.json()) as {
          navs: Record<string, { navPerNft: string | null; totalNav: string | null }>;
          updatedAt: number;
        };
        return funds.map((f) => {
          const n = j.navs[f.vault.toLowerCase()];
          return {
            ...f,
            navPerNft: n?.navPerNft == null ? null : BigInt(n.navPerNft),
            totalNav: n?.totalNav == null ? null : BigInt(n.totalNav),
            navStale: false,
            navUpdatedAt: null,
          };
        });
      } finally {
        clearTimeout(t);
      }
    },
  });

  // Remember every successful NAV read with its timestamp.
  useEffect(() => {
    if (!nav.data) return;
    const at = Date.now();
    for (const r of nav.data) {
      if (r.navPerNft != null) lastGood.current.set(r.address.toLowerCase(), { nav: r.navPerNft, total: r.totalNav ?? 0n, at });
    }
  }, [nav.data]);

  // Rows for the UI: fresh NAV when the read worked; the last good value
  // labelled stale when the latest read failed; null (unavailable) otherwise.
  // The mint price is never shown as if it were the live value.
  const rows = useMemo<TerminalFundRow[]>(() => {
    const byAddr = new Map((nav.data ?? []).map((r) => [r.address.toLowerCase(), r]));
    const out = funds.map((f) => {
      const r = byAddr.get(f.address.toLowerCase());
      const g = lastGood.current.get(f.address.toLowerCase());
      if (!nav.isError && r?.navPerNft != null) return { ...r, navStale: false, navUpdatedAt: null };
      if (g) return { ...f, navPerNft: g.nav, totalNav: g.total, navStale: true, navUpdatedAt: g.at };
      return { ...f, navPerNft: null, totalNav: r?.totalNav ?? null, navStale: false, navUpdatedAt: null };
    });
    out.sort((a, b) => {
      const av = a.navPerNft ?? -1n, bv = b.navPerNft ?? -1n;
      return av === bv ? 0 : av > bv ? -1 : 1;
    });
    return out;
  }, [funds, nav.data, nav.isError]);

  const refetch = () => {
    void v3.refetch();
    void p3.refetch();
    void v2.refetch();
    void nav.refetch();
  };

  return {
    rows,
    isLoading: v3.isLoading || p3.isLoading || v2.isLoading || (funds.length > 0 && nav.isLoading && !nav.data),
    // A failed NAV read is a per-row "unavailable", not a page error.
    isError: v3.isError || p3.isError || v2.isError,
    isFetching: v3.isFetching || p3.isFetching || v2.isFetching || nav.isFetching,
    fundAddresses: funds.map((f) => f.address),
    funds,
    refetch,
  };
}

/** The activity payload as it arrives over JSON: blocks are numbers and tokenIds strings (BigInts cannot go over JSON). */
type ActivityWireRow =
  | (Omit<TradeActivity, 'block'> & { block: number })
  | (Omit<MintActivity, 'block' | 'tokenId'> & { block: number; tokenId: string })
  | StakeActivity;

/**
 * The newest on-chain activity in the last 24h: token trades, Tokenized Fund
 * share mints, and new staking pools. The heavy scan (~27 chunked log
 * queries plus up to 40 block reads) used to run in the browser and timed
 * out at 20s against the official RPC, so a first-time visitor never got
 * data. It now runs once on the server behind /api/terminal/activity
 * (cached 30s); the browser makes one cheap request. A 202 { pending: true }
 * means the first server-side scan is still running — poll the route until
 * data arrives or the 20s timeout hits.
 */
export function useTerminalActivity(fundAddresses: `0x${string}`[]) {
  const key = fundAddresses.join(',');
  return useQuery({
    queryKey: ['terminal-activity', key],
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async (): Promise<TerminalActivity> => {
      const deadline = Date.now() + ACTIVITY_TIMEOUT_MS;
      for (;;) {
        const r = await fetch(`/api/terminal/activity?funds=${encodeURIComponent(key)}`);
        if (r.status === 202) {
          if (Date.now() > deadline - 2_000) throw new Error('Activity timed out');
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          continue;
        }
        if (!r.ok) throw new Error(`Could not read recent activity: ${r.status}`);
        const j = (await r.json()) as { rows: ActivityWireRow[]; ticker: TickerRow[]; updatedAt: number; degraded: boolean };
        const rows: ActivityRow[] = j.rows.map((row) =>
          row.kind === 'trade'
            ? { ...row, block: BigInt(row.block) }
            : row.kind === 'mint'
              ? { ...row, block: BigInt(row.block), tokenId: BigInt(row.tokenId) }
              : row,
        );
        return { rows, ticker: j.ticker, updatedAt: j.updatedAt, degraded: j.degraded };
      }
    },
  });
}
