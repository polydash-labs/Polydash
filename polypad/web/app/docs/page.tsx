import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, Code2, FileText, Rocket } from 'lucide-react';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { ExtLink } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import {
  CTA_PRIMARY,
  EMERALD_CARD,
  EMERALD_CARD_STRONG,
  HERO_GLOW,
  KICKER,
  PLAIN_CARD,
  SECTION,
  SectionHead,
  StatTiles,
  StepTimeline,
} from '@/lib/ui/template';

export const metadata: Metadata = trustMetadata({
  title: 'Docs | Polypad',
  description: 'Polypad documentation index: launch flow, commitment window, Uniswap V4 graduation, Holder Protections, build activity, agent launch API and risk.',
  path: '/docs',
});

const DOCS_URL = 'https://github.com/polydash-labs/Polydash/blob/main/docs/';

const sections: { title: string; body: string; link?: { href: string; label: string } }[] = [
  {
    title: 'Launch flow',
    body: 'How a token is created on Polypad: name, ticker, logo and links, a creator fee between 0% and 5% chosen before launch, and a fixed supply minted once to the token’s own launch contract. 80% of the supply is sold on a bonding curve priced in ETH.',
    link: { href: '/create', label: 'Create a token' },
  },
  {
    title: 'Commitment window',
    body: 'An optional window of 24 hours, 3 days or 7 days before trading starts. Users commit ETH and can withdraw it in full at any time during the window. When it ends, the creator’s dev buy executes first, then commitments are filled in batches at curve prices.',
  },
  {
    title: 'Uniswap V4 graduation',
    body: 'When the ETH raised reaches the graduation threshold, the launch graduates in the same transaction. The raised ETH and the reserved 20% of supply are added as full-range liquidity to a Uniswap V4 pool, held by the Polypad hook contract with no code path to remove it.',
    link: { href: '/contracts', label: 'Contracts' },
  },
  {
    title: 'Holder Protections',
    body: 'A badge on token cards and token pages showing how many of five on-chain checks a token meets, grouped into tiers. Explore can be filtered by minimum tier. It describes on-chain settings only.',
  },
  {
    title: 'Build activity',
    body: 'Shows what a creator has shipped, based on a linked public GitHub repo, deployer wallets and on-chain data. It shows what was shipped, not whether a token is free of risk.',
  },
  {
    title: 'Agent launch API',
    body: 'Lets AI agents and scripts prepare token launches programmatically, with the same contracts and parameters as the Create page.',
    link: { href: '/agents', label: 'Agents' },
  },
  {
    title: 'Agent action receipts',
    body: 'Public, verifiable receipts for agent actions: identity, authority, approval, and settlement for one action, re-checkable by anyone against Robinhood Chain. A receipt proves what happened; it promises no reimbursement or cover.',
    link: { href: '/agents/receipts', label: 'View receipts' },
  },
  {
    title: 'Risk',
    body: 'Tokens launched on Polypad are created by their users, not by Polypad. Prices on a bonding curve can move quickly and most new tokens lose value. Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.',
    link: { href: '/risk', label: 'Risk disclosure' },
  },
];

const API_LINKS: { href: string; label: string }[] = [
  { href: '/docs/tools', label: 'Tool reference' },
  { href: '/docs/rules', label: 'Rules of the road' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs/sign-loop', label: 'Sign loop: prepare → sign → confirm' },
  { href: '/docs/sdks', label: 'SDKs (TypeScript + Python)' },
  { href: '/docs/langchain', label: 'LangChain guide' },
  { href: '/docs/vercel-ai-sdk', label: 'Vercel AI SDK guide' },
  { href: '/docs/case-studies', label: 'Case studies' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/status', label: 'Status' },
  { href: '/build', label: 'Build on Polypad' },
];

const MANAGER_STEPS = [
  {
    title: 'Create the fund',
    body: 'Pick a Strategy and fee, a share price, a raise goal and how long the raise stays open.',
  },
  {
    title: 'Buy your manager stake',
    body: 'Buy your own manager stake, which stays locked for the period the Strategy sets.',
  },
  {
    title: 'Investors buy shares',
    body: 'Investors buy shares until the goal is reached; if it is not reached in time, holders can get their ETH back.',
  },
  {
    title: 'Trade inside the limits',
    body: 'Once the raise is complete, trade only approved tokens, inside the Strategy’s limits. Each trade is checked against a time-averaged price and the drawdown brake. A time-averaged price is the average price over a recent window, so one spike cannot justify a trade. The drawdown brake stops new trades after the fund’s value has fallen past the Strategy’s limit.',
  },
  {
    title: 'LP-Dividend Strategy',
    body: 'For the LP-Dividend Strategy, the manager can also add POLYDASH/WETH liquidity and stake POLYDASH; new positions also wait in public first. No guaranteed returns. Not financial advice.',
  },
];

export default function DocsPage() {
  return (
    <div className="bg-black text-white">
      <Header />
      <main>
        {/* 1 · Hero */}
        <section className="relative overflow-hidden border-b border-white/10">
          <div className={HERO_GLOW} />
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
            <p className={KICKER}>Docs · Polypad</p>
            <h1 className="mt-4 max-w-3xl text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
              Everything about Polypad,{' '}
              <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-500 bg-clip-text text-transparent">
                in plain words.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-[16px] sm:text-lg leading-relaxed text-white/70">
              Start with what you want to do: build with the API, launch a token, or start a tokenized fund.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/build" className={CTA_PRIMARY}>
                I want to build <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs/tools"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-6 py-3 text-[15px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                <BookOpen className="h-4 w-4" /> Tool reference
              </Link>
            </div>
            <StatTiles
              items={[
                { value: '25', label: 'MCP tools', note: 'Generated from the code itself' },
                { value: '5', label: 'Agent skills', note: 'SDKs: TypeScript + Python' },
                { value: '4663', label: 'Robinhood Chain', note: 'Every response includes the chain id' },
                { value: '0', label: 'Signup needed', note: 'No key, no approval to start' },
              ]}
            />
          </div>
        </section>

        {/* 2 · Start here — flow diagram */}
        <section className={SECTION}>
          <SectionHead
            kicker="Start here"
            title="From quickstart to building in three steps."
            sub="Connect your agent to Polypad with MCP — no signup, no API key, no approval. Start on /build, then read the tool reference and the rules below."
          />
          <StepTimeline
            steps={[
              {
                title: 'Read the quickstart',
                body: 'Start with what you want to do: build with the API, launch a token, or start a tokenized fund.',
              },
              {
                title: 'Connect with one command',
                body: 'Connect your agent to Polypad with MCP — no signup, no API key, no approval. Start on /build.',
              },
              {
                title: 'Build with the SDK / MCP',
                body: 'Use the SDKs (TypeScript + Python), the tool reference, and the rules of the road — every tool the agent API exposes, generated from the code itself.',
              },
            ]}
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Link
              href="/build"
              className={`${EMERALD_CARD_STRONG} block transition-colors hover:border-emerald-500/50`}
            >
              <Rocket className="h-5 w-5 text-emerald-400" />
              <p className="mt-3 text-[16px] font-semibold text-white">I want to build</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-white/60">
                Connect your agent to Polypad with MCP — no signup, no API key, no approval. Start on /build, then
                read the tool reference and the rules below.
              </p>
            </Link>
            <div className={PLAIN_CARD}>
              <Code2 className="h-5 w-5 text-emerald-400" />
              <p className="mt-3 text-[16px] font-semibold text-white">Agent API reference</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-white/60">
                Every tool the agent API exposes, generated from the code itself, with copy-paste examples and what can
                go wrong — plus the rate limits, error codes, and versioning rules. No signup, no API key, no approval.
              </p>
            </div>
          </div>
          <div className="mt-6">
            <BeginnerStart />
          </div>
          <div className="mt-6">
            <GlossaryBox />
          </div>
        </section>

        {/* 3 · API reference links */}
        <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
          <div className={SECTION}>
            <SectionHead
              kicker="Agent API reference"
              title="Every tool, every rule, every guide."
              sub="The tool reference, the rules of the road, pricing, the sign loop, SDKs, framework guides, case studies, changelog, and status — all in one place."
            />
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {API_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className={`${EMERALD_CARD} group flex items-center justify-between gap-3`}>
                  <span className="text-[14.5px] font-semibold text-white">{l.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-emerald-400 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* 4 · How Polypad works */}
        <section className={SECTION}>
          <SectionHead
            kicker="How Polypad works"
            title="Launch, graduate, protect, build."
            sub="The mechanics of a token on Polypad — from creation on a bonding curve to Uniswap V4 graduation — plus the agent API and the risk, plainly."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {sections.map((s) => (
              <div key={s.title} className={PLAIN_CARD}>
                <FileText className="h-5 w-5 text-emerald-400" />
                <h3 className="mt-3 text-[17px] font-semibold">{s.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">{s.body}</p>
                <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  <ExtLink href={DOCS_URL}>Read on GitHub</ExtLink>
                  {s.link ? (
                    <Link href={s.link.href} className="text-white/80 hover:underline">
                      {s.link.label}
                    </Link>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 5 · Agent-launched tokens */}
        <section className="border-y border-white/10 bg-white/[0.02]">
          <div className={SECTION}>
            <SectionHead
              kicker="Agent-launched tokens"
              title="Agent-launched tokens and the agent API."
              sub="Tokens marked agent-launched were prepared through the Polypad agent API by an AI agent or script. The mark records how the launch was prepared. It says nothing about the token’s quality or risk."
            />
            <div className={`${PLAIN_CARD} mt-8`}>
              <p className="text-[14px] leading-relaxed text-white/70">
                The API is non-custodial. It lets assistants browse launches, read token state, get bonding-curve
                quotes, and build transactions for launch, commit, uncommit, refunds, buy, sell and creator-fee
                claims. Every transaction is simulated and returned unsigned; the user’s own wallet signs and sends
                it. Polypad never accepts private keys. Amounts are decimal base-unit strings and every response
                includes the chain id (4663, Robinhood Chain). Not financial advice.
              </p>
              <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <a href="/api/agents/v1/spec" className="text-emerald-300 hover:underline">
                  API spec (JSON)
                </a>
                <a href="/api/agents/v1" className="text-white/80 hover:underline">
                  API index
                </a>
                <Link href="/agents" className="text-white/80 hover:underline">
                  Agents
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* 6 · Tokenized Funds */}
        <section className={SECTION}>
          <SectionHead
            kicker="Tokenized Funds"
            title="A fund pools ETH. A manager invests it under a locked mandate."
            sub="A Tokenized Fund pools ETH from investors who buy shares. A manager invests that ETH under a published Strategy (the mandate) that is locked when the Tokenized Fund is created. Every Strategy sets limits on trade size, how much of the Tokenized Fund one token may take up, and a drawdown brake. Each Strategy has a fixed fee — pick the Strategy, and the fee is set."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className={EMERALD_CARD}>
              <h3 className="text-[16px] font-semibold">The approved list (the allowlist)</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
                A Tokenized Fund can only buy tokens on the approved list, which is read live from the FundAllowlist
                contract{' '}
                <ExtLink href={getExplorerAddressUrl('0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19')}>
                  0x7A42…2c19
                </ExtLink>
                . You can browse the list on the Create page and on every Tokenized Fund page before you invest.
              </p>
            </div>
            <div className={EMERALD_CARD}>
              <h3 className="text-[16px] font-semibold">The 2-day wait for new tokens</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
                To add a token, the manager makes a public proposal with its share limit (a newly proposed token is
                capped at 30% by default). The proposal waits 2 days in public (the timelock) before the manager can
                add it. During the wait, investors can see it on the Tokenized Fund page and leave the Tokenized Fund
                if they do not agree.
              </p>
            </div>
          </div>
          <h3 className="mt-10 text-[20px] font-semibold">How a manager invests</h3>
          <StepTimeline steps={MANAGER_STEPS} />
          <p className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Link href="/funds/create" className="text-emerald-300 hover:underline">
              Create a Tokenized Fund
            </Link>
            <Link href="/funds" className="text-white/80 hover:underline">
              Browse Tokenized Funds
            </Link>
          </p>
        </section>

        {/* 7 · More */}
        <section className="border-t border-white/10">
          <div className={SECTION}>
            <div className={EMERALD_CARD_STRONG}>
              <h2 className="text-[20px] font-semibold">More</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">
                See{' '}
                <Link href="/about" className="text-emerald-300 hover:underline">
                  About
                </Link>{' '}
                for how Polypad works end to end.
              </p>
              <p className="mt-3 text-[13px] text-white/50">
                Full docs also live on GitHub:{' '}
                <ExtLink href={DOCS_URL}>polydash-labs/Polydash/docs</ExtLink>
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
