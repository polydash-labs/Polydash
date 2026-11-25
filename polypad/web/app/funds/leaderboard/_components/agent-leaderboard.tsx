'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bot, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatEther, parseAbiItem } from 'viem';
import { FundVaultInvestABI } from '@/lib/contracts/fund-abi';
import { robinhoodChain } from '@/lib/chain';
import {
  AgentExecutorABI,
  AgentRegistryABI,
  copyAgentLink,
  formatChange,
  getAgentRegistryAddress,
  parseAgentRecord,
  rankAgents,
  templateById,
  type LeaderboardRow,
  type StrategyParams,
} from '@/lib/fund/agent';
import { formatFundEth } from '@/lib/fund/model';

const NavCheckpointEvent = parseAbiItem('event NavCheckpoint(uint64 indexed timestamp, uint256 nav, uint256 navPerNft)');

/**
 * Agent leaderboard: registered agents ranked by NAV-per-NFT change since
 * investing began. Baseline = the first NavCheckpoint after investing
 * starts (the vault's investBlock). "Too early" when there is no checkpoint
 * yet. Reads via viem; nothing here is estimated or faked.
 */
export function AgentLeaderboard() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const registry = getAgentRegistryAddress();
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agent-leaderboard', registry ?? ''],
    enabled: !!client && !!registry,
    refetchInterval: 30_000,
    queryFn: async (): Promise<LeaderboardRow[]> => {
      if (!client || !registry) return [];
      const count = await client.readContract({ address: registry, abi: AgentRegistryABI, functionName: 'agentCount' });
      const total = Number(count);
      if (!Number.isFinite(total) || total <= 0) return [];
      const ids = await client.readContract({
        address: registry,
        abi: AgentRegistryABI,
        functionName: 'activeAgents',
        args: [0n, BigInt(Math.min(total, 50))],
      });
      const rows = await Promise.all(
        ids.map(async (agentId) => {
          const raw = await client.readContract({ address: registry, abi: AgentRegistryABI, functionName: 'getAgent', args: [agentId] }).catch(() => null);
          const record = raw ? parseAgentRecord(raw) : null;
          if (!record) return null;
          const [navPerNft, investBlock, paused, nextNonce, paramsRaw] = await Promise.all([
            client.readContract({ address: record.vault, abi: FundVaultInvestABI, functionName: 'navPerNft' }).catch(() => 0n),
            client.readContract({ address: record.vault, abi: FundVaultInvestABI, functionName: 'investBlock' }).catch(() => 0n),
            client.readContract({ address: record.executor, abi: AgentExecutorABI, functionName: 'paused' }).catch(() => false),
            client.readContract({ address: record.executor, abi: AgentExecutorABI, functionName: 'nextNonce' }).catch(() => 0n),
            client.readContract({ address: record.executor, abi: AgentExecutorABI, functionName: 'params' }).catch(() => null),
          ]);
          let baseline: number | null = null;
          try {
            if (investBlock > 0n) {
              const checkpoints = await client.getLogs({
                address: record.vault,
                event: NavCheckpointEvent,
                fromBlock: investBlock,
                toBlock: 'latest',
              });
              const first = checkpoints[0];
              const baselineRaw = first?.args.navPerNft;
              if (baselineRaw != null && baselineRaw > 0n) baseline = Number(formatEther(baselineRaw));
            }
          } catch {
            baseline = null;
          }
          let params: StrategyParams | null = null;
          if (paramsRaw) {
            const row = Array.isArray(paramsRaw) ? paramsRaw : Object.values(paramsRaw);
            if (row.length >= 9) {
              params = {
                templateId: Number(row[0] ?? 4) as StrategyParams['templateId'],
                riskLevel: Number(row[1] ?? 1) as StrategyParams['riskLevel'],
                maxPositionBps: Number(row[2] ?? 0),
                maxTradeBps: Number(row[3] ?? 0),
                maxDeviationBps: Number(row[4] ?? 0),
                dailyTradeLimit: Number(row[5] ?? 0),
                circuitBreakerBps: Number(row[6] ?? 0),
                rebalanceIntervalSeconds: Number(row[7] ?? 0),
                rulesHash: (row[8] as `0x${string}`) ?? `0x${'0'.repeat(64)}`,
              };
            }
          }
          return {
            agentId,
            name: record.name || `Agent #${agentId.toString()}`,
            logoURI: record.logoURI,
            templateId: record.templateId,
            fund: record.fund,
            navPerNftEth: navPerNft > 0n ? Number(formatEther(navPerNft)) : null,
            baselineNavPerNftEth: baseline,
            trades: Number(nextNonce),
            active: record.active,
            paused,
            params,
          };
        }),
      );
      const usable = rows.filter((row): row is NonNullable<typeof row> => row !== null);
      return rankAgents(usable);
    },
  });

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-8 sm:px-8 sm:py-12">
      <div className="max-w-xl">
        <h1 className="text-[28px] font-semibold tracking-tight text-white sm:text-[36px]">Agent leaderboard</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-white/60 sm:text-[15px]">
          AI agents managing funds, ranked by how the value per share changed since investing began. The starting
          point is the first NAV checkpoint after investing opened. &ldquo;Too early&rdquo; means there is no
          checkpoint yet, so there is nothing to compare against.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-white/45">
          Past performance does not promise future returns. Unaudited. Not financial advice.
        </p>
      </div>

      {!registry ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/60">
          The agent registry is not set up yet, so there are no agents to rank. Once the registry is deployed, agents
          registered for funds will appear here.
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading agents from Robinhood Chain
        </div>
      ) : isError ? (
        <div className="py-20 text-center text-white/50">
          <p className="text-lg">Could not read the agent registry</p>
          <p className="mt-1 text-sm">Check the connection and try again.</p>
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="py-20 text-center text-white/50">
          <p className="text-lg text-white">No agents yet</p>
          <p className="mt-1 text-sm">Create an agent fund and it will show up here once it is registered.</p>
          <Link href="/funds/create?agent=1" className="mt-4 inline-flex h-9 items-center rounded-full bg-polydash-green px-4 text-[13px] font-medium text-black hover:bg-polydash-green-light">
            Create an agent fund
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-white/45">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Strategy</th>
                <th className="px-4 py-3 font-medium">Fund</th>
                <th className="px-4 py-3 font-medium">Value per share</th>
                <th className="px-4 py-3 font-medium">Change since start</th>
                <th className="px-4 py-3 font-medium">Trades</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data!.map((row, index) => (
                <tr key={row.agentId.toString()} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-white/50">{index + 1}</td>
                  <td className="px-4 py-3">
                    <Link href={`/funds/${row.fund}#agent`} className="flex items-center gap-2">
                      {row.logoURI ? (
                        <img src={row.logoURI} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-400/15"><Bot className="h-4 w-4 text-violet-200" /></span>
                      )}
                      <span className="font-medium text-white">{row.name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-white/70">{templateById(row.templateId).name}</td>
                  <td className="px-4 py-3">
                    <Link href={`/funds/${row.fund}`} className="font-mono text-[12px] text-polydash-green">
                      {row.fund.slice(0, 6)}…{row.fund.slice(-4)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-white/80">
                    {row.navPerNftEth != null ? `${formatFundEth(BigInt(Math.round(row.navPerNftEth * 1e18)))} ETH` : '—'}
                  </td>
                  <td className={`px-4 py-3 font-mono ${row.changePct == null ? 'text-white/50' : row.changePct >= 0 ? 'text-polydash-green' : 'text-red-300'}`}>
                    {formatChange(row.changePct)}
                  </td>
                  <td className="px-4 py-3 font-mono text-white/80">{row.trades}</td>
                  <td className="px-4 py-3 text-white/70">{row.status}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center rounded-full border border-white/15 px-3 text-[12px] font-medium text-white/80 hover:bg-white/5"
                      onClick={async () => {
                        const link = row.params
                          ? copyAgentLink({ templateId: row.templateId, riskLevel: row.params.riskLevel, params: row.params, assets: [], agentName: row.name })
                          : `/funds/create?agent=1&template=${row.templateId}`;
                        try {
                          await navigator.clipboard.writeText(`${window.location.origin}${link}`);
                          setCopied(row.agentId.toString());
                          setTimeout(() => setCopied(null), 2000);
                        } catch {
                          window.location.href = link;
                        }
                      }}
                    >
                      {copied === row.agentId.toString() ? 'Link copied' : 'Use this strategy'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] leading-relaxed text-white/45">
        &ldquo;Use this strategy&rdquo; copies the link that opens the agent wizard prefilled with that agent&apos;s
        strategy and limits. It copies the strategy, not the fund.
      </p>
    </div>
  );
}
