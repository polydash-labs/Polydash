'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import GlossaryBox from '@/components/glossary-box';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  BANDS, COMPONENTS, REGISTRATION_STAKE, REGISTRY_ADDRESS, SCORE_ADDRESS,
  bandForScore, useAgentDirectory, useRegisterAgent, type AgentRow,
} from '@/lib/agents/credit-score';
import { AgentCard, AgentCardSub, AgentCardTitle, AgentStat, PageHero, ProofChip } from '../../_components/agent-cards';
import { ScoringMethodology } from './scoring-methodology';

function ComponentBar({ label, weight, value }: { label: string; weight: number; value: number }) {
  return (
    <div className="flex items-center gap-3.5 border-t border-white/5 py-2.5 first:border-t-0">
      <span className="w-[130px] flex-none text-[14.5px] text-white/80 sm:w-[190px]">
        {label} <small className="text-[12.5px] text-white/40">· {weight}%</small>
      </span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full min-w-[3px] rounded-full bg-polydash-green"
          style={{ width: `${Math.max(0, Math.min(100, value / 10))}%` }}
        />
      </span>
      <span className="w-[78px] flex-none text-right font-mono text-[14px] text-white/60">
        <b className="font-semibold text-white">{value}</b> / 1000
      </span>
    </div>
  );
}

function AgentScoreCard({ agent, isTop, rank }: { agent: AgentRow; isTop?: boolean; rank?: number | null }) {
  const band = agent.score != null ? bandForScore(agent.score) : null;
  return (
    <AgentCard label={agent.name}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-[20px] font-bold tracking-tight sm:text-[22px]">{agent.name}</h3>
          <p className="mt-1 text-[13px] text-white/50">
            Agent #{agent.id} ·{' '}<a className="font-mono text-polydash-green" href={getExplorerAddressUrl(agent.wallet)} target="_blank" rel="noopener noreferrer">
              {shortenAddress(agent.wallet)}
            </a>
            {agent.agentAccount !== '0x0000000000000000000000000000000000000000' && (
              <> · account <a className="font-mono text-polydash-green" href={getExplorerAddressUrl(agent.agentAccount)} target="_blank" rel="noopener noreferrer">{shortenAddress(agent.agentAccount)}</a></>
            )}
          </p>
        </div>
        {agent.score != null && band ? (
          <div className="text-right">
            {rank != null && <div className="text-[12px] font-medium text-white/50">Rank #{rank}</div>}
            <div className="text-[46px] font-extrabold leading-none tracking-tight">{agent.score}</div>
            <span className={cn('mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium', band.chip)}>{band.label} · {band.range}</span>
            {isTop && (
              <span className="ml-1.5 inline-block rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green">Highest score</span>
            )}
          </div>
        ) : (
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/70">Registered · score coming soon</span>
        )}
      </div>
      {agent.components ? (
        <div className="mt-5">
          {COMPONENTS.map((c, i) => (
            <ComponentBar key={c.key} label={c.label} weight={c.weight} value={agent.components![i]} />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-[13px] leading-relaxed text-white/50">
          No score posted yet. Scores are posted once a day from on-chain activity — a new agent starts at 300.
        </p>
      )}
      <p className="mt-5 border-t border-white/5 pt-4 text-[13px] text-white/40">
        Registered {new Date(agent.registeredAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        {agent.updatedAt ? ` · Score updated ${new Date(agent.updatedAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
        {!agent.active ? ' · Inactive' : ''}
        {' · '}
        <Link href={`/agents/${agent.id}`} className="font-semibold text-[#00E676] hover:underline">
          View identity card →
        </Link>
        <span className="text-white/40"> who controls it, what it can spend, what its owner authorized</span>
      </p>
    </AgentCard>
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
      toast.success(`Agent registered — agent #${id}. Your first score posts within a day once the daily scorer runs.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Registration failed.';
      const short = msg.includes('User rejected') || msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg;
      setError(short);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AgentCard label="Register your agent">
      <AgentCardTitle>Register your agent</AgentCardTitle>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-white/60">
        <li>Pick a name for your agent. Next: approve the 1,000 POLYDASH bond in your wallet.</li>
        <li>Confirm the registration. Next: the bond moves into the registry and your agent gets its number.</li>
        <li>Your first score posts within a day once the daily scorer runs, from what your agent does on-chain. New agents start at 300.</li>
      </ol>
      <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-white/60">
        The bond is 1,000 POLYDASH — buy POLYDASH on its{' '}
        <Link href="/token/0x319525528f42167eF7fC18b77b889958080568e4" className="text-polydash-green hover:underline">
          token page
        </Link>
        . Its dollar value changes with the price, so check the page for the current cost. You also need a
        little ETH in your wallet for the network fee (gas — a small fee, usually a few cents, paid to the
        network for each action). You get the bond back if you unregister.
      </p>
      {doneId != null && (
        <p className="mt-4 rounded-xl bg-polydash-green/10 px-3 py-2 text-[13px] text-polydash-green">
          Registered as agent #{doneId}. It now shows in the directory above — your first score posts within a day once the daily scorer runs.
        </p>
      )}
      {error && <p className="mt-4 text-[13px] text-red-300">{error}</p>}
      {!connected ? (
        <p className="mt-5 text-[14px] leading-relaxed text-white/60">Connect your wallet from the top of the page to register. Registration costs a 1,000 POLYDASH bond, paid from your wallet.</p>
      ) : (
        <div className="mt-5 space-y-3">
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
    </AgentCard>
  );
}

export function CreditScoreDirectory() {
  const { data: agents, isLoading, isError } = useAgentDirectory();
  const configured = !!REGISTRY_ADDRESS && !!SCORE_ADDRESS;
  const scored = agents?.filter((a) => a.score != null) ?? [];
  const topScore = scored.length ? Math.max(...scored.map((a) => a.score as number)) : null;
  const topCount = topScore != null ? scored.filter((a) => a.score === topScore).length : 0;
  // The verified leaderboard: ranked by score, ties broken by the stable
  // agent number (lowest first). Names change — agent numbers never do —
  // so rank and identity always key on the id, never the display name.
  // Unscored agents follow, newest first.
  const ranked = useMemo(() => {
    const list = [...(agents ?? [])];
    const s = list.filter((a) => a.score != null).sort((x, y) => (y.score as number) - (x.score as number) || x.id - y.id);
    const u = list.filter((a) => a.score == null).sort((x, y) => y.id - x.id);
    return [...s, ...u];
  }, [agents]);
  const rankOf = new Map<number, number>();
  ranked.forEach((a, i) => { if (a.score != null) rankOf.set(a.id, i + 1); });

  return (
    <div className="mx-auto max-w-container space-y-6 px-5 py-6 sm:px-8 sm:py-10">
      <PageHero
        crumb={<>Agents <span className="font-normal text-white/40">· Credit Scores</span></>}
        title="Agent Credit Scores"
        lede="A credit score for AI agents, from 300 to 850 — like a FICO score, but built only from what an agent actually does on-chain: how its tokenized funds perform, how long it has been active, and whether it behaves well. No score is ever guessed or self-reported. The full scoring method is published below — every weight, every rule, and what never counts."
      />

      <GlossaryBox />

      {!configured ? (
        <p className="rounded-[20px] border border-white/10 bg-[#141414] p-6 text-[14px] leading-relaxed text-white/60">
          The score contracts are not wired up on this deployment yet. Check back soon. The free API on{' '}
          <Link href="/build" className="text-polydash-green hover:underline">/build</Link> works without this — start there — and{' '}
          <Link href="/status" className="text-polydash-green hover:underline">/status</Link> shows when it lands.
        </p>
      ) : (
        <>
          <AgentCard label="What a score is">
            <ProofChip big="300 – 850" small="the same range as a FICO score" />
            <AgentCardTitle>What a score is</AgentCardTitle>
            <AgentCardSub>
              Five things, all read from the chain — nothing self-reported, nothing guessed. A higher score is meant to unlock more:
              higher raise caps, lower fees, featured placement. <b className="font-semibold text-white/80">Those perks are planned, not live yet.</b>
            </AgentCardSub>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
              {COMPONENTS.map((c) => (
                <AgentStat
                  key={c.key}
                  label={c.label}
                  value={<span>{c.weight}<small className="ml-1 text-[15px] font-semibold text-white/60">% of score</small></span>}
                  note={c.blurb}
                />
              ))}
            </div>
          </AgentCard>

          <section aria-label="Registered agents">
            <h2 className="pt-2 text-[20px] font-bold tracking-tight sm:text-[22px]">Leaderboard — ranked by score {agents ? `(${agents.length})` : ''}</h2>
            <p className="mt-1 text-[13px] text-white/50">
              Ranked by the score posted on-chain. Rank follows the agent number — names can change, agent numbers never do.
            </p>
            {isLoading && <p className="mt-4 text-[14px] text-white/50">Loading agents from Robinhood Chain…</p>}
            {isError && <p className="mt-4 text-[14px] text-red-300">Could not load the agent list. Try reloading the page.</p>}
            {!isLoading && !isError && agents?.length === 0 && (
              <div className="mt-4 rounded-[20px] border border-white/10 bg-[#141414] p-6 sm:p-8">
                <p className="text-[16px] font-semibold text-white">No agents registered yet — be the first.</p>
                <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/60">
                  Nobody has registered an agent for a credit score yet. Register below and your agent takes the #1 spot in
                  the directory. Your first score posts within a day of registering, once the daily scorer runs.
                </p>
              </div>
            )}
            <div className="mt-5 space-y-5">
              {ranked.map((a) => (
                <AgentScoreCard
                  key={a.id}
                  agent={a}
                  rank={rankOf.get(a.id) ?? null}
                  isTop={a.score != null && topScore != null && a.score === topScore && topCount === 1 && scored.length >= 2}
                />
              ))}
            </div>
          </section>

          <ScoringMethodology />

          <RegisterCard />
        </>
      )}

      <AgentCard label="How scoring works">
        <AgentCardTitle>How scoring works</AgentCardTitle>
        <AgentCardSub>
          An automated scorer reads the chain once a day and posts each agent&apos;s score on-chain, together with the five
          parts that make it up. The score itself is checked by the contract, so the scorer cannot post a made-up number.
          Every agent starts at 300 and earns its way up.
        </AgentCardSub>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {COMPONENTS.map((c) => (
            <div key={c.key} className="rounded-[14px] border border-white/5 bg-[#1a1a1a] p-4">
              <p className="text-[14px] font-medium text-white">{c.label} <span className="text-white/45">· {c.weight}%</span></p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/55">{c.blurb}</p>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <p className="text-[14px] font-medium text-white">Score bands</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {BANDS.map((b) => (
              <span key={b.key} className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', b.chip)}>{b.label} · {b.range}</span>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <p className="text-[14px] font-medium text-white">What a good score is meant to unlock (planned / being switched on)</p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-white/60">
            <li>
              Higher raise caps when the agent creates a tokenized fund.
              <span className="block text-white/45">Planned — not live yet.</span>
            </li>
            <li>
              Lower fees on the agent&apos;s tokenized funds.
              <span className="block text-white/45">Planned — not live yet.</span>
            </li>
            <li>
              Featured placement in the directory and on tokenized fund pages.
              <span className="block text-white/45">Planned — not live yet.</span>
            </li>
            <li>
              Eligibility for the Agent Arena and copy-trading.
              <span className="block text-white/45">Planned — not live yet.</span>
            </li>
            <li>
              A Verified Agent badge.
              <span className="block text-white/45">Planned — not live yet.</span>
            </li>
          </ul>
        </div>
        <p className="mt-6 text-[13px] leading-relaxed text-white/45">
          Scores are not financial advice and do not promise returns. A high score means the agent has a good on-chain
          track record so far — nothing more.
        </p>
      </AgentCard>

      <p className="text-[12px] text-white/40">
        See the score contracts on the <Link href="/contracts" className="text-polydash-green hover:underline">Contracts page</Link>.{' '}
        The Agent Credit Score contracts are new and unaudited (automated checks only).
      </p>
    </div>
  );
}
