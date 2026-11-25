'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Loader2, Pause, Play, XCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { formatEther, parseAbiItem } from 'viem';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { FundVaultInvestABI } from '@/lib/contracts/fund-abi';
import { robinhoodChain } from '@/lib/chain';
import {
  AgentExecutorABI,
  AgentRegistryABI,
  copyAgentLink,
  explainTrade,
  getAgentRegistryAddress,
  parseAgentRecord,
  templateById,
  type AgentRecord,
  type StrategyParams,
} from '@/lib/fund/agent';
import { formatFundEth, fundTxError } from '@/lib/fund/model';
import type { FundInvestView } from '@/lib/fund/invest';
import { shortenAddress } from '@/lib/format';

const TradeEvent = parseAbiItem('event Trade(address indexed asset, uint8 side, uint256 size, uint256 price, uint256 navAfter)');
const InstructionExecutedEvent = parseAbiItem('event InstructionExecuted(address indexed vault, address assetIn, address assetOut, uint256 amountIn, uint256 minAmountOut, uint256 nonce, uint256 navPerNftAfter)');

type FeedEntry = {
  key: string;
  blockNumber: bigint;
  side: 'buy' | 'sell';
  asset: `0x${string}`;
  symbol: string;
  amountEth: number | null;
  priceChangePct: number | null;
  navPerNftEth: number | null;
};

/**
 * Agent card on the fund detail page. Shown only when the fund has a
 * registered agent. The decision feed reads InstructionExecuted events
 * from the executor plus Trade events from the vault blotter, and explains
 * each one with the strategy rule + the numbers. The runner's LLM
 * reasoning lives in its decision log, not on-chain — this card does not
 * pretend otherwise.
 */
export function AgentCard({
  fund,
  vault,
  invest,
  isManager,
  navPerNft,
}: {
  fund: `0x${string}`;
  vault: `0x${string}`;
  invest: FundInvestView | null;
  isManager: boolean;
  navPerNft: bigint;
}) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const registry = getAgentRegistryAddress();
  const { data, isLoading } = useQuery({
    queryKey: ['agent-card', registry ?? '', fund.toLowerCase()],
    enabled: !!client && !!registry,
    refetchInterval: 20_000,
    queryFn: async () => {
      if (!client || !registry) return null;
      const agentId = await client.readContract({
        address: registry,
        abi: AgentRegistryABI,
        functionName: 'agentOfFund',
        args: [fund],
      });
      if (agentId === 0n) return null;
      const raw = await client.readContract({
        address: registry,
        abi: AgentRegistryABI,
        functionName: 'getAgent',
        args: [agentId],
      });
      const record = parseAgentRecord(raw);
      if (!record) return null;
      const executor = record.executor;
      const [paused, retired, nextNonce, paramsRaw] = await Promise.all([
        client.readContract({ address: executor, abi: AgentExecutorABI, functionName: 'paused' }).catch(() => false),
        client.readContract({ address: executor, abi: AgentExecutorABI, functionName: 'retired' }).catch(() => false),
        client.readContract({ address: executor, abi: AgentExecutorABI, functionName: 'nextNonce' }).catch(() => 0n),
        client.readContract({ address: executor, abi: AgentExecutorABI, functionName: 'params' }).catch(() => null),
      ]);
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
      return { agentId, record, paused, retired, trades: Number(nextNonce), params };
    },
  });

  if (!registry || isLoading) return null;
  if (!data) return null;
  return <AgentCardBody fund={fund} vault={vault} invest={invest} isManager={isManager} navPerNft={navPerNft} {...data} />;
}

function AgentCardBody({
  fund,
  vault,
  invest,
  isManager,
  navPerNft,
  agentId,
  record,
  paused,
  retired,
  trades,
  params,
}: {
  fund: `0x${string}`;
  vault: `0x${string}`;
  invest: FundInvestView | null;
  isManager: boolean;
  navPerNft: bigint;
  agentId: bigint;
  record: AgentRecord;
  paused: boolean;
  retired: boolean;
  trades: number;
  params: StrategyParams | null;
}) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const registry = getAgentRegistryAddress();
  const { address: account, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [backtested, setBacktested] = useState(false);

  useEffect(() => {
    try {
      setBacktested(localStorage.getItem(`polypad-agent-backtested:${agentId.toString()}`) === '1');
    } catch {
      setBacktested(false);
    }
  }, [agentId]);

  const { data: feed } = useQuery({
    queryKey: ['agent-feed', record.executor.toLowerCase(), vault.toLowerCase()],
    enabled: !!client,
    refetchInterval: 30_000,
    queryFn: async (): Promise<FeedEntry[]> => {
      if (!client) return [];
      const entries: FeedEntry[] = [];
      const symbolFor = (asset: string): string => {
        if (asset.toLowerCase() === (invest?.weth ?? '').toLowerCase()) return 'WETH';
        return invest?.holdings.find((row) => row.asset.toLowerCase() === asset.toLowerCase())?.symbol
          ?? `${asset.slice(0, 6)}…${asset.slice(-4)}`;
      };
      // InstructionExecuted events from the executor.
      try {
        const logs = await client.getLogs({
          address: record.executor,
          event: InstructionExecutedEvent,
          fromBlock: 0n,
          toBlock: 'latest',
        });
        for (const log of logs) {
          const args = log.args as unknown as { assetIn?: string; assetOut?: string; amountIn?: bigint; navPerNftAfter?: bigint };
          const assetIn = (args.assetIn ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
          const assetOut = (args.assetOut ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
          const isEthIn = assetIn === '0x0000000000000000000000000000000000000000' || (invest && assetIn.toLowerCase() === invest.weth.toLowerCase());
          const isEthOut = assetOut === '0x0000000000000000000000000000000000000000' || (invest && assetOut.toLowerCase() === invest.weth.toLowerCase());
          const side: 'buy' | 'sell' = isEthOut ? 'sell' : 'buy';
          const asset = side === 'buy' ? assetOut : assetIn;
          entries.push({
            key: `ix-${log.blockNumber}-${log.logIndex}`,
            blockNumber: log.blockNumber,
            side,
            asset,
            symbol: symbolFor(asset),
            amountEth: isEthIn && args.amountIn != null ? Number(formatEther(args.amountIn)) : null,
            priceChangePct: null,
            navPerNftEth: args.navPerNftAfter != null ? Number(formatEther(args.navPerNftAfter)) : null,
          });
        }
      } catch {
        /* executor logs unavailable — fall back to the blotter below */
      }
      // Trade events from the vault blotter (side 0 = buy, 1 = sell).
      try {
        const logs = await client.getLogs({
          address: vault,
          event: TradeEvent,
          fromBlock: 0n,
          toBlock: 'latest',
        });
        const lastPrice = new Map<string, bigint>();
        for (const log of logs) {
          const args = log.args as unknown as { asset?: string; side?: number; size?: bigint; price?: bigint; navAfter?: bigint };
          const asset = (args.asset ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
          const price = args.price ?? 0n;
          const prev = lastPrice.get(asset.toLowerCase());
          const priceChangePct = prev != null && prev > 0n && price > 0n
            ? (Number((price - prev) * 10_000n / prev) / 100)
            : null;
          lastPrice.set(asset.toLowerCase(), price);
          entries.push({
            key: `trade-${log.blockNumber}-${log.logIndex}`,
            blockNumber: log.blockNumber,
            side: args.side === 1 ? 'sell' : 'buy',
            asset,
            symbol: symbolFor(asset),
            amountEth: null,
            priceChangePct,
            navPerNftEth: args.navAfter != null ? Number(formatEther(args.navAfter)) : null,
          });
        }
      } catch {
        /* blotter logs unavailable — use the on-chain blotter rows instead */
      }
      // Fall back to the vault blotter rows when no events were found.
      if (entries.length === 0 && invest) {
        const lastPrice = new Map<string, bigint>();
        invest.trades.forEach((trade, index) => {
          const prev = lastPrice.get(trade.asset.toLowerCase());
          const priceChangePct = prev != null && prev > 0n && trade.price > 0n
            ? Number(((trade.price - prev) * 10_000n) / prev) / 100
            : null;
          lastPrice.set(trade.asset.toLowerCase(), trade.price);
          const holding = invest.holdings.find((row) => row.asset.toLowerCase() === trade.asset.toLowerCase());
          entries.push({
            key: `blotter-${index}`,
            blockNumber: 0n,
            side: trade.side === 1 ? 'sell' : 'buy',
            asset: trade.asset,
            symbol: holding?.symbol ?? `${trade.asset.slice(0, 6)}…${trade.asset.slice(-4)}`,
            amountEth: null,
            priceChangePct,
            navPerNftEth: trade.navAfter > 0n ? Number(formatEther(trade.navAfter)) : null,
          });
        });
      }
      entries.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
      return entries.slice(0, 20);
    },
  });

  const send = async (label: string, fn: () => Promise<`0x${string}`>) => {
    if (!client) return;
    setPending(true);
    const tid = toast.loading('Confirm in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      toast.loading(label, { id: tid });
      const hash = await fn();
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['agent-card'] });
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      toast.success('Signed and sent', { id: tid, action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') } });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setPending(false);
    }
  };

  const pauseToggle = () => {
    if (paused) {
      void send('Resuming the agent…', () => writeContractAsync({
        address: record.executor, abi: AgentExecutorABI, functionName: 'unpause', chainId: robinhoodChain.id,
      }));
    } else {
      void send('Pausing the agent…', () => writeContractAsync({
        address: record.executor, abi: AgentExecutorABI, functionName: 'pause', chainId: robinhoodChain.id,
      }));
    }
  };

  const revoke = async () => {
    if (!registry) return;
    if (!window.confirm('Remove this agent? It will stop trading for the vault and be retired from the directory. This cannot be undone from here.')) return;
    setPending(true);
    const tid = toast.loading('Confirm in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      toast.loading('Removing the agent from the vault…', { id: tid });
      const hash1 = await writeContractAsync({
        address: vault, abi: FundVaultInvestABI, functionName: 'setExecutor', chainId: robinhoodChain.id,
        args: [record.executor, false],
      });
      const receipt1 = await client!.waitForTransactionReceipt({ hash: hash1 });
      if (receipt1.status !== 'success') throw new Error('Transaction reverted');
      toast.loading('Retiring the agent from the directory…', { id: tid });
      const hash2 = await writeContractAsync({
        address: registry, abi: AgentRegistryABI, functionName: 'retireAgent', chainId: robinhoodChain.id,
        args: [agentId],
      });
      const receipt2 = await client!.waitForTransactionReceipt({ hash: hash2 });
      if (receipt2.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['agent-card'] });
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      toast.success('Agent removed', { id: tid, action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash2), '_blank') } });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setPending(false);
    }
  };

  const template = templateById(record.templateId);
  const status = !record.active || retired ? 'Retired' : paused ? 'Paused' : 'Running';
  const copyLink = params
    ? copyAgentLink({ templateId: record.templateId, riskLevel: params.riskLevel, params, assets: invest?.assets ?? [], agentName: record.name })
    : `/funds/create?agent=1&template=${record.templateId}`;
  const isCreator = !!account && record.creator.toLowerCase() === account.toLowerCase();

  return (
    <section id="agent" className="scroll-mt-20 space-y-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {record.logoURI ? (
            <img src={record.logoURI} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-400/15"><Bot className="h-6 w-6 text-violet-200" /></span>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">{record.name || 'AI agent'}</h2>
              <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-[11px] font-medium text-violet-200">{status}</span>
              {backtested && <span className="rounded-full bg-polydash-green/15 px-2 py-0.5 text-[11px] font-medium text-polydash-green">Backtested</span>}
            </div>
            <p className="mt-0.5 text-[12px] text-white/55">
              {template.name} · Agent #{agentId.toString()} · {record.runnerMode === 1 ? 'Polypad-hosted runner' : 'Self-hosted runner'}
            </p>
          </div>
        </div>
        <Link href={copyLink} className="inline-flex h-8 items-center rounded-full border border-white/15 px-3 text-[12px] font-medium text-white/80 hover:bg-white/5">
          Use this strategy
        </Link>
      </div>

      {record.description && <p className="text-[13px] leading-relaxed text-white/60">{record.description}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[12px] text-white/45">Value per share</p>
          <p className="mt-1 font-mono text-[15px] text-white">{navPerNft > 0n ? `${formatFundEth(navPerNft)} ETH` : 'Not known yet'}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[12px] text-white/45">Trades made</p>
          <p className="mt-1 font-mono text-[15px] text-white">{trades}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[12px] text-white/45">Runner wallet</p>
          <p className="mt-1 font-mono text-[13px] text-white">
            <a className="text-polydash-green" href={getExplorerAddressUrl(record.agentKey)} target="_blank" rel="noopener noreferrer">{shortenAddress(record.agentKey)}</a>
          </p>
        </div>
      </div>

      {params && (
        <p className="text-[12px] leading-relaxed text-white/55">
          Limits: largest holding {params.maxPositionBps === 0 ? 'vault default' : `${params.maxPositionBps / 100}%`},
          largest trade {params.maxTradeBps === 0 ? 'vault default' : `${params.maxTradeBps / 100}%`},
          up to {params.dailyTradeLimit === 0 ? 5 : params.dailyTradeLimit} trades a day,
          auto-pause after a {((params.circuitBreakerBps === 0 ? 1000 : params.circuitBreakerBps) / 100)}% drop.
          The agent never holds money — the vault does.
        </p>
      )}

      <div>
        <h3 className="text-[13px] font-semibold">What the agent did, and why</h3>
        {!feed || feed.length === 0 ? (
          <p className="mt-2 text-[13px] text-white/50">No trades yet. When the agent trades, each decision shows here with the rule that fired and the numbers behind it.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {feed.map((entry) => (
              <li key={entry.key} className="rounded-lg bg-white/[0.03] p-3 text-[12px] leading-relaxed text-white/70">
                {explainTrade(record.templateId, {
                  side: entry.side,
                  assetSymbol: entry.symbol,
                  amountEth: entry.amountEth,
                  priceChangePct: entry.priceChangePct,
                  navPerNftEth: entry.navPerNftEth,
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(isManager || isCreator) && record.active && !retired && (
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <Button variant="secondary" size="sm" disabled={pending} onClick={pauseToggle} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? 'Resume agent' : 'Pause agent'}
          </Button>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => void revoke()} className="gap-2">
            <XCircle className="h-4 w-4" /> Remove agent
          </Button>
          <p className="w-full text-[12px] text-white/45">
            Pause stops the agent trading. Remove takes it off the vault and retires it from the directory — two transactions, one after the other.
          </p>
        </div>
      )}
      {(!record.active || retired) && (
        <p className="text-[12px] text-white/50">This agent is retired and can no longer trade for this fund.</p>
      )}
      {record.runnerMode === 1 && status === 'Running' && (
        <p className="text-[12px] text-white/50">Hosted runner: waiting for the platform to start it — the agent will not trade until the platform starts the hosted runner.</p>
      )}
    </section>
  );
}
