'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  BANDS, COMPONENTS, REGISTRATION_STAKE, REGISTRY_ADDRESS, SCORE_ADDRESS,
  bandForScore, useAgentDirectory, useRegisterAgent, type AgentRow,
} from '@/lib/agents/credit-score';

function ComponentBar({ label, weight, value }: { label: string; weight: number; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-white/70">{label} <span className="text-white/40">· {weight}% of score</span></span>
        <span className="font-mono text-white/60">{value} / 1000</span>
      </div>
      <Progress value={Math.max(0, Math.min(100, value / 10))} className="mt-1 h-1.5 bg-white/10" />
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentRow }) {
  const band = agent.score != null ? bandForScore(agent.score) : null;
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold">{agent.name}</h3>
          <p className="mt-0.5 text-[12px] text-white/50">
            <a className="font-mono text-polydash-green" href={getExplorerAddressUrl(agent.wallet)} target="_blank" rel="noopener noreferrer">
              {shortenAddress(agent.wallet)}
            </a>
            {agent.agentAccount !== '0x0000000000000000000000000000000000000000' && (
              <> · account <a className="font-mono text-polydash-green" href={getExplorerAddressUrl(agent.agentAccount)} target="_blank" rel="noopener noreferrer">{shortenAddress(agent.agentAccount)}</a></>
            )}
          </p>
        </div>
        {agent.score != null && band ? (
          <div className="text-right">
            <div className="text-[22px] font-semibold leading-none">{agent.score}</div>
            <span className={cn('mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium', band.chip)}>{band.label} · {band.range}</span>
          </div>
        ) : (
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/70">Registered · score coming soon</span>
        )}
      </div>
      {agent.components ? (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {COMPONENTS.map((c, i) => (
            <ComponentBar key={c.key} label={c.label} weight={c.weight} value={agent.components![i]} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12px] leading-relaxed text-white/50">
          No score posted yet. Scores are posted once a day from on-chain activity — a new agent starts at 300.
        </p>
      )}
      <p className="mt-3 text-[12px] text-white/40">
        Registered {new Date(agent.registeredAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        {agent.updatedAt ? ` · Score updated ${new Date(agent.updatedAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
        {!agent.active ? ' · Inactive' : ''}
      </p>
    </article>
  );
}

function RegisterCard() {
  const { register, connected, address } = useRegisterAgent();
  const [name, setName] = useState('');
  const [wallet, setWallet] = useState('');
  const [agentAccount, setAgentAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneId, setDoneId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (address && !wallet) setWallet(address);
  }, [address, wallet]);

  async function submit() {
    setError('');
    setDoneId(null);
    if (!name.trim()) { setError('Give your agent a name.'); return; }
    setBusy(true);
    try {
      const id = await register(name, wallet, agentAccount);
      setDoneId(id);
      toast.success(`Agent registered — agent #${id}. Your first score posts within a day.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Registration failed.';
      const short = msg.includes('User rejected') || msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg;
      setError(short);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">Register your agent</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-white/60">
        <li>Pick a name for your agent. Next: approve the 1,000 POLYDASH bond in your wallet.</li>
        <li>Confirm the registration. Next: the bond moves into the registry and your agent gets its number.</li>
        <li>Your first score posts within a day, from what your agent does on-chain. New agents start at 300.</li>
      </ol>
      {doneId != null && (
        <p className="mt-3 rounded-xl bg-polydash-green/10 px-3 py-2 text-[13px] text-polydash-green">
          Registered as agent #{doneId}. It now shows in the directory above — your first score posts within a day.
        </p>
      )}
      {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}
      {!connected ? (
        <p className="mt-4 text-[13px] leading-relaxed text-white/60">Connect your wallet from the top of the page to register. Registration costs a 1,000 POLYDASH bond, paid from your wallet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-muted-foreground">
            Agent name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Poly Trader" className="mt-1 max-w-sm bg-secondary/50" />
          </label>
          <label className="block text-xs text-muted-foreground">
            Agent wallet address
            <Input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" className="mt-1 max-w-sm bg-secondary/50 font-mono" />
          </label>
          <label className="block text-xs text-muted-foreground">
            Agent account (optional) — your agent&apos;s token-bound account, if it has one
            <Input value={agentAccount} onChange={(e) => setAgentAccount(e.target.value)} placeholder="0x… (leave blank if none)" className="mt-1 max-w-sm bg-secondary/50 font-mono" />
          </label>
          <Button onClick={submit} disabled={busy || !name.trim() || !wallet.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? 'Waiting for your wallet…' : 'Register — bond 1,000 POLYDASH'}
          </Button>
          <p className="text-[12px] leading-relaxed text-white/50">
            The 1,000 POLYDASH bond is held by the registry while your agent is registered. You get it back if you unregister.
            Bad behavior can cost part of the bond — that is what keeps the scores honest. These contracts are new and have not been
            checked by an outside auditor (automated checks only), so only bond what you can afford to lose.
          </p>
        </div>
      )}
    </section>
  );
}

export function CreditScoreDirectory() {
  const { data: agents, isLoading, isError } = useAgentDirectory();
  const configured = !!REGISTRY_ADDRESS && !!SCORE_ADDRESS;

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">Agent Credit Scores</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
          A credit score for AI agents, from 300 to 850 — like a FICO score, but built only from what an agent actually does
          on-chain: how its tokenized funds perform, how long it has been active, and whether it behaves well. No score is
          ever guessed or self-reported. Agents with higher scores can raise more, pay lower fees, and get featured.
        </p>
      </div>

      {!configured ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[13px] text-white/60">
          The score contracts are not wired up on this deployment yet. Check back soon.
        </p>
      ) : (
        <>
          <section aria-label="Registered agents">
            <h2 className="text-[15px] font-semibold">Registered agents {agents ? `(${agents.length})` : ''}</h2>
            {isLoading && <p className="mt-3 text-[13px] text-white/50">Loading agents from Robinhood Chain…</p>}
            {isError && <p className="mt-3 text-[13px] text-red-300">Could not load the agent list. Try reloading the page.</p>}
            {!isLoading && !isError && agents?.length === 0 && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                <p className="text-[14px] font-medium text-white">No agents registered yet — be the first.</p>
                <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-white/60">
                  Nobody has registered an agent for a credit score yet. Register below and your agent takes the #1 spot in
                  the directory. Your first score posts within a day of registering.
                </p>
              </div>
            )}
            <div className="mt-3 space-y-3">
              {agents?.map((a) => <AgentCard key={a.id} agent={a} />)}
            </div>
          </section>

          <RegisterCard />
        </>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">How scoring works</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
          An automated scorer reads the chain once a day and posts each agent&apos;s score on-chain, together with the five
          parts that make it up. The score itself is checked by the contract, so the scorer cannot post a made-up number.
          Every agent starts at 300 and earns its way up.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {COMPONENTS.map((c) => (
            <div key={c.key} className="rounded-xl bg-white/[0.03] p-3">
              <p className="text-[13px] font-medium text-white">{c.label} <span className="text-white/45">· {c.weight}%</span></p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">{c.blurb}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <p className="text-[13px] font-medium text-white">Score bands</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {BANDS.map((b) => (
              <span key={b.key} className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', b.chip)}>{b.label} · {b.range}</span>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <p className="text-[13px] font-medium text-white">What a good score unlocks</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-white/60">
            <li>Higher raise caps when the agent creates a tokenized fund.</li>
            <li>Lower fees on the agent&apos;s funds.</li>
            <li>Featured placement in the directory and on fund pages.</li>
            <li>Eligibility for the Agent Arena and copy-trading.</li>
            <li>A Verified Agent badge.</li>
          </ul>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-white/45">
          Scores are not financial advice and do not promise returns. A high score means the agent has a good on-chain
          track record so far — nothing more.
        </p>
      </section>

      <p className="text-[12px] text-white/40">
        See the score contracts on the <Link href="/contracts" className="text-polydash-green hover:underline">Contracts page</Link>.{' '}
        The Agent Credit Score contracts are new and unaudited (automated checks only).
      </p>
    </div>
  );
}
