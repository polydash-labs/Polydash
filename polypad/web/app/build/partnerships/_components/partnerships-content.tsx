'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  Coins,
  Copy,
  Database,
  Download,
  FileText,
  Layers,
  Link2,
  Lock,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  BETTER,
  CAPABILITIES,
  COMPARISON_ROWS,
  FINE_PRINT,
  HERO,
  INTEGRATION_PATHS,
  NUMBERS,
  OFFERINGS,
  PARTNERSHIP_TYPES,
  PARTNERSHIP_TYPE_OPTIONS,
  PROCESS,
  WHY_PARTNER,
} from '@/lib/partnerships/data';

const SECTION = 'mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20';
const KICKER = 'text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-400';
const H2 = 'mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-white';
const SUB = 'mt-3 max-w-2xl text-[15px] leading-relaxed text-white/60';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/80 hover:bg-white/[0.08]"
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? 'Copied' : label}
    </button>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[11px] font-medium text-white/50">{label}</span>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-emerald-300">{code}</pre>
    </div>
  );
}

const OFFERING_ICONS = [Rocket, Coins, FileText, Layers, Sparkles, BookOpen, Zap, Database];

export function PartnershipsContent() {
  const [form, setForm] = useState({ name: '', company: '', email: '', website: '', type: 'Integration', message: '' });
  const [formState, setFormState] = useState<{ kind: 'idle' | 'sending' | 'done' | 'error'; msg: string }>({
    kind: 'idle',
    msg: '',
  });
  const [copiedLink, setCopiedLink] = useState(false);

  async function submitInquiry(e: React.FormEvent) {
    e.preventDefault();
    if (formState.kind === 'sending') return;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim());
    if (!form.name.trim() || !emailOk || form.message.trim().length < 10) {
      setFormState({ kind: 'error', msg: 'Please add your name, a valid work email, and at least a sentence about your project.' });
      return;
    }
    setFormState({ kind: 'sending', msg: '' });
    try {
      const res = await fetch('/api/partnerships/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not send your inquiry.');
      setFormState({ kind: 'done', msg: '' });
    } catch (err: unknown) {
      setFormState({ kind: 'error', msg: (err as Error)?.message || 'Could not send your inquiry. Please try again.' });
    }
  }

  return (
    <div className="bg-black text-white">
      {/* 1 · Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(0,230,118,0.12),transparent_50%)]" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <p className={KICKER}>Partnerships · Robinhood Chain</p>
          <h1 className="mt-4 max-w-3xl text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
            Partner with <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-500 bg-clip-text text-transparent">Polypad</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] sm:text-lg leading-relaxed text-white/70">{HERO.valueProp}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#inquiry"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-[15px] font-semibold text-black hover:bg-emerald-400"
            >
              Request for Partnership <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="/api/partnerships/catalog"
              download
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-6 py-3 text-[15px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
            >
              <Download className="h-4 w-4" /> Download the partner catalog
            </a>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NUMBERS.map((n) => (
              <div key={n.label} className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 to-transparent p-4">
                <p className="text-2xl sm:text-3xl font-bold text-emerald-300">{n.value}</p>
                <p className="mt-1 text-[13px] font-medium text-white">{n.label}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-white/50">{n.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2 · Why partner */}
      <section className={SECTION}>
        <p className={KICKER}>Why partner</p>
        <h2 className={H2}>One integration. The whole agentic stack.</h2>
        <p className={SUB}>Connect once and your product gets wallets, funds, launches, staking, and pay-per-call — without building any of it yourself.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {WHY_PARTNER.map((w) => (
            <div key={w.title} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-5">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <h3 className="mt-3 text-[17px] font-semibold">{w.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3 · What we offer */}
      <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
        <div className={SECTION}>
          <p className={KICKER}>What we offer partners</p>
          <h2 className={H2}>Everything you need to build on-chain.</h2>
          <p className={SUB}>Each offering plugs into your product through the API, the SDK, or MCP — whichever fits your stack.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {OFFERINGS.map((o, i) => {
              const Icon = OFFERING_ICONS[i % OFFERING_ICONS.length];
              return (
                <div
                  key={o.title}
                  className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-5"
                >
                  <Icon className="h-5 w-5 text-emerald-400" />
                  <h3 className="mt-3 text-[16px] font-semibold">{o.title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">{o.body}</p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-400/80">{o.route}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4 · Architecture diagram */}
      <section className={SECTION}>
        <p className={KICKER}>How it fits together</p>
        <h2 className={H2}>Your product → Polypad → Robinhood Chain.</h2>
        <p className={SUB}>Three layers. Your app talks to Polypad in plain language; Polypad talks to the chain. You sign everything — Polypad never holds your keys.</p>
        <div className="mx-auto mt-10 max-w-2xl">
          <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-5 text-center">
            <Wallet className="mx-auto h-6 w-6 text-emerald-400" />
            <p className="mt-2 text-[16px] font-semibold">Your app or agent</p>
            <p className="mt-1 text-[13px] text-white/55">Your product, your users, your brand — unchanged.</p>
          </div>
          <ArrowDown className="mx-auto my-2 h-5 w-5 text-emerald-400" />
          <div className="grid grid-cols-3 gap-3">
            {['REST API', 'SDK', 'MCP'].map((layer) => (
              <div key={layer} className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/20 to-emerald-500/[0.04] p-4 text-center">
                <p className="text-[15px] font-bold text-emerald-300">{layer}</p>
                <p className="mt-1 hidden text-[11.5px] leading-snug text-white/55 sm:block">
                  {layer === 'REST API' ? 'HTTPS, any stack' : layer === 'SDK' ? 'TypeScript + Python' : 'For AI agents'}
                </p>
              </div>
            ))}
          </div>
          <ArrowDown className="mx-auto my-2 h-5 w-5 text-emerald-400" />
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/20 to-transparent p-5 text-center">
            <p className="text-[16px] font-semibold">Polypad core</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {['Agent wallets', 'Tokenized funds', 'Token launches', 'Staking', 'NFTs', 'x402 pay-per-call'].map((c) => (
                <span key={c} className="rounded-full border border-emerald-500/30 bg-black/40 px-3 py-1 text-[12px] font-medium text-emerald-200">
                  {c}
                </span>
              ))}
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[12.5px] text-white/55">
              <Lock className="h-3.5 w-3.5 text-emerald-400" /> Non-custodial: every action returns an unsigned transaction for your user to sign.
            </p>
          </div>
          <ArrowDown className="mx-auto my-2 h-5 w-5 text-emerald-400" />
          <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-5 text-center">
            <p className="text-[16px] font-semibold">Robinhood Chain · 4663</p>
            <p className="mt-1 text-[13px] text-white/55">Fast, low-cost settlement — every wallet, fund, and payment settles here.</p>
          </div>
        </div>
      </section>

      {/* 5 · Integration paths */}
      <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.06] to-transparent">
        <div className={SECTION}>
          <p className={KICKER}>Integration paths</p>
          <h2 className={H2}>Three ways in. Pick your stack.</h2>
          <p className={SUB}>They all reach the same tools. Start with whichever one your team already knows.</p>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {INTEGRATION_PATHS.map((p) => (
              <div key={p.name} className="flex flex-col rounded-2xl border border-white/10 bg-black/50 p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[18px] font-semibold">{p.name}</h3>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">{p.tag}</span>
                </div>
                <ol className="mt-4 space-y-2.5">
                  {p.steps.map((s, i) => (
                    <li key={s} className="flex gap-2.5 text-[13.5px] leading-relaxed text-white/65">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-bold text-emerald-300">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
                <CodeBlock code={p.code} label={p.codeLabel} />
              </div>
            ))}
          </div>
          <p className="mt-6 text-[13px] text-white/50">
            MCP endpoint: <span className="font-mono text-[12px] text-emerald-300">https://polypad.family/api/mcp</span> · SDK:{' '}
            <span className="font-mono text-[12px] text-emerald-300">polypad-agent v2.0.1</span> (npm + PyPI) · REST API v2 with Pro keys.
          </p>
        </div>
      </section>

      {/* 6 · Partnership types */}
      <section className={SECTION}>
        <p className={KICKER}>Partnership types</p>
        <h2 className={H2}>Five ways to partner. One that fits.</h2>
        <p className={SUB}>Start with the type that matches what you are building — you can grow into the others later.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PARTNERSHIP_TYPES.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/12 to-transparent p-5"
            >
              <h3 className="text-[18px] font-semibold">{t.name}</h3>
              <p className="mt-1 text-[13.5px] text-emerald-300/90">{t.tagline}</p>
              <ul className="mt-4 space-y-2">
                {t.includes.map((inc) => (
                  <li key={inc} className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {inc}
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-white/10 pt-3 text-[12.5px] leading-relaxed text-white/50">
                <span className="font-semibold text-white/70">Best for: </span>
                {t.bestFor}
              </p>
            </div>
          ))}
          <div className="flex flex-col justify-center rounded-2xl border border-dashed border-emerald-500/40 bg-emerald-500/[0.06] p-5">
            <p className="text-[17px] font-semibold">Not sure which fits?</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
              Tell us what you are building in the form below and we will point you at the right one — or shape a custom build around it.
            </p>
            <a href="#inquiry" className="mt-4 inline-flex items-center gap-2 text-[14px] font-semibold text-emerald-300 hover:underline">
              Request for Partnership <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* 7 · Comparison grid */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className={SECTION}>
          <p className={KICKER}>Side by side</p>
          <h2 className={H2}>What each partnership includes.</h2>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 bg-emerald-500/10">
                  <th className="px-4 py-3 text-[13px] font-semibold text-white">Included</th>
                  {PARTNERSHIP_TYPES.map((t) => (
                    <th key={t.name} className="px-3 py-3 text-center text-[13px] font-semibold text-emerald-200">
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, ri) => (
                  <tr key={row.feature} className={ri % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                    <td className="px-4 py-3 text-[13.5px] text-white/80">{row.feature}</td>
                    {row.values.map((v, i) => (
                      <td key={`${row.feature}-${i}`} className="px-3 py-3 text-center">
                        {v === true ? (
                          <Check className="mx-auto h-4 w-4 text-emerald-400" />
                        ) : v === false ? (
                          <span className="text-white/25">—</span>
                        ) : (
                          <span className="text-[12px] font-medium text-emerald-300/90">{v}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12.5px] text-white/45">“Add-on” means available as part of that partnership — ask on the intro call.</p>
        </div>
      </section>

      {/* 8 · Capabilities checklist */}
      <section className={SECTION}>
        <p className={KICKER}>Capabilities checklist</p>
        <h2 className={H2}>Everything your agents can do — ready to integrate.</h2>
        <p className={SUB}>
          Every capability below is live on Polypad today and ties to a real integration route — API, SDK, MCP, or on-chain. 25 MCP tools · 5
          agent skills · chain id 4663.
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {CAPABILITIES.map((g, gi) => (
            <div key={g.group} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
              <div className="flex items-baseline gap-3 border-b border-white/10 pb-3">
                <span className="font-mono text-[13px] font-bold text-emerald-400">{String(gi + 1).padStart(2, '0')}</span>
                <h3 className="text-[19px] font-bold">{g.group}</h3>
              </div>
              <ul className="mt-4 space-y-3.5">
                {g.rows.map((row) => (
                  <li key={row.label} className="flex gap-3">
                    {row.live ? (
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-500 text-black">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-dashed border-white/40" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold leading-snug text-white">
                        {row.label}
                        {!row.live && (
                          <span className="ml-2 rounded border border-white/30 px-1.5 py-0.5 align-middle font-mono text-[10px] font-medium uppercase tracking-wide text-white/60">
                            Built · Not live
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-white/55">{row.detail}</p>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-400/70">{row.route}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 flex items-center gap-2 text-[12.5px] text-white/45">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-500 text-black">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          Live
          <span className="ml-3 inline-block h-4 w-4 rounded border border-dashed border-white/40" />
          Built, not live
        </p>
      </section>

      {/* 9 · How we make your project better */}
      <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
        <div className={SECTION}>
          <p className={KICKER}>How we make your project better</p>
          <h2 className={H2}>What changes when you build on Polypad.</h2>
          <p className={SUB}>Not a pitch — the concrete difference, feature by feature, for a project that integrates with us.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {BETTER.map((b) => (
              <div key={b.title} className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/12 to-transparent p-5">
                <h3 className="text-[16.5px] font-semibold leading-snug">{b.title}</h3>
                <p className="mt-3 text-[13px] leading-relaxed text-white/45">
                  <span className="font-semibold text-white/60">Before: </span>
                  {b.before}
                </p>
                <p className="mt-2 flex gap-2 text-[13.5px] leading-relaxed text-white/75">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    <span className="font-semibold text-emerald-300">After: </span>
                    {b.after}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 10 · Process timeline */}
      <section className={SECTION}>
        <p className={KICKER}>How it works</p>
        <h2 className={H2}>From application to launch in five steps.</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-5">
          {PROCESS.map((p, i) => (
            <div key={p.step} className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[15px] font-bold text-black">
                {i + 1}
              </span>
              <h3 className="mt-3 text-[16px] font-semibold">{p.step}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{p.body}</p>
              {i < PROCESS.length - 1 && (
                <ArrowRight className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-emerald-400 md:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 11 · Free compute */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-14 sm:pb-20">
        <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/25 via-emerald-600/10 to-transparent p-8 sm:p-12 text-center">
          <Zap className="mx-auto h-8 w-8 text-emerald-300" />
          <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">Free compute for strategic partners</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/70">
            Strategic partners get free compute to build and run on Polypad. If you are building something big on the agentic stack, apply below
            and tell us what it is.
          </p>
          <a
            href="#inquiry"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-[15px] font-semibold text-black hover:bg-emerald-400"
          >
            Apply for free compute <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* 12 · Partner catalog */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className={SECTION}>
          <div className="flex flex-col gap-6 rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-transparent p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <p className={KICKER}>Partner catalog</p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">The whole page, in one document.</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">
                Offerings, integration paths, partnership types, the capabilities checklist, the process, and free compute — everything on this
                page, in a PDF you can share with your team.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href="/api/partnerships/catalog"
                download
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 text-[14px] font-semibold text-black hover:bg-emerald-400"
              >
                <Download className="h-4 w-4" /> Download catalog (PDF)
              </a>
              <button
                type="button"
                onClick={async () => {
                  const url = window.location.href;
                  try {
                    await navigator.clipboard.writeText(url);
                  } catch {
                    const ta = document.createElement('textarea');
                    ta.value = url;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                  }
                  setCopiedLink(true);
                  window.setTimeout(() => setCopiedLink(false), 2500);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.04] px-5 py-3 text-[14px] font-semibold text-white hover:bg-white/[0.08]"
              >
                <Link2 className="h-4 w-4" /> {copiedLink ? 'Link copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 13 · Inquiry form */}
      <section id="inquiry" className={SECTION}>
        <p className={KICKER}>Request for Partnership</p>
        <h2 className={H2}>Tell us what you are building.</h2>
        <p className={SUB}>
          We read every application and reply from <span className="text-emerald-300">jon@dasheco.xyz</span>. No spam, no obligation — just a
          conversation about whether Polypad fits your project.
        </p>
        <div className="mt-8 max-w-2xl rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.08] to-transparent p-6 sm:p-8">
          {formState.kind === 'done' ? (
            <div className="py-6 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-black">
                <Check className="h-6 w-6" strokeWidth={3} />
              </span>
              <h3 className="mt-4 text-[20px] font-semibold">Inquiry received.</h3>
              <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-white/60">
                Thanks — your partnership inquiry is in. We will reply from jon@dasheco.xyz, usually within a few business days.
              </p>
              <Link href="/build" className="mt-5 inline-block text-[14px] font-semibold text-emerald-300 hover:underline">
                Back to Build →
              </Link>
            </div>
          ) : (
            <form onSubmit={submitInquiry} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[13px] font-medium text-white/80">Your name *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Jane Appleseed"
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[13px] font-medium text-white/80">Company / project *</span>
                  <input
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    placeholder="Your project name"
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[13px] font-medium text-white/80">Work email *</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@company.com"
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[13px] font-medium text-white/80">Website (optional)</span>
                  <input
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    placeholder="https://yourproject.com"
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[13px] font-medium text-white/80">Partnership type *</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] text-white focus:border-emerald-400 focus:outline-none [&>option]:bg-black"
                >
                  {PARTNERSHIP_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[13px] font-medium text-white/80">What are you building? *</span>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={5}
                  placeholder="A sentence or two: what your project does, and what you want to build with Polypad."
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
                />
              </label>
              {formState.kind === 'error' && <p className="text-[13.5px] text-red-400">{formState.msg}</p>}
              <button
                type="submit"
                disabled={formState.kind === 'sending'}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-[15px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-60"
              >
                <Send className="h-4 w-4" /> {formState.kind === 'sending' ? 'Sending…' : 'Submit partnership inquiry'}
              </button>
            </form>
          )}
        </div>
        <p className="mt-8 max-w-2xl text-[12px] leading-relaxed text-white/40">{FINE_PRINT}</p>
      </section>
    </div>
  );
}
