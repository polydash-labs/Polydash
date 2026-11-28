'use client';

import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatEther, type PublicClient } from 'viem';
import { Loader2 } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { StatusPill } from '@/components/bond/notes';
import { BOND_ABI, BOND_FACTORY_ABI } from '@/lib/bondArtifacts';
import { Erc20BondABI, bondFactory, statusLabel, type Addr } from '@/lib/bond';
import { readBondRows, type BondRow } from '@/lib/hooks/use-bond';
import { formatTokens } from '@/lib/format';
import { robinhoodChain } from '@/lib/chain';

type BondListRow = BondRow & { token: Addr; symbol: string; name: string; decimals: number };

async function readAllBonds(client: PublicClient, factory: Addr): Promise<BondListRow[]> {
  const length = Number(await client.readContract({ address: factory, abi: BOND_FACTORY_ABI, functionName: 'allBondsLength' }));
  const n = Math.min(Math.max(length, 0), 100);
  if (n === 0) return [];
  const addrs = (await client.multicall({
    allowFailure: true,
    contracts: Array.from({ length: n }, (_, i) => ({ address: factory, abi: BOND_FACTORY_ABI, functionName: 'allBonds' as const, args: [BigInt(i)] as const })),
  })) as { status: string; result?: unknown }[];
  const bonds = addrs.map((r) => r.result as Addr | undefined).filter((a): a is Addr => !!a && a !== '0x0000000000000000000000000000000000000000');
  if (!bonds.length) return [];
  const rows = await readBondRows(client, [...bonds].reverse());
  const tokens = (await client.multicall({
    allowFailure: true,
    contracts: rows.map((r) => ({ address: r.address, abi: BOND_ABI, functionName: 'token' as const })),
  })) as { status: string; result?: unknown }[];
  const tokenAddrs = tokens.map((r, i) => (r.status === 'success' ? (r.result as Addr) : null) ?? rows[i]?.address as Addr);
  const meta = (await client.multicall({
    allowFailure: true,
    contracts: tokenAddrs.flatMap((t) => [
      { address: t, abi: Erc20BondABI, functionName: 'symbol' as const },
      { address: t, abi: Erc20BondABI, functionName: 'name' as const },
      { address: t, abi: Erc20BondABI, functionName: 'decimals' as const },
    ]),
  })) as { status: string; result?: unknown }[];
  return rows.map((r, i) => ({
    ...r,
    token: tokenAddrs[i],
    symbol: meta[i * 3]?.status === 'success' ? String(meta[i * 3].result ?? '') : '',
    name: meta[i * 3 + 1]?.status === 'success' ? String(meta[i * 3 + 1].result ?? '') : '',
    decimals: meta[i * 3 + 2]?.status === 'success' ? Number(meta[i * 3 + 2].result ?? 18) : 18,
  }));
}

export default function BondIndexPage() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const factory = bondFactory();
  const live = !!factory;
  const bonds = useQuery({
    queryKey: ['bond', 'all', factory],
    enabled: !!client && live,
    staleTime: 60_000,
    refetchInterval: 60_000,
    // Robinhood Chain RPC is slow and sometimes drops a read: retry on a
    // longer backoff than the default, and keep the last good list on screen
    // when a background refetch fails instead of flashing an error.
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(2000 * 2 ** attemptIndex, 15_000),
    placeholderData: keepPreviousData,
    queryFn: () => readAllBonds(client as PublicClient, factory as Addr),
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-14">
        <p className="text-[12px] uppercase tracking-wider text-white/55">Creator bonds</p>
        <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Bonds</h1>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/65">
          A creator puts up ETH as a promise that a token will hold a minimum value. If it falls below that value, the bond is lost.
        </p>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/65">
          The creator locks ETH in a bond and names a minimum amount of the token (the floor) that certain wallets must keep holding. If those wallets fall below the floor before the bond ends, anyone can trigger the bond and holders can redeem tokens for ETH. If the floor holds, the creator gets the ETH back.
        </p>
        <div className="mt-5">
          <Link href="/bond/create" className="inline-block rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-black hover:bg-white/90">
            Post a bond
          </Link>
        </div>

        <div className="mt-8">
          <h2 className="text-[15px] font-semibold text-white">Live bonds</h2>
          {!live ? (
            <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-[13px] text-white/65">
              Bonds are not live yet — the bond factory is not deployed on Robinhood Chain.
            </p>
          ) : bonds.isLoading ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading bonds…</p>
          ) : bonds.isError ? (
            <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-[13px] text-white/60">
              Could not load bonds right now. <button type="button" className="text-white underline" onClick={() => bonds.refetch()}>Try again</button>
            </p>
          ) : !bonds.data?.length ? (
            <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-[13px] text-white/65">
              No bonds posted yet — be the first.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {bonds.data.map((b) => (
                <li key={b.address}>
                  <Link href={`/bond/${b.address}`} className="glass-card block p-4 transition-colors hover:bg-white/[0.05] sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[14px] font-medium text-white">
                        {b.symbol || b.name || 'Bond'}{b.name && b.symbol && b.name !== b.symbol && <span className="ml-1.5 font-normal text-white/50">{b.name}</span>}
                      </span>
                      <StatusPill status={b.status} />
                    </div>
                    <p className="mt-1 text-[13px] text-white/70">
                      Bond {formatEther(b.bondAmount)} ETH · Floor {formatTokens(b.floor, b.decimals)} {b.symbol}
                    </p>
                    <p className="mt-1 text-[12px] text-white/55">
                      {statusLabel(b.status)} · Ends {b.endTime ? new Date(b.endTime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
