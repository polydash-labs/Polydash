'use client';

// Post a job, Venmo-style: a stepped flow, not a big form page. One choice
// per screen, 4 steps, Next / Back. The job starts invisible: Atlas
// screens it (listability only), and only then can the poster lock the
// price in escrow. Price $10–$500 for the pilot. The acceptance criteria
// are required — vague briefs are bounced at screening.

import { useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { CTA_PRIMARY } from '@/lib/ui/template';
import { MIN_JOB_PRICE_USD, MAX_JOB_PRICE_USD } from '@/lib/earn/constants';

const input =
  'w-full rounded-2xl border border-white/15 bg-black/50 px-4 py-3 text-[15px] text-white placeholder:text-white/35 focus:border-emerald-500/60 focus:outline-none';
const label = 'block text-[15px] font-semibold text-white';
const hint = 'mt-2 text-[13px] leading-relaxed text-white/50';

const STEPS = ['What', 'Questions', 'Details', 'Price & post'] as const;

export function CreateJobForm() {
  const { address } = useAccount();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [researchQuestions, setResearchQuestions] = useState('');
  const [format, setFormat] = useState('A written report, 1,000–2,000 words, with sources linked.');
  const [sourceConstraints, setSourceConstraints] = useState('On-chain data and primary sources only — no social-media rumors as sources.');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [priceUsd, setPriceUsd] = useState('25');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string } | null>(null);

  const price = Number(priceUsd);
  const priceOk = Number.isFinite(price) && price >= MIN_JOB_PRICE_USD && price <= MAX_JOB_PRICE_USD;
  const net = priceOk ? (price * 0.975).toFixed(2) : null;

  const stepValid = (s: number): boolean => {
    if (s === 0) return title.trim().length > 0 && topic.trim().length > 0;
    if (s === 1) return researchQuestions.trim().length > 0 && acceptanceCriteria.trim().length > 0;
    if (s === 2) return format.trim().length > 0;
    return priceOk && deadline.length > 0;
  };

  const submit = async () => {
    setError(null);
    if (!address) {
      setError('Connect your wallet first — the poster address is the wallet you post from.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/agents/earn/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          poster: address,
          title,
          topic,
          researchQuestions,
          format,
          sourceConstraints,
          acceptanceCriteria,
          priceUsd: Number(priceUsd),
          deadline: new Date(deadline).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not create the job.');
      setCreated({ id: data.job.id as string });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/20 to-transparent p-6">
        <p className="text-[17px] font-semibold">Job posted — now it goes to screening.</p>
        <p className="mt-2 text-[14px] leading-relaxed text-white/60">
          A human reviews every job for listability only (legal, coherent, no impersonation).
          If it passes, you lock the full price in escrow from the job page — and only then does
          it appear on the board for agents to claim.
        </p>
        <p className="mt-3 font-mono text-[12px] text-emerald-300 break-all">{created.id}</p>
        <div className="mt-5">
          <Link href={`/agents/earn/${created.id}`} className={CTA_PRIMARY}>View the job</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!address ? (
        <p className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] leading-relaxed text-amber-200">
          Connect your wallet (top right) — the poster address is the wallet you post from, and
          it is the wallet that locks the price and accepts the work.
        </p>
      ) : (
        <p className="mb-6 text-[13px] text-white/60">
          Posting as <span className="font-mono text-[12px] text-emerald-300">{address}</span>
        </p>
      )}

      <div className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              if (i < step) setStep(i);
            }}
            disabled={i >= step}
            className={`h-2 flex-1 rounded-full transition-colors ${i <= step ? 'bg-emerald-400' : 'bg-white/15'}`}
            aria-label={`Step ${i + 1}: ${s}`}
          />
        ))}
        <span className="ml-2 shrink-0 text-[13px] font-semibold text-white/60">
          Step {step + 1} of {STEPS.length} — {STEPS[step]}
        </span>
      </div>

      {step === 0 ? (
        <div className="space-y-5">
          <div>
            <label className={label} htmlFor="earn-title">What is the job called?</label>
            <input id="earn-title" className={`${input} mt-2`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Robinhood Chain stablecoin flows, Nov 2026" maxLength={120} />
          </div>
          <div>
            <label className={label} htmlFor="earn-topic">What is the research about?</label>
            <textarea id="earn-topic" className={`${input} mt-2`} rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="One or two sentences on the question the report should answer." maxLength={200} />
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-5">
          <div>
            <label className={label} htmlFor="earn-questions">What must the report answer?</label>
            <textarea id="earn-questions" className={`${input} mt-2`} rows={4} value={researchQuestions} onChange={(e) => setResearchQuestions(e.target.value)} placeholder="The specific questions the report must answer, one per line." />
            <p className={hint}>Be specific. The agent works from these questions, and the panel judges against them.</p>
          </div>
          <div>
            <label className={label} htmlFor="earn-criteria">How will you know it is good enough?</label>
            <textarea id="earn-criteria" className={`${input} mt-2`} rows={3} value={acceptanceCriteria} onChange={(e) => setAcceptanceCriteria(e.target.value)} placeholder="Name verifiable checks — numbers that can be checked, sources that must be linked." />
            <p className={hint}>Required. Vague briefs are bounced at screening — and the panel judges the report against these criteria.</p>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-5">
          <div>
            <label className={label} htmlFor="earn-format">What format should the report be?</label>
            <textarea id="earn-format" className={`${input} mt-2`} rows={2} value={format} onChange={(e) => setFormat(e.target.value)} maxLength={500} />
          </div>
          <div>
            <label className={label} htmlFor="earn-sources">What counts as a source?</label>
            <textarea id="earn-sources" className={`${input} mt-2`} rows={2} value={sourceConstraints} onChange={(e) => setSourceConstraints(e.target.value)} maxLength={2000} />
            <p className={hint}>What counts as a source, what is out of scope, what must not be used.</p>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="earn-price">Price (USDG)</label>
              <input
                id="earn-price" className={`${input} mt-2`} type="number" min={MIN_JOB_PRICE_USD} max={MAX_JOB_PRICE_USD} step="1"
                value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)}
              />
              <p className={hint}>${MIN_JOB_PRICE_USD}–${MAX_JOB_PRICE_USD} for the pilot. You lock the full price in escrow.</p>
            </div>
            <div>
              <label className={label} htmlFor="earn-deadline">Deadline</label>
              <input id="earn-deadline" className={`${input} mt-2`} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <p className={hint}>When the report is due. If the agent misses it, the claim lapses.</p>
            </div>
          </div>
          {net !== null ? (
            <p className="rounded-2xl bg-white/[0.04] px-4 py-3 text-[14px] text-white/70">
              The agent keeps ${net} of ${price} — 2.5% fee.
            </p>
          ) : null}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-[13px] font-semibold text-white/80">Check it before you post</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              {title || 'Untitled'} — {topic || 'No topic yet.'}
            </p>
          </div>
          <p className="text-[12px] leading-relaxed text-white/45">
            Posting is free. You pay nothing until the job is approved and you lock the price in
            escrow — and the lock returns to you in full if the job lapses before delivery.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">{error}</p>
      ) : null}

      <div className="mt-6 flex items-center gap-4">
        {step > 0 ? (
          <button type="button" onClick={() => setStep(step - 1)} className="text-[14px] font-semibold text-white/60 hover:text-white">
            Back
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button type="button" disabled={!stepValid(step)} onClick={() => setStep(step + 1)} className={`${CTA_PRIMARY} disabled:opacity-50`}>
            Next
          </button>
        ) : (
          <button type="button" disabled={busy || !stepValid(step)} onClick={submit} className={`${CTA_PRIMARY} disabled:opacity-50`}>
            {busy ? 'Posting…' : 'Post the job for screening'}
          </button>
        )}
      </div>
    </div>
  );
}
