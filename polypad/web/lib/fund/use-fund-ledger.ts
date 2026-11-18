'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { parseEventLogs, type PublicClient } from 'viem';
import { FundNFTPhase3ABI, FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { robinhoodChain } from '@/lib/chain';
import { chunkedLogs } from '@/lib/fund/use-phase3';

type Addr = `0x${string}`;
const ZERO = '0x0000000000000000000000000000000000000000';

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

type Log = { args?: unknown; blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null };
const order = (a: Log, b: Log) => (a.blockNumber === b.blockNumber ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : (a.blockNumber ?? 0n) < (b.blockNumber ?? 0n) ? -1 : 1);

async function readLedger(client: PublicClient, nft: Addr, vault: Addr): Promise<FundLedger> {
  const [transfers, vaultLogs] = await Promise.all([
    chunkedLogs(client, (fromBlock, toBlock) => client.getContractEvents({ address: nft, abi: FundNFTPhase3ABI, eventName: 'Transfer', fromBlock, toBlock })),
    // Plain address-only log read, decoded locally: some RPCs reject the long topic OR-list of an all-events filter.
    chunkedLogs(client, async (fromBlock, toBlock) => parseEventLogs({ abi: FundVaultPhase3ABI, logs: await client.getLogs({ address: vault, fromBlock, toBlock }), strict: false })),
  ]);
  const owner = new Map<string, string>();
  for (const l of (transfers as Log[]).sort(order)) {
    const a = l.args as { to?: string; tokenId?: bigint };
    if (a.tokenId === undefined || !a.to) continue;
    owner.set(a.tokenId.toString(), a.to.toLowerCase());
  }
  const holders = new Set(Array.from(owner.values()).filter((o) => o !== ZERO)).size;

  const trades: LedgerTrade[] = [];
  const distributions: LedgerDistribution[] = [];
  const fees: LedgerFee[] = [];
  let brakeEvents = 0;
  for (const raw of (vaultLogs as (Log & { eventName?: string })[]).sort(order)) {
    const a = (raw.args ?? {}) as Record<string, unknown>;
    const base = { block: raw.blockNumber ?? 0n, tx: raw.transactionHash ?? '' };
    if (raw.eventName === 'Trade') trades.push({ asset: a.asset as Addr, side: Number(a.side ?? 0) === 0 ? 'Buy' : 'Sell', size: (a.size as bigint) ?? 0n, price: (a.price as bigint) ?? 0n, navAfter: (a.navAfter as bigint) ?? 0n, ...base });
    else if (raw.eventName === 'Distributed') distributions.push({ roundId: Number(a.roundId ?? 0n), pot: (a.pot as bigint) ?? 0n, perUnit: (a.perUnit as bigint) ?? 0n, ...base });
    else if (raw.eventName === 'PerformanceFeeAccrued') fees.push({ kind: 'Counted', amount: (a.amount as bigint) ?? 0n, ...base });
    else if (raw.eventName === 'PerformanceFeeWithdrawn') fees.push({ kind: 'Withdrawn', amount: (a.amount as bigint) ?? 0n, ...base });
    else if (raw.eventName === 'DrawdownBrake') brakeEvents += 1;
  }
  const feesWithdrawn = fees.filter((f) => f.kind === 'Withdrawn').reduce((s, f) => s + f.amount, 0n);
  return { holders, trades: trades.reverse(), distributions: distributions.reverse(), fees: fees.reverse(), feesWithdrawn, brakeEvents };
}

/** Holder count, trade blotter, distributions and fee events, read from Robinhood Chain logs. */
export function useFundLedger(nft: Addr | undefined, vault: Addr | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['ledger', nft ?? '', vault ?? ''],
    enabled: !!client && !!nft && !!vault,
    refetchInterval: 60_000,
    retry: 2,
    queryFn: () => readLedger(client as PublicClient, nft as Addr, vault as Addr),
  });
}
