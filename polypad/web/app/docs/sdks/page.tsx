import type { Metadata } from 'next';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';
import { TrustShell, TrustSection } from '@/components/trust/trust-shell';
import { CodeBlock } from '@/components/trust/code-block';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'SDKs — TypeScript and Python | Polypad',
  description: 'Thin typed clients for the Polypad agent API: prepare → sign → confirm, persistent wallet binding, and x402 pay-per-call. SDK version 2.0.1; the server is v2.1.0 — versioned separately.',
  path: '/docs/sdks',
});

const INSTALL_COMMANDS = `npm install polypad-agent
pip install polypad-agent`;

// One command, no code: connects the Polypad MCP server to the chosen host.
// Swap `claude` for `cursor`, `codex`, `gemini`, or `vscode`.
const CONNECT_COMMAND = `npx -y polypad-agent connect claude`;

const WALLET_TOKEN_EXPORT = `export POLYPAD_WALLET_TOKEN=<your token>`;

const TS_QUICKSTART = `import { PolypadClient } from "polypad-agent";

const client = new PolypadClient(); // reads POLYPAD_WALLET_TOKEN
console.log(await client.listTokens({ sort: "new", limit: 5 }));
const quote = await client.quoteTrade({
  token: "POLYDASH",
  side: "buy",
  amountEth: "0.01",
});
console.log(quote);
const POLYFUND = "0x7c1d31629ac68aebe83f230edbc7eacfc26285ef";
const mint = await client.prepareFundMint({ fund: POLYFUND, quantity: 1 });
console.log(mint.signing.url); // the user opens this and signs`;

const PY_QUICKSTART = `from polypad_agent import PolypadClient

client = PolypadClient()  # reads POLYPAD_WALLET_TOKEN
print(client.list_tokens(sort="new", limit=5))
print(client.quote_trade(token="POLYDASH", side="buy", amountEth="0.01"))
POLYFUND = "0x7c1d31629ac68aebe83f230edbc7eacfc26285ef"
mint = client.prepare_fund_mint(fund=POLYFUND, quantity=1)
print(mint["signing"]["url"])  # the user opens this and signs`;

const TS_LOOP_CHAT = `// Chat agent: prepare, show the link, wait for the hash, poll until confirmed.
const done = await client.prepareSignConfirm({
  tool: "polypad_prepare_fund_mint",
  arguments: {
    fund: "0x7c1d31629ac68aebe83f230edbc7eacfc26285ef",
    quantity: 1,
  },
  returnUrl: "https://example.com/agent/done",
  onSigningLink: (url, summary) => console.log(summary.headline, url),
  // You supply getTxHash: it returns the hash once the user has signed —
  // from your return-URL handler, or the user pasting it back.
  getTxHash: async () => "0x...", // the hash your handler received
});
console.log(done.status, done.txHash, done.result);`;

const TS_LOOP_SCRIPT = `// Script with its own wallet (the Forge path): prepare, sign, broadcast, confirm.
const launched = await client.prepareSignBroadcast({
  tool: "polypad_prepare_token_launch",
  arguments: {
    name: "Agent Swarm",
    symbol: "SWARM",
    creatorFeeBps: 100,
    devBuyEth: "0",
  },
  privateKey: process.env.LAUNCHER_PRIVATE_KEY,
});
console.log(launched.status, launched.txHash);`;

const PY_LOOP = `import os

from polypad_agent import PolypadClient

client = PolypadClient()  # reads POLYPAD_WALLET_TOKEN

# Chat agent: prepare, show the link, wait for the hash, poll until confirmed.
done = client.prepare_sign_confirm(
    tool="polypad_prepare_fund_mint",
    arguments={
        "fund": "0x7c1d31629ac68aebe83f230edbc7eacfc26285ef",
        "quantity": 1,
    },
    return_url="https://example.com/agent/done",
    on_signing_link=lambda url, summary: print(summary["headline"], url),
    # You supply get_tx_hash: it returns the hash once the user has signed —
    # from your return-URL handler, or the user pasting it back.
    get_tx_hash=lambda: "0x...",  # the hash your handler received
)
print(done["status"], done["tx_hash"], done["result"])

# Script with its own wallet (the Forge path): prepare, sign, broadcast, confirm.
launched = client.prepare_sign_broadcast(
    tool="polypad_prepare_token_launch",
    arguments={
        "name": "Agent Swarm",
        "symbol": "SWARM",
        "creatorFeeBps": 100,
        "devBuyEth": "0",
    },
    private_key=os.environ["LAUNCHER_PRIVATE_KEY"],
)
print(launched["status"], launched["tx_hash"])`;

const TS_PAY = `import { privateKeyToAccount } from "viem/accounts";
import { payForReport } from "polypad-agent";

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY as \`0x$\{string}\`);
const report = await payForReport({
  product: "token-report",
  query: "address=0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B",
  account,
});
console.log(report);`;

const PY_PAY = `import os

from polypad_agent import pay_for_report

report = pay_for_report(
    "token-report",
    "address=0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B",
    private_key=os.environ["PAYER_PRIVATE_KEY"],
)
print(report)`;

const GITHUB = 'https://github.com/polydash-labs/polypad-agent';

export default function SdksPage() {
  return (
    <TrustShell
      title="SDKs — TypeScript and Python"
      intro={
        <>
          Polypad is a launchpad and tokenized fund platform on Robinhood Chain: anyone can launch a token, or open a
          Tokenized Fund that other people can buy shares in. These SDKs let your code — or your AI agent — do
          all of that through Polypad&apos;s agent API, MCP (Model Context Protocol — the standard way for
          agents to call tools): trade tokens, launch tokens, run tokenized funds, and pay for reports per call. SDK
          version 2.0.1; the server is v2.1.0 — they are versioned separately. No signup, no API key, no approval.
        </>
      }
    >
      <BeginnerStart />
      <GlossaryBox />
      <TrustSection title="Before you start">
        <p>
          About 5 minutes once the setup below is ready. You need:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong>Node 18 or newer</strong> for the TypeScript SDK, or <strong>Python 3.10 or newer</strong>{' '}
            for the Python SDK.
          </li>
          <li>
            <strong>A wallet with ETH on Robinhood Chain</strong> — you need it to sign actions and pay gas.
          </li>
          <li>
            <strong>A model key, only if your agent calls a model</strong> (OpenAI, Anthropic, or any provider) —
            pay-as-you-go; a few dollars of credit is plenty for the examples here.
          </li>
          <li>
            The source, examples, and issue tracker live on{' '}
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="text-[#00E676] hover:underline">
              GitHub
            </a>
            .
          </li>
        </ul>
      </TrustSection>

      <TrustSection title="Install">
        <p>
          Both packages are published, version 2.0.1, and install straight from the public registries — no
          repo clone needed:
        </p>
        <CodeBlock code={INSTALL_COMMANDS} label="Copy install commands" />
        <p className="mt-3">
          Just want your AI assistant connected, without writing code? One command sets it up — swap{' '}
          <span className="font-mono text-[13px]">claude</span> for{' '}
          <span className="font-mono text-[13px]">cursor</span>,{' '}
          <span className="font-mono text-[13px]">codex</span>,{' '}
          <span className="font-mono text-[13px]">gemini</span>, or{' '}
          <span className="font-mono text-[13px]">vscode</span>. No account or API key needed on the free tier;
          add <span className="font-mono text-[13px]">--key</span> with a Pro key for the higher limits.
        </p>
        <CodeBlock code={CONNECT_COMMAND} label="Copy connect command" />
        <p className="mt-3 text-[13px]">
          <a href="https://www.npmjs.com/package/polypad-agent" target="_blank" rel="noopener noreferrer" className="text-[#00E676] hover:underline">
            View on npm
          </a>
          {' · '}
          <a href="https://pypi.org/project/polypad-agent/2.0.1/" target="_blank" rel="noopener noreferrer" className="text-[#00E676] hover:underline">
            View on PyPI
          </a>
        </p>
      </TrustSection>

      <TrustSection title="Wallet binding: connect once">
        <p>
          A prepare call needs to know which wallet will sign. Instead of passing the address on every call,
          connect once:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            Build the connect URL with <span className="font-mono text-[13px]">client.connectUrl()</span> — it
            points to <span className="font-mono text-[13px]">polypad.family/sign?connect=1</span>.
          </li>
          <li>
            The user connects their wallet and signs one message. This is not a transaction — no funds move.
          </li>
          <li>
            Save the token the page gives back as{' '}
            <span className="font-mono text-[13px]">POLYPAD_WALLET_TOKEN</span>:
            <CodeBlock code={WALLET_TOKEN_EXPORT} label="Copy wallet token export" />
          </li>
        </ol>
        <p className="mt-3">
          The client passes the token instead of a wallet address; the server recovers the wallet from the
          signature. Passing the <span className="font-mono text-[13px]">from</span> parameter on a single
          call still works as a fallback: pass it explicitly and the client leaves the token out for that
          call. How the token is built and
          checked is on the{' '}
          <a href="/docs/sign-loop" className="text-[#00E676] hover:underline">sign loop</a> page.
        </p>
        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] p-3">
          <p className="font-semibold text-amber-200">Keep this token safe.</p>
          <p className="mt-1">
            It lasts 90 days; after that, connect again. It cannot be revoked from the server — it stops
            working when it expires, or when the holder deletes it — so treat it like a password for that one
            wallet and never paste it in a public chat.
          </p>
        </div>
      </TrustSection>

      <TrustSection title="Quickstart — TypeScript">
        <p>
          Lists the five newest tokens, quotes a 0.01 ETH buy of POLYDASH — Polypad&apos;s ecosystem token —
          then prepares a mint of one share of the Polyfund, the live tokenized fund (the Polyfund) at the address shown.
        </p>
        <CodeBlock code={TS_QUICKSTART} label="Copy TypeScript quickstart" />
        <p className="mt-3">
          <strong>What happens next:</strong> the code prints a signing URL. Open the link — it takes you to
          /sign, where the user signs in their own wallet and approves the mint.
        </p>
      </TrustSection>

      <TrustSection title="Quickstart — Python">
        <p>
          The same quickstart in Python: lists the five newest tokens, quotes a 0.01 ETH buy of POLYDASH —
          Polypad&apos;s ecosystem token — then prepares a mint of one share of the Polyfund, the live tokenized fund (the Polyfund) at
          the address shown.
        </p>
        <CodeBlock code={PY_QUICKSTART} label="Copy Python quickstart" />
        <p className="mt-3">
          <strong>What happens next:</strong> the code prints a signing URL. Open the link — it takes you to
          /sign, where the user signs in their own wallet and approves the mint.
        </p>
      </TrustSection>

      <TrustSection title="The loop: prepare → sign → confirm">
        <p>
          An action is not done when it is prepared, and not done when it is signed — it is done when the agent
          knows the result. The helper has two shapes. For a chat agent, it prepares, hands the signing link to
          your callback for the user to open, waits for the transaction hash (from the{' '}
          <span className="font-mono text-[13px]">returnUrl</span> callback, or the user pasting it back), then
          polls <span className="font-mono text-[13px]">polypad_get_tx_status</span> until the chain confirms it.
          For a script with its own wallet, it prepares, signs and sends each step with the script&apos;s own
          key, waits for each step&apos;s receipt before the next, then polls for the final result. This is the
          Forge path — Forge is Polypad&apos;s autonomous daily token launcher, a script that launches one
          token a day with its own wallet. The signing key must be the bound wallet — never the Polypad deployer
          wallet. Python has the same two helpers:{' '}
          <span className="font-mono text-[13px]">prepare_sign_confirm</span> and{' '}
          <span className="font-mono text-[13px]">prepare_sign_broadcast</span>.
        </p>
        <p className="mt-5 font-semibold text-white/85">Chat agent (user signs)</p>
        <p>
          The user opens the signing link and signs; your code waits for the hash, then polls until the chain
          confirms.
        </p>
        <CodeBlock code={TS_LOOP_CHAT} label="Copy chat-agent loop" />
        <p className="mt-5 font-semibold text-white/85">Script with its own wallet (Forge path)</p>
        <p>
          The script prepares, signs, and sends each step with its own key — no user in the loop.
        </p>
        <CodeBlock code={TS_LOOP_SCRIPT} label="Copy script loop" />
        <p className="mt-5 font-semibold text-white/85">The same loop in Python</p>
        <p>Both helpers, same shape as above.</p>
        <CodeBlock code={PY_LOOP} label="Copy Python loop" />
      </TrustSection>

      <TrustSection title="Recipes">
        <p>
          Two recipes ship with each SDK, both using the bound wallet — no per-call address anywhere:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong>Launch a token from a script</strong> (
            <a href={`${GITHUB}/blob/main/ts/examples/launch-token.ts`} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px] text-[#00E676] hover:underline">
              launch-token.ts
            </a>
            {' · '}
            <a href={`${GITHUB}/blob/main/py/examples/launch_token.py`} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px] text-[#00E676] hover:underline">
              launch_token.py
            </a>
            ): prepare the launch, sign and broadcast it, confirm it, then create the token&apos;s staking
            pool by calling the factory directly — there is no MCP tool for staking pools yet. This is the
            Forge path; the numbers are in the{' '}
            <a href="/docs/case-studies" className="text-[#00E676] hover:underline">case studies</a>.
          </li>
          <li>
            <strong>Run a tokenized fund from an agent</strong> (
            <a href={`${GITHUB}/blob/main/ts/examples/run-fund.ts`} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px] text-[#00E676] hover:underline">
              run-fund.ts
            </a>
            {' · '}
            <a href={`${GITHUB}/blob/main/py/examples/run_fund.py`} target="_blank" rel="noopener noreferrer" className="font-mono text-[13px] text-[#00E676] hover:underline">
              run_fund.py
            </a>
            ): create the tokenized fund (
            <a href="/docs/case-studies" className="text-[#00E676] hover:underline">
              Strategy #6, the LP-Dividend strategy
            </a>
            ), then mint the manager&apos;s skin shares so the raise can open. Investors then mint through
            the same prepare → sign → confirm loop.
          </li>
        </ul>
      </TrustSection>

      <TrustSection title="Pay-per-call (x402)">
        <p>
          <strong>x402 is pay-per-call.</strong> The server answers with a 402 and a price, you sign a
          payment, and the report is fetched once paid.{' '}
          <span className="font-mono text-[13px]">payForReport</span> /{' '}
          <span className="font-mono text-[13px]">pay_for_report</span> fetches a priced report — token report
          $0.01, Tokenized Fund NAV $0.01, CTO report $0.05 — paying with USDG. USDG is the dollar stablecoin on
          Robinhood Chain, and the payment uses EIP-3009, a standard that lets a wallet authorize a transfer
          with a signed message instead of sending a transaction. Ask, get a 402 with the price, sign the
          authorization, send it back in the <span className="font-mono text-[13px]">X-PAYMENT</span> header.
          The server only settles after the report is built — if the report cannot be built, nothing is
          charged.
        </p>
        <CodeBlock code={TS_PAY} label="Copy pay-per-call example (TypeScript)" />
        <CodeBlock code={PY_PAY} label="Copy pay-per-call example (Python)" />
      </TrustSection>

      <TrustSection title="Next steps">
        <p>Where to go from here:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <a href="/docs/tools" className="text-[#00E676] hover:underline">Tool reference</a> — every tool,
            with inputs and copy-paste examples.
          </li>
          <li>
            <a href="/docs/rules" className="text-[#00E676] hover:underline">Rules of the road</a> — rate
            limits, size caps, and the error table.
          </li>
          <li>
            <a href="/docs/case-studies" className="text-[#00E676] hover:underline">Case studies</a> — what
            Forge, Grok, and Muse actually built with the API.
          </li>
          <li>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="text-[#00E676] hover:underline">
              GitHub repo
            </a>{' '}
            — source, examples, and issues.
          </li>
          <li>
            <a href="/changelog" className="text-[#00E676] hover:underline">Changelog</a> — what changed, and
            when.
          </li>
        </ul>
        <p className="mt-3 text-[13px] text-white/60">Note: the tokenized fund contracts are unaudited.</p>
      </TrustSection>
    </TrustShell>
  );
}
