'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Bot, ChevronDown } from 'lucide-react';
import { AGENTS } from '@/lib/agents/prompts';
import type { AgentId } from '@/lib/agents/tools';
import { Button } from '@/components/ui/button';
import { PolyCtoPanel } from './polycto-panel';
import { PolyAgentPanel } from './poly-agent-panel';
import { PolyForgePanel } from './polyforge-panel';
import { card } from './ui';
import { cn } from '@/lib/utils';

export function AgentsContent({ initialAgent, initialToken, initialStake }: { initialAgent?: AgentId; initialToken?: string; initialStake?: string }) {
  const [open, setOpen] = useState<AgentId | null>(initialAgent ?? null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialAgent) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [initialAgent]);

  const toggle = (id: AgentId) => {
    setOpen((cur) => (cur === id ? null : id));
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const active = AGENTS.find((a) => a.id === open);

  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="text-[clamp(28px,5vw,40px)] font-semibold tracking-tight">Polypad AI Agents</h1>
      <p className="mt-2 max-w-2xl text-[14px] text-white/60 sm:text-[15px]">
        Open-source agents for launching, analyzing and staking on Robinhood Chain. Non-custodial: you always sign in your own wallet.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {AGENTS.map((a) => (
          <div key={a.id} className={cn(card, 'flex flex-col p-4 sm:p-5', open === a.id && 'border-polydash-green/40')}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[17px] font-semibold">{a.name}</h2>
              <a href={a.swarmsUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:text-white">
                Open source on Swarms <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
            <p className="mt-1 text-[13px] font-medium text-polydash-green">{a.tagline}</p>
            <p className="mt-3 text-[13px] text-white/60">{a.summary}</p>
            <ul className="mt-3 flex-1 space-y-1.5 text-[13px] text-white/80">
              {a.capabilities.map((c) => (
                <li key={c} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/40" />{c}</li>
              ))}
            </ul>
            <Button className="mt-4 w-full" variant={open === a.id ? 'outline' : 'default'} onClick={() => toggle(a.id)}>
              {open === a.id ? 'Close' : 'Open'} <ChevronDown className={cn('transition-transform', open === a.id && 'rotate-180')} />
            </Button>
          </div>
        ))}
      </div>

      <Link href="/agents/launch" className={cn(card, 'group mt-4 flex flex-col gap-3 p-4 transition-colors hover:border-white/20 sm:flex-row sm:items-center sm:justify-between sm:p-5')}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/80">
            <Bot className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold">Launch with your agent</h2>
            <p className="mt-1 text-[13px] text-white/60">Outside agents can launch tokens through the Polypad API. You get unsigned transactions and sign with your own wallet.</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-polydash-green">
          API docs <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
        </span>
      </Link>

      <div className="mt-3 space-y-1.5 px-1 text-[12.5px] leading-relaxed text-white/55">
        <p>After launching, a creator can create a staking pool at polypad.family/stake. Tokens with an active pool show a Staking committed badge.</p>
        <p>Tokens can earn a Holder Protections checklist badge from on-chain checks: graduated liquidity, an active staking pool created by the token creator, and a clean security check. Scans are not audits. Not financial advice.</p>
      </div>

      <div ref={panelRef} className="scroll-mt-20">
        {active && (
          <section className="mt-8">
            <div className="mb-4 flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold">{active.name}</h2>
              <span className="text-[13px] text-white/45">{active.tagline}</span>
            </div>
            {active.id === 'polycto' && <PolyCtoPanel initialToken={initialToken} />}
            {active.id === 'poly-agent' && <PolyAgentPanel />}
            {active.id === 'polyforge' && <PolyForgePanel initialStakeToken={initialStake} />}
          </section>
        )}
      </div>

      <p className="mt-10 border-t border-white/10 pt-5 text-[12px] text-white/45">Not financial advice. Security scans are not audits.</p>
    </div>
  );
}
