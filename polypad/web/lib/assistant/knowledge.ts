/**
 * Poly Agent knowledge — the on-site assistant's reference material.
 *
 * Every address below was verified against this repo (constants files,
 * the /contracts page data, ABIs, lib/fund, lib/agent-wallet, lib/x402).
 * Anything that could NOT be verified in the repo was left out on purpose
 * — Poly Agent points at /contracts or the relevant docs page instead.
 * Live numbers (prices, NAV, APRs, volumes) are NEVER in this file: they
 * go stale. Poly Agent links to the page that shows the live number.
 */

/** Verified page directory. Only paths that exist in app/ are listed. */
export const SITE_MAP = `
- / — Homepage. The marketplace: Explore section with live tokens, the four doors (agent wallet, tokenized fund share, token launch, agent API), and the Polyfund card.
- /start — "Pick what you want to do" — the starting guide for new visitors.
- /about — About Polypad.
- /funds — Browse tokenized funds. /funds/create — Create your tokenized fund. /funds/[address] — one fund's page (thesis, proposals, countdown, mint/exit).
- /agents — Agents overview. /agents/create — Create an agent. /agents/wallets — Agent wallets (create and manage). /agents/wallets/new — New agent wallet. /agents/accounts — Agent accounts. /agents/scores — Agent credit scores. /agents/security — Security for AI agents. /agents/launch — Launch an agent. /agents/usage — Agent API usage.
- /stake — Staking pools (live APR, staked totals, pool end dates).
- /create — Launch a token. /token/[address] — one token's page. /terminal — Terminal (trading terminal). /pulse — Live usage.
- /nfts — NFTs. /nfts/create — Create an NFT collection. /nfts/stake — NFT staking.
- /build — API + SDK for developers (build with the agent API). /docs/sdks — SDK docs. /docs — Docs.
- /inference — AI inference marketplace (pay-per-call reports). /x402 — x402 pay-per-call products. /leaderboard — Leaderboard.
- /contracts — Every core contract address, with Sourcify verification status.
- /audits — Audit reports, including the agent-wallets v2 Phase 4 review.
- /pricing — Pricing.
`;

/** Technical reference. Plain facts only — no prices, APRs, or volumes. */
export const TECHNICAL_REFERENCE = `
CHAIN
- Polypad runs on Robinhood Chain, chain id 4663, an EVM chain. Native currency is ETH.
- RPC: https://rpc.mainnet.chain.robinhood.com — Explorer: https://robinhoodchain.blockscout.com (Blockscout).
- Multicall3: 0xcA11bde05977b3631167028862bE2a173976CA11.

TOKENS
- POLYDASH: 0x319525528f42167eF7fC18b77b889958080568e4 — 18 decimals, total supply 100,000,000,000, launched Oct 5, 2026.
- WETH: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73.
- USDG (stablecoin, 6 decimals): 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.

FEES
- Every token trade and fund mint pays a 0.2% protocol/platform fee.
- Of that fee: 60% goes to the fee wallet, and 40% funds POLYDASH buybacks through the BuybackVault (0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193). Of the bought POLYDASH, 62.5% is burned and 37.5% goes to stakers — so 25% of all fees end up burned and 15% go to stakers.
- Fee recipient: 0x9a21c75aC263cC43125E70200636f6397f8776d0.

TOKEN LAUNCHES
- Launch factory: 0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2. Tokens launch into liquidity pools on Robinhood Chain; the current launch contracts are listed on /contracts.

TOKENIZED FUNDS
- Fund factories: V3 0xB5251BaC3CFE2A057B7703D4477Bf80f10B8154B, V2 0xe50da719947e83f316977d9c425df95672e7b27e. Invest factory 0xd3c6ae470c25989cC8d2876c1855fB570B98894E. Strategy template 0xb2a958a9779e02764de006c8aeebc36174e2e3ba.
- How a fund works: a manager proposes assets and percentages, with a short thesis (max 3 lines + an IPFS link). The FundAllowlist (0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19) enforces a 2-day public wait (172,800 seconds) with a live countdown; holders can exit any time during the wait. No single asset can be more than 30% of a fund by default — except the strategy asset, which can go up to 80%. The manager's own shares are locked 30 days (skin in the game). Fund mints pay the 0.2% protocol fee.

POLYFUND (PDGFUND, Strategy #6)
- NFT shares: 0x7c1d31629ac68aebe83f230edbc7eacfc26285ef. Vault: 0xbcC982b6a5AbBbB5d94cce7e772E923F88d29Dd9.
- One share costs 0.01 ETH and mints an NFT. Max 200 shares. Entry fee is 0.
- The vault splits ETH: half buys POLYDASH, half pairs into POLYDASH/WETH liquidity (at most 50% of the fund per pool). LP trading fees + staking rewards flow back to NFT holders as dividends, distributed weekly.
- The raise ends Dec 16, 2026. If the raise does not fill, holders can get a refund; if it fills, holders exit at the net asset value per share. Live share count and NAV are on the fund's page — never quote them from memory.

STAKING
- Staking factory V2: 0x4C87aff7009DE1c58E052FEe202349a10b28Be9c. Flagship POLYDASH pool: 0x0F50043E172B8652bb786C4F14f30c415E5760AB.
- A pool pays rewards in its reward token over the pool's lifetime at a set reward rate; stakers claim their rewards. Live APR, staked totals, and pool end dates are on /stake — never quote a figure from memory.

AGENT WALLETS
- Built on Safe smart accounts (Safe v1.3.0 singleton 0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552) with ERC-4337 EntryPoint v0.7 (0x0000000071727De22E5E9d8BAf0edAc6f37da032).
- v2 contracts (Sourcify-verified, review on /audits): SessionKeyModuleV2 0xB8A927dfd18D87f5a041706b14424CBBA59Db270, Agent4337Module 0x49F49C72FE7B3A7EE418c5936Bd84af2dB57c8E5, WalletFactoryV2 0x944E225D5f53c25aa4C019CFD9B42f0a40b9AC22, Paymaster 0x03db6aaf03CAb9B4DA5fc27BF3C20fAC333e86EA (currently unfunded/inactive).
- How it works: the human creates a Safe wallet for the agent. The agent gets a session key that can only spend inside limits the human sets — a daily limit the human picks between $1 and $5,000, a per-payment cap, an allowlist of tokens/contracts, and an expiry. The agent cannot raise its own cap. The human alone can freeze the wallet. Recovery uses a backup key plus a 2-day timelock.
- ERC-8004 identity registry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432.
- Agent credit scores: AgentRegistry 0x514e352A12F3DB3d4cA649dD328776390e1725eF, AgentScore 0x1F7ebaAf16aEAa2F519D2Cc69B6091f908C6C92b. Scores are on /agents/scores.

X402 PAY-PER-CALL
- SpendVault: 0xDb5544a977b0dF881268746F2C47F049da579486.
- Paid products: token report $0.01, fund NAV $0.01, CTO report $0.05. Pay with USDG on Robinhood Chain, POLYDASH, or USDC on Base (cross-chain goes through Relay, about a $0.02 relayer fee on top). Payments settle to 0x9a21c75aC263cC43125E70200636f6397f8776d0. Details on /x402.

MCP + SDK
- MCP endpoint: https://polypad.family/api/mcp — 25 tools (trade, launch tokens, join tokenized funds, buy NFTs, portfolio, agent chat). No signup and no API key needed for reads.
- SDK "polypad-agent" v2.0.1 on npm and PyPI (the MCP server is v2.1.0 — versioned separately): npm install polypad-agent / pip install polypad-agent. Connect it to Claude Code, Cursor, Codex, Gemini, or VS Code with: npx -y polypad-agent connect <tool>. Docs on /build and /docs/sdks. Source: https://github.com/polydash-labs/polypad-agent.

NFTS
- Fixed-price factory 0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd, curve factory 0x8bdb1d8Db9aeC18bB464F719d5Bd97cFf8F1Ee94, marketplace 0x4Ff1d0E3Aa767C05b2D9983e14dDbC243CB0120A. Marketplace fee is 0.2%.

SECURITY
- The contracts are unaudited beyond Slither scans plus an in-house Warden review; the v2 agent-wallet contracts are Sourcify-verified. Reports are on /audits.
- Core contracts are currently owned by a single deployer key; moving ownership to a 2-of-3 multisig is planned.
`;
