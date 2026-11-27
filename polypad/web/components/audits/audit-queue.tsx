'use client';

import { useCallback, useEffect, useState } from 'react';

const inputCls =
  'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';

interface AuditRequestRow {
  id: string;
  projectName: string;
  repoUrl: string;
  commitHash: string;
  contractsInScope: string;
  chain: string;
  deployedAddresses: string;
  description: string;
  status: string;
  verdict: string | null;
  reportUrl: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  in_review: 'In review',
  reviewed: 'Reviewed',
};

const VERDICT_LABEL: Record<string, { label: string; dot: string }> = {
  green: { label: 'Green — clean', dot: 'bg-[#00E676]' },
  yellow: { label: 'Yellow — issues to fix', dot: 'bg-yellow-400' },
  red: { label: 'Red — serious issues open', dot: 'bg-red-500' },
};

const EMPTY_FORM = {
  projectName: '',
  repoUrl: '',
  commitHash: '',
  contractsInScope: '',
  chain: 'Robinhood Chain',
  deployedAddresses: '',
  description: '',
  contact: '',
};

export default function AuditQueue() {
  const [rows, setRows] = useState<AuditRequestRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/audits', { cache: 'no-store' });
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setRows(Array.isArray(data.requests) ? data.requests : []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key: keyof typeof EMPTY_FORM) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/audits/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not save the request.');
      setSubmitted(true);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save the request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="audit-project" className="mb-1 block text-[13px] font-medium text-white/80">
            Project name
          </label>
          <input id="audit-project" className={inputCls} placeholder="e.g. Acme Lending" value={form.projectName} onChange={set('projectName')} required />
        </div>
        <div>
          <label htmlFor="audit-repo" className="mb-1 block text-[13px] font-medium text-white/80">
            Link to your code
          </label>
          <input
            id="audit-repo"
            className={inputCls}
            placeholder="https://github.com/your-team/your-contracts"
            value={form.repoUrl}
            onChange={set('repoUrl')}
            required
          />
          <p className="mt-1 text-xs text-white/40">Public repo, or grant the review access to a private one.</p>
        </div>
        <div>
          <label htmlFor="audit-commit" className="mb-1 block text-[13px] font-medium text-white/80">
            Exact commit to review
          </label>
          <input
            id="audit-commit"
            className={inputCls}
            placeholder="The full 40-character commit hash"
            value={form.commitHash}
            onChange={set('commitHash')}
            required
          />
          <p className="mt-1 text-xs text-white/40">Warden reviews exactly this commit — nothing before it, nothing after it.</p>
        </div>
        <div>
          <label htmlFor="audit-contracts" className="mb-1 block text-[13px] font-medium text-white/80">
            Which contracts are in scope
          </label>
          <textarea
            id="audit-contracts"
            className={`${inputCls} min-h-[72px]`}
            placeholder={'contracts/LendingPool.sol\ncontracts/PriceFeed.sol'}
            value={form.contractsInScope}
            onChange={set('contractsInScope')}
            required
          />
        </div>
        <div>
          <label htmlFor="audit-chain" className="mb-1 block text-[13px] font-medium text-white/80">
            Chain
          </label>
          <input id="audit-chain" className={inputCls} value={form.chain} onChange={set('chain')} required />
        </div>
        <div>
          <label htmlFor="audit-deployed" className="mb-1 block text-[13px] font-medium text-white/80">
            Deployed addresses (if already deployed)
          </label>
          <input
            id="audit-deployed"
            className={inputCls}
            placeholder="0x… (one per line if there are several)"
            value={form.deployedAddresses}
            onChange={set('deployedAddresses')}
          />
        </div>
        <div>
          <label htmlFor="audit-description" className="mb-1 block text-[13px] font-medium text-white/80">
            What do the contracts do, in plain words?
          </label>
          <textarea
            id="audit-description"
            className={`${inputCls} min-h-[72px]`}
            placeholder="Who uses them, and what money or assets do they hold?"
            value={form.description}
            onChange={set('description')}
            required
          />
        </div>
        <div>
          <label htmlFor="audit-contact" className="mb-1 block text-[13px] font-medium text-white/80">
            How can Warden reach you for the fix round?
          </label>
          <input
            id="audit-contact"
            className={inputCls}
            placeholder="Email or Telegram handle"
            value={form.contact}
            onChange={set('contact')}
            required
          />
          <p className="mt-1 text-xs text-white/40">Only used to reach you about your audit. Never shown on this page.</p>
        </div>
        {submitError ? <p className="text-[13px] text-red-400">{submitError}</p> : null}
        {submitted ? (
          <p className="text-[13px] text-[#00E676]">
            Request saved — your project is in the queue below. Warden reviews the oldest request first.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-[#00E676] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Submit for audit'}
        </button>
      </form>

      <div>
        <h3 className="text-sm font-semibold text-white">The queue — in review order</h3>
        <p className="mt-1 text-[13px] text-white/50">
          Oldest first. Warden picks up the top queued project next — nothing jumps the line.
        </p>
        {loadError ? (
          <p className="mt-4 text-[13px] text-white/60">Couldn&apos;t load the queue right now. Try refreshing the page.</p>
        ) : rows === null ? (
          <p className="mt-4 text-[13px] text-white/60">Loading the queue…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-[13px] text-white/60">No audit requests yet — yours could be the first.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {rows.map((r, i) => (
              <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-white/40">#{i + 1}</span>
                  <a href={r.repoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-white hover:underline">
                    {r.projectName}
                  </a>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.verdict && VERDICT_LABEL[r.verdict] ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70">
                      <span className={`inline-block h-2 w-2 rounded-full ${VERDICT_LABEL[r.verdict].dot}`} />
                      {VERDICT_LABEL[r.verdict].label}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{r.description}</p>
                <p className="mt-1.5 text-xs text-white/40">
                  {r.chain} · commit {r.commitHash.slice(0, 7)} · requested{' '}
                  {new Date(r.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
                {r.reportUrl ? (
                  <a href={r.reportUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[13px] text-[#00E676] hover:underline">
                    Read the full report →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
