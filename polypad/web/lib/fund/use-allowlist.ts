'use client';

import { useQuery } from '@tanstack/react-query';
import type { AllowlistWire } from '@/lib/fund/list-wire';

type Addr = `0x${string}`;

export type AllowlistToken = { address: Addr; symbol: string; name: string; status: 'approved' | 'waiting'; readyAt: number };

/**
 * Tokens on the FundAllowlist contract, read live from Robinhood Chain.
 * The proposal walk + per-token metadata reads used to run directly from
 * the browser; on a first load they fired into the same storm that broke
 * the detail page, so the menu sat on "The approved list could not be read
 * right now" (round 5). The reads now run on the server behind
 * /api/funds/allowlist and the browser makes one cheap request.
 */
const ALLOWLIST_TIMEOUT_MS = 15_000;
export function useAllowlistTokens() {
  return useQuery({
    queryKey: ['fund-allowlist-tokens'],
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
    queryFn: async (): Promise<AllowlistToken[]> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ALLOWLIST_TIMEOUT_MS);
      try {
        const r = await fetch('/api/funds/allowlist', { signal: ctrl.signal });
        if (!r.ok) throw new Error(`Allowlist read failed: ${r.status}`);
        return ((await r.json()) as AllowlistWire).tokens;
      } finally {
        clearTimeout(t);
      }
    },
  });
}
