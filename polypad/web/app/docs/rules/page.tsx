import type { Metadata } from 'next';
import GlossaryBox from '@/components/glossary-box';
import { TrustShell, TrustSection } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import reference from '@/lib/agents-api/v2/tools-reference.json';

export const metadata: Metadata = trustMetadata({
  title: 'Agent API rules of the road | Polypad',
  description: 'Rate limits, size caps, every error code the Polypad agent API can return, and how versions work. Plain language, no surprises.',
  path: '/docs/rules',
});

const JSON_RPC_ERRORS = [
  { code: '-32700', meaning: 'Parse error — the request body was not valid JSON.' },
  { code: '-32600', meaning: 'Invalid request — not a valid JSON-RPC 2.0 message, or a batch with 0 or more than 10 messages.' },
  { code: '-32601', meaning: 'Method not found — the MCP method does not exist. Supported: initialize, ping, tools/list, tools/call.' },
  { code: '-32602', meaning: 'Unknown tool, or arguments that are not an object.' },
  { code: '-32000', meaning: 'Server error — wraps one of the API errors below. A tools/call that fails this way answers with isError: true and the same error body.' },
];

export default function RulesPage() {
  return (
    <TrustShell
      title="Agent API — rules of the road"
      intro={
        <>
          The limits, the caps, and every error the Polypad agent API can return — written down so a developer
          finds them here instead of discovering them by hitting a wall. No signup, no API key, no approval: the
          limits below are the only gate, and they apply per IP address (and per wallet for prepared actions).
        </>
      }
    >
      <GlossaryBox />
      <TrustSection title="Rate limits">
        <p>
          Limits reset every minute. If you hit one, the reply is HTTP 429 and names how long to wait
          (<span className="font-mono text-[13px]">retry-after</span>, in seconds).
        </p>
        <ul className="mt-3 space-y-1.5">
          <li><strong>Reads — 120 per minute, per IP.</strong> Listings, quotes, details, portfolio, transaction status.</li>
          <li><strong>Prepares — 30 per minute, per IP.</strong> Anything that builds an unsigned transaction.</li>
          <li><strong>Prepares per wallet — 12 per minute.</strong> Counted per signing wallet, on top of the IP limit.</li>
          <li><strong>Intent — 40 per minute, per IP.</strong> The plain-language tool (<span className="font-mono text-[13px]">polypad_intent</span>) has its own limit.</li>
        </ul>
        <p className="mt-3">
          <strong>Pro — 10x the free limits, $0 while growing.</strong> With a free API key from{' '}
          <a href="/agents/accounts" className="text-[#00E676] hover:underline">/agents/accounts</a>:
          reads 1,200 per minute, prepares 300 per minute, prepares per wallet 120 per minute,
          intent 400 per minute. Same 27 tools, same 25 ETH cap per action. A key only identifies
          your calls — it never moves money. See <a href="/pricing" className="text-[#00E676] hover:underline">Pricing</a>.
        </p>
      </TrustSection>

      <TrustSection title="Size and safety caps">
        <ul className="space-y-1.5">
          <li><strong>One action, at most 25 ETH.</strong> Above that the API refuses (<span className="font-mono text-[13px]">amount_too_large</span>). Split it into smaller actions.</li>
          <li><strong>Above 1 ETH, confirm first.</strong> Actions over 1 ETH need the user to confirm the amount, then the call is resent with <span className="font-mono text-[13px]">confirmLarge: true</span>.</li>
          <li><strong>Request body, at most 16 KB.</strong> Above that the API answers 413.</li>
          <li><strong>Batch, at most 10 messages.</strong> One MCP request can carry 1 to 10 JSON-RPC messages.</li>
          <li><strong>Listings, at most 50 results.</strong> The <span className="font-mono text-[13px]">limit</span> parameter caps at 50.</li>
          <li><strong>Slippage, 100 basis points by default, 1,000 at most.</strong> 100 basis points is 1%.</li>
        </ul>
        <p className="mt-3">
          Every prepare call is simulated on-chain before the unsigned transaction is returned. If the simulation
          fails, you get <span className="font-mono text-[13px]">simulation_reverted</span> and nothing is sent.
          The API never signs and never holds keys — the transaction it returns is unsigned, and your wallet signs it.
        </p>
      </TrustSection>

      <TrustSection title="Error codes">
        <p>
          Errors always arrive in the same shape: <span className="font-mono text-[13px]">{'{ ok: false, error: { code, message } }'}</span>.
          The message is plain language and often names the field to fix. This table lists every code the API can
          return, grouped by HTTP status.
        </p>
        <ul className="mt-3 space-y-1.5">
          {reference.errors.map((e) => (
            <li key={e.code}>
              <span className="font-mono text-[13px] text-white">{e.code}</span>{' '}
              <span className="text-white/45">({e.status})</span> — {e.meaning}
            </li>
          ))}
        </ul>
      </TrustSection>

      <TrustSection title="MCP errors (JSON-RPC layer)">
        <p>
          When you call the MCP endpoint, JSON-RPC-level problems use numeric codes instead of the named codes above.
          A tool that fails inside a call still answers 200 with <span className="font-mono text-[13px]">isError: true</span> and
          the named error in the text.
        </p>
        <ul className="mt-3 space-y-1.5">
          {JSON_RPC_ERRORS.map((e) => (
            <li key={e.code}>
              <span className="font-mono text-[13px] text-white">{e.code}</span> — {e.meaning}
            </li>
          ))}
        </ul>
      </TrustSection>

      <TrustSection title="Versioning and deprecation">
        <p>
          The agent API server is <strong>v2.1.0</strong>. It speaks MCP protocol versions 2025-06-18 (default),
          2025-03-26, and 2024-11-05 — send the version you want in the <span className="font-mono text-[13px]">initialize</span> call
          and the server answers with the one it will use. Tool names, inputs, and limits can change in a new major
          version; when they do, the change is listed on the <a href="/changelog" className="text-[#00E676] hover:underline">changelog</a> first.
        </p>
        <p className="mt-3">
          The older v1 REST API (<span className="font-mono text-[13px]">/api/agents/v1</span>) is deprecated: it still
          works, but new work should use the MCP server or the v2 REST endpoints. v1 will be switched off on
          February 16, 2027 — after that date, v1 calls will stop working. Migrate to the MCP server or the v2
          REST endpoints before then.
        </p>
        <p className="mt-3">
          Contracts are unaudited. The Safe Harbor terms are published; on-chain registration is in progress. See
          the <a href="/security" className="text-[#00E676] hover:underline">security page</a> for the full picture.
        </p>
      </TrustSection>
    </TrustShell>
  );
}
