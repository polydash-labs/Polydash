'use client';

import { useState, type ReactNode } from 'react';
import { analyzeToken, holdersAndFlows, scamCheck, type Intent, type ScamResult } from '@/lib/agents/tools';
import { Button } from '@/components/ui/button';
import { AgentChat } from '@/app/agents/_components/agent-chat';
import { fetchSecurity } from '@/app/agents/_components/polycto-panel';
import { ErrorNote, HoldersCard, Panel, ScamCard, SecurityCard, TokenCard } from '@/app/agents/_components/ui';

export function CtoTools({ tokenAddress, ctoName }: { tokenAddress: string; ctoName: string }) {
  const [text, setText] = useState('');
  const [scam, setScam] = useState<ScamResult | null>(null);

  const resolve = async (intent: Intent): Promise<ReactNode> => {
    try {
      if (intent.tool === 'scam') return intent.text ? <ScamCard r={scamCheck(intent.text)} /> : <ErrorNote message="Paste the message after 'check:'." />;
      if (intent.tool === 'analyze') return <TokenCard t={await analyzeToken(intent.address)} />;
      if (intent.tool === 'holders') return <HoldersCard h={await holdersAndFlows(intent.address)} />;
      if (intent.tool === 'security') return <SecurityCard r={await fetchSecurity(intent.address)} />;
    } catch (e: any) {
      return <ErrorNote message={e?.message ?? 'n/a'} />;
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
      <Panel title="Scam message check" note="Runs locally in your browser">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={5000}
          placeholder="Paste a message from the community chat"
          className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[16px] text-white placeholder:text-white/35 focus:border-polydash-green/50 focus:outline-none sm:text-[13px]" />
        <div className="mt-2 flex gap-2">
          <Button size="sm" className="h-10 sm:h-9" disabled={!text.trim()} onClick={() => setScam(scamCheck(text))}>Check message</Button>
          {scam && <Button size="sm" variant="ghost" className="h-10 sm:h-9" onClick={() => { setScam(null); setText(''); }}>Clear</Button>}
        </div>
        {scam && <div className="mt-3"><ScamCard r={scam} /></div>}
      </Panel>
      <AgentChat agent="polycto" title={`Ask ${ctoName}`} hint="Try: security, holders, or check: <message>" resolve={resolve} tokenAddress={tokenAddress} ctoName={ctoName} />
    </div>
  );
}
