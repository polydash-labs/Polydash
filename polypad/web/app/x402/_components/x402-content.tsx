'use client';

import { useState } from 'react';
import Link from 'next/link';
import { isAddress } from 'viem';
import { X402_PRODUCTS, GUARDRAIL_BANDS, bandForScore } from '@/lib/x402/constants';
import { useAgentScoreByWallet, BANDS, bandForScore as bandForCreditScore } from '@/lib/agents/credit-score';

const card = 'rounded-2xl border border-white/10 bg-white/[0.03]';
const sectionTitle = 'text-[18px] font-semibold text-white';
const retryBtn = 'underline hover:text-white';

export function X402Content() {
  const [wallet, setWallet] = useState('');
  const validWallet = isAddress(wallet, { strict: false }) ? wallet : undefined;
  const lookup = useAgentScoreByWallet(validWallet);
  const band = bandForScore(lookup.data?.score ?? null);

  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8">
      <h1 className="text-[26px] font-semibold tracking-tight text-white">Pay per call</h1>
      <p className="mt-1 max-w-[640px] text-[13px] text-white/55">
        AI agents pay for data one call at a time — no account, no subscription.
        Your agent asks for a report, gets a price, signs the payment, and gets
        the data. Payments settle on Robinhood Chain in USDG or POLYDASH with
        x402. The agent never shares a private key, and the facilitator only
        passes the signed payment along — it cannot change the amount or where
        the money goes.
      </p>

      <h2 className={`${sectionTitle} mt-10`}>What an agent can buy</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {X402_PRODUCTS.map((p) => (
          <div key={p.id} className={`${card} flex flex-col p-5`}>
            <p className="text-[15px] font-semibold text-white">{p.name}</p>
            <p className="mt-1 text-[13px] text-white/55">{p.blurb}</p>
            <p className="mt-3 text-[13px] text-white/70">{p.delivers}</p>
            <p className="mt-auto pt-4 text-[13px] text-white">
              <span className="font-semibold">${p.priceUsd.toFixed(2)}</span>
              <span className="text-white/50"> per call · USDG or POLYDASH</span>
            </p>
            <code className="mt-2 block break-all rounded-lg bg-black/40 px-3 py-2 text-[11px] text-white/60">{p.example}</code>
          </div>
        ))}
      </div>

      <h2 className={`${sectionTitle} mt-10`}>How it works</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {[
          { n: '1', t: 'Ask', d: 'The agent calls an endpoint, for example the token report for a launch address.' },
          { n: '2', t: 'Pay', d: 'The endpoint answers 402 with the price. The agent signs the payment — no transaction to broadcast, no gas to pay.' },
          { n: '3', t: 'Get the data', d: 'Polypad checks the signature, builds the report, settles the payment on-chain, and returns the data. If the report cannot be built, nothing is charged.' },
        ].map((s) => (
          <div key={s.n} className={`${card} p-5`}>
            <p className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[13px] font-semibold text-white">{s.n}</p>
            <p className="mt-3 text-[15px] font-semibold text-white">{s.t}</p>
            <p className="mt-1 text-[13px] text-white/55">{s.d}</p>
          </div>
        ))}
      </div>

      <h2 className={`${sectionTitle} mt-10`}>Spending limits, set by Agent Credit Score</h2>
      <p className="mt-1 max-w-[640px] text-[13px] text-white/55">
        Limits live outside the agent: a cap per payment, a budget per day, an
        allowlist of who it may pay, and keys that expire. A higher credit
        score earns higher limits — trust an agent can earn, not ask for.
      </p>
      <div className={`${card} mt-4 overflow-x-auto`}>
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-white/10 text-white/40">
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

      <h2 className={`${sectionTitle} mt-10`}>Check your limits</h2>
      <p className="mt-1 max-w-[640px] text-[13px] text-white/55">
        Paste an agent wallet to see its score band and spending limits.
      </p>
      <div className="mt-3 flex max-w-[520px] gap-2">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value.trim())}
          placeholder="0x… agent wallet"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        />
      </div>
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

      <div className={`${card} mt-10 p-5`}>
        <p className="text-[15px] font-semibold text-white">For builders</p>
        <p className="mt-1 text-[13px] text-white/55">
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
      </div>
    </div>
  );
}
