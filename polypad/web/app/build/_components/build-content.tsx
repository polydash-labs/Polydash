'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Loader2, Plug, Rocket, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import {
  CTA_OUTLINE,
  CTA_PRIMARY,
  FlowDiagram,
  H2,
  HERO_GLOW,
  KICKER,
  SECTION,
  SectionHead,
  StatTiles,
} from '@/lib/ui/template';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContract, useSignTypedData } from 'wagmi';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';
import { Button } from '@/components/ui/button';
import { USDG_ADDRESS, X402_CHAIN_ID } from '@/lib/x402/constants';
import { PolydashTokenABI } from '@/lib/contracts/abis';
import { robinhoodChain } from '@/lib/chain';

/** One payment option from a 402 quote. The POLYDASH alternative arrives as a raw integer (18 decimals) — it is shown formatted, never raw. */
type X402Accept = {
  amount: string;
  asset: string;
  extra?: Record<string, string>;
};

/** The USDG (EIP-3009) half of a 402 quote — everything the buyer needs to sign. */
type X402UsdgRequirement = {
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, string>;
};

/** POLYDASH, for labelling the pay-with-POLYDASH alternative in a quote. */
const POLYDASH_ADDRESS = '0x319525528f42167eF7fC18b77b889958080568e4';

/** A raw token amount (e.g. "38000000000000000000") as a readable number ("38"). */
function formatRawTokenAmount(raw: string, decimals: number): string {
  try {
    const v = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const fracStr = (v % base).toString().padStart(decimals, '0').slice(0, 2).replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return raw;
  }
}

function friendlyPayError(message: string): string {
  if (/insufficient_funds/i.test(message)) return 'Your wallet does not hold enough USDG for this report.';
  if (/nonce_already_used/i.test(message)) return 'That payment was already used — get a fresh quote and try again.';
  if (/authorization_expired/i.test(message)) return 'The quote expired (2 minutes). Get a fresh quote and try again.';
  if (/invalid_signature/i.test(message)) return 'The signature did not check out — please try again.';
  if (/settlement_pending/i.test(message)) return 'The payment was sent but is still confirming. Check back in a minute — do not pay twice.';
  if (/user rejected|user denied/i.test(message)) return 'You cancelled the signature — nothing was charged.';
  if (message.length < 160) return message;
  return 'The payment did not go through. Get a fresh quote and try again — nothing was charged.';
}

const MCP_CONFIG = `{
  "mcpServers": {
    "polypad": {
      "url": "https://polypad.family/api/mcp"
    }
  }
}`;

// One-click install links. Cursor: base64 of {"url":"https://polypad.family/api/mcp"}.
// VS Code: URL-encoded {"name":"polypad","type":"http","url":"https://polypad.family/api/mcp"}.
const CURSOR_INSTALL_LINK =
  'cursor://anysphere.cursor-deeplink/mcp/install?name=polypad&config=eyJ1cmwiOiJodHRwczovL3BvbHlwYWQuZmFtaWx5L2FwaS9tY3AifQ==';
const VSCODE_INSTALL_LINK =
  'vscode:mcp/install?%7B%22name%22%3A%22polypad%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A//polypad.family/api/mcp%22%7D';

const CLAUDE_PLUGIN_ADD = '/plugin marketplace add polydash-labs/polypad-agent';
const CLAUDE_PLUGIN_INSTALL = '/plugin install polypad@polypad-agent';
const CLAUDE_MCP_ADD = 'claude mcp add --transport http polypad https://polypad.family/api/mcp';
const CODEX_MCP_ADD = 'codex mcp add polypad --url https://polypad.family/api/mcp';

// One command, no config file: `polypad connect` writes the Polypad MCP server
// into the chosen host's config. npx form needs no install; the global form keeps the command.
const CONNECT_HOSTS = [
  { label: 'Claude Code', command: 'npx -y polypad-agent connect claude' },
  { label: 'Cursor', command: 'npx -y polypad-agent connect cursor' },
  { label: 'Codex', command: 'npx -y polypad-agent connect codex' },
  { label: 'Gemini', command: 'npx -y polypad-agent connect gemini' },
  { label: 'VS Code', command: 'npx -y polypad-agent connect vscode' },
] as const;
const CONNECT_GLOBAL_INSTALL = 'npm install -g polypad-agent';

const FIRST_PROMPTS = [
  {
    label: 'See what it can do',
    prompt: 'List the tools Polypad offers and show me what you can do.',
  },
  {
    label: 'Check the live tokenized funds',
    prompt: 'What tokenized funds are live on Polypad right now, and how much is each share worth?',
  },
  {
    label: 'See what launched today',
    prompt: 'What tokens launched on Polypad today?',
  },
];

const MCP_TOOLS: { group: string; tools: { name: string; what: string }[] }[] = [
  {
    group: 'Trade',
    tools: [
      { name: 'polypad_quote_trade', what: 'Price a buy or sell before you sign it.' },
      { name: 'polypad_prepare_buy', what: 'Build the unsigned buy transaction.' },
      { name: 'polypad_prepare_sell', what: 'Build the unsigned sell transaction.' },
    ],
  },
  {
    group: 'Launch',
    tools: [
      { name: 'polypad_list_tokens', what: 'List tokens launched on Polypad.' },
      { name: 'polypad_get_token', what: 'Full details for one token.' },
      { name: 'polypad_prepare_token_launch', what: 'Build the unsigned launch transaction.' },
    ],
  },
  {
    group: 'Tokenized Funds',
    tools: [
      { name: 'polypad_list_fund_templates', what: 'List the tokenized-fund strategies (Strategy #1–#9) — the tool name still says “templates” for now.' },
      { name: 'polypad_list_funds', what: 'List live tokenized funds.' },
      { name: 'polypad_get_fund', what: 'Full details for one tokenized fund.' },
      { name: 'polypad_prepare_fund_create', what: 'Build the unsigned tokenized-fund-creation transaction.' },
      { name: 'polypad_prepare_fund_mint', what: 'Build the unsigned mint-a-share transaction.' },
      { name: 'polypad_prepare_fund_redeem', what: 'Build the unsigned redeem-a-share transaction.' },
    ],
  },
  {
    group: 'NFTs',
    tools: [
      { name: 'polypad_list_nfts', what: 'List NFT collections on Polypad.' },
      { name: 'polypad_list_nft_listings', what: 'List NFTs for sale.' },
      { name: 'polypad_prepare_nft_buy', what: 'Build the unsigned NFT-buy transaction.' },
      { name: 'polypad_prepare_nft_create', what: 'Build the unsigned create-a-collection transaction.' },
    ],
  },
  {
    group: 'Read',
    tools: [
      { name: 'polypad_what_can_i_do', what: 'What this API can do, in plain words.' },
      { name: 'polypad_intent', what: 'Turn a sentence into the matching action.' },
      { name: 'polypad_token_protections', what: 'A token’s holder protections and checks.' },
      { name: 'polypad_portfolio', what: 'A wallet’s tokens, funds, and stakes.' },
      { name: 'polypad_get_tx_status', what: 'Check whether a transaction confirmed.' },
      { name: 'polypad_stats', what: 'Polypad totals: tokens, funds, volume.' },
      { name: 'polypad_agent_chat', what: 'Send a system prompt and messages to a business agent, get the reply.' },
    ],
  },
  {
    group: 'Pay across chains',
    tools: [
      { name: 'x402_cross_chain_quote', what: 'Plan paying an x402 endpoint from the other chain — read-only, nothing moves.' },
      { name: 'x402_cross_chain_pay', what: 'Build the unsigned bridge + settlement package to pay across chains.' },
    ],
  },
];

const X402_PRODUCTS = [
  {
    id: 'token-report',
    label: 'Token report',
    price: '$0.01',
    query: 'address=0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B',
    note: 'Full snapshot for a token — Agent Swarm (SWARM) in this example.',
  },
  {
    id: 'fund-nav',
    label: 'Tokenized Fund NAV',
    price: '$0.01',
    query: 'fund=0x7c1d31629ac68aebe83f230edbc7eacfc26285ef',
    note: 'NAV per share for a fund — the Polyfund in this example.',
  },
  {
    id: 'cto-report',
    label: 'CTO report',
    price: '$0.05',
    query: 'launch=0x2B0b4151cA57546BD968718b1ba256b288e51CA9',
    note: 'A code-and-risk report for a launch — Agent Swarm’s launch in this example.',
  },
] as const;

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the text manually.');
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? 'Copied' : label ?? 'Copy'}
    </Button>
  );
}

function Playground() {
  const searchParams = useSearchParams();
  const initialProduct = useMemo(() => {
    const p = searchParams.get('product');
    return X402_PRODUCTS.some((x) => x.id === p)
      ? (p as (typeof X402_PRODUCTS)[number]['id'])
      : 'token-report';
  }, [searchParams]);
  const [productId, setProductId] = useState<(typeof X402_PRODUCTS)[number]['id']>(initialProduct);
  const [result, setResult] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Payment state: the USDG quote from the 402 answer, and where the pay flow is.
  const [quote, setQuote] = useState<X402UsdgRequirement | null>(null);
  // Every payment option from the 402 answer, for the human-readable price line.
  const [accepts, setAccepts] = useState<X402Accept[] | null>(null);
  const [payState, setPayState] = useState<'idle' | 'signing' | 'paying' | 'done' | 'error'>('idle');
  const [payError, setPayError] = useState<string | null>(null);
  const { address } = useAccount();
  // USDG balance for the pre-pay check (wagmi v3 useBalance has no token
  // param — read the ERC-20 balance directly, the same pattern the trade
  // panel uses).
  const { data: usdgBalance } = useReadContract({
    address: USDG_ADDRESS,
    abi: PolydashTokenABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: robinhoodChain.id,
    query: { enabled: !!address },
  });
  const { signTypedDataAsync } = useSignTypedData();
  const product = X402_PRODUCTS.find((p) => p.id === productId)!;
  const usdgNeeded = quote ? BigInt(quote.amount) : 0n;
  const usdgShort = quote && usdgBalance != null && usdgBalance < usdgNeeded;

  async function getQuote() {
    setBusy(true);
    setResult(null);
    setStatus(null);
    setError(null);
    setQuote(null);
    setAccepts(null);
    setPayState('idle');
    setPayError(null);
    try {
      const res = await fetch(`/api/x402/products/${product.id}?${product.query}`);
      setStatus(res.status);
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        setResult(JSON.stringify(parsed, null, 2));
        if (res.status === 402) {
          setAccepts(Array.isArray(parsed?.accepts) ? (parsed.accepts as X402Accept[]) : null);
          const usdg = (parsed?.accepts ?? []).find(
            (a: { extra?: Record<string, string> }) => a?.extra?.assetTransferMethod === 'eip3009',
          ) as X402UsdgRequirement | undefined;
          setQuote(usdg ?? null);
        }
      } catch {
        setResult(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setBusy(false);
    }
  }

  // The pay-with-POLYDASH alternative, formatted as a readable amount ("about 38 POLYDASH")
  // instead of the raw 18-decimal integer the quote returns.
  const polydashAlt = accepts?.find((a) => a.asset.toLowerCase() !== USDG_ADDRESS.toLowerCase());
  const polydashAltLabel =
    polydashAlt?.asset.toLowerCase() === POLYDASH_ADDRESS.toLowerCase() ? 'POLYDASH' : 'the other token';
  const polydashAltAmount = polydashAlt ? formatRawTokenAmount(polydashAlt.amount, 18) : null;

  /**
   * Pay 1¢ in two clicks: sign a message approving the amount (free — no
   * network fee, no transaction from your side), then the server checks the
   * signature, builds the report, and only then takes the payment. Mirrors
   * lib/x402/facilitator.ts verifyPayment exactly: EIP-3009
   * TransferWithAuthorization on the USDG contract, chain 4663.
   */
  async function pay() {
    if (!quote || !address) return;
    setPayState('signing');
    setPayError(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const validBefore = now + (quote.maxTimeoutSeconds || 120);
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = `0x${Array.from(nonceBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}` as `0x${string}`;
      const signature = await signTypedDataAsync({
        domain: {
          name: quote.extra?.name ?? 'Global Dollar',
          version: quote.extra?.version ?? '1',
          chainId: X402_CHAIN_ID,
          verifyingContract: USDG_ADDRESS,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: address,
          to: quote.payTo as `0x${string}`,
          value: BigInt(quote.amount),
          validAfter: 0n,
          validBefore: BigInt(validBefore),
          nonce,
        },
      });
      setPayState('paying');
      const payload = {
        x402Version: 2,
        accepted: quote,
        payload: {
          signature,
          authorization: {
            from: address,
            to: quote.payTo,
            value: quote.amount,
            validAfter: '0',
            validBefore: String(validBefore),
            nonce,
          },
        },
      };
      const res = await fetch(`/api/x402/products/${product.id}?${product.query}`, {
        headers: { 'X-PAYMENT': btoa(JSON.stringify(payload)) },
      });
      const text = await res.text();
      setStatus(res.status);
      try {
        setResult(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResult(text);
      }
      if (res.ok) {
        setPayState('done');
      } else {
        setPayState('error');
        setPayError(friendlyPayError(text));
      }
    } catch (e) {
      setPayState('error');
      setPayError(friendlyPayError(e instanceof Error ? e.message : 'Signing failed.'));
    }
  }

  const curl = `curl -i "https://polypad.family/api/x402/products/${product.id}?${product.query}"`;

  return (
    <section id="pay-per-call" className="scroll-mt-24 rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-4 sm:p-6">
      <p className={KICKER}>Step 3 · Pay per call</p>
      <h2 className={H2}>Buy a report for 1¢</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        Some reports cost a few cents. Ask first and the server tells you the price before you pay — no
        account, no card on file. The quote below is live: it reads the real price from the chain right
        now. Pay with your wallet in two clicks, or let your agent pay for itself.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {X402_PRODUCTS.map((p) => (
          <Button key={p.id} variant={productId === p.id ? 'default' : 'outline'} size="sm" onClick={() => { setProductId(p.id); setResult(null); setStatus(null); setQuote(null); setAccepts(null); setPayState('idle'); }}>
            {p.label} · {p.price}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-white/60">{product.note}</p>
      <div className="mt-3">
        <Button onClick={getQuote} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {busy ? 'Asking the server…' : 'Get the live quote'}
        </Button>
      </div>
      {status !== null && (
        <div className="mt-4">
          <p className="text-[13px] text-white/70">
            Server answered <span className="font-mono text-emerald-400">{status}</span>
            {status === 402 ? (
              <>
                {' '}— payment required. The price is{' '}
                <span className="font-medium text-white">{product.price}</span> (USDG, a digital dollar
                worth $1){polydashAltAmount ? `, or about ${polydashAltAmount} ${polydashAltLabel}` : ''}.
              </>
            ) : (
              ''
            )}
          </p>
          {result && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-white/50 hover:text-white/80">
                See the full quote (for developers)
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{result}</pre>
            </details>
          )}
        </div>
      )}
      {status === 402 && quote && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <p className="text-[14px] font-semibold text-white">Pay {product.price} and get the report</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/70">
            Your wallet asks you to sign a message approving {product.price} of USDG (a digital dollar
            worth $1). Signing is free — no network fee, and nothing moves until the report is built.
          </p>
          {!address ? (
            <div className="mt-3">
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <Button className="w-full bg-white text-black hover:bg-white/90" onClick={openConnectModal}>
                    Connect wallet to pay {product.price}
                  </Button>
                )}
              </ConnectButton.Custom>
              <p className="mt-2 text-[12px] leading-relaxed text-white/60">
                No wallet yet? The box at the top of this page walks through it in 3 steps.
              </p>
            </div>
          ) : usdgShort ? (
            <div className="mt-3">
              <p className="text-[13px] leading-relaxed text-white/75">
                Your wallet holds {usdgBalance != null ? `${(Number(usdgBalance) / 1e6).toFixed(2)} USDG` : 'no USDG'} —
                you need {product.price}. No USDG? Pay with Poly credits instead: $25 free for every wallet.
              </p>
              <Link href="/agents/credits" className="mt-2 inline-flex text-[13px] font-medium text-emerald-400 hover:underline">
                Get $25 free Poly credits →
              </Link>
            </div>
          ) : (
            <div className="mt-3">
              <Button
                className="w-full bg-white text-black hover:bg-white/90"
                onClick={() => void pay()}
                disabled={payState === 'signing' || payState === 'paying'}
              >
                {(payState === 'signing' || payState === 'paying') && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {payState === 'signing'
                  ? 'Waiting for your signature…'
                  : payState === 'paying'
                    ? 'Paying and building your report…'
                    : `Pay ${product.price} and get the report`}
              </Button>
              {payState === 'done' && (
                <p className="mt-2 text-[13px] text-emerald-400">Paid — your report is in the box above.</p>
              )}
              {payState === 'error' && payError && (
                <p className="mt-2 text-[13px] leading-relaxed text-red-300">
                  {payError}{' '}
                  <button className="font-medium text-emerald-400 hover:underline" onClick={() => void getQuote()}>
                    Get a fresh quote
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-4">
          <p className="text-[13px] leading-relaxed text-red-300">
            The request failed — {error} Check your connection and try again, or see{' '}
            <Link href="/status" className="text-emerald-400 hover:underline">/status</Link>.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={getQuote} disabled={busy}>
            Try again
          </Button>
        </div>
      )}
      <details className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
        <summary className="cursor-pointer text-[13px] font-medium text-white">Same request from your terminal</summary>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[13px] text-white/60">Copy the request and run it yourself.</p>
          <CopyButton text={curl} />
        </div>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{curl}</pre>
      </details>
      <p className="mt-4 text-[12px] leading-relaxed text-white/50">
        How paying works: your wallet signs a message approving the amount — that is free, no network
        fee. The server checks the signature, builds the report, and only then takes the payment. If
        the report cannot be built, nothing is charged. Developers: the same flow works from any
        agent — see <Link href="/x402" className="text-emerald-400 hover:underline">Pay per call →</Link>
      </p>
    </section>
  );
}

function CrossChainPlayground() {
  const quoteCurl = `curl -X POST "https://polypad.family/api/x402/cross-chain/quote" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://polypad.family/api/x402/products/fund-nav?fund=0x7c1d31629ac68aebe83f230edbc7eacfc26285ef", "from": "0x0E03f180C18352Cc96704242A88aA20578E3750E"}'`;
  const mcpCall = `{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "x402_cross_chain_pay",
    "arguments": {
      "url": "https://polypad.family/api/x402/products/fund-nav?fund=0x7c1d31629ac68aebe83f230edbc7eacfc26285ef",
      "from": "0x0E03f180C18352Cc96704242A88aA20578E3750E"
    }
  }
}`;
  return (
    <section id="pay-across-chains" className="scroll-mt-24 rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-4 sm:p-6">
      <p className={KICKER}>Pay across chains</p>
      <h2 className={H2}>Money on Base can pay on Robinhood Chain</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        An agent&apos;s money does not have to live on the same chain as the thing it is paying for. If your
        wallet holds USDC on Base and the report costs USDG on Robinhood Chain, Polypad moves just the
        missing amount across — nothing more — and then pays the normal 1¢ price. The same flow works in
        reverse. No new account, no escrow, no middleman holding your money: a Relay bridge plus the same
        pay-per-call flow as above.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-white/70">
        <li>Your agent asks for a quote for any x402 link — the quote says whether a bridge is needed and exactly what it costs.</li>
        <li>If money is on the other chain, the agent sends the bridge (approve + deposit) for the shortfall only. If it already holds enough where the payment lives, there is no bridge at all.</li>
        <li>The agent signs one message approving the exact price, and the report is built and paid for.</li>
      </ol>
      <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
        <p className="text-[14px] font-semibold text-white">Proved live, Nov 22, 2026 — Base → Robinhood Chain</p>
        <p className="mt-1 text-[13px] leading-relaxed text-white/70">
          A wallet holding USDC on Base paid the $0.01 Polyfund NAV report on Robinhood Chain. It bridged
          $0.04 USDC and received $0.0158 USDG, then paid $0.01 — the whole thing took seconds.
        </p>
        <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-white/70">
          <li>
            Bridge approve:{' '}
            <a className="font-mono text-[12px] text-emerald-400 hover:underline" href="https://basescan.org/tx/0xebbec00df7ff6c48bb795616ed397ce14e16d7815543e2c7fd7694e8c000b228" target="_blank" rel="noopener noreferrer">
              0xebbec0…b228 ↗
            </a>
          </li>
          <li>
            Bridge deposit:{' '}
            <a className="font-mono text-[12px] text-emerald-400 hover:underline" href="https://basescan.org/tx/0x8cf20d2a409eac874a9130095a9b2a09c389ba08e975fc5c49c91ba46171cdc7" target="_blank" rel="noopener noreferrer">
              0x8cf20d…cdc7 ↗
            </a>
          </li>
          <li>
            Payment on Robinhood Chain:{' '}
            <a className="font-mono text-[12px] text-emerald-400 hover:underline" href="https://robinhoodchain.blockscout.com/tx/0x2f3e1906bda9b160eccc882ace73cf4744a8d111fa28e2ea615ce199e8417913" target="_blank" rel="noopener noreferrer">
              0x2f3e19…7913 ↗
            </a>
          </li>
        </ul>
        <p className="mt-2 text-[12px] leading-relaxed text-white/50">
          Honest about the cost: moving $0.04 cost about $0.024 in bridge fees — more than the $0.01
          report. Bridging only makes sense above roughly $0.10, where the fee is a few percent. The
          quote always shows the fee before anything moves, so nothing is ever a surprise.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-white/50">
          The reverse direction (Robinhood Chain → Base) is the same flow. A live run is still pending:
          it needs a wallet holding USDG on Robinhood Chain that is not the fee wallet itself — the Base
          facilitator refuses a payment where the payer and the recipient are the same wallet.
        </p>
      </div>
      <details className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
        <summary className="cursor-pointer text-[13px] font-medium text-white">Try the quote from your terminal</summary>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[13px] text-white/60">Copy the quote request and run it yourself.</p>
          <CopyButton text={quoteCurl} />
        </div>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{quoteCurl}</pre>
      </details>
      <p className="mt-4 text-[12px] leading-relaxed text-white/50">
        For agents, the same flow is two MCP tools: <span className="font-mono text-white/80">x402_cross_chain_quote</span> (dry
        run, read-only) and <span className="font-mono text-white/80">x402_cross_chain_pay</span> (the plan
        plus the unsigned bridge transactions and the message to sign — Polypad never sees a private
        key). Both are in the <Link href="/docs/tools" className="text-emerald-400 hover:underline">tool reference →</Link>
      </p>
      <details className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
        <summary className="cursor-pointer text-[13px] font-medium text-white">The same call over MCP</summary>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[13px] text-white/60">The MCP version of the same quote.</p>
          <CopyButton text={mcpCall} />
        </div>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{mcpCall}</pre>
      </details>
    </section>
  );
}

function McpStatusDot() {
  const [state, setState] = useState<'checking' | 'ok' | 'slow' | 'down'>('checking');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const start = performance.now();
    fetch('https://polypad.family/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'polypad-build', version: '1.0.0' } },
      }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const ms = Math.round(performance.now() - start);
        const json = (await res.json().catch(() => null)) as { result?: { serverInfo?: { version?: string } } } | null;
        if (cancelled) return;
        const version = json?.result?.serverInfo?.version;
        if (res.ok && version) {
          setDetail(`API live · server v${version} · answered in ${ms} ms`);
          setState(ms > 5000 ? 'slow' : 'ok');
        } else {
          setDetail('API unreachable right now — see the status page.');
          setState('down');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail('API unreachable right now — see the status page.');
          setState('down');
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  const dot =
    state === 'ok' ? 'bg-emerald-400' : state === 'slow' ? 'bg-amber-400' : state === 'down' ? 'bg-red-500' : 'bg-white/40 animate-pulse';
  return (
    <p className="mt-3 flex items-center gap-2 text-[13px] text-white/70">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
      {state === 'checking' ? 'Checking the API…' : detail}{' '}
      <Link href="/status" className="text-emerald-400 hover:underline">Status →</Link>
    </p>
  );
}

function McpPlayground() {
  const [choice, setChoice] = useState<'list' | 'stats'>('list');
  const [result, setResult] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(next?: 'list' | 'stats') {
    const which = next ?? choice;
    setBusy(true);
    setResult(null);
    setStatus(null);
    setError(null);
    const body =
      which === 'list'
        ? { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
        : { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'polypad_stats', arguments: {} } };
    try {
      const res = await fetch('https://polypad.family/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setStatus(res.status);
      const text = await res.text();
      try {
        setResult(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResult(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="try-live" className="scroll-mt-24 rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-4 sm:p-6">
      <p className={KICKER}>Step 2 · Try it live</p>
      <h2 className={H2}>Try it live — no signup</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        This calls the real API from your browser and shows the raw answer. Reads only — this playground never
        prepares a transaction and never asks for a signature.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={choice === 'list' ? 'default' : 'outline'} size="sm" onClick={() => { setChoice('list'); void run('list'); }}>
          List the 27 tools
        </Button>
        <Button variant={choice === 'stats' ? 'default' : 'outline'} size="sm" onClick={() => { setChoice('stats'); void run('stats'); }}>
          Get live stats
        </Button>
      </div>
      <div className="mt-3">
        <Button onClick={() => void run()} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {busy ? 'Asking the API…' : 'Run it'}
        </Button>
      </div>
      {status !== null && (
        <div className="mt-4">
          <p className="text-[13px] text-white/70">
            Server answered <span className="font-mono text-emerald-400">{status}</span>
          </p>
          {result && (
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{result}</pre>
          )}
        </div>
      )}
      {error && (
        <div className="mt-4">
          <p className="text-[13px] leading-relaxed text-red-300">
            The request failed — {error} Check your connection and try again, or see{' '}
            <Link href="/status" className="text-emerald-400 hover:underline">/status</Link>.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void run()} disabled={busy}>
            Try again
          </Button>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-white/50">
        Every tool, with inputs and copy-paste examples: <Link href="/docs/tools" className="text-emerald-400 hover:underline">Tool reference →</Link>
        {' · '}
        <Link href="/docs/sign-loop" className="text-emerald-400 hover:underline">How signing works: prepare → sign → confirm →</Link>
      </p>
    </section>
  );
}

export function BuildContent() {
  const [host, setHost] = useState<(typeof CONNECT_HOSTS)[number]['label']>('Claude Code');
  const selectedHost = CONNECT_HOSTS.find((h) => h.label === host) ?? CONNECT_HOSTS[0];
  const hostSlug = selectedHost.command.trim().split(' ').pop() ?? 'claude';
  return (
    <div className="bg-black text-white">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className={HERO_GLOW} />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <p className={KICKER}>Build on Polypad · Robinhood Chain</p>
          <h1 className="mt-4 max-w-3xl text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
            Build on{' '}
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-500 bg-clip-text text-transparent">
              Polypad
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] sm:text-lg leading-relaxed text-white/70">
            Connect your AI assistant to Polypad in about 2 minutes — then just talk to it. It can check
            live tokenized funds, buy a 1¢ report, and launch a token, all in its own wallet, under limits
            you set.
          </p>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/60">
            No signup. No API key. No approval. Your agent signs in its own wallet — Polypad never holds
            your keys.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#connect" className={CTA_PRIMARY}>
              Connect your agent <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#try-live" className={CTA_OUTLINE}>
              Try it live — no signup
            </a>
          </div>
          <McpStatusDot />
          <StatTiles
            items={[
              { value: '27', label: 'MCP tools', note: 'Trade, launch, funds, NFTs, read & pay' },
              { value: '5', label: 'Agent skills', note: 'Installable skills for Claude Code' },
              { value: '~2 min', label: 'To connect', note: 'One command, no signup' },
              { value: '4663', label: 'Robinhood Chain', note: 'Fast, low-cost settlement' },
            ]}
          />
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-6 py-8 sm:py-12">
      <BeginnerStart />
      <GlossaryBox />

      {/* How it works — the flow diagram */}
      <section className={SECTION}>
        <SectionHead
          kicker="How it works"
          title="Visitor to on-chain, in three moves."
          sub="Your agent connects once, gets its own wallet with limits you set, and then does the work — you sign the big moves, it handles the rest."
        />
        <FlowDiagram
          layers={[
            {
              title: 'Connect your agent',
              body: 'One command, or paste the config. MCP, REST API, or x402 — whichever fits your stack.',
              pills: ['MCP', 'REST API', 'x402'],
              icon: <Plug className="mx-auto h-6 w-6 text-emerald-400" />,
            },
            {
              title: 'Agent wallet, with limits you set',
              body: 'Its own wallet. Spending caps, allowlist, and expiry — Polypad never holds your keys.',
              icon: <Wallet className="mx-auto h-6 w-6 text-emerald-400" />,
              emerald: true,
            },
            {
              title: 'Launch, invest, stake, pay per call',
              body: 'Tokens, tokenized funds, staking, and 1¢ reports — every action prepared, then signed.',
              pills: ['Launch a token', 'Invest in funds', 'Stake', 'Pay per call'],
              icon: <Rocket className="mx-auto h-6 w-6 text-emerald-400" />,
            },
          ]}
        />
      </section>

      <section id="connect" className="scroll-mt-24 rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-4 sm:p-6">
        <SectionHead
          kicker="Step 1 · Connect"
          title="Connect your agent in three steps"
        />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[15px] font-bold text-black">1</span>
            <h3 className="mt-3 text-[16px] font-semibold">Run one command</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
              Run one command in your terminal (the easiest start — see below), or paste the config if you prefer. (No client yet? Claude Code is a good first pick, and Grok also works from your browser.)
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[15px] font-bold text-black">2</span>
            <h3 className="mt-3 text-[16px] font-semibold">Ask your agent</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
              Ask your agent to do something — “What tokens launched today?” or “Start a tokenized fund for me.”
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[15px] font-bold text-black">3</span>
            <h3 className="mt-3 text-[16px] font-semibold">Sign it</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
              Your agent prepares the transaction; you — or its own wallet — sign it. Nothing moves without a signature. Human signing and an agent wallet signing are different: you tap approve in your wallet for each action, while an agent wallet signs on its own, inside the limits you set.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-white/60">
          You need Node 18+ for the one-command setup — check with <code className="font-mono text-[12px] text-white/80">node -v</code>; no Node? Use the paste-the-config option below.
        </p>
        <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <p className="text-[13px] font-medium text-white">
            One command — the recommended way{' '}
            <span className="ml-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              Recommended
            </span>
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            Run one command in your terminal and your editor or AI assistant is connected to Polypad. No
            account, no API key, no config file to edit — the free tier just works. Pick your app:
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CONNECT_HOSTS.map((h) => (
              <Button key={h.label} variant={host === h.label ? 'default' : 'outline'} size="sm" onClick={() => setHost(h.label)}>
                {h.label}
              </Button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <code className="overflow-x-auto font-mono text-[12px] text-white/80">{selectedHost.command}</code>
            <CopyButton text={selectedHost.command} />
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            Prefer to install it once and keep the command? Install it globally, then run{' '}
            <code className="font-mono text-[12px] text-white/80">polypad connect {hostSlug}</code> — the
            host name follows the picker above (claude, cursor, codex, gemini, or vscode).
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <code className="overflow-x-auto font-mono text-[12px] text-white/80">{CONNECT_GLOBAL_INSTALL}</code>
            <CopyButton text={CONNECT_GLOBAL_INSTALL} />
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            Want the higher Pro limits instead of the free tier? Add{' '}
            <code className="font-mono text-[12px] text-white/80">--key</code> with your Pro key at the end of
            the command. Pro is free while growing — get a key from{' '}
            <Link href="/agents/accounts" className="text-emerald-400 hover:underline">
              Agent Accounts
            </Link>
            .
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/60">
            What success looks like: the command prints a confirmation, and your editor or assistant shows the
            Polypad server connected — ask it “What tokens launched today?” and it answers from live data.
          </p>
        </div>
        <details className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
          <summary className="cursor-pointer text-[13px] font-medium text-white">More ways to connect (advanced)</summary>
          <div className="mt-3">
        <details className="rounded-xl border border-white/10 bg-black/40 p-4">
          <summary className="cursor-pointer text-[13px] font-medium text-white">Paste the config yourself (advanced)</summary>
          <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-white">MCP config</p>
            <CopyButton text={MCP_CONFIG} />
          </div>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{MCP_CONFIG}</pre>
          <p className="mt-2 text-[12px] text-white/50">
            Endpoint: <span className="font-mono text-emerald-400">https://polypad.family/api/mcp</span> · 27 tools · your agent signs in its own wallet
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/60">
            What success looks like: your client lists 27 tools starting with <span className="font-mono">polypad_</span> — ask it “What tokens launched today?” and it answers from live data.
          </p>
          <p className="mt-2 text-[12px] text-white/50">
            Works in: Grok (live) · Muse connector (live) · Server v2.0.0
          </p>
          </div>
        </details>
        <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <p className="text-[13px] font-medium text-white">One click, no config file</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            The buttons below add the Polypad server to your editor. Your editor asks before it adds
            anything — nothing is installed silently.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild>
              <a href={CURSOR_INSTALL_LINK}>Add to Cursor</a>
            </Button>
            <Button asChild variant="outline">
              <a href={VSCODE_INSTALL_LINK}>Install in VS Code</a>
            </Button>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-white/60">
            What success looks like: your editor asks before adding anything, then lists Polypad under its MCP servers.
          </p>
          <p className="mt-3 text-[13px] font-medium text-white">Claude Code — install the plugin</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            In a Claude Code session, add the marketplace once, then install the plugin. It connects the
            Polypad server and adds a skill that explains the 27 tools.
          </p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <code className="overflow-x-auto font-mono text-[12px] text-white/80">{CLAUDE_PLUGIN_ADD}</code>
              <CopyButton text={CLAUDE_PLUGIN_ADD} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="overflow-x-auto font-mono text-[12px] text-white/80">{CLAUDE_PLUGIN_INSTALL}</code>
              <CopyButton text={CLAUDE_PLUGIN_INSTALL} />
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-white/50">
            Plugin live — add the marketplace once, then install.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/60">
            What success looks like: <span className="font-mono">/plugin</span> lists polypad, and your agent can call the 27 tools.
          </p>
          <p className="mt-3 text-[13px] font-medium text-white">Prefer the terminal?</p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <code className="overflow-x-auto font-mono text-[12px] text-white/80">{CLAUDE_MCP_ADD}</code>
              <CopyButton text={CLAUDE_MCP_ADD} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="overflow-x-auto font-mono text-[12px] text-white/80">{CODEX_MCP_ADD}</code>
              <CopyButton text={CODEX_MCP_ADD} />
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-white/60">
            What success looks like: <span className="font-mono">claude mcp list</span> (or{' '}
            <span className="font-mono">codex mcp list</span>) shows polypad.
          </p>
        </div>
          </div>
        </details>
        <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <p className="text-[13px] font-medium text-white">First prompts — copy one and paste it to your agent</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            You do not need to know the tool names. Paste one of these into your agent once it is connected.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/60">
            What success looks like: your agent answers from live Polypad data — real tokens, real tokenized funds — not from memory.
          </p>
          <div className="mt-3 space-y-3">
            {FIRST_PROMPTS.map((p) => (
              <div key={p.label} className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-white">{p.label}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-white/60">“{p.prompt}”</p>
                </div>
                <CopyButton text={p.prompt} />
              </div>
            ))}
          </div>
        </div>
        <details className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <summary className="cursor-pointer text-[13px] font-medium text-white">See all 27 tools — what each one does</summary>
          <div className="mt-3 space-y-4">
          {MCP_TOOLS.map((g) => (
            <div key={g.group}>
              <h3 className="text-[13px] font-semibold text-white/85">{g.group}</h3>
              <div className="mt-1 space-y-1">
                {g.tools.map((t) => (
                  <p key={t.name} className="text-[13px] leading-relaxed text-white/60">
                    <span className="font-mono text-[12px] text-emerald-400">{t.name}</span>
                    <span className="text-white/35"> — </span>{t.what}
                  </p>
                ))}
              </div>
            </div>
          ))}
          </div>
        </details>
        <details className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <summary className="cursor-pointer text-[13px] font-medium text-white">Limits — how much you can do for free</summary>
          <div className="mt-3">

          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            Reads 120/min · prepares 30/min · prepares per wallet 12/min · intent 40/min. One action at most 25 ETH;
            above 1 ETH, confirm first. Request body at most 16 KB; batches of at most 10 messages.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/60">
            Pro — $0 while growing, with a free API key: reads 1,200/min · prepares 300/min · prepares per wallet
            120/min · intent 400/min. Same tools, same 25 ETH cap. Get a key from{' '}
            <Link href="/agents/accounts" className="text-emerald-400 hover:underline">Agent Accounts</Link>
            {' · '}
            <Link href="/pricing" className="text-emerald-400 hover:underline">Pricing →</Link>
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/60">
            <Link href="/docs/tools" className="text-emerald-400 hover:underline">Tool reference →</Link>
            {' · '}
            <Link href="/docs/rules" className="text-emerald-400 hover:underline">Rules of the road →</Link>
            {' · '}
            <Link href="/pricing" className="text-emerald-400 hover:underline">Pricing →</Link>
            {' · '}
            <Link href="/docs/sign-loop" className="text-emerald-400 hover:underline">Sign loop →</Link>
            {' · '}
            <Link href="/docs/sdks" className="text-emerald-400 hover:underline">SDKs →</Link>
            {' · '}
            <Link href="/changelog" className="text-emerald-400 hover:underline">Changelog →</Link>
            {' · '}
            <Link href="/status" className="text-emerald-400 hover:underline">Status →</Link>
          </p>
          </div>
        </details>
        <p className="mt-4 text-[12px] leading-relaxed text-white/50">
          The tools only read and prepare unsigned transactions. Polypad never holds your agent&apos;s keys.
          Prefer Telegram? The Mini App opens Polypad inside Telegram:{' '}
          <a className="text-emerald-400" href="https://t.me/Aipolyagent_Bot/Polypad" target="_blank" rel="noopener noreferrer">t.me/Aipolyagent_Bot/Polypad</a>
        </p>
      </section>

      <McpPlayground />

      <Playground />

      <CrossChainPlayground />

      <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-4 sm:p-6">
        <SectionHead
          kicker="The sign loop"
          title="Prepare → sign → confirm"
          sub="An action is not done when it is prepared, and not done when it is signed — it is done when the agent knows the result. The agent prepares, you sign on the signing page, and the page watches the transaction until Robinhood Chain confirms it. Pass a returnUrl with any prepare call and the page shows a button back to your agent's flow after confirmation, with the transaction hash and status attached."
        />
        <p className="mt-3 text-[13px] leading-relaxed text-white/60">
          <Link href="/docs/sign-loop" className="text-emerald-400 hover:underline">How the sign loop works →</Link>
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Link href="/docs/sdks" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">SDKs: TypeScript + Python →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Typed clients with the prepare → sign → confirm helper and connect-once wallet binding.</p>
          </Link>
          <Link href="/docs/langchain" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">LangChain guide →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Connect with the MCP adapter; live in 5 minutes.</p>
          </Link>
          <Link href="/docs/vercel-ai-sdk" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">Vercel AI SDK guide →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Connect with the MCP client; live in 5 minutes.</p>
          </Link>
          <Link href="/docs/case-studies" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">Case studies →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Forge launched SWARM on its own for ~0.00109 ETH. Works in Grok and Muse.</p>
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-4 sm:p-6">
        <SectionHead
          kicker="Step 4 · Agent accounts"
          title="Give your agent an account"
          sub="An agent that can spend needs an identity people can check, money with limits, and a way to prove it. Polypad has all three — built for agents, not bolted on."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Link href="/agents/accounts" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">Agent Accounts →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Identity, vault balance, spending keys, and connection — one page.</p>
          </Link>
          <Link href="/agents/scores" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">Agent Credit Scores →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">A 300–850 reputation score for agents, from on-chain behavior only.</p>
          </Link>
          <Link href="/x402" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">Pay-per-call marketplace →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Priced reports and data, settled on-chain in USDG or POLYDASH.</p>
          </Link>
          <Link href="/terminal" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">Terminal →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Every live tokenized fund ranked by NAV per share, plus live activity.</p>
          </Link>
          <Link href="/build/partnerships" className="rounded-xl border border-white/10 bg-black/40 p-4 hover:border-emerald-500/30 hover:bg-emerald-500/[0.06]">
            <p className="text-[14px] font-medium text-white">Partnerships →</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">Build on Polypad: integrations, staking, NFT launches, growth funds — plus free compute for strategic partners.</p>
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/docs">Docs</Link></Button>
          <Button asChild variant="outline"><Link href="/funds">Tokenized Funds</Link></Button>
          <Button asChild variant="outline"><Link href="/contracts">Contracts</Link></Button>
        </div>
      </section>
      </div>
    </div>
  );
}
