'use client';

import Image from 'next/image';
import Link from 'next/link';

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

export function AgentSecurityContent({ receiptCount }: { receiptCount: number }) {
  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-white sm:text-[28px]">
        Security for AI agents
      </h1>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        Your agent can work on-chain without putting your money at risk. Caps, a freeze switch,
        a public trail, and a real audit — all live today.
      </p>

      {/* Dark hero card — one big number as the hero. */}
      <div className={`${card} mt-6`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Image src="/polydash-logo-200.png" alt="Polypad" width={30} height={30} className="h-[30px] w-[30px]" />
            <span className="text-[19px] font-bold tracking-tight">Polypad</span>
          </div>
          <span className="rounded-full bg-[#00E676]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00E676]">
            Protected
          </span>
        </div>

        <p className="mt-6 text-center text-[40px] font-extrabold leading-none tracking-tight sm:text-[52px]">
          $5,000
        </p>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-white/50">
          a day — the most your agent can spend. Your agent can&apos;t raise it.
          Only you can change it, and only you can freeze the wallet.
        </p>

        <div className="mt-6 space-y-2">
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Public receipts</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Every agent action has a receipt anyone can check on-chain
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">{receiptCount} live</p>
          </div>
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Audit verdict</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Warden reviewed the agent-wallet contracts — full reports public
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight text-[#00E676]">Green</p>
          </div>
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Monitoring</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Sentinel reviews contracts and watches on-chain activity every day
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">Daily</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Link href="/agents/wallets" className={`${greenPill} flex-1`}>
            See agent wallets
          </Link>
          <Link href="/audits" className={`${grayPill} flex-1`}>
            Read the audit
          </Link>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>What protects your agent</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* On-chain firewall */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
            $0
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            above your limit — your agent can never spend more than you allow.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">On-chain firewall</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Daily limit you set</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">$1 to $5,000 a day — your call</p>
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
          <div className="mt-5 flex flex-col gap-2.5">
            <Link href="/agents/wallets" className={`${greenPill} w-full`}>
              See agent wallets
            </Link>
            <Link href="/agents/wallets/cap-proof" className={`${grayPill} w-full`}>
              See the cap proof — we tried to break it
            </Link>
          </div>
        </div>

        {/* Continuous monitoring */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
            Sentinel
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            Polypad&apos;s security agent — watches, never moves funds.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">Continuous monitoring</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Reviews the contracts</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Looks for gaps in the live contracts, every day
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Watches on-chain activity</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Flags anything suspicious before it becomes a problem
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Read-only</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  It can see everything and move nothing
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/agents/receipts" className={`${greenPill} w-full`}>
              See the activity trail
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
                <p className="text-[14px] font-semibold leading-tight">Who acted, and under what authority</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Every receipt names the agent and the approval it had
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">How it settled</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Each receipt links to the transaction on Robinhood Chain
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Checkable by anyone</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  No trust needed — verify the receipt against the chain yourself
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

        {/* Audits */}
        <div className={`${card} flex flex-col`}>
          <p className="text-center text-[36px] font-extrabold leading-none tracking-tight text-[#00E676] sm:text-[44px]">
            Green
          </p>
          <p className="mt-2 text-center text-[14px] text-white/50">
            Warden&apos;s verdict on the agent-wallet contracts.
          </p>
          <p className="mt-4 text-[15px] font-semibold leading-tight">Audits</p>
          <div className="mt-3 space-y-2">
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">No critical or high findings open</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  What was found was fixed and re-reviewed — four rounds
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">Full reports are public</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  Read what was found, what was fixed, and what is still open
                </p>
              </div>
            </div>
            <div className={row}>
              <div>
                <p className="text-[14px] font-semibold leading-tight">In-house, labelled honestly</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                  An internal review, not a paid third-party audit — we say so plainly
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Link href="/audits" className={`${greenPill} w-full`}>
              Read the audit reports
            </Link>
          </div>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>Stolen-fund tracing</h2>
      <div className={`${card} mt-4`}>
        <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
          Every move
        </p>
        <p className="mt-2 text-center text-[14px] text-white/50">
          traceable — money in, money out, running balance.
        </p>
        <div className="mt-6 space-y-2">
          <div className={row}>
            <div>
              <p className="text-[14px] font-semibold leading-tight">A plain-language ledger</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Every agent wallet keeps a bank-style ledger, so you can see where every dollar went
              </p>
            </div>
          </div>
          <div className={row}>
            <div>
              <p className="text-[14px] font-semibold leading-tight">No hidden path out</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Money can only move inside the daily limit you set, to an address on the allowlist you approved
              </p>
            </div>
          </div>
          <div className={row}>
            <div>
              <p className="text-[14px] font-semibold leading-tight">Receipts back it up</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Every movement has a receipt with the transaction on-chain
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Link href="/agents/wallets" className={`${greenPill} flex-1`}>
            See a wallet ledger
          </Link>
          <Link href="/agents/receipts" className={`${grayPill} flex-1`}>
            See receipts
          </Link>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>Reputation, not promises</h2>
      <div className={`${card} mt-4`}>
        <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[48px]">
          300<span className="text-white/30">–</span>850
        </p>
        <p className="mt-2 text-center text-[14px] text-white/50">
          The Agent Credit Score — built only from on-chain behavior.
        </p>
        <div className="mt-6 space-y-2">
          <div className={row}>
            <div>
              <p className="text-[14px] font-semibold leading-tight">Bad behavior costs score</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                An agent that misbehaves loses score, and everyone can see it before trusting it with money
              </p>
            </div>
          </div>
          <div className={row}>
            <div>
              <p className="text-[14px] font-semibold leading-tight">On-chain, checkable by anyone</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Stored on-chain (ERC-8004) — reputation is the backstop when a cap is not enough
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-center">
          <Link href="/agents/scores" className={greenPill}>
            See the score directory
          </Link>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>The full picture</h2>
      <div className={`${darkCard} mt-4 max-w-[640px] p-5 sm:p-6`}>
        <p className="text-[13px] leading-relaxed text-white/70">
          Polypad contracts are unaudited by a third party — we say so plainly. What exists
          instead is public source verified on Sourcify, the Warden internal review above,
          automated scans of the POLYDASH token, and the on-chain limits and receipts on this
          page. Read the full disclosure and the contract addresses:
        </p>
        <p className="mt-3">
          <Link href="/security" className="text-[13px] font-medium text-polydash-green hover:underline">
            Security disclosure →
          </Link>
          {' · '}
          <Link href="/contracts" className="text-[13px] font-medium text-polydash-green hover:underline">
            Contracts →
          </Link>
          {' · '}
          <Link href="/audits" className="text-[13px] font-medium text-polydash-green hover:underline">
            Audits →
          </Link>
        </p>
      </div>
    </div>
  );
}
