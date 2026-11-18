'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { isAddress } from 'viem';
import { listPools, openPools, poolStats, recentFlows, type Intent } from '@/lib/agents/tools';
import { getAgent } from '@/lib/agents/prompts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentChat } from './agent-chat';
import { ErrorNote, FlowsTable, Loading, Panel, PoolStatsCard, PoolsTable, RateBlock } from './ui';
import { cn } from '@/lib/utils';

const REFRESH = 30_000;
const errMsg = (e: unknown) => (e as any)?.message ?? 'n/a';

function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function PolyAgentPanel() {
  const now = useNow();
  const [tab, setTab] = useState<'all' | 'open' | 'lookup'>('all');
  const [input, setInput] = useState('');
  const [pool, setPool] = useState<string | null>(null);
  const [inputErr, setInputErr] = useState('');

  const pools = useQuery({ queryKey: ['agents', 'pools'], queryFn: listPools, refetchInterval: REFRESH, staleTime: REFRESH, enabled: tab !== 'lookup' });
  const open = useQuery({ queryKey: ['agents', 'open-pools'], queryFn: openPools, refetchInterval: REFRESH, staleTime: REFRESH, enabled: tab === 'open' });
  const stats = useQuery({ queryKey: ['agents', 'pool', pool], queryFn: () => poolStats(pool as string), enabled: !!pool, refetchInterval: REFRESH, staleTime: REFRESH, retry: false });
  const flows = useQuery({ queryKey: ['agents', 'flows', pool], queryFn: () => recentFlows(pool as string), enabled: !!pool, refetchInterval: REFRESH, staleTime: REFRESH, retry: false });

  const lookup = (addr: string) => {
    const a = addr.trim();
    if (!isAddress(a, { strict: false })) { setInputErr('Enter a valid 0x pool address.'); return; }
    setInputErr('');
    setInput(a);
    setPool(a);
    setTab('lookup');
  };

  const resolve = async (intent: Intent): Promise<ReactNode> => {
    try {
      if (intent.tool === 'listPools') return <Panel title="All pools"><PoolsTable pools={await listPools()} empty="No pools found." /></Panel>;
      if (intent.tool === 'openPools') return <Panel title="Open pools"><PoolsTable pools={await openPools()} empty="No pools are open right now (not ended, not full and active)." /></Panel>;
      if (intent.tool === 'poolStats') { const p = await poolStats(intent.address); return <PoolStatsCard p={p} nowSec={now} />; }
      if (intent.tool === 'rewardRate') { const p = await poolStats(intent.address); return <Panel title={`Reward rate${p.name ? ` · ${p.name}` : ''}`}><RateBlock p={p} /></Panel>; }
      if (intent.tool === 'flows') { const f = await recentFlows(intent.address); return <FlowsTable rows={f.rows} symbol={f.symbol} blocks={f.blocks} />; }
    } catch (e) {
      return <ErrorNote message={errMsg(e)} />;
    }
    return null;
  };

  const tabs = [['all', 'All pools'], ['open', 'Open pools'], ['lookup', 'Pool lookup']] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cn('h-8 rounded-full px-3.5 text-[13px] transition-colors', tab === k ? 'bg-white text-black' : 'text-white/60 hover:text-white')}>{l}</button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-white/40"><RefreshCw className="h-3 w-3" /> Auto-refresh every 30s</span>
      </div>

      {tab === 'all' && (
        <Panel title="All pools" note="Polypad staking factory V2">
          {pools.isLoading ? <Loading /> : pools.error ? <ErrorNote message={errMsg(pools.error)} /> :
            <PoolsTable pools={pools.data ?? []} onSelect={lookup} empty="No pools found." />}
        </Panel>
      )}

      {tab === 'open' && (
        <Panel title="Open pools" note="Not ended, not full, active">
          {open.isLoading ? <Loading /> : open.error ? <ErrorNote message={errMsg(open.error)} /> :
            <PoolsTable pools={open.data ?? []} onSelect={lookup} empty="No pools are open right now (not ended, not full and active)." />}
        </Panel>
      )}

      {tab === 'lookup' && (
        <div className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); lookup(input); }} className="flex flex-col gap-2 sm:flex-row">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pool address 0x…" className="font-mono" />
            <Button type="submit">Stats, rate & flows</Button>
          </form>
          {inputErr && <ErrorNote message={inputErr} />}
          {!pool && !inputErr && <p className="text-[13px] text-white/50">Enter a pool address, or pick one from All pools.</p>}
          {pool && (stats.isLoading ? <Loading /> : stats.error ? <ErrorNote message={errMsg(stats.error)} /> : stats.data ? <PoolStatsCard p={stats.data} nowSec={now} /> : null)}
          {pool && !stats.error && (flows.isLoading ? <Loading label="Reading stake and withdraw events" /> : flows.error ? <ErrorNote message={`Flows: ${errMsg(flows.error)}`} /> : flows.data ? <FlowsTable rows={flows.data.rows} symbol={flows.data.symbol} blocks={flows.data.blocks} /> : null)}
        </div>
      )}

      <AgentChat agent="poly-agent" hint={getAgent('poly-agent')!.chatHint} resolve={resolve} />
    </div>
  );
}
