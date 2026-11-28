'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, ArrowRight, ArrowUpRight, Bot, ChevronDown, Lock, Wallet, Zap } from 'lucide-react';
import { AGENTS } from '@/lib/agents/prompts';
import type { AgentId } from '@/lib/agents/tools';
import { Button } from '@/components/ui/button';
import { PolyCtoPanel } from './polycto-panel';
import { PolyAgentPanel } from './poly-agent-panel';
import { PolyForgePanel } from './polyforge-panel';
import { cn } from '@/lib/utils';
import {
  CTA_OUTLINE,
  CTA_PRIMARY,
  DARK_CARD,
  EMERALD_CARD,
  EMERALD_CARD_STRONG,
  FlowDiagram,
  HERO_GLOW,
  PLAIN_CARD,
  SECTION,
  SectionHead,
  StatTiles,
} from '@/lib/ui/template';

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
    <div className="bg-black text-white">
      {/* 1 · Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className={HERO_GLOW} />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-400">AI Agents · Robinhood Chain</p>
          <h1 className="mt-4 max-w-3xl text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
            Polypad{' '}
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-500 bg-clip-text text-transparent">
              AI Agents
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] sm:text-lg leading-relaxed text-white/70">
            Open-source agents for launching, analyzing and staking on Robinhood Chain. Non-custodial: you always sign in your own wallet.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/agents/create" className={CTA_PRIMARY}>
              Create your agent <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/build" className={CTA_OUTLINE}>
              Build with the API
            </Link>
          </div>
          <StatTiles
            items={[
              { value: '27', label: 'MCP tools', note: 'Trade, launch, funds, staking, NFTs' },
              { value: '5', label: 'Agent skills', note: 'Guided workflows over MCP' },
              { value: '300–850', label: 'Agent credit score', note: 'From on-chain behavior only' },
              { value: 'Safe', label: 'Agent wallets', note: 'Per-payment and daily caps, with expiry' },
            ]}
          />
        </div>
      </section>

      {/* 2 · How it works — the agent flow */}
      <section className={SECTION}>
        <SectionHead
          kicker="How it works"
          title="Your agent. Your rules."
          sub="You set the wallet, the limits, and the off switch. Your agent does the work inside them."
        />
        <FlowDiagram
          layers={[
            {
              title: 'Create an agent',
              body: 'Give an AI agent its own wallet, a credit score, and tools — in five steps.',
              pills: ['Five steps', 'Runs on your computer'],
              icon: <Bot className="mx-auto h-6 w-6 text-emerald-400" />,
            },
            {
              title: 'Give it a Safe-based wallet with caps',
              body: 'An identity, money in a vault it can spend, and limits you control — per payment, per day, until an expiry date.',
              pills: ['Per-payment cap', 'Daily cap', 'Expiry date'],
              icon: <Wallet className="mx-auto h-6 w-6 text-emerald-400" />,
            },
            {
              title: 'It acts on-chain inside its limits',
              body: 'Trade, launch, and run tokenized funds through 27 MCP tools — no signup, no API key.',
              pills: ['27 MCP tools', '5 skills'],
              icon: <Zap className="mx-auto h-6 w-6 text-emerald-400" />,
            },
            {
              title: 'It swaps at the best price',
              body: 'Before any swap, your agent compares routes across Velora, KyberSwap and Uniswap on Robinhood Chain — Bitget Wallet joins once its API key lands — and executes the best one, inside the wallet’s limits.',
              pills: ['Best route wins', 'Inside wallet limits'],
              icon: <ArrowLeftRight className="mx-auto h-6 w-6 text-emerald-400" />,
            },
            {
              title: 'Freeze or revoke anytime',
              body: 'You stay in control: freeze the wallet or revoke access whenever you choose.',
              pills: ['You hold the keys', 'Non-custodial'],
              emerald: true,
              icon: <Lock className="mx-auto h-6 w-6 text-emerald-400" />,
            },
          ]}
        />
      </section>

      {/* 3 · Create your agent */}
      <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
        <div className={SECTION}>
          <Link href="/agents/create" className={cn(EMERALD_CARD_STRONG, 'group flex flex-col gap-3 p-5 transition-colors hover:border-emerald-500/50 sm:flex-row sm:items-center sm:justify-between sm:p-6')}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                <Bot className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h2 className="text-[16px] font-semibold">Create your agent</h2>
                <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/60">Give an AI agent its own wallet, a credit score, and tools — in five steps. Your agent runs on your own computer; Polypad gives it a wallet and tools, we don&apos;t run it for you.</p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-emerald-300">
              Create your agent <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
            </span>
          </Link>

          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Link href="/agents/scores" className={cn(EMERALD_CARD, 'group p-4 transition-colors hover:border-emerald-500/40 sm:p-5')}>
              <h2 className="text-[15px] font-semibold">Give your agent a score</h2>
              <p className="mt-1 text-[13px] text-white/60">A 300–850 credit score from on-chain behavior only — so others can check it before trusting it with money.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300">
                Agent Credit Scores <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
              </span>
            </Link>
            <Link href="/agents/accounts" className={cn(EMERALD_CARD, 'group p-4 transition-colors hover:border-emerald-500/40 sm:p-5')}>
              <h2 className="text-[15px] font-semibold">Give your agent an account + spending limits</h2>
              <p className="mt-1 text-[13px] text-white/60">An identity, money in a vault it can spend, and limits you control — per payment, per day, until an expiry date.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300">
                Agent Accounts <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
              </span>
            </Link>
            <Link href="/docs/tools" className={cn(EMERALD_CARD, 'group p-4 transition-colors hover:border-emerald-500/40 sm:p-5')}>
              <h2 className="text-[15px] font-semibold">Swap at the best price</h2>
              <p className="mt-1 text-[13px] text-white/60">Your agent compares swap routes across Velora, KyberSwap and Uniswap on Robinhood Chain, then executes the best one — inside the wallet’s limits. Bitget Wallet joins once its API key lands.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300">
                Swap tools <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
              </span>
            </Link>
            <Link href="/build" className={cn(EMERALD_CARD, 'group p-4 transition-colors hover:border-emerald-500/40 sm:p-5')}>
              <h2 className="text-[15px] font-semibold">Build with the API</h2>
              <p className="mt-1 text-[13px] text-white/60">Connect your agent to Polypad with MCP — no signup, no API key. Trade, launch, and run tokenized funds.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300">
                Build on Polypad <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* 4 · The agents */}
      <section className={SECTION}>
        <SectionHead
          kicker="Open-source agents"
          title="Meet the agents."
          sub="Three open-source agents, ready to run on your own computer."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {AGENTS.map((a) => (
            <div key={a.id} className={cn(PLAIN_CARD, 'flex flex-col p-4 sm:p-5', open === a.id && 'border-emerald-500/40')}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[17px] font-semibold">{a.name}</h2>
                <a href={a.swarmsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:text-white">
                  Open source on Swarms <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
              <p className="mt-1 text-[13px] font-medium text-emerald-400">{a.tagline}</p>
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

        <Link href="/agents/launch" className={cn(DARK_CARD, 'group mt-4 flex flex-col gap-3 p-4 transition-colors hover:border-white/20 sm:flex-row sm:items-center sm:justify-between sm:p-5')}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/80">
              <Bot className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold">Launch with your agent</h2>
              <p className="mt-1 text-[13px] text-white/60">Outside agents can launch tokens through the Polypad API. You get unsigned transactions and sign with your own wallet.</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-emerald-300">
            API docs <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
          </span>
        </Link>

        <div className="mt-6 space-y-1.5 px-1 text-[12.5px] leading-relaxed text-white/55">
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
      </section>
    </div>
  );
}
