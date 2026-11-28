'use client';

// Job tabs — Open / In progress / Done. Each job is one clean feed row:
// a big amount, plain words, one tap to open. No tables, no grids.
import { useState } from 'react';
import Link from 'next/link';

/** One row, built server-side. All strings — safe to pass to a client component. */
export interface JobRow {
  id: string;
  title: string;
  /** Plain-words line, e.g. "Due in 3d · Claimed by Agent #2". */
  line: string;
  /** The big amount, e.g. "$24.38". Always the agent's net (or, for a
   * refund, the price returned to the poster). Never gross as take-home. */
  headline: string;
  /** What the big amount is, e.g. "Agent keeps" / "Returned to poster". */
  headlineNote: string;
}

type Tab = 'open' | 'progress' | 'done';

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

const EMPTY: Record<Tab, { title: string; body: string }> = {
  open: {
    title: 'No jobs open right now.',
    body: 'The pilot runs 5 curated jobs with invited posters. When a job is screened in and its price is locked in escrow, it appears here.',
  },
  progress: {
    title: 'Nothing in progress.',
    body: 'Jobs an agent has claimed — or that are waiting on a decision — show up here.',
  },
  done: {
    title: 'Nothing settled yet.',
    body: 'Paid-out jobs — and refunds — show up here with what the agent kept.',
  },
};

function JobFeedRow({ row }: { row: JobRow }) {
  return (
    <Link
      href={`/agents/earn/${row.id}`}
      className="flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-4 transition-colors hover:border-emerald-500/40 hover:bg-white/[0.05]"
    >
      <span className="min-w-0">
        <span className="block truncate text-[16px] font-semibold leading-snug">{row.title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-white/55">{row.line}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[20px] font-bold leading-none">{row.headline}</span>
        <span className="mt-1 block text-[12px] text-white/50">{row.headlineNote}</span>
      </span>
    </Link>
  );
}

export function JobTabs({
  open,
  inProgress,
  done,
}: {
  open: JobRow[];
  inProgress: JobRow[];
  done: JobRow[];
}) {
  const [tab, setTab] = useState<Tab>('open');
  const rows = tab === 'open' ? open : tab === 'progress' ? inProgress : done;
  const counts: Record<Tab, number> = { open: open.length, progress: inProgress.length, done: done.length };

  return (
    <div className="mt-8">
      <div className="inline-flex rounded-full border border-white/15 bg-white/[0.03] p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`rounded-full px-4 py-2 text-[14px] font-semibold transition-colors ${
              tab === t.key ? 'bg-white text-black' : 'text-white/60 hover:text-white'
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-6">
          <p className="text-[15px] font-semibold">{EMPTY[tab].title}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{EMPTY[tab].body}</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <JobFeedRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
