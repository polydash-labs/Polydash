'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from 'wagmi';
import { decodeEventLog, type Abi, type Hex, type TransactionReceipt } from 'viem';
import { toast } from 'sonner';
import { FundPhase4ABI } from '@/lib/contracts/fund-phase4-abi';
import { FundFactoryPhase3ABI, FundNFTPhase3ABI, FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { PHASE3_LOG_CHUNK } from '@/lib/fund/phase3';
import { FUND_PHASE4, PHASE4_DEPLOY_BLOCK, phase4Live, phase4TxError } from '@/lib/fund/phase4';

type Addr = `0x${string}`;
type Row = { status: string; result?: unknown; error?: unknown };
const ok = (r: Row | undefined) => r?.status === 'success' && r.result !== undefined;
const ZERO = '0x0000000000000000000000000000000000000000';
const P4 = FundPhase4ABI as Abi;

export type LiveCard = { navTotal: bigint; navPerShare: bigint; hwmPerShare: bigint; peakPerShare: bigint; drawdownBps: bigint; tradeCount: bigint; status: number };
export type Season = {
  index: number; openedAt: number; closedAt: number; navStart: bigint; navEnd: bigint; hwmAtClose: bigint; peakPerShare: bigint;
  maxDrawdownBps: bigint; tradeStart: bigint; tradeEnd: bigint; versusStartBps: bigint; versusHwmBps: bigint; closed: boolean;
};
export type AgentInfo = { agent: Addr | null; expiry: number; maxAmountIn: bigint; active: boolean; gateIsExecutor: boolean };

export type Phase4State = {
  agent: AgentInfo | null;
  vaultAllowsGate: boolean;
  card: LiveCard | null;
  seasons: Season[];
  seasonOpen: boolean;
  openSeason: Season | null;
};

export function usePhase4Fund(nft: Addr, vault: Addr) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p4-fund', nft.toLowerCase()],
    enabled: !!client && phase4Live(),
    refetchInterval: 30_000,
    queryFn: async (): Promise<Phase4State | null> => {
      if (!client || !FUND_PHASE4) return null;
      const p4 = FUND_PHASE4;
      const r = await client.multicall({
        allowFailure: true,
        contracts: [
          { address: p4, abi: P4, functionName: 'agentOf', args: [nft] },
          { address: p4, abi: P4, functionName: 'liveCard', args: [nft] },
          { address: p4, abi: P4, functionName: 'seasonCount', args: [nft] },
          { address: p4, abi: P4, functionName: 'seasonOpen', args: [nft] },
          { address: vault, abi: FundVaultPhase3ABI as Abi, functionName: 'isExecutor', args: [p4] },
        ],
      }) as Row[];
      if (!ok(r[1])) console.error('liveCard read failed', r[1]?.error);
      let agent: AgentInfo | null = null;
      if (ok(r[0])) {
        const a = r[0].result as readonly [Addr, bigint, bigint, boolean, boolean];
        agent = { agent: a[0] === ZERO ? null : a[0], expiry: Number(a[1]), maxAmountIn: a[2], active: a[3], gateIsExecutor: a[4] };
      }
      const count = ok(r[2]) ? Number(r[2].result as bigint) : 0;
      const idx = Array.from({ length: Math.min(count, 50) }, (_, i) => count - 1 - i);
      const sRes = idx.length
        ? (await client.multicall({ allowFailure: true, contracts: idx.map((i) => ({ address: p4, abi: P4, functionName: 'seasonOf', args: [nft, BigInt(i)] })) }) as Row[])
        : [];
      const seasons: Season[] = [];
      sRes.forEach((row, k) => {
        if (!ok(row)) return;
        const s = row.result as Omit<Season, 'index' | 'openedAt' | 'closedAt'> & { openedAt: bigint; closedAt: bigint };
        seasons.push({ ...s, index: idx[k], openedAt: Number(s.openedAt), closedAt: Number(s.closedAt) });
      });
      const seasonOpen = ok(r[3]) ? (r[3].result as boolean) : false;
      const c = ok(r[1]) ? (r[1].result as LiveCard) : null;
      return {
        agent,
        vaultAllowsGate: ok(r[4]) ? (r[4].result as boolean) : false,
        card: c ? { ...c, status: Number(c.status) } : null,
        seasons,
        seasonOpen,
        openSeason: seasonOpen ? seasons.find((s) => !s.closed) ?? null : null,
      };
    },
  });
}

export function useShareWallet(nft: Addr, tokenId: bigint | null) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p4-wallet', nft.toLowerCase(), tokenId?.toString() ?? ''],
    enabled: !!client && phase4Live() && tokenId !== null,
    queryFn: async () => {
      if (!client || !FUND_PHASE4 || tokenId === null) return null;
      const [wallet, enabled] = await client.readContract({ address: FUND_PHASE4, abi: P4, functionName: 'shareWallet', args: [nft, tokenId] }) as readonly [Addr, boolean];
      const code = enabled && wallet !== ZERO ? await client.getCode({ address: wallet }).catch(() => undefined) : undefined;
      return { wallet, enabled, created: !!code && code !== '0x' };
    },
  });
}

export type Offer = {
  id: bigint; bidder: Addr; tokenId: bigint; amount: bigint; expiry: number;
  open: boolean; expired: boolean; withinNav: boolean; navPerShare: bigint;
  holder: Addr | null; approved: boolean;
};

export function useOffers(nft: Addr) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p4-offers', nft.toLowerCase()],
    enabled: !!client && phase4Live(),
    refetchInterval: 30_000,
    queryFn: async (): Promise<Offer[]> => {
      if (!client || !FUND_PHASE4) return [];
      const p4 = FUND_PHASE4;
      const head = await client.getBlockNumber();
      const logs: { id: bigint; tokenId: bigint; bidder: Addr; amount: bigint; expiry: number }[] = [];
      for (let from = PHASE4_DEPLOY_BLOCK; from <= head; from += PHASE3_LOG_CHUNK) {
        const to = from + PHASE3_LOG_CHUNK - 1n > head ? head : from + PHASE3_LOG_CHUNK - 1n;
        const part = await client.getContractEvents({ address: p4, abi: FundPhase4ABI, eventName: 'BidPlaced', fromBlock: from, toBlock: to });
        for (const l of part) {
          const a = l.args as { id?: bigint; nft?: Addr; tokenId?: bigint; bidder?: Addr; amount?: bigint; expiry?: bigint };
          if (a.id === undefined || a.nft?.toLowerCase() !== nft.toLowerCase()) continue;
          logs.push({ id: a.id, tokenId: a.tokenId ?? 0n, bidder: a.bidder ?? ZERO, amount: a.amount ?? 0n, expiry: Number(a.expiry ?? 0n) });
        }
      }
      if (!logs.length) return [];
      const recent = logs.slice(-100);
      const st = await client.multicall({
        allowFailure: true,
        contracts: recent.flatMap((b) => [
          { address: p4, abi: P4, functionName: 'bidStatus', args: [b.id] },
          { address: nft, abi: FundNFTPhase3ABI as Abi, functionName: 'ownerOf', args: [b.tokenId] },
          { address: nft, abi: FundNFTPhase3ABI as Abi, functionName: 'getApproved', args: [b.tokenId] },
        ]),
      }) as Row[];
      const out: Offer[] = recent.map((b, i) => {
        const s = ok(st[i * 3]) ? (st[i * 3].result as readonly [boolean, boolean, boolean, bigint]) : [false, false, false, 0n] as const;
        const holder = ok(st[i * 3 + 1]) ? (st[i * 3 + 1].result as Addr) : null;
        const approvedTo = ok(st[i * 3 + 2]) ? (st[i * 3 + 2].result as Addr) : null;
        return { ...b, open: s[0], expired: s[1], withinNav: s[2], navPerShare: s[3], holder, approved: !!approvedTo && approvedTo.toLowerCase() === p4 };
      });
      // Operator approval also counts.
      const holders = Array.from(new Set(out.filter((o) => o.open && o.holder && !o.approved).map((o) => o.holder as Addr)));
      if (holders.length) {
        const ap = await client.multicall({
          allowFailure: true,
          contracts: holders.map((h) => ({ address: nft, abi: FundNFTPhase3ABI as Abi, functionName: 'isApprovedForAll', args: [h, p4] })),
        }) as Row[];
        const all = new Set(holders.filter((_, i) => ok(ap[i]) && ap[i].result === true).map((h) => h.toLowerCase()));
        out.forEach((o) => { if (o.holder && all.has(o.holder.toLowerCase())) o.approved = true; });
      }
      return out.reverse();
    },
  });
}

/** Simulate, sign in the connected wallet, wait, refresh. Nothing is sent unless Phase 4 is live. */
export function usePhase4Tx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const run = async (key: string, working: string, success: string, exec: () => Promise<Hex>): Promise<TransactionReceipt | null> => {
    if (!phase4Live()) {
      toast.error('Phase 4 is not live on this site yet.');
      return null;
    }
    if (!client || !address) {
      toast.error('Connect a wallet to continue.');
      return null;
    }
    setPending(key);
    const tid = toast.loading('Checking the transaction…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await exec();
      toast.loading(`${working} on Robinhood Chain…`, { id: tid });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      toast.success(success, { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await Promise.all(['p4-fund', 'p4-wallet', 'p4-offers', 'p3-fund', 'p3-funds'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      return receipt;
    } catch (e: any) {
      console.error(`${key} failed`, e);
      const name = e?.cause?.data?.errorName ?? e?.data?.errorName;
      toast.error(phase4TxError(String(name ?? e?.shortMessage ?? e?.message ?? 'Transaction failed')), { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  const send = (o: { key: string; address: Addr; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint; success: string; working: string }) =>
    run(o.key, o.working, o.success, async () => {
      const call = { address: o.address, abi: o.abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, account: address } as any;
      await client!.simulateContract(call);
      return writeContractAsync({ ...call, account: undefined, chainId: robinhoodChain.id } as any);
    });

  /** Asks FundPhase4 for the createFund call, then the connected wallet sends it straight to the factory. */
  const clone = (source: Addr, cosmetic: Record<string, unknown>) => {
    let target: Addr | null = null;
    return run('clone', 'Starting the new fund', 'New fund started', async () => {
      const [to, data] = await client!.readContract({ address: FUND_PHASE4!, abi: P4, functionName: 'cloneFromFund', args: [source, cosmetic] }) as readonly [Addr, Hex];
      target = to;
      await client!.call({ account: address, to, data });
      return sendTransactionAsync({ to, data, chainId: robinhoodChain.id });
    }).then((receipt) => {
      if (!receipt) return undefined;
      if (!target) return null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== target.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: FundFactoryPhase3ABI, data: log.data, topics: log.topics });
          if (ev.eventName === 'FundCreated') return (ev.args as { fund: Addr }).fund;
        } catch { /* other event */ }
      }
      return null;
    });
  };

  return { send, clone, pending, account: address };
}
