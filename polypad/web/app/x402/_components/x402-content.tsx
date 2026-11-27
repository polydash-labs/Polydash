'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Coins, FileText, Receipt, ShieldCheck, Wallet } from 'lucide-react';
import { isAddress } from 'viem';
import GlossaryBox from '@/components/glossary-box';
import { X402_PRODUCTS, GUARDRAIL_BANDS, bandForScore } from '@/lib/x402/constants';
import { useAgentScoreByWallet, bandForScore as bandForCreditScore } from '@/lib/agents/credit-score';
import {
  CTA_OUTLINE,
  CTA_PRIMARY,
  DARK_CARD,
  EMERALD_CARD,
  EMERALD_CARD_STRONG,
  EMERALD_PILL,
  FlowDiagram,
  HERO_GLOW,
  H2,
  KICKER,
  PLAIN_CARD,
  SECTION,
  SectionHead,
  StatTiles,
  StepTimeline,
} from '@/lib/ui/template';

// A Polypad keeper wallet, used only as a demo address for the lookup below.
// It is not a registered agent, so checking it shows the Unregistered limits.
const EXAMPLE_WALLET = '0x3e298C64B4073ccFfd9df671eBaEdb886Dcb9270';

const retryBtn = 'underline hover:text-white';

const PRODUCT_ICONS: Record<string, typeof FileText> = {
  'token-report': FileText,
  'cto-report': Receipt,
  'fund-nav': Coins,
};

export function X402Content() {
  const [wallet, setWallet] = useState('');
  const validWallet = isAddress(wallet, { strict: false }) ? wallet : undefined;
  const lookup = useAgentScoreByWallet(validWallet);
  const band = bandForScore(lookup.data?.score ?? null);

  return (
    <div className="bg-black text-white">
      {/* 1 · Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className={HERO_GLOW} />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <p className={KICKER}>x402 · Pay per call</p>
          <h1 className="mt-4 max-w-3xl text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
            Pay{' '}
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-500 bg-clip-text text-transparent">
              1¢
            </span>{' '}
            for one answer.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] sm:text-lg leading-relaxed text-white/70">
            x402 = pay 1¢ for one answer, inside the request — no account, no monthly fee. USDG is a digital dollar
            (1 USDG ≈ $1).
          </p>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/60">
            AI agents pay for data one call at a time — no account, no subscription. Your agent asks for a report,
            gets a price, signs the payment, and gets the data. Payments settle on Robinhood Chain in USDG or POLYDASH
            with x402 — or pay with{' '}
            <Link href="/agents/credits" className="text-emerald-300 hover:underline">
              Poly credits
            </Link>{' '}
            from your Pro key instead (claim $25 free, no crypto needed). The agent never shares a private key, and
            the facilitator only passes the signed payment along — it cannot change the amount or where the money goes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/build?product=token-report#pay-per-call" className={CTA_PRIMARY}>
              Token report — $0.01 <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/build?product=fund-nav#pay-per-call" className={CTA_OUTLINE}>
              Fund value — $0.01
            </Link>
            <Link href="/build?product=cto-report#pay-per-call" className={CTA_OUTLINE}>
              CTO report — $0.05
            </Link>
          </div>
          <StatTiles
            items={[
              { value: '$0.01', label: 'Token report', note: 'And fund NAV — per call' },
              { value: '$0.05', label: 'CTO report', note: 'The full analyst report' },
              { value: 'No account', label: 'No subscription', note: 'Pay inside the request' },
              { value: '4663', label: 'Robinhood Chain', note: 'Settles in USDG or POLYDASH' },
            ]}
          />
        </div>
      </section>

      {/* 2 · Payment flow diagram */}
      <section className={SECTION}>
        <SectionHead
          kicker="How a payment flows"
          title="Ask. Pay. Get the data."
          sub="The price is quoted before anything is paid, the agent signs a message — no transaction to broadcast, no gas to pay — and the report settles on-chain."
        />
        <FlowDiagram
          layers={[
            {
              title: 'Request the data',
              body: 'The agent calls an endpoint — for example the token report for a token address.',
              icon: <FileText className="mx-auto h-6 w-6 text-emerald-400" />,
              pills: ['Token report', 'Fund NAV', 'CTO report'],
            },
            {
              title: '402 — Payment Required',
              body: 'The endpoint tells the agent the price before it pays: $0.01 for a token report or fund NAV, $0.05 for a CTO report.',
              icon: <Receipt className="mx-auto h-6 w-6 text-emerald-400" />,
              emerald: true,
              pills: ['$0.01', '$0.05'],
            },
            {
              title: 'Pay in USDG or POLYDASH',
              body: 'The agent signs the payment — no transaction to broadcast, no gas to pay. Or pay with Poly credits from a Pro key: 1 credit = 1 cent.',
              icon: <Wallet className="mx-auto h-6 w-6 text-emerald-400" />,
              pills: ['USDG', 'POLYDASH', 'USDC on Base', 'Poly credits'],
            },
            {
              title: 'Report settles and returns',
              body: 'Polypad checks the signature, builds the report, settles the payment on-chain, and returns the data. If the report cannot be built, nothing is charged.',
              icon: <Check className="mx-auto h-6 w-6 text-emerald-400" />,
              emerald: true,
              pills: ['Settled on Robinhood Chain', 'Nothing charged if it fails'],
            },
          ]}
        />
      </section>

      {/* 3 · Buy your first report + Base */}
      <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
        <div className={SECTION}>
          <SectionHead
            kicker="Try it now"
            title="Buy your first report — 2 clicks, 1¢."
            sub="No agent needed. Pick a report, pay with your wallet — you just sign a message, no gas fee — and the report appears. Or pay with Poly credits: $25 free, no crypto needed."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className={EMERALD_CARD_STRONG}>
              <h3 className="text-[18px] font-semibold">Buy your first report — 2 clicks, 1¢</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
                No agent needed. Pick a report, pay with your wallet — you just sign a message, no gas fee — and the
                report appears. Or pay with Poly credits: $25 free, no crypto needed.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/build?product=token-report#pay-per-call"
                  className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-emerald-400"
                >
                  Token report — $0.01
                </Link>
                <Link
                  href="/build?product=fund-nav#pay-per-call"
                  className="inline-flex items-center rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5"
                >
                  Fund value — $0.01
                </Link>
                <Link
                  href="/build?product=cto-report#pay-per-call"
                  className="inline-flex items-center rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5"
                >
                  CTO report — $0.05
                </Link>
              </div>
            </div>
            <div className={PLAIN_CARD}>
              <h3 className="text-[18px] font-semibold">On Base? Pay $0.01 USDC — no bridge needed</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
                The same reports are live on Base. If your money is in USDC on Base, you pay $0.01 USDC right there —
                no bridging to Robinhood Chain, no extra fee. Your agent or app calls the same report on Base and pays
                in USDC. Money on Base can also pay for a report on Robinhood Chain — see the cross-chain option on
                the build page.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/build#pay-across-chains"
                  className="inline-flex items-center rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/5"
                >
                  Pay across chains — Base → Robinhood Chain
                </Link>
                <a
                  href="/api/x402/products/token-report?network=base"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-full border border-white/15 px-4 py-2 font-mono text-[12px] font-medium text-white transition-colors hover:bg-white/5"
                >
                  Token report on Base — $0.01 USDC
                </a>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <GlossaryBox
              terms={[
                { term: 'Facilitator', def: 'The service that checks your signed payment and settles it on-chain. It only passes the payment along — it cannot change the amount or where the money goes.' },
                { term: 'EIP-3009', def: 'A standard that lets a wallet authorize a USDG transfer with a signed message instead of sending a transaction — no gas to pay.' },
                { term: 'Permit2', def: 'A standard that lets a wallet authorize a POLYDASH payment with a signed message instead of sending a transaction — no gas to pay.' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* 4 · What an agent can buy */}
      <section className={SECTION}>
        <SectionHead
          kicker="Products"
          title="What an agent can buy."
          sub="Three reports, priced per call. No account, no subscription — the price is quoted before anything is paid."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {X402_PRODUCTS.map((p) => {
            const Icon = PRODUCT_ICONS[p.id] ?? FileText;
            return (
              <div key={p.id} className={`${EMERALD_CARD} flex flex-col`}>
                <Icon className="h-5 w-5 text-emerald-400" />
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <p className="text-[15px] font-semibold text-white">{p.name}</p>
                  <span className={EMERALD_PILL}>${p.priceUsd.toFixed(2)} / call</span>
                </div>
                <p className="mt-1 text-[13px] text-white/55">{p.blurb}</p>
                <p className="mt-3 text-[13px] text-white/70">{p.delivers}</p>
                <p className="mt-auto pt-4 text-[13px] text-white">
                  <span className="font-semibold">${p.priceUsd.toFixed(2)}</span>
                  <span className="text-white/50"> per call · USDG, POLYDASH, or USDC on Base</span>
                </p>
                <code className="mt-2 block break-all rounded-lg bg-black/40 px-3 py-2 text-[11px] text-white/60">{p.example}</code>
                <p className="mt-3 text-[12px] leading-relaxed text-white/50">
                  You pay with USDG (a digital dollar) or POLYDASH — get them first on{' '}
                  <Link href="/build" className="text-emerald-300 hover:underline">/build</Link>
                  {' '}— or with USDC on Base, or with <Link href="/agents/credits" className="text-emerald-300 hover:underline">Poly credits</Link> from
                  your Pro key (claim $25 free).
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5 · How it works */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className={SECTION}>
          <SectionHead
            kicker="How it works"
            title="Three steps, inside one request."
            sub="The agent never shares a private key. The facilitator only passes the signed payment along — it cannot change the amount or where the money goes."
          />
          <StepTimeline
            steps={[
              {
                title: 'Ask',
                body: 'The agent calls an endpoint, for example the token report for a token address.',
              },
              {
                title: 'Pay',
                body: 'The endpoint tells the agent the price before it pays. The agent signs the payment — no transaction to broadcast, no gas to pay.',
              },
              {
                title: 'Get the data',
                body: 'Polypad checks the signature, builds the report, settles the payment on-chain, and returns the data. If the report cannot be built, nothing is charged.',
              },
            ]}
          />
        </div>
      </section>

      {/* 6 · Spending limits */}
      <section className={SECTION}>
        <SectionHead
          kicker="Spending limits"
          title="Limits set by Agent Credit Score."
          sub="Limits live outside the agent: a cap per payment, a budget per day, an allowlist of who it may pay, and keys that expire. A higher credit score earns higher limits — trust an agent can earn, not ask for."
        />
        <p className="mt-4 max-w-[640px] text-[13px] text-white/70">
          No score yet? You start as Unregistered — $0.05 per payment, $0.50 a day. Get a score →{' '}
          <Link href="/agents/scores" className="text-emerald-300 hover:underline">/agents/scores</Link>.
        </p>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 bg-emerald-500/10 text-white/40">
                <th className="px-4 py-3 font-medium">Score band</th>
                <th className="px-4 py-3 font-medium">Per payment</th>
                <th className="px-4 py-3 font-medium">Per day</th>
                <th className="px-4 py-3 font-medium">May pay</th>
                <th className="px-4 py-3 font-medium">Key lasts</th>
              </tr>
            </thead>
            <tbody>
              {GUARDRAIL_BANDS.map((b) => (
                <tr key={b.key} className="border-b border-white/5 last:border-0 text-white/70">
                  <td className="px-4 py-3 font-medium text-white">{b.label}{b.minScore == null ? '' : ` (${b.minScore}–${b.key === 'elite' ? 850 : b.key === 'prime' ? 799 : b.key === 'standard' ? 699 : b.key === 'building' ? 599 : 499})`}</td>
                  <td className="px-4 py-3">${b.perPaymentUsd.toFixed(2)}</td>
                  <td className="px-4 py-3">${b.dailyUsd.toFixed(2)}</td>
                  <td className="px-4 py-3">{b.allowlist === 'polypad-only' ? 'Polypad products only' : b.allowlist === 'approved' ? 'Polypad + approved sellers' : 'Any seller'}</td>
                  <td className="px-4 py-3">{b.maxKeyDays === 1 ? '24 hours' : `${b.maxKeyDays} days`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 7 · Check your limits */}
      <section className="border-y border-white/10 bg-gradient-to-b from-emerald-500/[0.06] to-transparent">
        <div className={SECTION}>
          <SectionHead
            kicker="Check your limits"
            title="Paste an agent wallet to see its score band and spending limits."
          />
          <div className="mt-6 flex max-w-[520px] gap-2">
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value.trim())}
              placeholder="0x… agent wallet"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setWallet(EXAMPLE_WALLET)}
              className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/70 hover:text-white"
            >
              Try an example
            </button>
          </div>
          <p className="mt-2 max-w-[520px] text-[12px] leading-relaxed text-white/45">
            The example is a Polypad keeper wallet — not a registered agent, so it shows the Unregistered limits.
          </p>
          {wallet && !validWallet && wallet.length > 2 && (
            <p className="mt-2 max-w-[520px] text-[13px] text-amber-300/90">
              That doesn&apos;t look like a wallet address — addresses start with 0x and are 42 characters long.
            </p>
          )}
          {validWallet && (
            <div className="mt-3 max-w-[520px] text-[13px]">
              {lookup.isPending && <p className="text-white/55">Checking the score…</p>}
              {lookup.isError && (
                <p className="text-white/55">
                  The score is not available right now.{' '}
                  <button type="button" onClick={() => void lookup.refetch()} className={retryBtn}>Try again</button>
                </p>
              )}
              {lookup.data && !lookup.data.registered && (
                <p className="text-white/70">
                  Not a registered agent — <span className="font-semibold text-white">Unregistered</span> limits apply
                  ($0.05 per payment, $0.50 per day, Polypad products only).{' '}
                  <Link href="/agents/scores" className="underline hover:text-white">Register to raise them</Link>.
                </p>
              )}
              {lookup.data?.registered && (
                <p className="text-white/70">
                  Score <span className="font-semibold text-white">{lookup.data.score ?? '—'}</span>
                  {lookup.data.score != null && (
                    <> · band <span className="font-semibold text-white">{bandForCreditScore(lookup.data.score).label}</span></>
                  )}
                  {' '}· up to <span className="font-semibold text-white">${band.perPaymentUsd.toFixed(2)}</span> per payment
                  and <span className="font-semibold text-white">${band.dailyUsd.toFixed(2)}</span> per day.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 8 · For builders */}
      <section className={SECTION}>
        <div className={DARK_CARD}>
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <p className="mt-3 text-[15px] font-semibold text-white">For builders</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/55">
            The facilitator is open: <code className="text-white/70">GET /api/x402/supported</code> lists
            the payment kinds, <code className="text-white/70">POST /api/x402/verify</code> checks
            a payment without settling, and <code className="text-white/70">POST /api/x402/settle</code> broadcasts
            it. Responses follow the x402 v2 spec (<code className="text-white/70">PAYMENT-REQUIRED</code>,{' '}
            <code className="text-white/70">PAYMENT-SIGNATURE</code>, <code className="text-white/70">PAYMENT-RESPONSE</code>).
            Spending keys with caps, allowlists, and expiry live in the{' '}
            <a
              href="https://robinhoodchain.blockscout.com/address/0xDb5544a977b0dF881268746F2C47F049da579486"
              target="_blank"
              rel="noreferrer"
              className="text-white/70 underline"
            >
              PolypadSpendVault
            </a>{' '}
            contract — live on mainnet.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/55">
            Machine-readable catalog of everything an agent can buy here — prices, settlement chains,
            and the cross-chain option:{' '}
            <Link href="/api/x402/catalog" className="text-emerald-300 hover:underline">
              /api/x402/catalog
            </Link>{' '}
            (also at{' '}
            <Link href="/.well-known/x402" className="text-emerald-300 hover:underline">
              /.well-known/x402
            </Link>
            ). Paying from Base for a report that settles on Robinhood Chain costs about $0.03
            all-in for a $0.01 report — the $0.01 price plus about $0.02 in bridge fees — never $0.01
            all-in. Get the exact quote first:{' '}
            <code className="text-white/70">POST /api/x402/cross-chain/quote</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
