'use client';

// Atlas screening queue — the pilot's human gate (brief §1.1).
// Screening judges listability only: legality, coherence,
// impersonation/trademark, price/deadline plausibility. It never judges
// quality. Approved jobs go to the poster for locking; rejected jobs go
// back to the poster with a reason. Admin wallet only, signed in the same
// way as the agent-actions admin page (nonce + signature, no transaction).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EMERALD_CARD, PLAIN_CARD } from '@/lib/ui/template';
import { formatUsdg } from '@/lib/earn/fees';
import type { JobJson } from '@/lib/earn/types';
import { AddrLink } from '../../_components/earn-ui';

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Request failed.');
  return data;
}

export function ScreeningQueue() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [jobs, setJobs] = useState<JobJson[] | null>(null);
  const [state, setState] = useState<'loading' | 'signin' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/agents/earn/jobs?status=pending_screening', { cache: 'no-store' });
      const data = await res.json();
      if (res.status === 401) {
        setState('signin');
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? 'Could not load the queue.');
      setJobs(data.jobs as JobJson[]);
      setState('ready');
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not load the queue.');
      setState('signin');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const signIn = async () => {
    if (!address) return;
    setBusy(true);
    setError('');
    try {
      const { nonce, message } = await postJson('/api/admin/agent-actions/nonce', { address });
      const signature = await signMessageAsync({ message });
      await postJson('/api/admin/agent-actions/verify', { address, nonce, signature });
      await load();
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'Sign-in failed.';
      setError(/reject|denied/i.test(msg) ? 'Signature cancelled.' : msg);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (jobId: string, decision: 'approve' | 'reject') => {
    const reason = (reasonById[jobId] ?? '').trim();
    if (decision === 'reject' && reason.length < 5) {
      setError('A rejected job needs a reason — the poster sees it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await postJson(`/api/agents/earn/jobs/${jobId}/screen`, { decision, reason });
      await load();
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not record the decision.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return <p className="flex items-center gap-2 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading the queue…</p>;
  }

  if (state === 'signin') {
    return (
      <div className={PLAIN_CARD}>
        <p className="text-[15px] font-semibold">Atlas only</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
          Connect the admin wallet and sign a message to open the queue. Signing a message sends
          no transaction.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ConnectButton showBalance={false} />
          {address ? <Button onClick={signIn} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in (sign a message)'}</Button> : null}
        </div>
        {error ? <p className="mt-3 text-[13px] text-red-300">{error}</p> : null}
      </div>
    );
  }

  const pending = jobs ?? [];
  return (
    <div className="space-y-4">
      {pending.length === 0 ? (
        <div className={PLAIN_CARD}>
          <p className="text-[15px] font-semibold">Queue is empty.</p>
          <p className="mt-1.5 text-[13px] text-white/60">No jobs are waiting for screening. New submissions appear here.</p>
        </div>
      ) : (
        pending.map((job) => (
          <div key={job.id} className={EMERALD_CARD}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[16px] font-semibold">{job.title}</p>
              <p className="text-[14px] font-bold text-emerald-300">{formatUsdg(BigInt(job.priceUsdg))}</p>
            </div>
            <p className="mt-1 text-[13px] text-white/60">{job.topic}</p>
            <div className="mt-3 space-y-2 text-[13px] leading-relaxed text-white/70">
              <p><span className="font-semibold text-white">Questions: </span><span className="whitespace-pre-wrap">{job.researchQuestions}</span></p>
              <p><span className="font-semibold text-white">Format: </span>{job.format}</p>
              {job.sourceConstraints ? <p><span className="font-semibold text-white">Sources: </span>{job.sourceConstraints}</p> : null}
              <p><span className="font-semibold text-white">Acceptance: </span>{job.acceptanceCriteria}</p>
              <p><span className="font-semibold text-white">Deadline: </span>{new Date(job.deadline).toLocaleString()}</p>
              <p><span className="font-semibold text-white">Poster: </span><AddrLink address={job.poster} /></p>
            </div>
            <div className="mt-4">
              <label className="block text-[13px] font-semibold" htmlFor={`reason-${job.id}`}>
                Reason (required to reject — the poster sees it)
              </label>
              <input
                id={`reason-${job.id}`}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-[14px]"
                value={reasonById[job.id] ?? ''}
                onChange={(e) => setReasonById((prev) => ({ ...prev, [job.id]: e.target.value }))}
                placeholder="e.g. Vague brief — the acceptance criteria are not verifiable."
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button" disabled={busy} onClick={() => decide(job.id, 'approve')}
                className="inline-flex items-center rounded-full bg-emerald-500 px-5 py-2.5 text-[14px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
              >
                Approve — list after lock
              </button>
              <button
                type="button" disabled={busy} onClick={() => decide(job.id, 'reject')}
                className="inline-flex items-center rounded-full border border-red-500/50 bg-red-500/10 px-5 py-2.5 text-[14px] font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              >
                Reject with reason
              </button>
              <Link href={`/agents/earn/${job.id}`} className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-white/[0.08]">
                View job →
              </Link>
            </div>
          </div>
        ))
      )}
      {error ? <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-200">{error}</p> : null}
    </div>
  );
}
