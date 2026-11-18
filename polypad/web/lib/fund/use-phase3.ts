'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import type { Abi, PublicClient, TransactionReceipt } from 'viem';
import { toast } from 'sonner';
import { FundFactoryPhase3ABI, FundNFTPhase3ABI, FundVaultPhase3ABI, StrategyTemplateABI } from '@/lib/contracts/fund-phase3-abi';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
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

export function usePhase3Funds() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p3-funds'],
    enabled: !!client,
    refetchInterval: 20_000,
    // A slow first-paint chain read must not flash the error state: the
    // single RPC times out at 10s under concurrent load, so retry with
    // backoff inside the loading state, and keep the last good list when
    // a background refetch fails (same pattern as useV3Funds).
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Phase3Summary[]> => {
      if (!client) return [];
      const count = Number(await client.readContract({ address: FUND_FACTORY_PHASE3, abi: FundFactoryPhase3ABI, functionName: 'allFundsLength' }));
      if (!count) return [];
      const addrs = await client.multicall({
        allowFailure: true,
        contracts: Array.from({ length: count }, (_, i) => ({ address: FUND_FACTORY_PHASE3, abi: FundFactoryPhase3ABI, functionName: 'allFunds' as const, args: [BigInt(i)] as const })),
      });
      const rows = await Promise.all(addrs.map((r, i) => (r.status === 'success' ? readSummary(client, r.result as Addr, i) : Promise.resolve(null))));
      return rows.filter((r): r is Phase3Summary => r !== null).reverse();
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
  navLog: NavPoint[];
  navLogError: boolean;
  rounds: { id: number; perUnit: bigint; pot: bigint }[];
  myIds: bigint[];
  myClaimable: bigint;
  myUnclaimedIds: bigint[];
};

const NFT_DETAIL = [
  'name', 'symbol', 'imageUri', 'manager', 'vault', 'mintPrice', 'maxSupply', 'totalMinted', 'publicOpen',
  'totalBurned', 'outstanding', 'managerMinted', 'entryFeeBps', 'protocolFeeBps', 'minSkinBps', 'skinRequired', 'skinUnlockTime',
] as const;
const VAULT_DETAIL = [
  'raised', 'raiseCap', 'status', 'templateId', 'raiseDeadline', 'mandateHash', 'mandateUri', 'hwmFeeBps', 'hwmPerNft',
  'peakNavPerNft', 'maxDrawdownBps', 'maxPositionBps', 'maxTradeBps', 'maxDeviationBps', 'navPerNft', 'nav', 'spendableEth',
  'distributionReserved', 'distRound', 'claimablePerformanceFee', 'performanceFeeAccrued', 'claimableEntryFee', 'payoutWallet',
  'lastNavCheckpoint', 'NAV_CHECKPOINT_INTERVAL',
] as const;

export async function chunkedLogs<T>(client: PublicClient, fetch: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const head = await client.getBlockNumber();
  const out: T[] = [];
  for (let from = PHASE3_DEPLOY_BLOCK; from <= head; from += PHASE3_LOG_CHUNK) {
    const to = from + PHASE3_LOG_CHUNK - 1n > head ? head : from + PHASE3_LOG_CHUNK - 1n;
    out.push(...(await fetch(from, to)));
  }
  return out;
}

async function readNavLog(client: PublicClient, vault: Addr): Promise<NavPoint[]> {
  const logs = await chunkedLogs(client, (fromBlock, toBlock) =>
    client.getContractEvents({ address: vault, abi: FundVaultPhase3ABI, eventName: 'NavTape', fromBlock, toBlock }));
  return logs
    .map((l) => {
      const a = l.args as { timestamp?: bigint; nav?: bigint; navPerNft?: bigint; hwmPerNft?: bigint; drawdownBps?: bigint };
      return {
        timestamp: Number(a.timestamp ?? 0n),
        nav: a.nav ?? 0n,
        navPerNft: a.navPerNft ?? 0n,
        hwmPerNft: a.hwmPerNft ?? 0n,
        drawdownBps: Number(a.drawdownBps ?? 0n),
        tx: l.transactionHash ?? '',
      };
    })
    .sort((x, y) => x.timestamp - y.timestamp)
    .slice(-300);
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
    queryFn: async (): Promise<Phase3Detail | null> => {
      if (!client) return null;
      const fund = address as Addr;
      const n = await client.multicall({ allowFailure: true, contracts: NFT_DETAIL.map((functionName) => ({ address: fund, abi: FundNFTPhase3ABI, functionName })) });
      const vault = pick<Addr | undefined>(n[4], undefined);
      const manager = pick<Addr | undefined>(n[3], undefined);
      if (!vault || !manager || vault === ZERO) return null;
      const v = await client.multicall({ allowFailure: true, contracts: VAULT_DETAIL.map((functionName) => ({ address: vault, abi: FundVaultPhase3ABI, functionName })) });
      const distRound = Number(pick(v[18], 0n));
      const roundIds = Array.from({ length: Math.min(distRound, 200) }, (_, i) => i + 1);
      const [vaultEth, navLogRes, roundRes, myIds] = await Promise.all([
        client.getBalance({ address: vault }).catch(() => 0n),
        readNavLog(client, vault).then((log) => ({ log, error: false })).catch((e) => { console.error('NAV log read failed', e); return { log: [] as NavPoint[], error: true }; }),
        roundIds.length
          ? client.multicall({ allowFailure: true, contracts: roundIds.map((r) => ({ address: vault, abi: FundVaultPhase3ABI, functionName: 'rounds' as const, args: [BigInt(r)] as const })) })
          : Promise.resolve([]),
        account ? readMyIds(client, fund, account).catch((e) => { console.error('Share lookup failed', e); return [] as bigint[]; }) : Promise.resolve([] as bigint[]),
      ]);
      const rounds = roundIds.map((id, i) => {
        const r = pick<readonly [bigint, bigint] | null>(roundRes[i] as Row, null);
        return { id, perUnit: r?.[0] ?? 0n, pot: r?.[1] ?? 0n };
      });
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
      const optBig = (row: Row | undefined) => (row?.status === 'success' ? (row.result as bigint) : null);
      const payout = pick<Addr | null>(v[22], null);
      return {
        address: fund,
        index: 0,
        name: pick(n[0], '') || 'Tokenized Fund',
        symbol: pick(n[1], ''),
        imageUri: pick(n[2], ''),
        manager,
        vault,
        mintPrice: pick(n[5], 0n),
        maxSupply: pick(n[6], 0n),
        totalMinted: pick(n[7], 0n),
        publicOpen: pick(n[8], false),
        totalBurned: pick(n[9], 0n),
        outstanding: pick(n[10], 0n),
        managerMinted: pick(n[11], 0n),
        entryFeeBps: Number(pick(n[12], 0n)),
        protocolFeeBps: Number(pick(n[13], 0n)),
        minSkinBps: Number(pick(n[14], 0n)),
        skinRequired: pick(n[15], 0n),
        skinUnlockTime: Number(pick(n[16], 0n)),
        raised: pick(v[0], 0n),
        raiseCap: pick(v[1], 0n),
        status: Number(pick(v[2], 0)),
        templateId: Number(pick(v[3], 0n)),
        raiseDeadline: Number(pick(v[4], 0n)),
        mandateHash: pick(v[5], '0x' as Addr),
        mandateUri: pick(v[6], ''),
        hwmFeeBps: Number(pick(v[7], 0n)),
        hwmPerNft: pick(v[8], 0n),
        peakNavPerNft: pick(v[9], 0n),
        maxDrawdownBps: Number(pick(v[10], 0n)),
        maxPositionBps: Number(pick(v[11], 0n)),
        maxTradeBps: Number(pick(v[12], 0n)),
        maxDeviationBps: Number(pick(v[13], 0n)),
        navPerNft: optBig(v[14]),
        nav: optBig(v[15]),
        spendableEth: pick(v[16], 0n),
        distributionReserved: pick(v[17], 0n),
        distRound,
        claimablePerformanceFee: pick(v[19], 0n),
        performanceFeeAccrued: pick(v[20], 0n),
        claimableEntryFee: pick(v[21], 0n),
        payoutWallet: payout && payout !== ZERO ? payout : null,
        lastNavCheckpoint: Number(pick(v[23], 0n)),
        checkpointInterval: Number(pick(v[24], 3600n)),
        vaultEth,
        navLog: navLogRes.log,
        navLogError: navLogRes.error,
        rounds,
        myIds,
        myClaimable,
        myUnclaimedIds,
      };
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
