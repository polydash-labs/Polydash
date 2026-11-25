'use client';

import Image from 'next/image';
import Link from 'next/link';
import GlossaryBox from '@/components/glossary-box';

/* Commercial card system — the Agentcard / Visacli pattern from the agent
 * balance card: a dark hero card on the dark page, one big number as the
 * hero, a plain-language subtitle, clean itemized rows, big pill buttons.
 * Dark surfaces (not white) so the page stays easy on the eyes.
 * Polypad dark + green, not Agentcard's blue. */
const card =
  'rounded-[20px] border border-white/10 bg-[#151a1f] p-4 text-white shadow-[0_16px_40px_rgba(0,0,0,0.4)] sm:p-5';
const darkCard = 'rounded-2xl border border-white/10 bg-white/[0.03]';
const sectionTitle = 'text-[18px] font-semibold text-white';
const row = 'flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3.5 py-2.5';
const greenPill =
  'inline-flex items-center justify-center rounded-full bg-polydash-green px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-polydash-green-light';
const grayPill =
  'inline-flex items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.08]';

const flywheelSteps = [
  {
    n: '1',
    t: 'Connect',
    d: 'The business connects its AI agent — or creates one — with a secure wallet that has limits the owner sets.',
  },
  {
    n: '2',
    t: 'Work',
    d: 'The agent uses Polypad\u2019s pay-per-call tools to do real jobs: token reports, fund NAV checks, CTO reports.',
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

export function BusinessContent({ receiptCount }: { receiptCount: number }) {
  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-white sm:text-[28px]">
        Polypad for business
      </h1>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        AI that does real work for your business — with limits you set, a receipt for every
        job, and a price of pennies per call.
      </p>

      {/* Dark hero card — one big number as the hero. */}
      <div className={`${card} mt-6`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Image src="/polydash-logo-200.png" alt="Polypad" width={30} height={30} className="h-[30px] w-[30px]" />
            <span className="text-[19px] font-bold tracking-tight">Polypad</span>
          </div>
          <span className="rounded-full bg-[#00E676]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00E676]">
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
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Pay per call</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Token report $0.01, fund NAV $0.01, CTO report $0.05 — pay only for the answers you use
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">$0.01</p>
          </div>
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Free to start</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                $25 starter credits, one per wallet, good for 6 months — 2,500 credits
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">6 months</p>
          </div>
          <div className={row}>
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
          <Link href="/agents/credits" className={`${greenPill} flex-1`}>
            Get your free $25
          </Link>
          <Link href="/inference" className={`${grayPill} flex-1`}>
            See what it can do
          </Link>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>What a business gets</h2>
      <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        Everything below is live today — no waitlist, no sales call.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Secure agent wallet */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
            $5,000
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            a day — the most your agent can spend. You set the limit, and only you can freeze it.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">A secure agent wallet</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Daily limit you set</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  $1 to $5,000 a day — your call, and your agent can&apos;t raise it
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Freeze switch only you control</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Stop the wallet instantly if anything looks wrong
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Recovery built in</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Backup key plus a two-day wait if your agent key is ever compromised
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/agents/wallets" className={`${greenPill} w-full`}>
              See agent wallets
            </Link>
          </div>
        </div>

        {/* Pay-per-call tools */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
            $0.01
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            per call — token reports, fund NAV checks, CTO reports.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">Pay-per-call tools</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Token report — $0.01</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  A full report on a token, on demand, in seconds
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Fund NAV — $0.01</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  The live value of a tokenized fund share, checked any time
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">CTO report — $0.05</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  A deeper technical report, still a few cents a call
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/inference" className={`${greenPill} w-full`}>
              Browse the marketplace
            </Link>
          </div>
        </div>

        {/* Poly Credits */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
            $25
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            free starter — 2,500 credits, good for 6 months.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">Poly Credits</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">100 credits = $1</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  A token report costs 1 credit; a CTO report costs 5
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Not a token — nothing in MetaMask</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Credits live off-chain in your account, not on a blockchain
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">One starter per wallet</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Claim it, spend it on real jobs — top up with ETH or POLYDASH when you need more
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/agents/credits" className={`${greenPill} w-full`}>
              Claim your free $25
            </Link>
          </div>
        </div>

        {/* Verifiable receipts */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
            {receiptCount}
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            public receipts — and counting.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">Verifiable receipts</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">A receipt for every job</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Who acted, under what approval, and how it settled
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Checkable by anyone</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Each receipt links to the transaction on Robinhood Chain — no trust needed
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Proof you can show a customer</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  The work your agent did is on the public record, not a screenshot
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/agents/receipts" className={`${greenPill} w-full`}>
              Browse receipts
            </Link>
          </div>
        </div>

        {/* Agent Credit Score */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[48px]">
            300<span className="text-white/30">–</span>850
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            The Agent Credit Score — built only from real usage.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">A credit score for your agent</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Built from real usage</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Scores come from settled calls and real behavior, not self-reported claims
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">On-chain, checkable by anyone</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  The score lives on-chain (ERC-8004) — verify it before you trust an agent
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Bad behavior costs score</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  An agent that misbehaves loses score fast, and everyone can see it
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/agents/scores" className={`${greenPill} w-full`}>
              See the score directory
            </Link>
          </div>
        </div>

        {/* Agent API */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
            23
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            tools in the agent API — one command to connect.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">The agent API</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Launch, trade, join funds, pay</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  One API for the whole marketplace — tokens, funds, staking, and pay-per-call
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Works with any agent framework</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  MCP server, plus SDKs — connect in one command with polypad connect
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Free while growing</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Pro is free while Polypad grows, at 10x the free limits
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/build" className={`${greenPill} w-full`}>
              Open the developer hub
            </Link>
          </div>
        </div>
      </div>

      {/* THE FLYWHEEL — centerpiece. A visual loop, not a list. */}
      <h2 className={`${sectionTitle} mt-10`}>The flywheel</h2>
      <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        Six steps that feed each other. Each loop makes the next one easier — and brings the
        next business in.
      </p>
      <div className={`${card} mt-4`}>
        <div className="flex items-center gap-3">
          <p className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-polydash-green text-[22px] font-bold text-black">
            ↻
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
                <span className="text-[16px] font-bold text-[#00E676]" aria-hidden>
                  →
                </span>
              ) : (
                <span className="text-[16px] font-bold text-[#00E676]" aria-hidden>
                  ↻
                </span>
              )}
            </span>
          ))}
          <span className="rounded-full bg-[#00E676]/15 px-3 py-1.5 text-[12.5px] font-semibold text-[#00E676]">
            back to Connect
          </span>
        </div>

        {/* The six steps, as cards in a 3×2 grid. */}
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {flywheelSteps.map((s) => (
            <div key={s.n} className="rounded-2xl bg-white/[0.06] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex h-9 w-9 items-center justify-center rounded-full bg-polydash-green text-[15px] font-bold text-black">
                  {s.n}
                </p>
                <p className="text-[13px] font-bold tracking-tight text-white">{s.t}</p>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-white/50">{s.d}</p>
            </div>
          ))}
        </div>

        {/* Loop-back strip — the cycle closes here. */}
        <div className="mt-6 flex items-start gap-3 rounded-2xl bg-[#00E676]/10 px-4 py-3.5">
          <p className="flex-none text-[20px] font-bold leading-none text-[#00E676]">↻</p>
          <p className="text-[13.5px] leading-relaxed text-white/70">
            <span className="font-semibold text-white">The loop closes:</span>{' '}
            every business that proves its work brings the next one in. More proof, more
            businesses, more usage — and the flywheel spins faster.
          </p>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>How to start</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
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
          <div key={s.n} className={`${darkCard} flex flex-col p-5`}>
            <p className="flex h-9 w-9 items-center justify-center rounded-full bg-polydash-green text-[15px] font-bold text-black">
              {s.n}
            </p>
            <p className="mt-3 text-[16px] font-semibold text-white">{s.t}</p>
            <p className="mt-1 flex-1 text-[13px] leading-relaxed text-white/55">{s.d}</p>
            <div className="mt-4">
              <Link href={s.href} className={`${greenPill} w-full`}>
                {s.cta}
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Built for real businesses — the OpenWorks moment, stated factually. */}
      <h2 className={`${sectionTitle} mt-10`}>Built for real businesses</h2>
      <div className={`${darkCard} mt-4 max-w-[640px] p-5 sm:p-6`}>
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
      <div className={`${card} mt-10`}>
        <p className="text-center text-[22px] font-bold leading-tight tracking-tight">
          Put an AI agent to work for your business.
        </p>
        <p className="mt-2 text-center text-[14px] leading-relaxed text-white/50">
          Start free — $25 of credits, no crypto needed.
        </p>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Link href="/agents/credits" className={`${greenPill} flex-1`}>
            Get your free $25
          </Link>
          <Link href="/inference" className={`${grayPill} flex-1`}>
            See the inference marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}
