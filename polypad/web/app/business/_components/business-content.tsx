'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  Briefcase,
  CalendarCheck,
  Check,
  Coins,
  CreditCard,
  Gem,
  Layers,
  LayoutDashboard,
  MessageSquare,
  PieChart,
  Plug,
  Receipt,
  Rocket,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import GlossaryBox from '@/components/glossary-box';
import {
  SECTION,
  KICKER,
  HERO_GLOW,
  EMERALD_CARD,
  EMERALD_CARD_STRONG,
  PLAIN_CARD,
  CTA_PRIMARY,
  CTA_OUTLINE,
  SectionHead,
  FlowDiagram,
} from '@/lib/ui/template';

const CALENDLY_URL = 'https://calendly.com/jon-dasheco/30min';

const flywheelSteps = [
  {
    n: '1',
    t: 'Connect',
    d: 'The business connects its AI agent — or creates one — with a secure wallet that has limits the owner sets.',
  },
  {
    n: '2',
    t: 'Work',
    d: 'The agent uses Polypad’s pay-per-call tools to do real jobs: token reports, fund NAV checks, CTO reports.',
  },
  {
    n: '3',
    t: 'Save',
    d: 'Jobs that used to take hours get done in minutes — finding customers, checking prices, drafting outreach, tracking inventory.',
  },
  {
    n: '4',
    t: 'Grow',
    d: 'The time and money saved funds more AI usage. The business does more with the same team.',
  },
  {
    n: '5',
    t: 'Prove',
    d: 'Every agent action has a verifiable on-chain receipt, and the agent builds a credit score (300–850) from real usage.',
  },
  {
    n: '6',
    t: 'Repeat',
    d: 'The proof brings the next business in, and the flywheel spins faster.',
  },
];

/* The three tiers. Tier 1 is the flagship (everything, customized);
 * Tier 2 is the growth suite (customized for scaling businesses);
 * Tier 3 is the starter (essentially free). No prices are listed for
 * Tier 1 or Tier 2 — they are priced on the demo call. */
const tiers = [
  {
    tier: 'Tier 1',
    name: 'Enterprise AI Infra Suite',
    price: 'Custom',
    priceNote: 'Priced on your demo call — built around your business',
    badge: 'Flagship — most complete',
    flagship: true,
    blurb:
      'The full suite, customized for your company. We build it with you and run it with you.',
    includes: [
      'Everything in the Growth suite',
      'Dedicated support from the Polypad team',
      'Custom integrations built for your stack',
      'Custom fund structures for your company',
      'Priority onboarding — we set it all up for you',
    ],
    cta: 'Book a demo',
  },
  {
    tier: 'Tier 2',
    name: 'Growth AI Infra Suite',
    price: 'Custom',
    priceNote: 'Priced on your demo call — sized to your team',
    badge: null,
    flagship: false,
    blurb:
      'The customized suite for a business that is scaling — every tool your agents need to do real work.',
    includes: [
      'Agent wallets with daily spending caps you set',
      '25 MCP tools in one API — launch, trade, stake, funds',
      'Agent payments — pay per call, pennies at a time',
      'x402 AI inference — reports from $0.01',
      'Agent security — firewall, caps, verifiable receipts',
      'Poly Agent on-site chat for your customers',
    ],
    cta: 'Book a demo',
  },
  {
    tier: 'Tier 3',
    name: 'Starter',
    price: 'Free',
    priceNote: 'Essentially free — pay only for what you use after that',
    badge: 'Start here',
    flagship: false,
    blurb:
      'Try it on a real job today. Free credits, one agent wallet, and Poly Agent — no crypto needed.',
    includes: [
      '$25 free Poly Credits starter — 2,500 credits, good for 6 months',
      'One agent wallet with a daily limit you set',
      'Poly Agent access — ask anything in plain language',
      'Pay-per-use after the starter — from $0.01 per call',
    ],
    cta: 'Start free',
  },
];

/* Everything in the suite — all live today. Each package is one
 * plain-language line about what it does for a business. */
const packages = [
  {
    t: 'Agentic management software',
    d: 'Manage your AI agents in one place — wallets, limits, activity, and receipts. Every agent also builds a credit score (300–850) from real usage.',
    icon: LayoutDashboard,
  },
  {
    t: 'Agent payments',
    d: 'Your agent pays for answers and tools as it works — pennies per call, no monthly seat fees, and you set the daily limit.',
    icon: CreditCard,
  },
  {
    t: 'Agentic NFT tokenized capability',
    d: 'Turn products, memberships, or shares into tokens or NFTs — your customers can own a piece of what you build.',
    icon: Gem,
  },
  {
    t: 'Company growth fund management',
    d: 'A tokenized fund for your company: raise, invest, and share returns under a locked mandate — every buy public, with a two-day wait.',
    icon: PieChart,
  },
  {
    t: 'Agent wallets',
    d: 'A secure wallet for each agent, with a daily spending limit you set and a freeze switch only you control. Backup key plus a two-day recovery wait.',
    icon: Wallet,
  },
  {
    t: '25 MCP tools',
    d: 'One API with 25 tools — launch tokens, trade, stake, join funds, and pay. Connect your agent in one command.',
    icon: Plug,
  },
  {
    t: 'x402 AI inference',
    d: 'Token reports $0.01, fund NAV $0.01, CTO reports $0.05 — answers on demand, paid per call, no account needed.',
    icon: Zap,
  },
  {
    t: 'Poly Agent',
    d: 'An AI assistant on your site that answers questions in plain language and points visitors to the right page.',
    icon: MessageSquare,
  },
  {
    t: 'Agent security',
    d: '$5,000/day spending caps, a firewall, and a verifiable receipt for every job your agent does — checkable by anyone, on-chain.',
    icon: ShieldCheck,
  },
  {
    t: 'Token launches',
    d: 'Launch a token in minutes. It moves to Uniswap V4 when the curve fills — your agent can do the whole launch.',
    icon: Rocket,
  },
  {
    t: 'Staking',
    d: 'Stake POLYDASH and earn rewards while your agent works — your stake keeps earning in the background.',
    icon: Coins,
  },
  {
    t: 'Poly credits',
    d: 'Prepaid credits for agent tools: $25 free starter, 100 credits = $1, good for 6 months. Not a token — nothing in MetaMask.',
    icon: Sparkles,
  },
];

/* Comparison chart — qualitative only. No competitor names, no invented
 * competitor prices or numbers. */
const compareRows: { label: string; us: string; them: string }[] = [
  { label: 'Agent wallets with spending caps', us: 'Included', them: 'Partial' },
  { label: 'MCP tools in one API', us: '25 tools', them: 'Fewer tools, separate APIs' },
  { label: 'Tokenized funds under a locked mandate', us: 'Included', them: 'Not offered' },
  { label: 'x402 pay-per-call pricing', us: 'From $0.01 per call', them: 'Monthly plans' },
  { label: 'Agent security with verifiable receipts', us: 'Included', them: 'Add-on' },
  { label: 'Setup time', us: 'Minutes — no sales call', them: 'Days to weeks' },
  {
    label: 'Cost to scale',
    us: 'Usage-based — pay per call, no per-seat fees',
    them: 'Per-seat / per-agent monthly fees',
  },
];

function DemoForm() {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setError('');
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company: company || undefined }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error || 'Something went wrong. Please try again.');
        setState('error');
        return;
      }
      setState('done');
    } catch {
      setError('Something went wrong. Please try again.');
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="rounded-2xl bg-emerald-500/10 px-4 py-4 text-center">
        <p className="text-[15px] font-semibold text-white">
          Thanks — pick a time below to lock in your demo.
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-white/60">
          We&apos;ll confirm by email and bring a plan built around your business.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <label className="block">
        <span className="sr-only">Work email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Work email"
          autoComplete="email"
          className="w-full rounded-full border border-white/15 bg-black/40 px-4 py-3 text-[14px] text-white placeholder:text-white/40 focus:border-emerald-400 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="sr-only">Company name (optional)</span>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company name (optional)"
          autoComplete="organization"
          className="w-full rounded-full border border-white/15 bg-black/40 px-4 py-3 text-[14px] text-white placeholder:text-white/40 focus:border-emerald-400 focus:outline-none"
        />
      </label>
      {state === 'error' && error && (
        <p className="text-[13px] text-red-400" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={state === 'sending'} className={`${CTA_PRIMARY} w-full justify-center disabled:opacity-60`}>
        {state === 'sending' ? 'Saving…' : 'Request my demo'}
      </button>
    </form>
  );
}

export function BusinessContent({ receiptCount }: { receiptCount: number }) {
  return (
    <div className="bg-black text-white">
      {/* Hero — big commercial headline, plain language, two CTAs. */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className={HERO_GLOW} />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <p className={KICKER}>Polypad for business · Robinhood Chain</p>
          <h1 className="mt-4 max-w-3xl text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
            AI infrastructure that{' '}
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-500 bg-clip-text text-transparent">
              does the work
            </span>{' '}
            for your business.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] sm:text-lg leading-relaxed text-white/70">
            Give your business an AI workforce: agents with their own wallets, tools that cost
            pennies per call, and a receipt for every job. You set the limits — Polypad does the
            heavy lifting.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#demo" className={CTA_PRIMARY}>
              Book a demo <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#packages" className={CTA_OUTLINE}>
              See packages
            </a>
            <span className="text-[13px] text-white/50">Free to start — $25 of starter credits, no crypto needed.</span>
          </div>

          {/* Dark hero card — one big number as the hero. */}
          <div className={`${EMERALD_CARD_STRONG} mt-12`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Image src="/polydash-logo-200.png" alt="Polypad" width={30} height={30} className="h-[30px] w-[30px]" />
                <span className="text-[19px] font-bold tracking-tight">Polypad</span>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                Free to start
              </span>
            </div>

            <p className="mt-6 text-center text-[40px] font-extrabold leading-none tracking-tight sm:text-[52px]">
              $25
            </p>
            <p className="mt-3 text-center text-[15px] leading-relaxed text-white/50">
              free starter credits — put an AI agent to work on a real job today. No crypto needed.
            </p>

            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3.5 py-2.5">
                <div>
                  <p className="text-[15px] font-semibold leading-tight">Pay per call</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                    Token report $0.01, fund NAV $0.01, CTO report $0.05 — pay only for the answers you use
                  </p>
                </div>
                <p className="flex-none text-right text-[15px] font-bold leading-tight">$0.01</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3.5 py-2.5">
                <div>
                  <p className="text-[15px] font-semibold leading-tight">Free to start</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                    $25 starter credits, one per wallet, good for 6 months — 2,500 credits
                  </p>
                </div>
                <p className="flex-none text-right text-[15px] font-bold leading-tight">6 months</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3.5 py-2.5">
                <div>
                  <p className="text-[15px] font-semibold leading-tight">Reputation on-chain</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                    Every agent builds a credit score from real usage — no faking it
                  </p>
                </div>
                <p className="flex-none text-right text-[15px] font-bold leading-tight">300–850</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <Link href="/agents/credits" className={`${CTA_PRIMARY} flex-1 justify-center`}>
                Get your free $25
              </Link>
              <Link href="/inference" className={`${CTA_OUTLINE} flex-1 justify-center`}>
                See what it can do
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — the business flow, as a diagram. */}
      <section className={SECTION}>
        <SectionHead
          kicker="How it works"
          title="Need to results, in four moves."
          sub="Tell us the job, pick how you want to start, and the agent infrastructure does the work — with a receipt for every job, on-chain."
        />
        <FlowDiagram
          layers={[
            {
              title: 'Your business need',
              body: 'A real job: find customers, check prices, draft outreach, track inventory.',
              icon: <Briefcase className="mx-auto h-6 w-6 text-emerald-400" />,
            },
            {
              title: 'Request a demo — or pick a tier',
              body: 'Book a demo, or start free with $25 of starter credits. No crypto needed.',
              icon: <CalendarCheck className="mx-auto h-6 w-6 text-emerald-400" />,
            },
            {
              title: 'Agent infrastructure does the work',
              body: 'Your agent connects once and gets everything — wallets, tools, payments, security.',
              pills: ['REST API', 'SDK', 'MCP · 25 tools'],
              icon: <Layers className="mx-auto h-6 w-6 text-emerald-400" />,
              emerald: true,
            },
            {
              title: 'Results on-chain',
              body: 'Every job has a verifiable receipt, and the agent builds a credit score (300–850) from real usage.',
              icon: <Receipt className="mx-auto h-6 w-6 text-emerald-400" />,
            },
          ]}
        />
      </section>

      {/* TIERS — what we offer, in three tiers. Tier 1 is the flagship,
          Tier 3 is the starter (essentially free). */}
      <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
        <div className={SECTION}>
          <SectionHead
            kicker="What we offer"
            title="Three ways in."
            sub="Pick the one that fits where your business is today. Every tier is built on the same live infrastructure."
          />
          <div id="tiers" className="mt-8 grid scroll-mt-24 gap-4 lg:grid-cols-3">
            {tiers.map((t) => (
              <div
                key={t.tier}
                className={`flex flex-col rounded-[20px] border p-5 text-white shadow-[0_16px_40px_rgba(0,0,0,0.4)] ${
                  t.flagship
                    ? 'border-emerald-500/60 bg-gradient-to-b from-emerald-500/20 to-emerald-500/[0.04] ring-1 ring-emerald-500/40'
                    : 'border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-emerald-400">{t.tier}</p>
                  {t.badge && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        t.flagship ? 'bg-emerald-500 text-black' : 'bg-white/[0.08] text-white/80'
                      }`}
                    >
                      {t.badge}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[19px] font-bold leading-tight tracking-tight">{t.name}</p>
                <p className="mt-3 text-[36px] font-extrabold leading-none tracking-tight">
                  {t.price}
                </p>
                <p className="mt-2 text-[12.5px] leading-snug text-white/50">{t.priceNote}</p>
                <p className="mt-4 text-[13.5px] leading-relaxed text-white/70">{t.blurb}</p>
                <ul className="mt-4 flex-1 space-y-2.5">
                  {t.includes.map((line) => (
                    <li key={line} className="flex items-start gap-2.5 text-[13.5px] leading-snug text-white/80">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  <a href="#demo" className={`${t.flagship ? CTA_PRIMARY : CTA_OUTLINE} w-full justify-center`}>
                    {t.cta}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PACKAGES — everything in the suite. */}
      <section className={SECTION}>
        <div id="packages" className="scroll-mt-24">
          <SectionHead
            kicker="Everything in the suite"
            title="Twelve packages. All live today."
            sub={`No waitlist, no sales call to get started.${receiptCount > 0 ? ` ${receiptCount} public receipts already prove the work.` : ''}`}
          />
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.t} className={`${EMERALD_CARD} flex flex-col`}>
                <Icon className="h-5 w-5 text-emerald-400" />
                <p className="mt-3 text-[16px] font-semibold leading-tight text-white">{p.t}</p>
                <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-white/60">{p.d}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* COMPARISON — Polydash vs top competitors (generic, no names). */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className={SECTION}>
          <div id="compare" className="scroll-mt-24">
            <SectionHead
              kicker="Side by side"
              title="Polydash vs. the rest"
              sub="Most agent platforms charge you per seat, per agent, per month — and still make you bolt the pieces together. Polypad is one suite, and you pay for what you use."
            />
          </div>
          <div className="mt-8 overflow-x-auto rounded-[20px] border border-white/10 bg-black/50 shadow-[0_16px_40px_rgba(0,0,0,0.4)]">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 bg-emerald-500/10">
                  <th className="px-4 py-3.5 text-[13px] font-semibold text-white/50 sm:px-5">What you get</th>
                  <th className="px-4 py-3.5 text-[13px] font-bold text-emerald-300 sm:px-5">Polydash</th>
                  <th className="px-4 py-3.5 text-[13px] font-semibold text-white/50 sm:px-5">Top competitors</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((r) => (
                  <tr key={r.label} className="border-b border-white/5 last:border-b-0">
                    <td className="px-4 py-3.5 text-[13.5px] font-medium text-white sm:px-5">{r.label}</td>
                    <td className="px-4 py-3.5 text-[13.5px] font-semibold text-white sm:px-5">
                      <span className="mr-1.5 inline-flex align-middle text-emerald-400"><Check className="h-4 w-4" /></span>
                      {r.us}
                    </td>
                    <td className="px-4 py-3.5 text-[13.5px] text-white/55 sm:px-5">{r.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-[640px] text-[12px] leading-relaxed text-white/40">
            The competitor column describes the common pattern across agent platforms — per-seat
            pricing, separate tools, and add-on security — not any single company.
          </p>
        </div>
      </section>

      {/* DEMO — email capture + Calendly. The Calendly button works even
          if the visitor never fills the form. */}
      <section className={SECTION}>
        <div id="demo" className={`scroll-mt-24 rounded-[20px] border border-emerald-500/40 ${EMERALD_CARD_STRONG} p-5 text-white shadow-[0_16px_40px_rgba(0,0,0,0.4)] sm:p-7`}>
          <p className={KICKER}>Book your demo</p>
          <p className="mt-2 text-[22px] font-extrabold leading-tight tracking-tight sm:text-[28px]">
            We&apos;ll do the heavy lifting.
          </p>
          <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-white/60">
            Leave your work email and we&apos;ll bring a plan built around your business — the
            right tier, the right integrations, and a price that fits. Or skip the form and
            grab a time right now.
          </p>
          <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:items-start">
            <DemoForm />
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <p className="text-[15px] font-semibold text-white">Prefer to talk now?</p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/55">
                Book a 30-minute call. We&apos;ll walk through your business, show the suite
                live, and tell you exactly what it costs — no pressure, no jargon.
              </p>
              <a
                href={CALENDLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`${CTA_PRIMARY} mt-4 w-full justify-center`}
              >
                Book a 30-min demo call
              </a>
              <p className="mt-2 text-center text-[12px] text-white/40">
                Opens Calendly in a new tab
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THE FLYWHEEL — centerpiece. A visual loop, not a list. */}
      <section className={SECTION}>
        <SectionHead
          kicker="The flywheel"
          title="It compounds."
          sub="Six steps that feed each other. Each loop makes the next one easier — and brings the next business in."
        />
        <div className={`${EMERALD_CARD_STRONG} mt-8`}>
          <div className="flex items-center gap-3">
            <p className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-emerald-500 text-black">
              <RotateCw className="h-5 w-5" />
            </p>
            <div>
              <p className="text-[19px] font-bold leading-tight tracking-tight">It compounds</p>
              <p className="text-[13px] leading-snug text-white/50">
                The work proves itself, and the proof does the selling.
              </p>
            </div>
          </div>

          {/* The loop, in one line — arrows make the cycle obvious. */}
          <div className="mt-6 flex flex-wrap items-center gap-1.5">
            {flywheelSteps.map((s, i) => (
              <span key={s.n} className="flex items-center gap-1.5">
                <span className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[12.5px] font-semibold text-white">
                  {s.n} · {s.t}
                </span>
                {i < flywheelSteps.length - 1 ? (
                  <ArrowRight className="h-4 w-4 text-emerald-400" aria-hidden />
                ) : (
                  <RotateCw className="h-4 w-4 text-emerald-400" aria-hidden />
                )}
              </span>
            ))}
            <span className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-300">
              back to Connect
            </span>
          </div>

          {/* The six steps, as cards in a 3×2 grid. */}
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {flywheelSteps.map((s) => (
              <div key={s.n} className="rounded-2xl bg-white/[0.06] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-[15px] font-bold text-black">
                    {s.n}
                  </p>
                  <p className="text-[13px] font-bold tracking-tight text-white">{s.t}</p>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-white/50">{s.d}</p>
              </div>
            ))}
          </div>

          {/* Loop-back strip — the cycle closes here. */}
          <div className="mt-6 flex items-start gap-3 rounded-2xl bg-emerald-500/10 px-4 py-3.5">
            <RotateCw className="mt-0.5 h-5 w-5 flex-none text-emerald-400" />
            <p className="text-[13.5px] leading-relaxed text-white/70">
              <span className="font-semibold text-white">The loop closes:</span>{' '}
              every business that proves its work brings the next one in. More proof, more
              businesses, more usage — and the flywheel spins faster.
            </p>
          </div>
        </div>
      </section>

      {/* HOW TO START */}
      <section className={SECTION}>
        <SectionHead
          kicker="How to start"
          title="Three steps to your first job."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              n: '1',
              t: 'Connect or create an agent wallet',
              d: 'Give your AI agent a wallet with a daily limit you set. You can freeze it any time.',
              href: '/agents/wallets',
              cta: 'See agent wallets',
            },
            {
              n: '2',
              t: 'Claim $25 free Poly Credits',
              d: 'Free starter credits — 2,500 of them, good for 6 months. No crypto needed.',
              href: '/agents/credits',
              cta: 'Claim your free $25',
            },
            {
              n: '3',
              t: 'Put the agent to work on a real task',
              d: 'A token report, a fund NAV check, a CTO report — a few cents a call, receipt on-chain.',
              href: '/inference',
              cta: 'Browse the marketplace',
            },
          ].map((s) => (
            <div key={s.n} className={`${PLAIN_CARD} flex flex-col`}>
              <p className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-[15px] font-bold text-black">
                {s.n}
              </p>
              <p className="mt-3 text-[16px] font-semibold text-white">{s.t}</p>
              <p className="mt-1 flex-1 text-[13px] leading-relaxed text-white/55">{s.d}</p>
              <div className="mt-4">
                <Link href={s.href} className={`${CTA_PRIMARY} w-full justify-center`}>
                  {s.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Built for real businesses — the OpenWorks moment, stated factually. */}
      <section className={SECTION}>
        <SectionHead
          kicker="Built for real businesses"
          title="Built for real businesses."
        />
        <div className={`${PLAIN_CARD} mt-8 max-w-[640px]`}>
          <p className="text-[13px] leading-relaxed text-white/70">
            OpenAI just launched OpenWorks — it pays local AI experts up to $8,000 a month to help
            small businesses adopt AI, hands-on. Polypad is the infrastructure those experts — and
            the businesses they help — can run on: a secure agent wallet with limits the owner
            sets, pay-per-call tools that cost pennies, and a receipt for every job.
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-white/40">
            Polypad is not affiliated with, endorsed by, or a partner of OpenAI, and is not an
            OpenWorks Partner.
          </p>
        </div>

        <div className="mt-4 max-w-[640px]">
          <GlossaryBox
            terms={[
              {
                term: 'AI agent',
                def: 'Software that does a job for you on its own — it can look things up, make payments, and take actions, inside limits you set.',
              },
              {
                term: 'Pay-per-call',
                def: 'You pay a few cents for one answer, inside the request — no account, no monthly fee. The agent signs the payment and gets the data back.',
              },
              {
                term: 'Poly Credits',
                def: 'Prepaid credits for pay-per-call agent tools. $25 starter = 2,500 credits, good for 6 months. They live off-chain in your account — not a token, nothing in MetaMask.',
              },
              {
                term: 'Agent Credit Score',
                def: 'A score from 300 to 850 for an AI agent, built only from on-chain behavior. Stored on-chain (ERC-8004) so anyone can check it.',
              },
            ]}
          />
        </div>

        {/* Closing CTA. */}
        <div className={`${EMERALD_CARD_STRONG} mt-10`}>
          <p className="text-center text-[22px] font-bold leading-tight tracking-tight">
            Put an AI agent to work for your business.
          </p>
          <p className="mt-2 text-center text-[14px] leading-relaxed text-white/50">
            Start free — $25 of credits, no crypto needed.
          </p>
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <Link href="/agents/credits" className={`${CTA_PRIMARY} flex-1 justify-center`}>
              Get your free $25
            </Link>
            <a href="#demo" className={`${CTA_OUTLINE} flex-1 justify-center`}>
              Book a demo
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
