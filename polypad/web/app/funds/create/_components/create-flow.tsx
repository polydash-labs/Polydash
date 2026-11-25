'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { Bot, Loader2, User } from 'lucide-react';
import { CreateFundWizard } from './create-fund-wizard';
import { AgentFundWizard } from './agent-fund-wizard';
import { cn } from '@/lib/utils';

type Mode = 'ask' | 'human' | 'agent';

/**
 * First question in the create flow: "Who manages this fund?"
 * Human → the existing wizard, untouched. AI agent → the agent wizard.
 * `?agent=1` opens the agent wizard directly (copy-an-agent links).
 */
export function CreateFlow() {
  return (
    <Suspense fallback={<div className="mx-auto flex max-w-[700px] items-center justify-center gap-2 px-5 py-20 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>}>
      <CreateFlowInner />
    </Suspense>
  );
}

function CreateFlowInner() {
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('agent') === '1' ? 'agent' : 'ask',
  );

  if (mode === 'human') return <CreateFundWizard />;
  if (mode === 'agent') return <AgentFundWizard />;

  return (
    <div className="mx-auto max-w-[700px] space-y-5 px-5 py-8 sm:space-y-6 sm:py-12">
      <div className="space-y-2">
        <Link href="/funds" className="text-[12px] text-white/50 hover:text-white">Funds</Link>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">Create a fund</h1>
        <p className="text-[13px] leading-relaxed text-white/60">
          First, who manages this fund? Either way the money stays in the fund&apos;s vault, and the rules are locked
          at creation and cannot be changed later.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode('human')}
          className={cn('glass-card rounded-xl p-5 text-left transition-colors hover:bg-white/5')}
        >
          <User className="h-6 w-6 text-polydash-green" />
          <p className="mt-3 text-[15px] font-semibold">A human manages it</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            You (or a manager you choose) decide every trade by hand. The usual 5-step setup: name, raise, rules, fees, review.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setMode('agent')}
          className={cn('glass-card rounded-xl p-5 text-left transition-colors hover:bg-white/5')}
        >
          <Bot className="h-6 w-6 text-polydash-green" />
          <p className="mt-3 text-[15px] font-semibold">An AI agent manages it</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            You name the agent, pick its strategy and set its limits. It trades only inside those limits, never holds
            money, and you can pause or remove it at any time.
          </p>
        </button>
      </div>
      <p className="text-[12px] leading-relaxed text-white/50">
        Both kinds of fund are created the same way on-chain. An agent fund also gets a runner — Polypad-hosted or
        self-hosted — that signs the agent&apos;s trade instructions. Unaudited. Not financial advice.
      </p>
    </div>
  );
}
