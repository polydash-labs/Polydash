'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import type { Abi, PublicClient, TransactionReceipt } from 'viem';
import { toast } from 'sonner';
import { FundFactoryPhase3ABI, FundNFTPhase3ABI, FundVaultPhase3ABI, StrategyTemplateABI } from '@/lib/contracts/fund-phase3-abi';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import type { FundDetailWire } from '@/lib/fund/detail-server';
import { phase3SummaryFromWire, navLogFromWire, type FundKind, type FundsListWire, type NavLogWire } from '@/lib/fund/list-wire';
import {
  FUND_FACTORY_PHASE3,
  PHASE3_DEPLOY_BLOCK,
  PHASE3_LOG_CHUNK,
  STRATEGY_TEMPLATE,
  claimableTotal,
  phase3TxError,
  type StrategyTemplateView,
} from '@/lib/fund/phase3';

type Addr = `0x${string}`;
type Row = { status: string; result?: unknown };
const pick = <T,>(row: Row | undefined, fallback: T): T =>
  row?.status === 'success' && row.result !== undefined ? (row.result as T) : fallback;
const ZERO = '0x0000000000000000000000000000000000000000';

async function readTemplates(client: PublicClient): Promise<StrategyTemplateView[]> {
  const count = Number(await client.readContract({ address: STRATEGY_TEMPLATE, abi: StrategyTemplateABI, functionName: 'templateCount' }));
  if (!count) return [];
  const ids = Array.from({ length: Math.min(count, 50) }, (_, i) => BigInt(i + 1));
  const res = await client.multicall({
    allowFailure: true,
    contracts: ids.flatMap((id) => [
      { address: STRATEGY_TEMPLATE, abi: StrategyTemplateABI, functionName: 'getTemplate' as const, args: [id] as const },
      { address: STRATEGY_TEMPLATE, abi: StrategyTemplateABI, functionName: 'assetsOf' as const, args: [id] as const },
    ]),
  });
  const out: StrategyTemplateView[] = [];
  ids.forEach((id, i) => {
    const t = pick<readonly [Addr, string, bigint, bigint, bigint, bigint, bigint, bigint] | null>(res[i * 2], null);
    if (!t) return;
    out.push({
      id: Number(id),
      mandateHash: t[0],
      mandateUri: t[1],
      maxPositionBps: Number(t[2]),
      maxTradeBps: Number(t[3]),
      maxDeviationBps: Number(t[4]),
      hwmFeeBps: Number(t[5]),
      maxDrawdownBps: Number(t[6]),
      skinLock: Number(t[7]),
      assets: [...pick<readonly Addr[]>(res[i * 2 + 1], [])],
    });
  });
  return out;
}

export function usePhase3Templates() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p3-templates'],
    enabled: !!client,
    staleTime: 60_000,
    queryFn: () => (client ? readTemplates(client) : Promise.resolve([])),
  });
}

export type Phase3Summary = {
  address: Addr;
  index: number;
  name: string;
  symbol: string;
  imageUri: string;
  manager: Addr;
  vault: Addr;
  mintPrice: bigint;
  maxSupply: bigint;
  totalMinted: bigint;
  publicOpen: boolean;
  raised: bigint;
  raiseCap: bigint;
  status: number;
  templateId: number;
};

const NFT_LIST = ['name', 'symbol', 'imageUri', 'manager', 'vault', 'mintPrice', 'maxSupply', 'totalMinted', 'publicOpen'] as const;
const VAULT_LIST = ['raised', 'raiseCap', 'status', 'templateId'] as const;

export async function readSummary(client: PublicClient, address: Addr, index: number): Promise<Phase3Summary | null> {
  const n = await client.multicall({ allowFailure: true, contracts: NFT_LIST.map((functionName) => ({ address, abi: FundNFTPhase3ABI, functionName })) });
  const vault = pick<Addr | undefined>(n[4], undefined);
  const manager = pick<Addr | undefined>(n[3], undefined);
  if (!vault || !manager || vault === ZERO) return null;
  const v = await client.multicall({ allowFailure: true, contracts: VAULT_LIST.map((functionName) => ({ address: vault, abi: FundVaultPhase3ABI, functionName })) });
  return {
    address,
    index,
    name: pick(n[0], '') || 'Tokenized Fund',
    symbol: pick(n[1], ''),
    imageUri: pick(n[2], ''),
    manager,
    vault,
    mintPrice: pick(n[5], 0n),
    maxSupply: pick(n[6], 0n),
    totalMinted: pick(n[7], 0n),
    publicOpen: pick(n[8], false),
    raised: pick(v[0], 0n),
    raiseCap: pick(v[1], 0n),
    status: Number(pick(v[2], 0)),
    templateId: Number(pick(v[3], 0n)),
  };
}

export function usePhase3Funds(initialWire?: FundsListWire) {
  return useQuery({
    queryKey: ['p3-funds'],
    refetchInterval: 20_000,
    // A slow first-paint chain read must not flash the error state: the
    // lists used to read the chain directly from the browser (allFundsLength
    // + allFunds + two multicalls per fund) and the official RPC rejected
    // them in the first-load storm, so the /funds lists sat on "Loading
    // tokenized funds…" for 20+s (round 4). The read now runs once on the
    // server behind /api/funds/list (cached 30s) and the browser makes one
    // cheap request; retry with backoff inside the loading state, and keep
    // the last good list when a background refetch fails. Pass the
    // server-read list and the section renders with real figures on first
    // paint instead of the skeleton.
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    initialData: initialWire ? initialWire.phase3.map(phase3SummaryFromWire) : undefined,
    staleTime: initialWire ? 30_000 : undefined,
    queryFn: async (): Promise<Phase3Summary[]> => {
      const wire = await fetchFundsListWire();
      return wire.phase3.map(phase3SummaryFromWire);
    },
  });
}

/** One cheap request for all four fund lists (shared by the list hooks). */
const FUNDS_LIST_TIMEOUT_MS = 15_000;
export async function fetchFundsListWire(): Promise<FundsListWire> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FUNDS_LIST_TIMEOUT_MS);
  try {
    const r = await fetch('/api/funds/list', { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Could not read the tokenized funds: ${r.status}`);
    return (await r.json()) as FundsListWire;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Which page a fund address belongs to, from /api/fund/kind (one
 * server-side multicall across the three factories). The detail-page
 * switch used to run these three checks from the browser; when they all
 * errored in the first-load storm it fell through to the legacy page,
 * which can never load a V3 fund — that was the Polyfund first-load
 * failure (round 4). The kind never changes for an address, so the result
 * is cached forever; an error keeps retrying inside the loading state and
 * the switch must never fall through on it.
 */
export function useFundKind(address: string) {
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['fund-kind', address.toLowerCase()],
    enabled: valid,
    staleTime: Infinity,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<FundKind> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FUNDS_LIST_TIMEOUT_MS);
      try {
        const r = await fetch(`/api/fund/kind?address=${address}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`Could not read this tokenized fund: ${r.status}`);
        return ((await r.json()) as { kind: FundKind }).kind;
      } finally {
        clearTimeout(t);
      }
    },
  });
}

/** true when the address was created by FundFactoryPhase3. */
export function usePhase3IsFund(address: string) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['p3-isfund', address.toLowerCase()],
    enabled: !!client && valid,
    staleTime: Infinity,
    retry: 2,
    queryFn: async () => {
      if (!client) return false;
      return client.readContract({ address: FUND_FACTORY_PHASE3, abi: FundFactoryPhase3ABI, functionName: 'isFund', args: [address as Addr] });
    },
  });
}

export type NavPoint = { timestamp: number; nav: bigint; navPerNft: bigint; hwmPerNft: bigint; drawdownBps: number; tx: string };

export type Phase3Detail = Phase3Summary & {
  totalBurned: bigint;
  outstanding: bigint;
  managerMinted: bigint;
  entryFeeBps: number;
  protocolFeeBps: number;
  minSkinBps: number;
  skinRequired: bigint;
  skinUnlockTime: number;
  raiseDeadline: number;
  mandateHash: Addr;
  mandateUri: string;
  hwmFeeBps: number;
  hwmPerNft: bigint;
  peakNavPerNft: bigint;
  maxDrawdownBps: number;
  maxPositionBps: number;
  maxTradeBps: number;
  maxDeviationBps: number;
  navPerNft: bigint | null;
  nav: bigint | null;
  spendableEth: bigint;
  distributionReserved: bigint;
  distRound: number;
  claimablePerformanceFee: bigint;
  performanceFeeAccrued: bigint;
  claimableEntryFee: bigint;
  payoutWallet: Addr | null;
  lastNavCheckpoint: number;
  checkpointInterval: number;
  vaultEth: bigint;
  rounds: { id: number; perUnit: bigint; pot: bigint }[];
  myIds: bigint[];
  myClaimable: bigint;
  myUnclaimedIds: bigint[];
};

/** Rehydrate the /api/fund/detail payload: decimal strings back to bigints. */
function fundDetailFromWire(w: FundDetailWire): Omit<Phase3Detail, 'myIds' | 'myClaimable' | 'myUnclaimedIds'> {
  const b = (s: string) => BigInt(s);
  const bn = (s: string | null) => (s === null ? null : BigInt(s));
  return {
    address: w.address,
    index: 0,
    name: w.name,
    symbol: w.symbol,
    imageUri: w.imageUri,
    manager: w.manager,
    vault: w.vault,
    mintPrice: b(w.mintPrice),
    maxSupply: b(w.maxSupply),
    totalMinted: b(w.totalMinted),
    publicOpen: w.publicOpen,
    totalBurned: b(w.totalBurned),
    outstanding: b(w.outstanding),
    managerMinted: b(w.managerMinted),
    entryFeeBps: w.entryFeeBps,
    protocolFeeBps: w.protocolFeeBps,
    minSkinBps: w.minSkinBps,
    skinRequired: b(w.skinRequired),
    skinUnlockTime: w.skinUnlockTime,
    raised: b(w.raised),
    raiseCap: b(w.raiseCap),
    status: w.status,
    templateId: w.templateId,
    raiseDeadline: w.raiseDeadline,
    mandateHash: w.mandateHash,
    mandateUri: w.mandateUri,
    hwmFeeBps: w.hwmFeeBps,
    hwmPerNft: b(w.hwmPerNft),
    peakNavPerNft: b(w.peakNavPerNft),
    maxDrawdownBps: w.maxDrawdownBps,
    maxPositionBps: w.maxPositionBps,
    maxTradeBps: w.maxTradeBps,
    maxDeviationBps: w.maxDeviationBps,
    navPerNft: bn(w.navPerNft),
    nav: bn(w.nav),
    spendableEth: b(w.spendableEth),
    distributionReserved: b(w.distributionReserved),
    distRound: w.distRound,
    claimablePerformanceFee: b(w.claimablePerformanceFee),
    performanceFeeAccrued: b(w.performanceFeeAccrued),
    claimableEntryFee: b(w.claimableEntryFee),
    payoutWallet: w.payoutWallet,
    lastNavCheckpoint: w.lastNavCheckpoint,
    checkpointInterval: w.checkpointInterval,
    vaultEth: b(w.vaultEth),
    rounds: w.rounds.map((r) => ({ id: r.id, perUnit: b(r.perUnit), pot: b(r.pot) })),
  };
}

/** One cheap request for the core detail; 404 means "not a fund" (no retry). */
const FUND_DETAIL_TIMEOUT_MS = 15_000;
async function fetchFundDetailWire(address: string): Promise<FundDetailWire | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FUND_DETAIL_TIMEOUT_MS);
  try {
    const r = await fetch(`/api/fund/detail?address=${address}`, { signal: ctrl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Could not read this tokenized fund: ${r.status}`);
    return (await r.json()) as FundDetailWire;
  } finally {
    clearTimeout(t);
  }
}

export async function chunkedLogs<T>(client: PublicClient, fetch: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const head = await client.getBlockNumber();
  const out: T[] = [];
  for (let from = PHASE3_DEPLOY_BLOCK; from <= head; from += PHASE3_LOG_CHUNK) {
    const to = from + PHASE3_LOG_CHUNK - 1n > head ? head : from + PHASE3_LOG_CHUNK - 1n;
    out.push(...(await fetch(from, to)));
  }
  return out;
}

async function readMyIds(client: PublicClient, nft: Addr, account: Addr): Promise<bigint[]> {
  const logs = await chunkedLogs(client, (fromBlock, toBlock) =>
    client.getContractEvents({ address: nft, abi: FundNFTPhase3ABI, eventName: 'Transfer', args: { to: account }, fromBlock, toBlock }));
  const seen = Array.from(new Set(logs.map((l) => (l.args as { tokenId?: bigint }).tokenId).filter((x): x is bigint => x !== undefined)));
  if (!seen.length) return [];
  const owners = await client.multicall({
    allowFailure: true,
    contracts: seen.map((id) => ({ address: nft, abi: FundNFTPhase3ABI, functionName: 'ownerOf' as const, args: [id] as const })),
  });
  return seen.filter((_, i) => pick<string>(owners[i], '').toLowerCase() === account.toLowerCase()).sort((a, b) => (a < b ? -1 : 1));
}

export function usePhase3Fund(address: string, account?: Addr, enabled = true) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['p3-fund', address.toLowerCase(), account ?? ''],
    enabled: !!client && valid && enabled,
    refetchInterval: 20_000,
    // A slow first-paint read must not flash the error state ("Could not load
    // this tokenized fund right now"): retry with backoff inside the loading
    // state, and keep the last good fund when a background refetch fails
    // (same pattern as usePhase3Funds). The read itself is one cheap request
    // to /api/fund/detail — the browser no longer fires the multicalls.
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Phase3Detail | null> => {
      if (!client) return null;
      // The core read comes from /api/fund/detail: one cheap request, the
      // server does the NFT + vault multicalls (cached 30s). The browser
      // used to fire all 43 contract calls into the first-load storm and the
      // RPC rejected them often enough that the first visit failed outright
      // after ~35s of retries. The NAV log is no longer awaited here either
      // (see useNavLog) — it only feeds the Value history card.
      const wire = await fetchFundDetailWire(address);
      if (!wire) return null;
      const fund = address as Addr;
      const core = fundDetailFromWire(wire);
      const vault = core.vault;
      const rounds = core.rounds;
      // The holder's own shares: connected wallet only, best effort — a slow
      // or failed scan returns [] and the claim UI stays hidden.
      const myIds = account
        ? await readMyIds(client, fund, account).catch((e) => { console.error('Share lookup failed', e); return [] as bigint[]; })
        : [];
      let myClaimable = 0n;
      let myUnclaimedIds: bigint[] = [];
      const ids = myIds.slice(0, 100);
      const active = rounds.filter((r) => r.perUnit > 0n);
      if (ids.length && active.length) {
        const flags = await client.multicall({
          allowFailure: true,
          contracts: active.flatMap((r) => ids.map((id) => ({ address: vault, abi: FundVaultPhase3ABI, functionName: 'distributionClaimed' as const, args: [BigInt(r.id), id] as const }))),
        });
        const claimed = active.map((_, ri) => ids.map((_, ii) => pick(flags[ri * ids.length + ii], true)));
        myClaimable = claimableTotal(active.map((r) => r.perUnit), claimed);
        myUnclaimedIds = ids.filter((_, ii) => claimed.some((row) => !row[ii]));
      }
      return { ...core, myIds, myClaimable, myUnclaimedIds };
    },
  });
}

/**
 * The Value history (NAV log) as its own query: it only feeds the card at
 * the bottom of the detail page, so a slow chain scan of it must never hold
 * up the paint — it used to be awaited inside usePhase3Fund. The scan now
 * runs on the server behind /api/fund/nav-log (round 5): the browser used
 * to walk ~10M blocks of logs straight into the first-load storm and the
 * card sat on "Could not read the value history right now" permanently.
 * It never throws: a failed read reports { error: true } and the card says
 * so. An empty log is a real answer (no value recorded yet).
 */
const NAV_LOG_TIMEOUT_MS = 15_000;
export function useNavLog(vault: Addr | undefined) {
  return useQuery({
    queryKey: ['p3-navlog', vault ?? ''],
    enabled: !!vault,
    staleTime: 60_000,
    retry: 2,
    queryFn: async (): Promise<{ log: NavPoint[]; error: boolean }> => {
      if (!vault) return { log: [], error: false };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), NAV_LOG_TIMEOUT_MS);
      try {
        const r = await fetch(`/api/fund/nav-log?vault=${vault}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`Value history read failed: ${r.status}`);
        return { log: navLogFromWire((await r.json()) as NavLogWire), error: false };
      } catch (e) {
        console.error('NAV log read failed', e);
        return { log: [] as NavPoint[], error: true };
      } finally {
        clearTimeout(t);
      }
    },
  });
}

/** Simulate, sign, wait, refresh. Every Phase 3 write goes through here. */
export function usePhase3Tx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint; success: string; working: string; mapError?: (raw: string) => string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) {
      toast.error('Connect a wallet to continue.');
      return null;
    }
    setPending(o.key);
    const tid = toast.loading('Checking the transaction…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const call = { address: o.address, abi: o.abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, account: address } as any;
      await client.simulateContract(call);
      toast.loading('Confirm in your wallet…', { id: tid });
      const hash = await writeContractAsync({ ...call, account: undefined, chainId: robinhoodChain.id } as any);
      toast.loading(`${o.working} on Robinhood Chain…`, { id: tid });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success, { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['p3-fund'] }),
        qc.invalidateQueries({ queryKey: ['p3-funds'] }),
        qc.invalidateQueries({ queryKey: ['p6'] }),
      ]);
      return receipt;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const name = e?.cause?.data?.errorName ?? e?.data?.errorName;
      toast.error((o.mapError ?? phase3TxError)(String(name ?? e?.shortMessage ?? e?.message ?? 'Transaction failed')), { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  return { send, pending, account: address };
}
