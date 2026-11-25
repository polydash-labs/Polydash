import type { Metadata } from 'next';
import Link from 'next/link';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';
import { TrustShell, TrustSection, ExtLink } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';

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

export default function DocsPage() {
  return (
    <TrustShell
      title="Docs"
      intro={<>Everything about Polypad, in plain words. Start with what you want to do: build with the API, launch a token, or start a tokenized fund.</>}
    >
      <Link href="/build" className="block rounded-2xl border border-polydash-green/30 bg-polydash-green/[0.06] p-5 transition-colors hover:border-polydash-green/50">
        <p className="text-[15px] font-semibold text-white">I want to build →</p>
        <p className="mt-1 text-[13px] leading-relaxed text-white/65">
          Connect your agent to Polypad with MCP — no signup, no API key, no approval. Start on /build, then read
          the tool reference and the rules below.
        </p>
      </Link>
      <BeginnerStart />
      <GlossaryBox />
      <TrustSection title="Agent API reference">
        <p>
          Every tool the agent API exposes, generated from the code itself, with copy-paste examples and what can go
          wrong — plus the rate limits, error codes, and versioning rules. No signup, no API key, no approval.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/docs/tools" className="text-[#00E676] hover:underline">Tool reference</Link>
          <Link href="/docs/rules" className="text-[#00E676] hover:underline">Rules of the road</Link>
          <Link href="/pricing" className="text-[#00E676] hover:underline">Pricing</Link>
          <Link href="/docs/sign-loop" className="text-[#00E676] hover:underline">Sign loop: prepare → sign → confirm</Link>
          <Link href="/docs/sdks" className="text-[#00E676] hover:underline">SDKs (TypeScript + Python)</Link>
          <Link href="/docs/langchain" className="text-[#00E676] hover:underline">LangChain guide</Link>
          <Link href="/docs/vercel-ai-sdk" className="text-[#00E676] hover:underline">Vercel AI SDK guide</Link>
          <Link href="/docs/case-studies" className="text-[#00E676] hover:underline">Case studies</Link>
          <Link href="/changelog" className="text-[#00E676] hover:underline">Changelog</Link>
          <Link href="/status" className="text-[#00E676] hover:underline">Status</Link>
          <Link href="/build" className="text-[#00E676] hover:underline">Build on Polypad</Link>
        </p>
      </TrustSection>
      {sections.map((s) => (
        <TrustSection key={s.title} title={s.title}>
          <p>{s.body}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <ExtLink href={DOCS_URL}>Read on GitHub</ExtLink>
            {s.link ? (
              <Link href={s.link.href} className="text-white/80 hover:underline">
                {s.link.label}
              </Link>
            ) : null}
          </p>
        </TrustSection>
      ))}
      <div id="agent-launched" className="scroll-mt-24">
        <TrustSection title="Agent-launched tokens and the agent API">
          <p>
            Tokens marked agent-launched were prepared through the Polypad agent API by an AI agent or script. The mark records how the launch
            was prepared. It says nothing about the token’s quality or risk.
          </p>
          <p className="mt-2">
            The API is non-custodial. It lets assistants browse launches, read token state, get bonding-curve quotes, and build transactions
            for launch, commit, uncommit, refunds, buy, sell and creator-fee claims. Every transaction is simulated and returned unsigned; the
            user’s own wallet signs and sends it. Polypad never accepts private keys. Amounts are decimal base-unit strings and every response
            includes the chain id (4663, Robinhood Chain). Not financial advice.
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <a href="/api/agents/v1/spec" className="text-[#00E676] hover:underline">API spec (JSON)</a>
            <a href="/api/agents/v1" className="text-white/80 hover:underline">API index</a>
            <Link href="/agents" className="text-white/80 hover:underline">Agents</Link>
          </p>
        </TrustSection>
      </div>
      <div id="tokenized-funds" className="scroll-mt-24">
        <TrustSection title="Tokenized Funds">
          <p>
            A Tokenized Fund pools ETH from investors who buy shares. A manager invests that ETH under a published Strategy (the mandate) that
            is locked when the Tokenized Fund is created. Every Strategy sets limits on trade size, how much of the Tokenized Fund one token may
            take up, and a drawdown brake. Each Strategy has a fixed fee — pick the Strategy, and the fee is set.
          </p>
          <p className="mt-2">
            <span className="font-medium text-white">The approved list (the allowlist).</span> A Tokenized Fund can only buy tokens on the approved
            list, which is read live from the FundAllowlist contract{' '}
            <ExtLink href={getExplorerAddressUrl('0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19')}>0x7A42…2c19</ExtLink>. You can
            browse the list on the Create page and on every Tokenized Fund page before you invest.
          </p>
          <p className="mt-2">
            <span className="font-medium text-white">The 2-day wait for new tokens.</span> To add a token, the manager makes a public proposal
            with its share limit (a newly proposed token is capped at 30% by default). The proposal waits 2 days in public (the timelock) before
            the manager can add it. During the wait, investors can see it on the Tokenized Fund page and leave the Tokenized Fund if they do not
            agree.
          </p>
          <p className="mt-2">
            <span className="font-medium text-white">How a manager invests.</span> 1) Create the Tokenized Fund: pick a Strategy and fee, a share
            price, a raise goal and how long the raise stays open. 2) Buy your own manager stake, which stays locked for the period the Strategy
            sets. 3) Investors buy shares until the goal is reached; if it is not reached in time, holders can get their ETH back. 4) Once the
            raise is complete, trade only approved tokens, inside the Strategy’s limits. Each trade is checked against a time-averaged price and
            the drawdown brake. A time-averaged price is the average price over a recent window, so one spike cannot justify a trade. The drawdown
            brake stops new trades after the Tokenized Fund’s value has fallen past the Strategy’s limit. 5) For the LP-Dividend Strategy, the manager can also add POLYDASH/WETH liquidity and stake POLYDASH; new positions
            also wait in public first. No guaranteed returns. Not financial advice.
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/funds/create" className="text-[#00E676] hover:underline">Create a Tokenized Fund</Link>
            <Link href="/funds" className="text-white/80 hover:underline">Browse Tokenized Funds</Link>
          </p>
        </TrustSection>
      </div>
      <TrustSection title="More">
        <p>
          See <Link href="/about" className="text-[#00E676] hover:underline">About</Link> for how Polypad works end to end.
        </p>
      </TrustSection>
      <p className="text-sm text-white/50">
        Full docs also live on GitHub: <ExtLink href={DOCS_URL}>polydash-labs/Polydash/docs</ExtLink>
      </p>
    </TrustShell>
  );
}
