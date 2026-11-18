'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import type { Abi, Hex } from 'viem';
import { toast } from 'sonner';
import {
  FundPhase5ABI, FundSecondaryMarketABI, FundShareRendererABI, FundConvictionLockABI, FundCarryRightsABI, FundNavFloorABI,
} from '@/lib/contracts/fund-phase5-abi';
import { FundNFTPhase3ABI, FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { PHASE3_LOG_CHUNK } from '@/lib/fund/phase3';
import {
  FUND_CARRY, FUND_LOCKS, FUND_MARKET, FUND_NAV_FLOOR, FUND_PHASE5, FUND_RENDERER, PHASE3_FACTORY, PHASE5_DEPLOY_BLOCK, phase5Live, phase5TxError,
  parseListing, parsePosition, parseQueue, parseQuote,
} from '@/lib/fund/phase5';

type Addr = `0x${string}`;
type R = { status: string; result?: unknown };
const ok = (r: R | undefined) => r?.status === 'success' && r.result !== undefined;
const ZERO = '0x0000000000000000000000000000000000000000';
export const P5ABI = {
  hub: FundPhase5ABI as Abi, market: FundSecondaryMarketABI as Abi, renderer: FundShareRendererABI as Abi,
  locks: FundConvictionLockABI as Abi, carry: FundCarryRightsABI as Abi, floor: FundNavFloorABI as Abi, nft: FundNFTPhase3ABI as Abi, vault: FundVaultPhase3ABI as Abi,
};

/** Confirms FundPhase5 points at the same contracts as the env vars. */
export function useRegistryMatch() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p5-registry'],
    enabled: !!client && phase5Live(),
    staleTime: 300_000,
    queryFn: async () => {
      const names = ['factory', 'market', 'renderer', 'locks', 'carry', 'navFloor'];
      const want = [PHASE3_FACTORY, FUND_MARKET, FUND_RENDERER, FUND_LOCKS, FUND_CARRY, FUND_NAV_FLOOR];
      const r = await client!.multicall({ allowFailure: true, contracts: names.map((n) => ({ address: FUND_PHASE5!, abi: P5ABI.hub, functionName: n })) }) as R[];
      const match = r.every((x, i) => ok(x) && String(x.result).toLowerCase() === want[i]);
      if (!match) console.error('Phase 5 registry mismatch', r);
      return match;
    },
  });
}

export type Listing = { id: bigint; seller: Addr; tokenId: bigint; price: bigint; mode: number };

export function useListings(nft: Addr) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { address } = useAccount();
  return useQuery({
    queryKey: ['p5-listings', nft.toLowerCase(), address ?? ''],
    enabled: !!client && phase5Live(),
    refetchInterval: 30_000,
    queryFn: async () => {
      const latest = await client!.getBlockNumber();
      const ids = new Set<bigint>();
      for (let from = PHASE5_DEPLOY_BLOCK; from <= latest; from += PHASE3_LOG_CHUNK) {
        const to = from + PHASE3_LOG_CHUNK - 1n > latest ? latest : from + PHASE3_LOG_CHUNK - 1n;
        const logs = await client!.getContractEvents({ address: FUND_MARKET!, abi: P5ABI.market, eventName: 'Listed', args: { nft }, fromBlock: from, toBlock: to });
        logs.forEach((l: any) => ids.add(l.args.id as bigint));
      }
      const list = [...ids];
      const r = list.length ? await client!.multicall({ allowFailure: true, contracts: list.map((id) => ({ address: FUND_MARKET!, abi: P5ABI.market, functionName: 'listing', args: [id] })) }) as R[] : [];
      const listings: Listing[] = [];
      r.forEach((x, i) => {
        if (!ok(x)) return;
        const v = parseListing(x.result);
        if (!v.active || v.nft?.toLowerCase() !== nft.toLowerCase()) return;
        listings.push({ id: list[i], seller: v.seller, tokenId: v.tokenId, price: v.price, mode: v.mode });
      });
      let proceeds = 0n;
      if (address) proceeds = await client!.readContract({ address: FUND_MARKET!, abi: P5ABI.market, functionName: 'proceeds', args: [address] }) as bigint;
      return { listings, proceeds };
    },
  });
}

export type ShareState = {
  owner: Addr | null; svg: string | null; tier: number; isLocked: boolean; lockHolder: Addr | null; lockExpiry: number;
  inEscrow: boolean; queueHolder: Addr | null; readyAt: number; ethShare: bigint | null; supply: bigint | null; quoteStatus: number | null;
  approved: { market: boolean; locks: boolean; floor: boolean };
};

export function useShare5(nft: Addr, tokenId: bigint | null) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { address } = useAccount();
  return useQuery({
    queryKey: ['p5-share', nft.toLowerCase(), tokenId?.toString() ?? '', address ?? ''],
    enabled: !!client && phase5Live() && tokenId !== null,
    refetchInterval: 30_000,
    queryFn: async (): Promise<ShareState> => {
      const a = [nft, tokenId!] as const;
      const r = await client!.multicall({
        allowFailure: true,
        contracts: [
          { address: nft, abi: P5ABI.nft, functionName: 'ownerOf', args: [tokenId!] },
          { address: FUND_RENDERER!, abi: P5ABI.renderer, functionName: 'svg', args: a },
          { address: FUND_LOCKS!, abi: P5ABI.locks, functionName: 'tierOf', args: a },
          { address: FUND_LOCKS!, abi: P5ABI.locks, functionName: 'isLocked', args: a },
          { address: FUND_LOCKS!, abi: P5ABI.locks, functionName: 'positions', args: a },
          { address: FUND_MARKET!, abi: P5ABI.market, functionName: 'holds', args: a },
          { address: FUND_NAV_FLOOR!, abi: P5ABI.floor, functionName: 'queues', args: a },
          { address: FUND_NAV_FLOOR!, abi: P5ABI.floor, functionName: 'quote', args: a },
          { address: nft, abi: P5ABI.nft, functionName: 'getApproved', args: [tokenId!] },
          { address: nft, abi: P5ABI.nft, functionName: 'isApprovedForAll', args: [address ?? ZERO, FUND_MARKET!] },
        ],
      }) as R[];
      if (!ok(r[1])) console.error('Share art read failed', r[1]);
      const pos = ok(r[4]) ? parsePosition(r[4].result) : null;
      const q = ok(r[6]) ? parseQueue(r[6].result) : null;
      const qt = ok(r[7]) ? parseQuote(r[7].result) : null;
      const appr = ok(r[8]) ? String(r[8].result).toLowerCase() : '';
      return {
        owner: ok(r[0]) ? (r[0].result as Addr) : null,
        svg: ok(r[1]) ? (r[1].result as string) : null,
        tier: ok(r[2]) ? Number(r[2].result) : 0,
        isLocked: ok(r[3]) ? (r[3].result as boolean) : false,
        lockHolder: pos?.holder ?? null,
        lockExpiry: pos?.expiry ?? 0,
        inEscrow: ok(r[5]) ? (r[5].result as boolean) : false,
        queueHolder: q?.holder ?? null,
        readyAt: q?.readyAt ?? 0,
        ethShare: qt?.ethShare ?? null,
        supply: qt?.supply ?? null,
        quoteStatus: qt?.status ?? null,
        approved: {
          market: appr === FUND_MARKET || (ok(r[9]) && (r[9].result as boolean)),
          locks: appr === FUND_LOCKS,
          floor: appr === FUND_NAV_FLOOR,
        },
      };
    },
  });
}

export function useCarry(nft: Addr, vault: Addr) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['p5-carry', nft.toLowerCase()],
    enabled: !!client && phase5Live(),
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await client!.multicall({
        allowFailure: true,
        contracts: [
          { address: FUND_CARRY!, abi: P5ABI.carry, functionName: 'idOf', args: [nft] },
          { address: FUND_CARRY!, abi: P5ABI.carry, functionName: 'routed', args: [nft] },
          { address: FUND_CARRY!, abi: P5ABI.carry, functionName: 'claimable', args: [nft] },
          { address: vault, abi: P5ABI.vault, functionName: 'payoutWallet' },
        ],
      }) as R[];
      const id = ok(r[0]) ? (r[0].result as bigint) : 0n;
      let holder: Addr | null = null;
      if (id > 0n) {
        try { holder = await client!.readContract({ address: FUND_CARRY!, abi: P5ABI.carry, functionName: 'ownerOf', args: [id] }) as Addr; } catch (e) { console.error('Carry owner read failed', e); }
      }
      return {
        id, armed: id > 0n, holder,
        routed: ok(r[1]) ? (r[1].result as boolean) : false,
        claimable: ok(r[2]) ? (r[2].result as bigint) : 0n,
        payoutWallet: ok(r[3]) ? String(r[3].result).toLowerCase() : null,
      };
    },
  });
}

export function usePhase5Tx(registryOk: boolean) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (o: { key: string; address: Addr; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint; success: string; working: string }) => {
    if (!phase5Live() || !registryOk) { toast.error('Phase 5 is not live on this site yet.'); return null; }
    if (!client || !address) { toast.error('Connect a wallet to continue.'); return null; }
    setPending(o.key);
    const tid = toast.loading('Checking the transaction...');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const call = { address: o.address, abi: o.abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, account: address } as any;
      await client.simulateContract(call);
      const hash: Hex = await writeContractAsync({ ...call, account: undefined, chainId: robinhoodChain.id } as any);
      toast.loading(`${o.working} on Robinhood Chain...`, { id: tid });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success, { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await Promise.all(['p5-listings', 'p5-share', 'p5-carry', 'p3-fund', 'p3-funds'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      return receipt;
    } catch (e: any) {
      console.error(`${o.key} failed`, e);
      const name = e?.cause?.data?.errorName ?? e?.data?.errorName;
      toast.error(phase5TxError(String(name ?? e?.shortMessage ?? e?.message ?? 'Transaction failed')), { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };
  return { send, pending, account: address?.toLowerCase() as Addr | undefined };
}
