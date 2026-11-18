'use client';

import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';
import { useLaunches, useEthPrice } from '@/lib/hooks/use-launches';
import { PolydashLaunchABI, PolydashTokenABI } from '@/lib/contracts/abis';
import { robinhoodChain } from '@/lib/chain';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from '@/components/ui/button';
import { ContractsBanner } from '@/components/contracts-banner';
import { TokenAvatar } from '@/components/token-avatar';
import { formatUsd } from '@/lib/format';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/animate';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { BuyEthButton, BridgeEthLink } from '@/components/onramp/buy-eth';

export function PortfolioContent() {
  const { isConnected, address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { data: launches } = useLaunches();
  const { data: ethUsd } = useEthPrice();
  const { data: positions, isLoading } = useQuery({
    queryKey: ['portfolio', address, launches?.map((l) => l.launchAddress).join(',')],
    enabled: !!client && !!address && !!launches,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !address || !launches?.length) return [];
      const res = await client.multicall({
        contracts: launches.flatMap((l) => [
          { address: l.tokenAddress as `0x${string}`, abi: PolydashTokenABI, functionName: 'balanceOf', args: [address] },
          { address: l.launchAddress as `0x${string}`, abi: PolydashLaunchABI, functionName: 'commitments', args: [address] },
        ]) as any,
        allowFailure: true,
      });
      return launches.map((l, i) => ({
        ...l,
        balance: res[i * 2]?.status === 'success' ? Number(formatEther(res[i * 2].result as bigint)) : 0,
        committed: res[i * 2 + 1]?.status === 'success' ? Number(formatEther(res[i * 2 + 1].result as bigint)) : 0,
      }));
    },
  });

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-container px-5 sm:px-8 py-16 sm:py-20 text-center">
        <FadeIn>
          <p className="text-[14px] text-muted-foreground mb-5 mx-auto max-w-sm">Connect a wallet to see holdings and commitments.</p>
          <ConnectButton.Custom>
            {({ openConnectModal }: any) => (
              <Button onClick={openConnectModal}>Connect wallet</Button>
            )}
          </ConnectButton.Custom>
          <div className="mt-8 flex flex-col items-center gap-3">
            <BuyEthButton className="items-center" />
            <BridgeEthLink />
          </div>
        </FadeIn>
      </div>
    );
  }

  const holdings = (positions ?? []).filter((p) => p.balance > 0).map((p) => ({
    ...p,
    valueEth: p.balance * p.priceEth,
    valueUsd: p.balance * p.priceEth * (ethUsd ?? 0),
  }));
  const commits = (positions ?? []).filter((p) => p.committed > 0);

  const totalValue = holdings.reduce((sum: number, h: any) => sum + (h?.valueUsd ?? 0), 0);

  return (
    <div className="mx-auto max-w-container px-5 sm:px-8 py-8 sm:py-16 space-y-5 sm:space-y-6">
      <ContractsBanner />

      <h1 className="text-lg sm:text-xl font-semibold">Portfolio</h1>

      <div className="glass-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[14px] font-medium">Add ETH to your wallet</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Buy ETH, or bridge ETH you already have on Base to Robinhood Chain.</p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <BuyEthButton />
          <BridgeEthLink />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {[
          { label: 'Total value', value: formatUsd(totalValue) },
          { label: 'Tokens held', value: String(holdings?.length ?? 0) },
          { label: 'Commits', value: String(commits?.length ?? 0) },
        ].map((s) => (
          <FadeIn key={s.label} delay={0.05}>
            <div className="glass-card rounded-xl p-3 sm:p-4">
              <p className="mb-1 truncate text-[11px] uppercase tracking-wider text-muted-foreground sm:text-xs">{s.label}</p>
              <p className="truncate font-mono text-base font-semibold sm:text-xl">{s.value}</p>
            </div>
          </FadeIn>
        ))}
      </div>

      {/* Holdings */}
      <FadeIn delay={0.1}>
        <div className="glass-card rounded-xl p-4 sm:p-5">
          <h2 className="font-semibold text-[15px] mb-3 sm:mb-4">Token holdings</h2>
          <Stagger staggerDelay={0.05}>
            <div className="space-y-2">
              {holdings.map((h: any) => (
                <StaggerItem key={h?.launchAddress}>
                  <Link href={`/token/${h?.launchAddress ?? ''}`} className="flex items-center justify-between gap-3 bg-secondary/30 rounded-lg px-3 sm:px-4 py-3 hover:bg-secondary/50 transition-colors group">
                    <div className="flex min-w-0 items-center gap-3">
                      <TokenAvatar name={h?.name} symbol={h?.symbol} imageUri={h?.imageUri} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-sm">{h?.name} <span className="text-muted-foreground font-mono text-xs">${h?.symbol}</span></p>
                        <p className="text-xs text-muted-foreground font-mono">{Number(h?.balance ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} tokens</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm">{formatUsd(h?.valueUsd)}</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {h.valueEth.toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH
                      </p>
                    </div>
                  </Link>
                </StaggerItem>
              ))}
            </div>
          </Stagger>
          {holdings.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">
              {isLoading ? 'Loading balances…' : <>You don&apos;t hold any Polypad tokens yet. <Link href="/" className="text-primary hover:underline">Explore tokens</Link></>}
            </p>
          )}
        </div>
      </FadeIn>

      {/* Commits */}
      {(commits?.length ?? 0) > 0 && (
        <FadeIn delay={0.15}>
          <div className="glass-card rounded-xl p-4 sm:p-5">
            <h2 className="font-semibold text-[15px] mb-3 sm:mb-4">Active vault commitments</h2>
            <div className="space-y-2">
              {commits.map((c: any) => (
                <div key={c?.launchAddress} className="flex items-center justify-between bg-secondary/30 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <TokenAvatar name={c?.name} symbol={c?.symbol} imageUri={c?.imageUri} size="sm" />
                    <div>
                      <p className="font-semibold text-sm">{c?.name}</p>
                      <p className="text-xs text-muted-foreground">Pre-launch commit</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm">{c.committed.toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH</p>
                    <span className="text-xs text-yellow-400">Pending</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
