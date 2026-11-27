import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import BeginnerStart from '@/components/beginner-start';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Start here | Polypad',
  description:
    'Pick what you want to do — buy a share of a tokenized fund, launch a token, give your AI agent a wallet, or get market data for your agent. One click to the right place.',
  path: '/start',
});

const DOORS = [
  {
    href: '/funds/0x7c1d31629ac68aebe83f230edbc7eacfc26285ef',
    title: 'Buy a share of a fund',
    what: 'Own a piece of a fund that invests for you. The fund buys POLYDASH and earns trading fees — you share the returns.',
    need: 'A wallet and a little ETH. From 0.01 ETH.',
    time: 'About 5 minutes',
    cta: 'Buy a Polyfund share',
  },
  {
    href: '/create',
    title: 'Launch a token',
    what: 'Make your own token in minutes. No code. It trades on a price curve and moves to a public exchange when enough people buy in.',
    need: 'A wallet and a little ETH to start it.',
    time: 'About 10 minutes',
    cta: 'Launch a token',
  },
  {
    href: '/agents/wallets/new',
    title: 'Give my agent a wallet',
    what: 'A wallet your AI agent can spend from, with a daily limit you set. You can freeze it any time — the money stays yours.',
    need: 'A wallet, and an agent to give the key to.',
    time: 'About 5 minutes',
    cta: 'Create an agent wallet',
  },
  {
    href: '/build',
    title: 'Get market data for my agent',
    what: 'Plug Polypad into your AI assistant so it can see live tokens, funds, and prices — and act on them. Free to start, no account.',
    need: 'An AI assistant (Claude, Grok, Cursor, or VS Code) and one command.',
    time: 'About 5 minutes',
    cta: 'Connect my agent',
  },
] as const;

export default function StartPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">What do you want to do?</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
              Pick one — each card tells you what it is, what you need, and how long it takes. No jargon,
              no wrong turns.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {DOORS.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-polydash-green/40"
              >
                <p className="text-[16px] font-semibold text-white">{d.title}</p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/60">{d.what}</p>
                <p className="mt-3 text-[13px] text-white/70">
                  <span className="font-medium text-white">You need:</span> {d.need}
                </p>
                <p className="mt-1 text-[13px] text-white/70">
                  <span className="font-medium text-white">Time:</span> {d.time}
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-polydash-green">
                  {d.cta} <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[15px] font-semibold text-white">Just looking?</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              Browse what is live right now — no wallet needed.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/#tokens" className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                Explore tokens <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/terminal" className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                See live activity <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/funds" className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                Browse tokenized funds <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/agents/scores" className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5">
                See agent scores <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>

          <BeginnerStart />
        </div>
      </main>
      <Footer />
    </div>
  );
}
