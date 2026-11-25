import type { Metadata } from 'next';
import Link from 'next/link';
import { TrustShell, TrustSection } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import { LIMITS } from '@/lib/agents-api/v2/config';

export const metadata: Metadata = trustMetadata({
  title: 'Pricing | Polypad',
  description: 'Start free. No signup. No API key. No approval. Pro is $0 while growing, at 10x the free limits. Pay-per-call reports from $0.01.',
  path: '/pricing',
});

const FREE = LIMITS.rate;
const PRO = LIMITS.ratePro;

export default function PricingPage() {
  return (
    <TrustShell
      title="Pricing"
      intro={
        <>
          Start free. No signup. No API key. No approval. The Polypad MCP is 24 tools that let an
          agent trade, launch tokens, join Tokenized Funds, and buy NFTs on Robinhood Chain — the
          agent signs everything in its own wallet, and Polypad never holds a private key.
        </>
      }
    >
      <TrustSection title="Free — $0, forever">
        <p>The MCP as it is today.</p>
        <ul className="mt-3 space-y-1.5">
          <li>All 24 tools, no key, no signup.</li>
          <li>
            Reads {FREE.read.limit.toLocaleString('en-US')}/min · prepares{' '}
            {FREE.prepare.limit.toLocaleString('en-US')}/min · prepares per wallet{' '}
            {FREE.perWalletPrepare.limit.toLocaleString('en-US')}/min · intent{' '}
            {FREE.intent.limit.toLocaleString('en-US')}/min.
          </li>
          <li>One action at most 25 ETH; above 1 ETH, confirm the amount first.</li>
          <li>Request body at most 16 KB; batches of at most 10 messages.</li>
        </ul>
        <p className="mt-3">
          <Link href="/build" className="text-[#00E676] hover:underline">
            Connect — copy the MCP config →
          </Link>
        </p>
      </TrustSection>

      <TrustSection title="Pro — $0 while growing">
        <p>Same API, higher limits, and see your usage.</p>
        <ul className="mt-3 space-y-1.5">
          <li>Everything in Free.</li>
          <li>
            Higher per-minute limits — 10x the free tier: reads {PRO.read.limit.toLocaleString('en-US')}/min ·
            prepares {PRO.prepare.limit.toLocaleString('en-US')}/min · prepares per wallet{' '}
            {PRO.perWalletPrepare.limit.toLocaleString('en-US')}/min · intent{' '}
            {PRO.intent.limit.toLocaleString('en-US')}/min.
          </li>
          <li>
            API keys you manage from{' '}
            <Link href="/agents/accounts" className="text-[#00E676] hover:underline">
              /agents/accounts
            </Link>
            : the key is shown once, and you can revoke it any time. A key only identifies your
            calls — it never moves money.
          </li>
          <li>
            A usage dashboard (calls by tool, reads vs prepares, 429s) is live now at{' '}
            <Link href="/agents/usage" className="text-[#00E676] hover:underline">
              /agents/usage
            </Link>{' '}
            — paste your key to see your own usage.
          </li>
          <li>The 25 ETH per-action cap and the 1 ETH confirm-first rule do not change with Pro.</li>
        </ul>
        <p className="mt-3">
          <Link href="/agents/accounts" className="text-[#00E676] hover:underline">
            Get a Pro key →
          </Link>
        </p>
      </TrustSection>

      <TrustSection title="Pay-per-call — priced per report">
        <p>One deep answer, bought in the call itself. No subscription, and not part of Pro.</p>
        <ul className="mt-3 space-y-1.5">
          <li>
            <strong>Token report — $0.01.</strong> Live on-chain facts for any token launched on Polypad.
          </li>
          <li>
            <strong>Tokenized Fund NAV — $0.01.</strong> A Tokenized Fund&apos;s net asset value per share, right now.
          </li>
          <li>
            <strong>CTO report — $0.05.</strong> The full analyst report — risk, momentum, holders, narrative.
          </li>
        </ul>
        <p className="mt-3">
          Paid in USDG or POLYDASH, in the call itself (x402).{' '}
          <Link href="/build" className="text-[#00E676] hover:underline">
            Try it live →
          </Link>
        </p>
      </TrustSection>

      <TrustSection title="How limits work">
        <p>
          Reads are questions — listings, quotes, details, portfolio, transaction status. They are
          fast and cheap, so the limit is high. Prepares are “get a transaction ready for me to
          sign” — heavier, so the limit is lower, and still capped at 25 ETH per action. If you
          hit a limit you get a 429 — wait a minute and try again. A Pro key raises the ceiling;
          it never raises the 25 ETH cap.
        </p>
      </TrustSection>

      <TrustSection title="Trust, plainly">
        <p>
          The contracts are not audited (automated checks only). The Safe Harbor terms are
          published; on-chain registration is in progress. See the{' '}
          <Link href="/security" className="text-[#00E676] hover:underline">
            security page
          </Link>{' '}
          for the full picture. No usage numbers or uptime promises are published here — the only
          public numbers are the on-chain ones (tokens launched, Tokenized Funds live), which
          anyone can check.
        </p>
      </TrustSection>

      <TrustSection title="Questions">
        <ul className="mt-3 space-y-3">
          <li>
            <strong>Do I need a key to start?</strong> No. The free tier needs nothing — no signup,
            no key, no approval.
          </li>
          <li>
            <strong>What does a key buy me?</strong> Higher limits and a usage dashboard. Same tools, same safety caps.
          </li>
          <li>
            <strong>Do keys move money?</strong> No. Keys only identify your calls. Spending is
            governed separately by SpendVault keys on /agents/accounts.
          </li>
          <li>
            <strong>What happens if I lose my key?</strong> Issue a new one from /agents/accounts and
            revoke the old one. The full key is shown once and never again.
          </li>
        </ul>
      </TrustSection>
    </TrustShell>
  );
}
