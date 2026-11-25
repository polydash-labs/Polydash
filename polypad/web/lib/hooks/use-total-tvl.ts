'use client';

import { useQuery } from '@tanstack/react-query';
import type { TotalTvl } from '@/lib/total-tvl';

/**
 * Total TVL (staked principal + fund vaults, priced on-chain).
 * Same resilience pattern as useFunds: retry with backoff inside the
 * loading state, and keep the last good figure when a background refetch
 * fails — a failed refetch is never rendered as $0.
 */
export function useTotalTvl() {
  return useQuery<TotalTvl>({
    queryKey: ['total-tvl'],
    refetchInterval: 60_000,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await fetch('/api/total-tvl');
      if (!res.ok) throw new Error(`Total TVL request failed: ${res.status}`);
      return (await res.json()) as TotalTvl;
    },
  });
}
