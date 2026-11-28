'use client';

import { useQuery } from '@tanstack/react-query';
import type { TotalTvl } from '@/lib/total-tvl';

/**
 * Total TVL (staked principal + fund vaults, priced on-chain).
 * Same resilience pattern as useFunds: retry with backoff inside the
 * loading state, and keep the last good figure when a background refetch
 * fails — a failed refetch is never rendered as $0.
 */
export function useTotalTvl(initial?: TotalTvl) {
  return useQuery<TotalTvl>({
    queryKey: ['total-tvl'],
    refetchInterval: 60_000,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    // First-paint TVL (server-read, from the /funds page): the card renders
    // with the real figure immediately. staleTime is 0 on purpose: the
    // 60s staleTime used to let a hours-old cached figure sit on screen
    // (React Query keeps ['total-tvl'] across client-side navigations,
    // and refetchInterval pauses in a backgrounded tab), while the
    // homepage platform-usage strip fetches fresh /api/pulse on every
    // mount — so the same page showed two different TVLs ($2,161 hero
    // vs $2,465.68 strip, Nov 27). POLYDASH is priced from a thin V4
    // pool, so any staleness shows up as a big dollar gap. The card
    // still never flashes $0: placeholderData keeps the last good
    // figure while the mount refetch runs.
    initialData: initial,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch('/api/total-tvl');
      if (!res.ok) throw new Error(`Total TVL request failed: ${res.status}`);
      return (await res.json()) as TotalTvl;
    },
  });
}
