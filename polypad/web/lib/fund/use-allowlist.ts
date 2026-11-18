'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { PublicClient } from 'viem';
import { FundAllowlistABI } from '@/lib/contracts/fund-phase6-abi';
import { robinhoodChain } from '@/lib/chain';
import { FUND_ALLOWLIST } from '@/lib/fund/phase3';

type Addr = `0x${string}`;
type R = { status: string; result?: unknown };
const ZERO = '0x0000000000000000000000000000000000000000';
const TokenMetaABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const;

export type AllowlistToken = { address: Addr; symbol: string; name: string; status: 'approved' | 'waiting'; readyAt: number };

/**
 * Tokens on the FundAllowlist contract, read live from Robinhood Chain.
 * Walks every allowlist proposal (asset ones only, routers skipped) and keeps
 * the ones the contract says are allowed now, plus asset proposals still in their public wait.
 */
async function readAllowlist(client: PublicClient): Promise<AllowlistToken[]> {
  const count = Number(await client.readContract({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'proposalCount' }));
  const n = Math.min(Math.max(count, 0), 500);
  const ids = Array.from({ length: n + 1 }, (_, i) => BigInt(i));
  const rows = (await client.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'proposals' as const, args: [id] as const })) })) as R[];
  const now = Math.floor(Date.now() / 1000);
  const seen = new Map<string, { address: Addr; waitingUntil: number }>();
  for (const r of rows) {
    if (r.status !== 'success') continue;
    const p = r.result as readonly [Addr, boolean, boolean, bigint, boolean, boolean];
    const [target, isRouter, allowed, readyAt, executed, canceled] = p;
    if (!target || target === ZERO || isRouter) continue;
    const key = target.toLowerCase();
    const prev = seen.get(key) ?? { address: target, waitingUntil: 0 };
    if (!executed && !canceled && allowed) prev.waitingUntil = Math.max(prev.waitingUntil, Number(readyAt));
    seen.set(key, prev);
  }
  const list = Array.from(seen.values());
  if (!list.length) return [];
  const meta = (await client.multicall({
    allowFailure: true,
    contracts: list.flatMap((t) => [
      { address: FUND_ALLOWLIST, abi: FundAllowlistABI, functionName: 'assetAllowed' as const, args: [t.address] as const },
      { address: t.address, abi: TokenMetaABI, functionName: 'symbol' as const },
      { address: t.address, abi: TokenMetaABI, functionName: 'name' as const },
    ]),
  })) as R[];
  const out: AllowlistToken[] = [];
  list.forEach((t, i) => {
    const allowedNow = meta[i * 3]?.status === 'success' && meta[i * 3].result === true;
    const symbol = meta[i * 3 + 1]?.status === 'success' ? String(meta[i * 3 + 1].result) : '';
    const name = meta[i * 3 + 2]?.status === 'success' ? String(meta[i * 3 + 2].result) : '';
    if (allowedNow) out.push({ address: t.address, symbol: symbol || t.address.slice(0, 8), name, status: 'approved', readyAt: 0 });
    else if (t.waitingUntil > 0) out.push({ address: t.address, symbol: symbol || t.address.slice(0, 8), name, status: 'waiting', readyAt: t.waitingUntil > now ? t.waitingUntil : now });
  });
  return out;
}

export function useAllowlistTokens() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['fund-allowlist-tokens'],
    enabled: !!client,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
    queryFn: () => readAllowlist(client as PublicClient),
  });
}
