'use client';

import Image from 'next/image';
import Link from 'next/link';
import { X402_PRODUCTS } from '@/lib/x402/constants';
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

export function InferenceContent() {
  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-white sm:text-[28px]">
        AI inference marketplace
      </h1>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        One open marketplace to pick an inference provider, check its reputation, and pay a few
        cents per answer.
      </p>

      {/* White hero card — one huge price as the hero. */}
      <div className={`${card} mt-6`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Image src="/polydash-logo-200.png" alt="Polypad" width={30} height={30} className="h-[30px] w-[30px]" />
            <span className="text-[19px] font-bold tracking-tight">Polypad</span>
          </div>
          <span className="rounded-full bg-[#00E676]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00E676]">
            Live
          </span>
        </div>

        <p className="mt-6 text-center text-[40px] font-extrabold leading-none tracking-tight sm:text-[52px]">
          $0.01
        </p>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-white/50">
          per answer — pick a provider, pay, get your data. No account, no subscription.
        </p>

        <div className="mt-6 space-y-2">
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Providers live now</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Token report, Fund NAV, CTO report — all settling real payments
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">3 live</p>
          </div>
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Reputation on-chain</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Every provider earns a score from real usage — no faking it
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">300–850</p>
          </div>
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Settles in</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                You sign a message — no transaction to broadcast, no gas to pay
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">USDG · USDC</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <a href="#providers" className={`${greenPill} flex-1`}>
            Browse providers
          </a>
          <Link href="/x402" className={`${grayPill} flex-1`}>
            How pay-per-call works
          </Link>
        </div>
      </div>

      <h2 id="providers" className={`${sectionTitle} mt-10 scroll-mt-20`}>
        Providers live now
      </h2>
      <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        These are Polypad&apos;s own providers — live, settling real payments on-chain today.
        Third-party providers join through the listing flow below.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {X402_PRODUCTS.map((p) => (
          <div key={p.id} className={`${card} flex flex-col`}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-[19px] font-bold leading-tight tracking-tight">{p.name}</p>
              <span className="flex-none rounded-full bg-[#00E676]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00E676]">
                Polypad
              </span>
            </div>

            <p className="mt-5 text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[44px]">
              ${p.priceUsd.toFixed(2)}
            </p>
            <p className="mt-2 text-center text-[14px] text-white/50">per call</p>

            <div className="mt-5 space-y-2">
              <div className={row}>
                <div>
                  <p className="text-[14px] font-semibold leading-tight">What it does</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">{p.blurb}</p>
                </div>
              </div>
              <div className={row}>
                <div>
                  <p className="text-[14px] font-semibold leading-tight">What you get</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">{p.delivers}</p>
                </div>
              </div>
              <div className={row}>
                <div>
                  <p className="text-[14px] font-semibold leading-tight">Pay with</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                    USDG, POLYDASH, or USDC on Base — or Poly credits
                  </p>
                </div>
              </div>
            </div>

            <code className="mt-4 block break-all rounded-lg bg-white/[0.06] px-3 py-2 text-[11px] text-white/50">
              {p.example}
            </code>

            <div className="mt-5">
              <Link href={`/build?product=${p.id}#pay-per-call`} className={`${greenPill} w-full`}>
                Buy now — ${p.priceUsd.toFixed(2)}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <h2 className={`${sectionTitle} mt-10`}>How it works</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {[
          {
            n: '1',
            t: 'Pick a provider',
            d: 'Browse the listings above. Each one says what it does, what it costs per call, and who runs it.',
          },
          {
            n: '2',
            t: 'Pay per call',
            d: 'You pay only for the answers you use — a few cents each. You sign the payment, no transaction to broadcast, no gas to pay.',
          },
          {
            n: '3',
            t: 'Check its reputation',
            d: 'Every provider builds a score from real usage, tracked on-chain by the Agent Credit Score (300 to 850). A bad provider cannot fake a good score.',
          },
        ].map((s) => (
          <div key={s.n} className={`${darkCard} p-5`}>
            <p className="flex h-9 w-9 items-center justify-center rounded-full bg-polydash-green text-[15px] font-bold text-black">
              {s.n}
            </p>
            <p className="mt-3 text-[16px] font-semibold text-white">{s.t}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/55">{s.d}</p>
          </div>
        ))}
      </div>

      <h2 className={`${sectionTitle} mt-10`}>How reputation works</h2>
      <div className={`${card} mt-4`}>
        <p className="text-center text-[36px] font-extrabold leading-none tracking-tight sm:text-[48px]">
          300<span className="text-white/30">–</span>850
        </p>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-white/50">
          The Agent Credit Score — built only from what a provider does on-chain.
        </p>
        <div className="mt-6 space-y-2">
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
                The score lives on-chain (ERC-8004) — verify it before you pay
              </p>
            </div>
          </div>
          <div className={row}>
            <div>
              <p className="text-[14px] font-semibold leading-tight">Bad behavior costs score</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                A provider that misses answers or overcharges loses score fast
              </p>
            </div>
          </div>
        </div>
        <p className="mt-5 text-center text-[13px] leading-relaxed text-white/50">
          Polypad&apos;s own providers above are run by the platform, so they carry the Polypad
          badge. Independent providers get a score from their usage, the same as any agent.
        </p>
        <div className="mt-5 flex justify-center">
          <Link href="/agents/scores" className={greenPill}>
            See the score directory
          </Link>
        </div>
      </div>

      <div className="mt-4 max-w-[640px]">
        <GlossaryBox
          terms={[
            {
              term: 'x402',
              def: 'A standard that lets an agent pay a few cents for one answer, inside the request — no account, no monthly fee. The agent signs the payment and gets the data back.',
            },
            {
              term: 'Agent Credit Score',
              def: 'A score from 300 to 850 for an AI agent or provider, built only from on-chain behavior. Stored on-chain (ERC-8004) so anyone can check it.',
            },
            {
              term: 'Inference provider',
              def: 'A service that answers a question for an agent — a report, an analysis, a lookup — and charges per answer.',
            },
          ]}
        />
      </div>

      <h2 className={`${sectionTitle} mt-10`}>List your provider</h2>
      <div className={`${darkCard} mt-4 max-w-[640px] p-5 sm:p-6`}>
        <p className="text-[15px] font-semibold text-white">Run an inference service? Get listed.</p>
        <p className="mt-1 text-[13px] leading-relaxed text-white/70">
          Text, embeddings, analysis, data — if agents can pay you per call, the marketplace is
          open. Here is how to join:
        </p>
        <div className="mt-4 space-y-2">
          {[
            {
              n: '1',
              t: 'Build an endpoint that answers with x402',
              d: 'It quotes a price, takes a signed payment, and returns the answer. The developer hub shows the pattern and the live products.',
            },
            {
              n: '2',
              t: 'Set your price per call',
              d: 'Pick settlement: USDG or POLYDASH on Robinhood Chain, or USDC on Base.',
            },
            {
              n: '3',
              t: 'Email us your listing',
              d: 'Send your endpoint, your price, and what your provider does to jon@dasheco.xyz. We add your listing, and your reputation builds from real usage.',
            },
          ].map((s) => (
            <div key={s.n} className="flex items-start gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
              <p className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-polydash-green text-[13px] font-bold text-black">
                {s.n}
              </p>
              <div>
                <p className="text-[14px] font-semibold leading-tight text-white">{s.t}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-white/55">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Link
            href="/build"
            className="inline-flex items-center justify-center rounded-full bg-polydash-green px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-polydash-green-light"
          >
            Open the developer hub
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-white/5"
          >
            Contact
          </Link>
        </div>
      </div>
    </div>
  );
}
