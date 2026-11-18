'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isAddress } from 'viem';
import { analyzeToken, holdersAndFlows, scamCheck, type HolderReport, type Intent, type ScamResult, type SecurityReport, type TokenAnalysis } from '@/lib/agents/tools';
import { getAgent } from '@/lib/agents/prompts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentChat } from './agent-chat';
import { ErrorNote, HoldersCard, Loading, Panel, ScamCard, SecurityCard, TokenCard } from './ui';

type Tool = 'analyze' | 'holders' | 'security';
type Result =
  | { tool: 'analyze'; data: TokenAnalysis }
  | { tool: 'holders'; data: HolderReport }
  | { tool: 'security'; data: SecurityReport };

export async function fetchSecurity(address: string): Promise<SecurityReport> {
  const res = await fetch(`/api/agents/tools/security?address=${encodeURIComponent(address)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Security check failed.');
  return data as SecurityReport;
}

async function runTool(tool: Tool, address: string): Promise<Result> {
  if (tool === 'analyze') return { tool, data: await analyzeToken(address) };
  if (tool === 'holders') return { tool, data: await holdersAndFlows(address) };
  return { tool, data: await fetchSecurity(address) };
}

function ResultView({ r }: { r: Result }) {
  if (r.tool === 'analyze') return <TokenCard t={r.data} />;
  if (r.tool === 'holders') return <HoldersCard h={r.data} />;
  return <SecurityCard r={r.data} />;
}

const LABEL: Record<Tool, string> = { analyze: 'Analyze token', holders: 'Holders & flows', security: 'Security check' };

export function PolyCtoPanel({ initialToken }: { initialToken?: string }) {
  const [address, setAddress] = useState(initialToken ?? '');
  const [running, setRunning] = useState<Tool | null>(null);
  const [results, setResults] = useState<Partial<Record<Tool, Result>>>({});
  const [error, setError] = useState('');
  const [scamText, setScamText] = useState('');
  const [scam, setScam] = useState<ScamResult | null>(null);
  const autoRan = useRef(false);

  const run = async (tool: Tool, addr = address) => {
    const a = addr.trim();
    if (!isAddress(a, { strict: false })) { setError('Enter a valid 0x token address.'); return; }
    setError('');
    setRunning(tool);
    try {
      const r = await runTool(tool, a);
      setResults((prev) => ({ ...prev, [tool]: r }));
    } catch (e: any) {
      setError(`${LABEL[tool]}: ${e?.message ?? 'n/a'}`);
    } finally {
      setRunning(null);
    }
  };

  useEffect(() => {
    if (autoRan.current || !initialToken || !isAddress(initialToken, { strict: false })) return;
    autoRan.current = true;
    run('analyze', initialToken);
  }, [initialToken]); // run once for a token passed in the URL

  const resolve = async (intent: Intent): Promise<ReactNode> => {
    try {
      if (intent.tool === 'scam') return intent.text ? <ScamCard r={scamCheck(intent.text)} /> : <ErrorNote message="Paste the message after 'check:'." />;
      if (intent.tool === 'analyze' || intent.tool === 'holders' || intent.tool === 'security') return <ResultView r={await runTool(intent.tool, intent.address)} />;
    } catch (e: any) {
      return <ErrorNote message={e?.message ?? 'n/a'} />;
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <Panel title="Token tools" note="Read-only, Robinhood Chain">
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Token address 0x…" className="font-mono" />
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(LABEL) as Tool[]).map((t) => (
            <Button key={t} size="sm" variant={t === 'analyze' ? 'default' : 'outline'} disabled={!!running} onClick={() => run(t)}>{LABEL[t]}</Button>
          ))}
        </div>
        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
        {running && <Loading label={running === 'holders' ? 'Reading recent transfers (this can take a few seconds)' : running === 'security' ? 'Running heuristic checks' : 'Reading token'} />}
      </Panel>

      {(['analyze', 'holders', 'security'] as Tool[]).map((t) => results[t] ? <ResultView key={t} r={results[t]!} /> : null)}

      <Panel title="Scam message check" note="Runs locally in your browser">
        <textarea value={scamText} onChange={(e) => setScamText(e.target.value)} rows={4} maxLength={5000}
          placeholder="Paste a message from your community chat"
          className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[16px] text-white placeholder:text-white/35 focus:border-polydash-green/50 focus:outline-none sm:text-[13px]" />
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={!scamText.trim()} onClick={() => setScam(scamCheck(scamText))}>Check message</Button>
          {scam && <Button size="sm" variant="ghost" onClick={() => { setScam(null); setScamText(''); }}>Clear</Button>}
        </div>
        {scam && <div className="mt-3"><ScamCard r={scam} /></div>}
      </Panel>

      <AgentChat agent="polycto" hint={getAgent('polycto')!.chatHint} resolve={resolve} tokenAddress={isAddress(address.trim(), { strict: false }) ? address.trim() : undefined} />
    </div>
  );
}
