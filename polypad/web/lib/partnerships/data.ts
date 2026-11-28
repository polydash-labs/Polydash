// Partnerships page content — single source of truth for the page AND the
// downloadable catalog PDF. Every number here is a verified fact (Nov 26,
// 2026). Do not add stats, partners, or promises without verifying them
// first. No partner names or logos exist to list — there are no confirmed
// partners. No returns, yields, or dividends are promised anywhere.

export const PARTNER_EMAIL = 'jon@dasheco.xyz';
export const SITE_URL = 'https://polypad.family';
export const PARTNERSHIPS_URL = 'https://polypad.family/build/partnerships';
export const MCP_ENDPOINT = 'https://polypad.family/api/mcp';

export const HERO = {
  title: 'Partner with Polypad',
  valueProp:
    'Build your product on the agentic marketplace for Robinhood Chain. Agent wallets, tokenized funds, token launches, staking, and pay-per-call tools — ready to integrate, in plain language, with no custody: you sign everything.',
};

export const NUMBERS = [
  { value: '25', label: 'MCP tools', note: 'plus 5 agent skills' },
  { value: '43', label: 'Tokens buyable in funds', note: 'graduated launches, Robinhood Chain' },
  { value: '11', label: 'Fund strategy templates', note: 'LP-dividend, yield, momentum and more' },
  { value: '$0.20', label: 'Settled via x402', note: '12 pay-per-call payments so far' },
];

export const WHY_PARTNER = [
  {
    title: 'Built for agents, not bolted on',
    body: 'Every tool was designed for software that acts on its own: prepare a transaction, show a plain summary, sign, confirm. Your product gets agent-ready infrastructure on day one instead of building it over months.',
  },
  {
    title: 'Non-custodial by design',
    body: 'Polypad never holds private keys or seed phrases. Every action returns an unsigned transaction and a signing link — the spend only happens when a human signs in their own wallet.',
  },
  {
    title: 'Live on Robinhood Chain today',
    body: 'Wallets, tokenized funds, launches, staking, NFTs, and pay-per-call products are already running on chain 4663. Partners integrate with what exists, not a roadmap.',
  },
  {
    title: 'One integration, every tool',
    body: 'Connect once through the API, SDK, or MCP and your product can launch tokens, run funds, stake, mint NFTs, and sell data per call — without a separate integration for each one.',
  },
];

export const OFFERINGS = [
  {
    title: 'Token launches',
    body: 'Launch a token with a bonding curve, holder protections, and a creator bond — without writing or deploying a contract yourself.',
    route: 'API · SDK · MCP',
  },
  {
    title: 'Staking integrations',
    body: 'Plug your token or your community into Polypad staking, with rewards and a live pool page your users can check.',
    route: 'API · Site',
  },
  {
    title: 'NFT launches',
    body: 'Launch an NFT collection — fixed price or bonding curve — with marketplace buys and relayer minting built in.',
    route: 'API · SDK · MCP',
  },
  {
    title: 'Growth-fund partnerships',
    body: 'Launch a tokenized fund for your community: NFT shares, a locked public mandate, and LP fees plus staking rewards flowing to holders.',
    route: 'API · MCP',
  },
  {
    title: 'Custom builds',
    body: 'A build shaped around your product — a new tool, a new fund strategy, or a full integration your team designs with ours.',
    route: 'Direct',
  },
  {
    title: 'API, SDK & MCP access',
    body: 'REST API v2 with Pro keys and a usage dashboard, the polypad-agent SDK (TypeScript + Python, v2.0.1), and an MCP server with 25 tools and 5 agent skills.',
    route: 'API · SDK · MCP',
  },
  {
    title: 'AI agent tools',
    body: 'Everything an agent needs to act on-chain: Safe-based wallets with spending caps and session keys, an on-chain identity and credit score, and 25 MCP tools with 5 guided skills.',
    route: 'MCP · SDK · API',
  },
  {
    title: 'Pay-per-call products (x402)',
    body: 'Turn your API or your data into a product that charges per call — token reports $0.01, fund NAV $0.01, CTO reports $0.05 — settled on-chain.',
    route: 'API · x402',
  },
  {
    title: 'Free compute for strategic partners',
    body: 'Strategic partners get free compute to build and run on Polypad. Apply below and tell us what you are building.',
    route: 'Strategic',
  },
];

export const INTEGRATION_PATHS = [
  {
    name: 'REST API',
    tag: 'For any stack',
    steps: [
      'Get a Pro key — one key per project, with a usage dashboard.',
      'Call the v2 endpoints: launch, trade, funds, NFTs, portfolio.',
      'Every write returns an unsigned transaction — your user signs it.',
    ],
    code: 'curl https://polypad.family/api/v2/funds \\\n  -H "Authorization: Bearer YOUR_KEY"',
    codeLabel: 'List live tokenized funds',
  },
  {
    name: 'SDK',
    tag: 'TypeScript + Python',
    steps: [
      'Install polypad-agent (v2.0.1) from npm or PyPI.',
      'Run one command to connect your agent — no config file.',
      'Use typed clients with a prepare, sign, and confirm helper.',
    ],
    code: 'npm install polypad-agent\nnpx -y polypad-agent connect claude',
    codeLabel: 'Install and connect in two commands',
  },
  {
    name: 'MCP',
    tag: 'For AI agents',
    steps: [
      'Point your agent host at one URL — no install, no key, no approval.',
      '25 tools and 5 skills: launch, trade, funds, NFTs, x402.',
      'Add a skill and your agent follows the workflow with human approval before any spend.',
    ],
    code: '{\n  "mcpServers": {\n    "polypad": {\n      "url": "https://polypad.family/api/mcp"\n    }\n  }\n}',
    codeLabel: 'One config block — Claude, Cursor, Codex',
  },
];

// Capabilities checklist — modeled on the "Polydash — AI Agent
// Infrastructure for Robinhood Chain" reference. Corrections applied:
// 25 tools + 5 skills (not 21); no total feature count; the 15-agent swarm
// is marked Built — not live; ERC-8021 is Polypad's own on-chain
// attribution tagging (lib/erc8021.ts); "Score-based spending tiers" was
// not in the code, so it reads as the verified free/Pro tiers.
export type ChecklistRow = {
  label: string;
  detail: string;
  route: string;
  live: boolean;
};

export const CAPABILITIES: { group: string; rows: ChecklistRow[] }[] = [
  {
    group: 'Launch & Trade',
    rows: [
      { label: 'Token launch API for agents', detail: 'Launch a token from an API call — no contract code.', route: 'MCP', live: true },
      { label: 'Agent-launched badge', detail: 'Tokens launched by an agent carry the badge on-chain.', route: 'On-chain', live: true },
      { label: 'Bonding-curve quotes', detail: 'Price a buy or sell before anyone signs it.', route: 'MCP', live: true },
      { label: 'Buy / sell preparation', detail: 'Unsigned buy and sell transactions, ready to sign.', route: 'MCP', live: true },
      { label: 'NFT mint & marketplace buys', detail: 'Mint a collection and buy listings from one flow.', route: 'MCP', live: true },
    ],
  },
  {
    group: 'Identity & Accounts',
    rows: [
      { label: 'Agent wallet creation (session keys)', detail: 'Safe-based wallets with keys that act inside limits.', route: 'API · MCP', live: true },
      { label: 'Agent registry', detail: 'Every agent gets an on-chain identity people can check.', route: 'On-chain', live: true },
      { label: 'Agent Credit Score 300–850', detail: 'A reputation score from on-chain behavior only.', route: 'API', live: true },
      { label: 'Agent Accounts vault', detail: 'One place for an agent’s identity, balance, and keys.', route: 'Site · API', live: true },
      { label: 'Spending keys: per-payment & daily limits', detail: 'Caps your agent cannot exceed, written into the contract.', route: 'On-chain', live: true },
      { label: 'One-transaction revoke', detail: 'Kill a spending key in a single transaction.', route: 'On-chain', live: true },
    ],
  },
  {
    group: 'Tools & API',
    rows: [
      { label: 'MCP server · 25 tools + 5 skills', detail: 'The full toolset, over one URL, with guided skills.', route: 'MCP', live: true },
      { label: 'REST API v2', detail: 'Every tool, over HTTPS, with Pro keys and metering.', route: 'API', live: true },
      { label: 'Plain-language intent tool', detail: 'Tell the agent what you want in words — it picks the tools.', route: 'MCP', live: true },
      { label: 'SDK: polypad-agent (TS + Python)', detail: 'Typed clients, v2.0.1 on npm and PyPI.', route: 'SDK', live: true },
      { label: 'One-command connect', detail: 'polypad-agent connect wires up Claude, Cursor, Codex, and more.', route: 'SDK', live: true },
      { label: 'Pro keys + usage dashboard', detail: 'One key per project, 10× the free limits, usage you can see.', route: 'API', live: true },
    ],
  },
  {
    group: 'Machine Payments',
    rows: [
      { label: 'x402 pay-per-call on Robinhood Chain', detail: 'Charge per API call, settled on-chain in USDG.', route: 'API · x402', live: true },
      { label: 'Paid data products', detail: 'Token reports, fund NAV, and CTO reports from $0.01.', route: 'x402', live: true },
      { label: 'Free & Pro tiers — Pro keys get 10× the limits', detail: 'Free tier for trying; Pro keys for production volume.', route: 'API', live: true },
      { label: 'Poly credits', detail: 'Prepaid credits for API calls — $25 gets 2,500 credits.', route: 'Site · API', live: true },
    ],
  },
  {
    group: 'Tokenized Funds',
    rows: [
      { label: 'Create funds via API', detail: 'Launch a tokenized fund from one API call.', route: 'API · MCP', live: true },
      { label: 'Mint & redeem shares', detail: 'NFT shares in, NFT shares out — with a locked public mandate.', route: 'MCP', live: true },
      { label: 'Strategy templates', detail: '11 templates: LP-dividend, yield, momentum, and more.', route: 'API · MCP', live: true },
      { label: 'Fund discovery & detail', detail: 'List every fund, read its NAV, assets, and mandate.', route: 'MCP', live: true },
    ],
  },
  {
    group: 'Trust & Transparency',
    rows: [
      { label: 'Non-custodial by design', detail: 'Polypad never holds keys. You sign everything.', route: 'All', live: true },
      { label: 'Simulation before signing', detail: 'See exactly what a transaction does before you sign it.', route: 'Site', live: true },
      { label: 'Per-action guardrails', detail: 'Caps, allowlists, and expiry on every agent action.', route: 'On-chain', live: true },
      { label: 'Token protections read', detail: 'Check a token’s taxes, ownership, and risks before buying.', route: 'MCP', live: true },
      { label: 'Holder Protections badge', detail: 'A public badge for tokens that pass the checks.', route: 'On-chain', live: true },
      { label: 'Creator bonds', detail: 'Creators stake a bond behind their launch.', route: 'On-chain', live: true },
      { label: 'On-chain attribution (ERC-8021)', detail: 'Builder codes stamped into transactions, readable on-chain.', route: 'On-chain', live: true },
      { label: 'Transaction status reads', detail: 'Ask for any transaction’s status and get the answer.', route: 'MCP', live: true },
    ],
  },
  {
    group: 'Orchestration',
    rows: [
      { label: 'Open-source agents on Swarms', detail: 'Agents that trade, scout, and report — built on the open Swarms framework.', route: 'SDK', live: true },
      { label: 'Scripted 15-agent swarm', detail: 'A coordinated multi-agent swarm — built, not live yet.', route: '—', live: false },
    ],
  },
];

export const BETTER = [
  {
    title: 'Ship without building chain infrastructure',
    before: 'Months wiring up wallets, contracts, and indexing before your first user.',
    after: 'Launch tokens and tokenized funds through one API. Polypad runs the chain layer underneath.',
  },
  {
    title: 'Automation that can’t drain you',
    before: 'An agent holding a key can spend everything — one bad prompt empties the account.',
    after: 'Capped agent wallets: daily caps, an allowlist, an expiry, and an owner freeze. The cap is written into the contract, so the chain itself says no.',
  },
  {
    title: 'Trust your users can check',
    before: 'Users have to take your word that a launch is safe.',
    after: 'Holder protections, creator bonds, and an agent credit score — all readable on-chain, all visible on the token’s page.',
  },
  {
    title: 'Turn your API into a product',
    before: 'Your data and tools are given away for free.',
    after: 'x402 pay-per-call charges per request and settles on-chain — from $0.01 a call. Your API becomes a revenue line.',
  },
  {
    title: 'Lower cost to integrate',
    before: 'Integration means paid infrastructure and engineering time.',
    after: 'Poly credits and free compute for strategic partners cut the cost of getting started to near zero.',
  },
  {
    title: 'Turn your community into shareholders',
    before: 'A community that watches from the sidelines.',
    after: 'A tokenized fund lets your community mint NFT shares. The fund’s LP fees and staking rewards flow to holders — your community owns a piece of what it builds.',
  },
];

export const PARTNERSHIP_TYPES = [
  {
    name: 'Integration',
    tagline: 'Connect your app or agent to Polypad.',
    includes: [
      'Full API, SDK, and MCP access',
      'Pro keys with a usage dashboard',
      'Integration support from our team',
      'Listed in the partner catalog',
    ],
    bestFor: 'Apps, agents, and tools that want Polypad’s wallets, funds, and launches inside their own product.',
  },
  {
    name: 'Staking',
    tagline: 'Plug your token or community into staking.',
    includes: [
      'Staking pool setup for your token',
      'Rewards flow your users can follow',
      'Live pool page on polypad.family',
      'API, SDK, and MCP access',
    ],
    bestFor: 'Token projects and communities that want staking live without building it.',
  },
  {
    name: 'NFT launch',
    tagline: 'Launch a collection with a marketplace from day one.',
    includes: [
      'Fixed-price or bonding-curve launch',
      'Marketplace buys from launch day',
      'Relayer minting for your users',
      'API, SDK, and MCP access',
    ],
    bestFor: 'Creators, games, and brands launching NFTs with real distribution.',
  },
  {
    name: 'Growth fund',
    tagline: 'Launch a tokenized fund for your community.',
    includes: [
      'Fund creation from a strategy template',
      'NFT shares with a locked public mandate',
      'Mint and redeem flow, live on-site',
      'API, SDK, and MCP access',
    ],
    bestFor: 'Projects that want their community to hold shares in a fund, not just a token.',
  },
  {
    name: 'Strategic',
    tagline: 'A deep partnership — custom builds, together.',
    includes: [
      'Everything in the other partnership types',
      'Custom builds designed with our team',
      'Free compute for strategic partners',
      'Dedicated support and co-marketing',
    ],
    bestFor: 'Teams building something big on the agentic stack, long-term.',
  },
];

// Comparison grid: which partnership type includes what. Keep honest:
// free compute is a Strategic-partner benefit only.
export const COMPARISON_ROWS: { feature: string; values: (boolean | string)[] }[] = [
  { feature: 'API, SDK & MCP access', values: [true, true, true, true, true] },
  { feature: 'Pro keys + usage dashboard', values: [true, true, true, true, true] },
  { feature: 'Token launches', values: [true, true, true, true, true] },
  { feature: 'Staking integration', values: ['Add-on', true, 'Add-on', 'Add-on', true] },
  { feature: 'NFT launches', values: ['Add-on', 'Add-on', true, 'Add-on', true] },
  { feature: 'Growth-fund partnership', values: ['Add-on', 'Add-on', 'Add-on', true, true] },
  { feature: 'Custom builds', values: [false, false, false, false, true] },
  { feature: 'Dedicated support', values: [false, false, false, false, true] },
  { feature: 'Free compute', values: [false, false, false, false, true] },
];

export const PROCESS = [
  {
    step: 'Request',
    body: 'Tell us about your project in the form below. We read every request.',
  },
  {
    step: 'Intro call',
    body: 'A short call to understand what you are building and which integration fits.',
  },
  {
    step: 'Integrate',
    body: 'Connect in minutes with MCP, or work with us on a deeper custom integration.',
  },
  {
    step: 'Launch',
    body: 'Ship to your users with Polypad running the chain layer underneath.',
  },
  {
    step: 'Grow',
    body: 'Keep building — new tools, funds, and launches as your project grows.',
  },
];

export const PARTNERSHIP_TYPE_OPTIONS = [
  'Integration',
  'Staking',
  'NFT launch',
  'Growth fund',
  'Strategic',
  'Other',
] as const;

export const FINE_PRINT =
  'Polypad’s contracts are internally reviewed; they have not had a third-party audit. Nothing on this page promises returns, yields, or dividends. Tokenized funds carry risk — read a fund’s locked mandate before minting a share.';
