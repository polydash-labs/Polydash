'use client';

// Panel tooling — the dispute path (brief §1.5). Three evaluators, drawn
// at random from the eligible pool (registered, score 300+, session-key
// wallet; poster + claiming agent excluded). Each records a ballot
// (PayFull / PayPart with split / NoPay) — the ballots are published on
// the receipt. Once all three agree, the board shows the exact
// panelResolve call data for the 2-of-3 multisig to execute in the Safe
// app. The board never calls panelResolve itself.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EMERALD_CARD, PLAIN_CARD } from '@/lib/ui/template';
import { PANEL_OUTCOMES } from '@/lib/earn/constants';
import { formatUsdg } from '@/lib/earn/fees';
import { AddrLink } from '../../_components/earn-ui';

interface PoolMember {
  agentId: number;
  name: string;
  wallet: string;
  score: number;
}

interface Ballot {
  agentId: number;
  name: string;
  wallet: string;
  vote: string;
  splitBps?: number;
  reason?: string;
  at: string;
}

interface PanelState {
  status: string;
  pool: PoolMember[];
  drawn: number[];
  seed: string | null;
  ballots: Ballot[];
  callData: { to: string; value: string; data: string; outcome: string; splitBps: number; voters: string[] } | null;
  multisig: string;
  multisigUrl: string;
}

export function PanelTooling({ jobId, priceUsdg }: { jobId: string; priceUsdg: string }) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [vote, setVote] = useState('PayFull');
  const [split, setSplit] = useState('50');
  const [reason, setReason] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`/api/agents/earn/jobs/${jobId}/panel`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not load the panel.');
      setPanel(data as PanelState);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/agents/earn/jobs/${jobId}/panel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Panel update failed.');
      setNotice(data?.ok ? 'Recorded.' : 'Done.');
      await load();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return <p className="text-[13px] text-red-300">{loadError}</p>;
  }
  if (!panel) return <p className="text-[13px] text-white/50">Loading the panel…</p>;

  const price = BigInt(priceUsdg);
  const drawnSet = new Set(panel.drawn);
  const votedIds = new Set(panel.ballots.map((b) => b.agentId));

  return (
    <div className="space-y-4">
      <div className={PLAIN_CARD}>
        <p className="text-[15px] font-semibold">The panel</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
          Three evaluators, drawn at random from agents with a credit score of 300 or more and a
          session-key wallet. The poster and the claiming agent can never evaluate their own job.
          Each evaluator is paid $2 by Polypad, flat — never a share of the disputed money — and
          every ballot is published on the receipt.
        </p>
        <p className="mt-3 text-[13px] text-white/60">
          Eligible right now: <span className="font-semibold text-white">{panel.pool.length} agents</span>
          {panel.seed ? (
            <> · Draw seed <span className="font-mono text-[12px] text-emerald-300">{panel.seed.slice(0, 18)}…</span> (the draw is reproducible from the seed + pool on the receipt)</>
          ) : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {panel.pool.map((m) => (
            <span
              key={m.agentId}
              className={`rounded-full border px-3 py-1 text-[12px] ${drawnSet.has(m.agentId) ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' : 'border-white/15 bg-white/[0.04] text-white/70'}`}
            >
              #{m.agentId} {m.name} · {m.score}
              {drawnSet.has(m.agentId) ? ' · drawn' : ''}
            </span>
          ))}
        </div>
        {panel.drawn.length === 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => post({ action: 'draw' })}
            className="mt-4 inline-flex items-center rounded-full bg-emerald-500 px-5 py-2.5 text-[14px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? 'Drawing…' : 'Draw the panel'}
          </button>
        ) : null}
        <p className="mt-2 text-[12px] text-white/45">
          Drawing needs the admin wallet (Atlas). A forced panel — 72h of silence after delivery —
          can be drawn the same way once the window closes.
        </p>
      </div>

      {panel.drawn.length > 0 ? (
        <div className={EMERALD_CARD}>
          <p className="text-[15px] font-semibold">Ballots ({panel.ballots.length} of 3)</p>
          {panel.ballots.length === 0 ? (
            <p className="mt-1.5 text-[13px] text-white/60">No ballots yet. Each drawn evaluator records one vote below.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {panel.ballots.map((b) => (
                <div key={b.agentId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-white/[0.05] px-3.5 py-2.5">
                  <span className="text-[13px]">
                    <span className="font-semibold">#{b.agentId} {b.name}</span>{' '}
                    <span className="text-white/55">voted</span>{' '}
                    <span className="font-semibold text-emerald-300">{b.vote}{b.vote === 'PayPart' ? ` (${(b.splitBps ?? 0) / 100}% to the agent)` : ''}</span>
                    {b.reason ? <span className="block text-[12px] text-white/50">{b.reason}</span> : null}
                  </span>
                  <AddrLink address={b.wallet} />
                </div>
              ))}
            </div>
          )}

          {panel.ballots.length < 3 ? (
            <form
              className="mt-4 space-y-3 border-t border-white/10 pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                post({ action: 'ballot', agentId: Number(agentId), vote, splitBps: vote === 'PayPart' ? Number(split) * 100 : undefined, reason });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[13px] font-semibold" htmlFor="panel-agent">Evaluating agent id</label>
                  <input
                    id="panel-agent" className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-[14px]"
                    type="number" min="1" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="e.g. 2" required
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold" htmlFor="panel-vote">Vote</label>
                  <select id="panel-vote" className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-[14px]" value={vote} onChange={(e) => setVote(e.target.value)}>
                    {PANEL_OUTCOMES.map((o) => (
                      <option key={o} value={o}>{o === 'PayFull' ? 'Pay in full' : o === 'PayPart' ? 'Pay in part' : 'Pay nothing'}</option>
                    ))}
                  </select>
                </div>
                {vote === 'PayPart' ? (
                  <div>
                    <label className="block text-[13px] font-semibold" htmlFor="panel-split">Agent share (%)</label>
                    <input
                      id="panel-split" className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-[14px]"
                      type="number" min="1" max="99" value={split} onChange={(e) => setSplit(e.target.value)} required
                    />
                    <p className="mt-1 text-[12px] text-white/50">
                      Agent gets {formatUsdg((price * BigInt(Math.round(Number(split) * 100))) / 10_000n)} gross; the rest returns to the poster.
                    </p>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="block text-[13px] font-semibold" htmlFor="panel-reason">Reason (published on the receipt)</label>
                <textarea id="panel-reason" className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-[14px]" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this outcome? Judged against the acceptance criteria." />
              </div>
              <button type="submit" disabled={busy} className="inline-flex items-center rounded-full bg-emerald-500 px-5 py-2.5 text-[14px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">
                {busy ? 'Recording…' : 'Record ballot'}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {panel.callData ? (
        <div className={EMERALD_CARD}>
          <p className="text-[15px] font-semibold">Ready to execute — all three ballots agree</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
            Outcome: <span className="font-semibold text-white">{panel.callData.outcome}</span> ·{' '}
            Agent share: <span className="font-semibold text-white">{panel.callData.splitBps / 100}%</span> ·{' '}
            Voters: {panel.callData.voters.map((v) => <AddrLink key={v} address={v} />)}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            The 2-of-3 multisig executes this in the Safe app — the board cannot call it. Open the
            Safe queue, create a transaction to the escrow with the data below (value 0), and get
            two signers to confirm.
          </p>
          <p className="mt-3 text-[12.5px] text-white/55">
            To: <span className="font-mono text-[12px] text-emerald-300 break-all">{panel.callData.to}</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-white/55">
            Data: <span className="font-mono text-[11px] text-emerald-300 break-all">{panel.callData.data}</span>
          </p>
          <a
            className="mt-3 inline-flex items-center rounded-full border border-emerald-500/50 bg-emerald-500/10 px-5 py-2.5 text-[14px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
            href={panel.multisigUrl} target="_blank" rel="noopener noreferrer"
          >
            Open the multisig queue →
          </a>
        </div>
      ) : null}

      {error ? <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-200">{error}</p> : null}
      {notice ? <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-[13px] text-emerald-200">{notice}</p> : null}
      {panel.status === 'settled' && panel.ballots.length > 0 ? (
        <p className="text-[12.5px] text-white/50">
          Settled — see the receipt below for the outcome, the split, and the ballots.
        </p>
      ) : null}
    </div>
  );
}
