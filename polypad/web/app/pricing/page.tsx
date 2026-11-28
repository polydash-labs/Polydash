import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, CreditCard, KeyRound, ShieldCheck, Zap } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { trustMetadata } from '@/lib/trust';
import { LIMITS } from '@/lib/agents-api/v2/config';
import {
  CTA_OUTLINE,
  CTA_PRIMARY,
  EMERALD_CARD,
  EMERALD_CARD_STRONG,
  EMERALD_PILL,
  FlowDiagram,
  HERO_GLOW,
  KICKER,
  PLAIN_CARD,
  SECTION,
  SectionHead,
  StatTiles,
} from '@/lib/ui/template';

export const metadata: Metadata = trustMetadata({
  title: 'Pricing | Polypad',
  description: 'Start free. No signup. No API key. No approval. Pro is $0 while growing, at 10x the free limits. Pay-per-call reports from $0.01.',
  path: '/pricing',
});

const FREE = LIMITS.rate;
const PRO = LIMITS.ratePro;

const LIMIT_ROWS = [
  { label: 'Reads / min', free: FREE.read.limit, pro: PRO.read.limit },
  { label: 'Prepares / min', free: FREE.prepare.limit, pro: PRO.prepare.limit },
  { label: 'Prepares per wallet / min', free: FREE.perWalletPrepare.limit, pro: PRO.perWalletPrepare.limit },
  { label: 'Intent / min', free: FREE.intent.limit, pro: PRO.intent.limit },
];

const QUESTIONS = [
  {
    q: 'Do I need a key to start?',
    a: 'No. The free tier needs nothing — no signup, no key, no approval.',
  },
  {
    q: 'What does a key buy me?',
    a: 'Higher limits and a usage dashboard. Same tools, same safety caps.',
  },
  {
    q: 'Do keys move money?',
    a: 'No. Keys only identify your calls. Spending is governed separately by SpendVault keys on /agents/accounts.',
  },
  {
    q: 'What happens if I lose my key?',
    a: 'Issue a new one from /agents/accounts and revoke the old one. The full key is shown once and never again.',
  },
];

export default function PricingPage() {
  return (
    <div className="bg-black text-white">
      <Header />
      <main>
        {/* 1 · Hero */}
        <section className="relative overflow-hidden border-b border-white/10">
          <div className={HERO_GLOW} />
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
            <p className={KICKER}>Pricing · Robinhood Chain</p>
            <h1 className="mt-4 max-w-3xl text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
              Start <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-500 bg-clip-text text-transparent">free</span>.
              Scale when you need to.
            </h1>
            <p className="mt-5 max-w-2xl text-[16px] sm:text-lg leading-relaxed text-white/70">
              Start free. No signup. No API key. No approval. The Polypad MCP is 25 tools that let an agent trade,
              launch tokens, join Tokenized Funds, and buy NFTs on Robinhood Chain — the agent signs everything in its
              own wallet, and Polypad never holds a private key.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/build" className={CTA_PRIMARY}>
                Connect — copy the MCP config <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/agents/accounts" className={CTA_OUTLINE}>
                <KeyRound className="h-4 w-4" /> Get a Pro key
              </Link>
            </div>
            <StatTiles
              items={[
                { value: '$0', label: 'Free tier', note: 'Forever — no signup, no key' },
                { value: '25', label: 'MCP tools', note: 'All of them, on the free tier' },
                { value: '10×', label: 'Pro limits', note: 'Pro is $0 while growing' },
                { value: '$0.01', label: 'Pay-per-call', note: 'Per report — no subscription' },
              ]}
            />
          </div>
        </section>

        {/* 2 · How pricing scales — flow diagram */}
        <section className={SECTION}>
          <SectionHead
            kicker="How pricing scales"
            title="Free first. Pro when your usage grows."
            sub="The same API at every tier. A Pro key raises the ceiling on calls per minute — it never raises the 25 ETH per-action cap."
          />
          <FlowDiagram
            layers={[
              {
                title: 'Start free — $0, forever',
                body: 'All 25 tools, no key, no signup. Reads 120/min · prepares 30/min · prepares per wallet 12/min · intent 40/min.',
                icon: <Zap className="mx-auto h-6 w-6 text-emerald-400" />,
                pills: ['No signup', 'No API key', 'No approval'],
              },
              {
                title: 'Get a Pro key — $0 while growing',
                body: 'Same API, higher limits, and see your usage. The key is shown once and you can revoke it any time. A key only identifies your calls — it never moves money.',
                icon: <KeyRound className="mx-auto h-6 w-6 text-emerald-400" />,
                emerald: true,
                pills: ['10× the free limits', 'Usage dashboard', 'Revocable any time'],
              },
              {
                title: 'Usage scales with 10× limits',
                body: 'Reads 1,200/min · prepares 300/min · prepares per wallet 120/min · intent 400/min. The 25 ETH per-action cap and the 1 ETH confirm-first rule do not change with Pro.',
                icon: <CreditCard className="mx-auto h-6 w-6 text-emerald-400" />,
                pills: ['Reads 1,200/min', 'Prepares 300/min', '25 ETH cap unchanged'],
              },
            ]}
          />
        </section>

        {/* 3 · Tiers */}
        <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
          <div className={SECTION}>
            <SectionHead
              kicker="Tiers"
              title="Three ways to pay. Pick the one that fits."
              sub="Free and Pro cover the MCP. Pay-per-call covers one deep answer at a time — it is not part of Pro."
            />
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {/* Free */}
              <div className={PLAIN_CARD}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[18px] font-semibold">Free</h3>
                  <span className={EMERALD_PILL}>$0, forever</span>
                </div>
                <p className="mt-1 text-[13.5px] text-white/55">The MCP as it is today.</p>
                <ul className="mt-4 space-y-2.5">
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> All 25 tools, no key, no signup.
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    Reads {FREE.read.limit.toLocaleString('en-US')}/min · prepares{' '}
                    {FREE.prepare.limit.toLocaleString('en-US')}/min · prepares per wallet{' '}
                    {FREE.perWalletPrepare.limit.toLocaleString('en-US')}/min · intent{' '}
                    {FREE.intent.limit.toLocaleString('en-US')}/min.
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> One action at most 25 ETH; above 1
                    ETH, confirm the amount first.
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> Request body at most 16 KB;
                    batches of at most 10 messages.
                  </li>
                </ul>
                <Link href="/build" className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-emerald-300 hover:underline">
                  Connect — copy the MCP config <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              {/* Pro */}
              <div className={EMERALD_CARD_STRONG}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[18px] font-semibold">Pro</h3>
                  <span className={EMERALD_PILL}>$0 while growing</span>
                </div>
                <p className="mt-1 text-[13.5px] text-white/55">Same API, higher limits, and see your usage.</p>
                <ul className="mt-4 space-y-2.5">
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> Everything in Free.
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    Higher per-minute limits — 10x the free tier: reads {PRO.read.limit.toLocaleString('en-US')}/min
                    · prepares {PRO.prepare.limit.toLocaleString('en-US')}/min · prepares per wallet{' '}
                    {PRO.perWalletPrepare.limit.toLocaleString('en-US')}/min · intent{' '}
                    {PRO.intent.limit.toLocaleString('en-US')}/min.
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      API keys you manage from{' '}
                      <Link href="/agents/accounts" className="text-emerald-300 hover:underline">
                        /agents/accounts
                      </Link>
                      : the key is shown once, and you can revoke it any time. A key only identifies your calls — it
                      never moves money.
                    </span>
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      A usage dashboard (calls by tool, reads vs prepares, 429s) is live now at{' '}
                      <Link href="/agents/usage" className="text-emerald-300 hover:underline">
                        /agents/usage
                      </Link>{' '}
                      — paste your key to see your own usage.
                    </span>
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> The 25 ETH per-action cap and the
                    1 ETH confirm-first rule do not change with Pro.
                  </li>
                </ul>
                <Link href="/agents/accounts" className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-emerald-300 hover:underline">
                  Get a Pro key <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              {/* Pay-per-call */}
              <div className={EMERALD_CARD}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[18px] font-semibold">Pay-per-call</h3>
                  <span className={EMERALD_PILL}>Priced per report</span>
                </div>
                <p className="mt-1 text-[13.5px] text-white/55">
                  One deep answer, bought in the call itself. No subscription, and not part of Pro.
                </p>
                <ul className="mt-4 space-y-2.5">
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      <strong className="text-white">Token report — $0.01.</strong> Live on-chain facts for any token
                      launched on Polypad.
                    </span>
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      <strong className="text-white">Tokenized Fund NAV — $0.01.</strong> A Tokenized Fund&apos;s net
                      asset value per share, right now.
                    </span>
                  </li>
                  <li className="flex gap-2 text-[13.5px] leading-relaxed text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      <strong className="text-white">CTO report — $0.05.</strong> The full analyst report — risk,
                      momentum, holders, narrative.
                    </span>
                  </li>
                </ul>
                <p className="mt-4 text-[13.5px] leading-relaxed text-white/60">
                  Paid in USDG or POLYDASH, in the call itself (x402).
                </p>
                <Link href="/build" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-emerald-300 hover:underline">
                  Try it live <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* 4 · Limits side by side */}
        <section className={SECTION}>
          <SectionHead
            kicker="Side by side"
            title="Free vs Pro limits."
            sub="Every per-minute limit, at a glance. Pro is 10× the free tier on every row — and the safety caps never move."
          />
          <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 bg-emerald-500/10">
                  <th className="px-4 py-3 text-[13px] font-semibold text-white">Limit</th>
                  <th className="px-3 py-3 text-center text-[13px] font-semibold text-emerald-200">Free</th>
                  <th className="px-3 py-3 text-center text-[13px] font-semibold text-emerald-200">Pro</th>
                </tr>
              </thead>
              <tbody>
                {LIMIT_ROWS.map((row, ri) => (
                  <tr key={row.label} className={ri % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                    <td className="px-4 py-3 text-[13.5px] text-white/80">{row.label}</td>
                    <td className="px-3 py-3 text-center text-[13.5px] text-white/70">
                      {row.free.toLocaleString('en-US')}/min
                    </td>
                    <td className="px-3 py-3 text-center text-[13.5px] font-semibold text-emerald-300">
                      {row.pro.toLocaleString('en-US')}/min
                    </td>
                  </tr>
                ))}
                <tr className="bg-white/[0.02]">
                  <td className="px-4 py-3 text-[13.5px] text-white/80">Max per action</td>
                  <td className="px-3 py-3 text-center text-[13.5px] text-white/70">25 ETH</td>
                  <td className="px-3 py-3 text-center text-[13.5px] font-semibold text-emerald-300">25 ETH</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-[13.5px] text-white/80">Confirm first above</td>
                  <td className="px-3 py-3 text-center text-[13.5px] text-white/70">1 ETH</td>
                  <td className="px-3 py-3 text-center text-[13.5px] font-semibold text-emerald-300">1 ETH</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12.5px] text-white/45">
            Request body at most 16 KB; batches of at most 10 messages — the same on both tiers.
          </p>
        </section>

        {/* 5 · How limits work */}
        <section className="border-y border-white/10 bg-white/[0.02]">
          <div className={SECTION}>
            <SectionHead
              kicker="How limits work"
              title="Reads are questions. Prepares are transactions, ready to sign."
            />
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className={PLAIN_CARD}>
                <Zap className="h-5 w-5 text-emerald-400" />
                <h3 className="mt-3 text-[16px] font-semibold">Reads</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
                  Reads are questions — listings, quotes, details, portfolio, transaction status. They are fast and
                  cheap, so the limit is high.
                </p>
              </div>
              <div className={PLAIN_CARD}>
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <h3 className="mt-3 text-[16px] font-semibold">Prepares</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
                  Prepares are “get a transaction ready for me to sign” — heavier, so the limit is lower, and still
                  capped at 25 ETH per action. If you hit a limit you get a 429 — wait a minute and try again. A Pro
                  key raises the ceiling; it never raises the 25 ETH cap.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6 · Trust + Questions */}
        <section className={SECTION}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={EMERALD_CARD}>
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <h3 className="mt-3 text-[18px] font-semibold">Trust, plainly</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
                The contracts are not audited (automated checks only). The Safe Harbor terms are published; on-chain
                registration is in progress. See the{' '}
                <Link href="/security" className="text-emerald-300 hover:underline">
                  security page
                </Link>{' '}
                for the full picture. No usage numbers or uptime promises are published here — the only public numbers
                are the on-chain ones (tokens launched, Tokenized Funds live), which anyone can check.
              </p>
            </div>
            <div className={PLAIN_CARD}>
              <h3 className="text-[18px] font-semibold">Questions</h3>
              <ul className="mt-4 space-y-4">
                {QUESTIONS.map((item) => (
                  <li key={item.q}>
                    <p className="text-[14px] font-semibold text-white">{item.q}</p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-white/60">{item.a}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
