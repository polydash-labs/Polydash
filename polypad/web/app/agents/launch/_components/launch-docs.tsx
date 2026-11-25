import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, KeyRound, ShieldCheck, Gauge, FileText } from 'lucide-react';
import { CHAIN_ID, LIMITS, OPERATOR_TERMS, TERMS_VERSION } from '@/lib/agents-api/terms';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { CodeBlock } from './code-block';

const FACTORY = '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2';
const SOURCIFY = `https://repo.sourcify.dev/${CHAIN_ID}/${FACTORY}`;
const BASE = 'https://polypad.family/api/agents/v1';
const card = 'rounded-2xl border border-white/10 bg-white/[0.03]';

const ENDPOINTS: { method: string; path: string; auth: boolean; desc: string; returns: string }[] = [
  { method: 'POST', path: '/keys', auth: false, desc: 'Get an operator API key. Body: { agentName, operatorUrl, acceptTerms: true, termsVersion }. The key is shown once; only its hash is stored.', returns: '{ apiKey, keyId, termsVersion }' },
  { method: 'POST', path: '/metadata', auth: true, desc: 'Host a token image. multipart/form-data, field "file": PNG, JPG or WEBP, max 1 MB.', returns: '{ imageUri }' },
  { method: 'POST', path: '/launch/build', auth: true, desc: 'Validate parameters, simulate createLaunch with eth_call from your wallet, and return an unsigned transaction. The first call from a wallet must include acceptTerms: true and termsVersion.', returns: '{ to, data, value, chainId: 4663, gasEstimate, buildId, termsVersion }' },
  { method: 'POST', path: '/launch/register', auth: true, desc: 'After your wallet sends the transaction: { buildId, txHash }. Checks the receipt and the transaction against the build, decodes LaunchCreated and marks the token Agent-launched. Returns 202 while pending.', returns: '{ status, launchAddress, tokenAddress, agentLaunched }' },
  { method: 'GET', path: '/launch/:txHash', auth: false, desc: 'Status of a launch transaction: pending, success, reverted or not_found.', returns: '{ status, launchAddress, tokenAddress, agentLaunched }' },
  { method: 'GET', path: '/token/:address', auth: false, desc: 'Token state by launch or token address.', returns: '{ name, symbol, phase, curveProgress, ..., agentLaunched }' },
];

const PARAMS: [string, string][] = [
  ['from', 'Wallet that will sign and send. Simulation runs from this address.'],
  ['name, symbol', 'Required, non-empty (symbol max 16 characters).'],
  ['description', 'Optional plain text, max 1000 characters. HTML and hidden characters are removed.'],
  ['imageUri', 'Optional https:// or ipfs:// URL. Use /metadata to host one.'],
  ['socialLinks', 'Optional, at most 10 http(s) URLs.'],
  ['creatorFeeBps', '0 to 500 (0 to 5%).'],
  ['creatorPayoutWallet', 'Optional address; zero address uses the default.'],
  ['devBuyEth', 'Wei as a decimal string. value must equal devBuyEth.'],
  ['totalSupply', '0 (default) or 1e24 to 1e30 wei.'],
  ['virtualEthReserve', '0 (default) or 0.01 to 1000 ETH, in wei.'],
  ['launchDelay', 'Seconds, at most 30 days (2592000).'],
];

const TS_EXAMPLE = `import { createPublicClient, createWalletClient, defineChain, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const API = '${BASE}';
const API_KEY = process.env.POLYPAD_API_KEY!; // operator key from POST /keys

// Your key stays on your machine. Polypad never sees it.
const account = privateKeyToAccount(process.env.AGENT_WALLET_KEY as \`0x\${string}\`);

const robinhood = defineChain({
  id: ${CHAIN_ID},
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
});
const wallet = createWalletClient({ account, chain: robinhood, transport: http() });
const client = createPublicClient({ chain: robinhood, transport: http() });

const post = async (path: string, body: unknown) => {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status >= 400) throw new Error(\`\${res.status} \${json.error}: \${json.message}\`);
  return json;
};

// 1. Build: Polypad validates, simulates from your wallet and returns an unsigned tx.
const devBuy = parseEther('0.001');
const tx = await post('/launch/build', {
  from: account.address,
  acceptTerms: true,           // needed on the first call from this wallet
  termsVersion: '${TERMS_VERSION}',
  params: {
    name: 'Example Token',
    symbol: 'EXMPL',
    description: 'Launched by my agent.',
    imageUri: '',              // or the imageUri from POST /metadata
    socialLinks: ['https://example.com'],
    creatorFeeBps: 100,        // 1%
    devBuyEth: devBuy.toString(),
    totalSupply: '0',          // 0 = default
    virtualEthReserve: '0',    // 0 = default
    launchDelay: 86400,        // 1 day commitment window
  },
  value: devBuy.toString(),
});

// 2. Sign and send with your own wallet.
const hash = await wallet.sendTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
  gas: (BigInt(tx.gasEstimate) * 12n) / 10n,
});
await client.waitForTransactionReceipt({ hash });

// 3. Register, so the token is labelled Agent-launched.
const launch = await post('/launch/register', { buildId: tx.buildId, txHash: hash });
console.log(launch.launchAddress, launch.tokenAddress);`;

const KEY_EXAMPLE = `curl -X POST ${BASE}/keys \\
  -H 'content-type: application/json' \\
  -d '{"agentName":"My Agent","operatorUrl":"https://example.com","acceptTerms":true,"termsVersion":"${TERMS_VERSION}"}'`;

const MCP_EXAMPLE = `{
  "mcpServers": {
    "polypad": {
      "url": "https://polypad.family/api/mcp"
    }
  }
}`;

const ERRORS_EXAMPLE = `HTTP 429
{
  "error": "rate_limited",
  "message": "Limit reached: 3 builds per wallet per 24 hours.",
  "scope": "wallet", "limit": 3, "window": "24h", "retryAfter": 51234
}`;

function Section({ id, icon: Icon, title, children }: { id: string; icon?: typeof KeyRound; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
        {Icon && <Icon className="h-4 w-4 text-white/60" strokeWidth={1.75} aria-hidden />}
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-white/65">{children}</div>
    </section>
  );
}

export function LaunchDocs() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <Link href="/agents" className="inline-flex h-10 items-center gap-1 text-[13px] text-white/60 transition-colors hover:text-white sm:h-auto">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} /> Polypad AI Agents
      </Link>
      <h1 className="mt-3 text-[clamp(28px,5vw,40px)] font-semibold tracking-tight">Launch with your agent</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/65">
        Polydash&apos;s own agents are non-custodial, and outside agents can launch through Polypad. Polypad never holds your keys.
      </p>

      <div className="mt-10 space-y-12">
        <Section id="non-custodial" icon={ShieldCheck} title="How it works">
          <p>
            Every endpoint returns an unsigned transaction or read-only data. Your agent signs and sends with its own wallet, so Polypad never holds, requests or stores private keys or seed phrases.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-white/75">
            <li>Build: send the launch parameters. Polypad validates them and simulates createLaunch with eth_call from your wallet.</li>
            <li>Sign and send: your wallet sends the returned to, data and value to the factory on Robinhood Chain ({CHAIN_ID}).</li>
            <li>Register: send the buildId and txHash. Polypad checks the receipt and marks the token Agent-launched.</li>
          </ol>
          <p>Agent-launched tokens carry a label on Polypad and appear under the Agent-launched filter on the launch list, not in the default view.</p>
        </Section>

        <Section id="contract" title="Factory contract">
          <div className={`${card} space-y-2 p-4`}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[12px] text-white/55">PolydashFactory on Robinhood Chain ({CHAIN_ID})</span>
              <div className="flex gap-3 text-[12px]">
                <a href={SOURCIFY} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-polydash-green hover:text-polydash-green-light">Sourcify <ArrowUpRight className="h-3 w-3" /></a>
                <a href={getExplorerAddressUrl(FACTORY)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-white/70 hover:text-white">Explorer <ArrowUpRight className="h-3 w-3" /></a>
              </div>
            </div>
            <p className="break-all font-mono text-[13px] text-white/85">{FACTORY}</p>
          </div>
          <p>createLaunch(LaunchParams) is permissionless and payable; msg.value must equal devBuyEth.</p>
        </Section>

        <Section id="endpoints" icon={FileText} title="Endpoints">
          <p>Base URL <span className="break-all font-mono text-[13px] text-white/85">{BASE}</span>. Authenticated calls send the key in the <span className="font-mono text-[13px] text-white/85">x-api-key</span> header. Amounts are wei as decimal strings.</p>
          <div className="space-y-2">
            {ENDPOINTS.map((e) => (
              <div key={e.path} className={`${card} p-4`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white/85">{e.method}</span>
                  <span className="font-mono text-[13px] text-white">{e.path}</span>
                  {e.auth && <span className="inline-flex items-center gap-1 text-[11px] text-white/55"><KeyRound className="h-3 w-3" strokeWidth={1.75} /> API key</span>}
                </div>
                <p className="mt-2 text-[13px] text-white/65">{e.desc}</p>
                <p className="mt-1 break-words font-mono text-[12px] text-white/55">{e.returns}</p>
              </div>
            ))}
          </div>
          <h3 className="pt-2 text-[14px] font-semibold text-white">Build parameters</h3>
          <div className={`${card} divide-y divide-white/[0.06]`}>
            {PARAMS.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                <span className="font-mono text-[12px] text-white/85">{k}</span>
                <span className="text-[13px] text-white/60">{v}</span>
              </div>
            ))}
          </div>
          <CodeBlock label="Get an API key" code={KEY_EXAMPLE} />
        </Section>

        <Section id="example" title="TypeScript example (viem)">
          <p>Build, sign with your own wallet, send, register.</p>
          <CodeBlock label="agent-launch.ts" code={TS_EXAMPLE} />
        </Section>

        <Section id="mcp" title="MCP server">
          <p>
            The same tools for MCP clients — live now, with the same config as on{' '}
            <Link href="/build" className="text-polydash-green hover:underline">/build</Link>. No API key
            needed on the free tier; add an <span className="font-mono text-[13px] text-white/85">x-api-key</span> header
            with a Pro key for the higher limits.
          </p>
          <CodeBlock label="mcp.json" code={MCP_EXAMPLE} />
          <p>
            Every tool, with inputs and copy-paste examples, is in the{' '}
            <Link href="/docs/tools" className="text-polydash-green hover:underline">tool reference</Link>.
          </p>
        </Section>

        <Section id="limits" icon={Gauge} title="Rate limits">
          <ul className="space-y-1.5 text-white/75">
            <li>{LIMITS.walletBuilds} builds per wallet per 24 hours.</li>
            <li>{LIMITS.keyBuilds} builds per API key per 24 hours.</li>
            <li>{LIMITS.keysPerIp} new API keys per network address per 24 hours.</li>
          </ul>
          <p>Over the limit, the API answers HTTP 429 with a Retry-After header:</p>
          <CodeBlock label="429 response" code={ERRORS_EXAMPLE} />
        </Section>

        <Section id="terms" title={`Operator terms (version ${TERMS_VERSION})`}>
          <p>The first call from each wallet and each API key must include <span className="font-mono text-[13px] text-white/85">&quot;acceptTerms&quot;: true</span> and <span className="font-mono text-[13px] text-white/85">&quot;termsVersion&quot;: &quot;{TERMS_VERSION}&quot;</span>. Acceptance is stored.</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-white/75">
            {OPERATOR_TERMS.map((t) => <li key={t}>{t}</li>)}
          </ol>
        </Section>
      </div>

      <p className="mt-12 border-t border-white/10 pt-5 text-[12px] text-white/55">Not financial advice. Scans are not audits.</p>
    </div>
  );
}
