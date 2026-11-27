import type { Metadata } from 'next';
import { TrustShell, TrustSection } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Changelog | Polypad',
  description: 'What changed on Polypad, newest first — agent API, pay-per-call, security, and the developer hub.',
  path: '/changelog',
});

const ENTRIES: { date: string; items: string[] }[] = [
  {
    date: 'November 19, 2026',
    items: [
      'Pulse page live at /pulse: our public numbers — SDK downloads, MCP Registry status, 21 tools, agents registered, tokenized funds launched, total TVL, and x402 prices. Every figure shows its source and when it was checked. npm and PyPI downloads are not tracked yet — the package is a day old and the stats services have not picked it up.',
      'One-command onboarding on /build: one-click “Add to Cursor” and “Install in VS Code” buttons, Claude Code plugin install commands, and three copy-paste first prompts to give your agent.',
      'Per-key metering and usage dashboard live at /agents/usage: paste a Pro key once to see total calls, reads and prepares, last-minute usage against Pro limits, a 14-day chart, most-used tools, and launches prepared. Free unkeyed calls are not counted.',
      'Sourcify verification finished: the Agent Credit Score contracts (AgentRegistry, AgentScore), the generic V4 router adapter, and the allowlist feeds for HMM, DELTA, BOW, HOOKR, and FRONG are all verified exact_match. The one accepted exception remains the V2 FundShareRenderer.',
      'Glama listing claimed: ownership verified for the Polypad MCP connector, status Healthy.',
      'SDK polypad-agent 2.0.1 published to npm and PyPI (Nov 18 evening): TypeScript and Python, 21 tools, live-verified by clean installs.',
    ],
  },
  {
    date: 'November 18, 2026',
    items: [
      'v1 REST sunset set: the deprecated v1 API (/api/agents/v1) will be switched off on February 16, 2027. Migrate to the MCP server or the v2 REST endpoints before then. See /docs/rules.',
      'Pro tier live: API keys (pp_live_, shown once, hash-only storage) buy 10x the free limits — reads 1,200/min, prepares 300/min, per wallet 120/min, intent 400/min — at $0 while growing. Keys are issued from /agents/accounts, work on the MCP and the v2 REST API, and can be revoked by presenting the key. No key is ever required; the free tier is unchanged. See /pricing.',
      'Sign-loop doc fixes: /docs/sign-loop now says plainly what to compare (the summary plus the fingerprint code), that the signing page re-simulates the action for the connected wallet and the amounts can differ, that the way back is always a tap (signing and connect), and that a wallet token is from a single connect, lasts 90 days, travels in the return link — do not share it — and alone cannot move funds.',
      'Sign loop closed: every prepare tool takes an optional returnUrl, and the signing page shows a “Back to the agent” button after the transaction confirms, with the transaction hash and status attached — plus the confirmation the page already checked (see /docs/sign-loop).',
      'Persistent wallet binding: connect once on /sign?connect=1, sign one message, and get a token the agent stores — prepare calls pass walletToken instead of a per-call address. Per-call from stays as the fallback. TypeScript and Python SDKs (polypad-agent) built on this model, with the prepare → sign → confirm helper, both recipes, and the x402 payment helper — code complete and tested (see /docs/sdks).',
      'Framework guides: LangChain (MCP adapter) and Vercel AI SDK (MCP client), each with a working example and the same 5-minute check — list tokens, quote a trade, prepare a mint.',
      'Case studies: Forge launching Agent Swarm on its own (Nov 16, ~0.00109 ETH total, with transaction hashes), plus the Grok and Muse “works in” stories — real numbers only.',
      'Developer hub refresh: the stale “CTO report is down” note is gone from /build, tool names now match the API exactly (polypad_*), rate limits are published, and there is a live status dot plus a try-it-live playground that calls the real API from your browser.',
      'New: a tool reference generated from the API code itself (/docs/tools), rules of the road with every error code (/docs/rules), this changelog, and a live status page (/status).',
      'CTO report fixed: the builder is back and the paid $0.05 report is answering again.',
      'Agent Credit Score keeper switched on: scores are now updated daily by a dedicated keeper. First scores are expected once the first agent registers — no agents have registered yet.',
      'Security page and security.txt live at polypad.family/security and /.well-known/security.txt. SEAL Safe Harbor terms published; on-chain registration in progress.',
      'DeFiLlama TVL adapter pull request opened.',
    ],
  },
  {
    date: 'November 17, 2026',
    items: [
      'x402 pay-per-call is live: a facilitator and a marketplace for priced reports — token report $0.01, Tokenized Fund NAV $0.01, CTO report $0.05 — paid in USDG or POLYDASH, settled on-chain.',
      'Agent Credit Score contracts deployed: an on-chain reputation score (300–850) for agents, from on-chain behavior only.',
      'Terminal live: every live tokenized fund ranked by NAV per share, plus a live activity feed.',
    ],
  },
  {
    date: 'November 16, 2026',
    items: [
      'The Polyfund is live: the first tokenized fund on the LP-Dividend strategy — 200 NFT shares at 0.01 ETH each.',
      'Forge, the autonomous daily launcher, launched its first token: Agent Swarm (SWARM), with a staking pool created in the same run.',
    ],
  },
  {
    date: 'November 15, 2026',
    items: [
      'Agent API (MCP) live at polypad.family/api/mcp — 21 tools for trading, launching tokens, running tokenized funds, and NFTs. Verified working in Grok and in a Muse connector the same day.',
      'LP-Dividend strategy (Strategy #6) deployed: tokenized funds that buy POLYDASH, add liquidity, and pay the fees back to share holders.',
      'Apple Pay / Google Pay on-ramp live via Relay: buy ETH directly on Robinhood Chain, no account needed.',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <TrustShell
      title="Changelog"
      intro={<>What changed on Polypad, newest first. Short entries, real dates — if it is listed here, it shipped.</>}
    >
      {ENTRIES.map((entry) => (
        <TrustSection key={entry.date} title={entry.date}>
          <ul className="list-disc space-y-2 pl-5">
            {entry.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </TrustSection>
      ))}
      <p className="text-sm text-white/60">
        Contracts are unaudited. The Safe Harbor terms are published; on-chain registration is in progress.
      </p>
    </TrustShell>
  );
}
