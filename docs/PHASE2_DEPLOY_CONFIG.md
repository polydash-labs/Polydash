# Phase 2 deploy config — FINALIZED, WETH-only (Jon go-ahead 2026-11-09)

Status: the four creation transactions in this note were broadcast on 2026-11-09 from
source commit `e4ceacaab5175bc4e7724fafe3fedc8831085563`. Addresses, bytecode, and the
security scan are in [phase2-live-scan.md](security/phase2-live-scan.md). This file is the
config that was signed. It is not a review. Fund routes stay off.

## Finalized config (exact)

| Item | Value |
|---|---|
| Launch scope | **WETH-only.** No USDG initially, no other non-WETH asset. USDG (§4) is deferred, not initial. |
| Chain | Robinhood Chain, chain ID 4663 |
| WETH (quote) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Fee recipient (`FEE_RECIPIENT`) | `0x9a21c75aC263cC43125E70200636f6397f8776d0` — also the deployer address in the unsigned manifest, and the initial owner/fee-recipient address. |
| Signer threshold | **2-of-3, chosen by Atlas.** No multisig address or other signers were provided, so no multisig is deployed in this run. **Post-deploy step:** transfer allowlist/factory ownership to a 2-of-3 multisig Jon controls, with `0x9a21c75aC263cC43125E70200636f6397f8776d0` as one signer. |
| Router | Uniswap V3 SwapRouter02 `0xCaf681a66D020601342297493863E78C959E5cb2`, **only through** `UniswapV3RouterAdapter` (raw SwapRouter02 is never allowlisted). |
| Price feed | ChainlinkNavFeed, ETH/USD `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`. No sequencer requirement (no L2 sequencer uptime feed exists on this chain). No USDG feed at launch (WETH-only). |
| Timelock | 2 days (`FUND_INVEST_DELAY`, min 1 day) |
| Caps (defaults) | Max position 75%, max trade 75%, max execution deviation 50% |
| Fees | Protocol 0.2%, entry 0–5% per fund |
| Alchemy | Off-chain only: RPC / Token Prices API for UI/keeper/fork tests. Not a router, not an on-chain feed. |
| Front end | `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` = the deployed FundFactoryInvest address (set in Abacus after a successful mainnet deploy). `FUND_ROUTES_ENABLED` stays an Abacus server var — do NOT enable it in the repo. |

Deploy command (WETH-only, with the finalized fee recipient):

```sh
CONFIRM_FUND_PHASE2_DEPLOY=yes \
FUND_INVEST_WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 \
FEE_RECIPIENT=0x9a21c75aC263cC43125E70200636f6397f8776d0 \
FUND_INVEST_SWAP_ROUTER02=0xCaf681a66D020601342297493863E78C959E5cb2 \
PRIVATE_KEY=0x... \
forge script script/DeployFundFactoryInvest.s.sol --rpc-url robinhood --broadcast
```

`PRIVATE_KEY` is the signing blocker: no deployer private key / hardware wallet is
available in this environment. Do not invent or generate one. See "Signing" below.

## Signing — exact access needed for the mainnet deploy (Jon will provide the key)

Jon confirmed 2026-11-09 he will provide the private key for the deployer wallet.
**Do not paste it in chat. Do not store it in memory, files, env, or logs.**

What is needed:
- The deployer private key for `0x9a21c75aC263cC43125E70200636f6397f8776d0` — the
  fee-recipient / deployer address — or, if Jon designates a different deployer, that
  deployer's key and its address, stated explicitly.
- The key signs exactly four mainnet deploy transactions on Robinhood Chain (4663),
  via `script/DeployFundFactoryInvest.s.sol` with
  `CONFIRM_FUND_PHASE2_DEPLOY=yes`, `FUND_INVEST_WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`,
  `FEE_RECIPIENT=0x9a21c75aC263cC43125E70200636f6397f8776d0`,
  `FUND_INVEST_SWAP_ROUTER02=0xCaf681a66D020601342297493863E78C959E5cb2`,
  `--rpc-url robinhood` (`ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com`):
  `FundSwapFacet`, `UniswapV3RouterAdapter`, `FundAllowlist`, `FundFactoryInvest`.
  A fifth step, after deploy, is the ownership transfer to the 2-of-3 multisig.
- Secure ways to provide it: the Secure Vault capture page (preferred — the key is
  used once by the deploy and never shown in chat), or a hardware wallet / `cast wallet
  import` keystore (see `.env.example`: "Prefer a hardware wallet or `cast wallet
  import` keystore over a raw key"). No key value is ever written to this repo, to
  `.env`, or to any log.

Until that signing path exists, **no mainnet transaction is broadcast**. All prep
below that point — config, tests, fork/testnet lifecycle — uses only local test keys
(anvil defaults), clearly labelled test-only, and never touches mainnet.

---

# Phase 2 deploy config — proposal (not deployed)

Status: proposal on paper only. Nothing here has been broadcast, and no address below is
live in the allowlist or the front end. Do not deploy to mainnet without Jon's explicit
go-ahead, an audit, and the multisig in §1.

All on-chain facts were verified read-only on Robinhood Chain (chain ID 4663) on 2026-11-09
via `cast` against https://rpc.mainnet.chain.robinhood.com (latest block ~109,829,000).
Anything marked "unvetted" was not checked and must be checked before mainnet.

## 1. Ownership — finalized 2026-11-09 (2-of-3, post-deploy transfer)

- The deployer of `FundFactoryInvest` / `FundAllowlist` becomes their owner (a single EOA
  in `script/DeployFundFactoryInvest.s.sol`). The deployer / fee-recipient address is
  `0x9a21c75aC263cC43125E70200636f6397f8776d0`.
- **Post-deploy step (required before any public fund): transfer ownership to a 2-of-3
  multisig Jon controls**, with `0x9a21c75aC263cC43125E70200636f6397f8776d0` as one signer.
  No multisig address or other signers were provided, so no multisig is deployed in this
  run and no signers are invented.
- Fee recipient (`FEE_RECIPIENT` env): `0x9a21c75aC263cC43125E70200636f6397f8776d0` — the
  protocol fee (0.2%) and any unclaimed entry fees go there.
- The deploy script's 2-day timelock (`FUND_INVEST_DELAY`, default 2 days, minimum 1 day)
  applies to every allowlist change (router, asset, feed). Keep 2 days for mainnet.

## 2. Chain and WETH

| Item | Address | Verified |
|---|---|---|
| Robinhood Chain | chain ID 4663, RPC https://rpc.mainnet.chain.robinhood.com | yes — chain ID + block ~109,829,000 |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | yes — `WETH / WETH / 18`, totalSupply 39,487.23, ERC-1967 proxy |

WETH is the quote asset. Its proxy admin was not reviewed — unvetted.

## 3. Router — SwapRouter02 through an adapter (verified)

| Item | Address | Verified |
|---|---|---|
| Uniswap V3 SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` | yes — 24,497 B code, `WETH9()` returns WETH, `factory()` returns the V3 factory |
| V3Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | yes — owner `0x05C420bC4823e039AA4dA645eDde743486dAAA25`, fee-500 tick spacing 10 |
| QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | yes — `factory()` returns V3Factory |

**SwapRouter02 does NOT implement the vault's `swap(address,address,uint256,uint256,bytes)`
(selector `0x2506c018`).** Verified by enumerating its 38 selectors on live bytecode
(`exactInputSingle`, `exactInput`, `exactOutput`, `multicall`, `unwrapWETH9`, …) and by a
raw call that reverts with empty data. **Do not allowlist SwapRouter02 directly.**

Instead, deploy `src/fund/phase2/UniswapV3RouterAdapter.sol` (new in this work) and
allowlist the adapter. It translates `swap` into `exactInputSingle`; the pool fee comes
from `data` (`abi.encode(uint24 fee)`, empty = 3000). It holds no funds after a swap
(output goes straight back to the vault). Unit tests in
`test/fund/UniswapV3RouterAdapter.t.sol`; fork test against the real pool in
`test/fork/UniswapV3RouterAdapterFork.t.sol`. The adapter is unaudited — include it in
the audit scope.

UniversalRouter (`0x8876789976dEcBfCbBbe364623C63652db8C0904`) is **not** proposed: it has
no `WETH9()`/`owner()`, its surface was not enumerated, and the vault needs no
multi-hop path. Do not allowlist it.

Deploy command (after Jon approves the deployer key and fee recipient):

```sh
CONFIRM_FUND_PHASE2_DEPLOY=yes \
FUND_INVEST_WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 \
FEE_RECIPIENT=<multisig from §1> \
FUND_INVEST_SWAP_ROUTER02=0xCaf681a66D020601342297493863E78C959E5cb2 \
PRIVATE_KEY=0x... \
forge script script/DeployFundFactoryInvest.s.sol --rpc-url robinhood --broadcast
```

The script deploys the adapter and seeds it as the only initial router. The allowlist
still starts with WETH only; USDG (§4) is added later through the timelock.

## 4. First non-WETH asset — USDG (verified, DEFERRED for WETH-only launch)

**WETH-only launch decision (2026-11-09): USDG is NOT an initial asset.** The launch
allowlist is WETH as quote, no non-WETH asset. USDG below is verified and documented
for a later timelocked `proposeAsset` addition, after the WETH-only launch proves the
loop. Do not add it at deploy time.

USDC was the first choice, but it is a dead end on this chain: the canonical bridged USDC
(`0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8`, gateway-derived and verified) has ~$384
total bridged supply, and **no V3 pool exists for bridged USDC, USDT, or WBTC vs WETH at
any fee tier** (500/3000/10000 all return `0x0`). A fund cannot trade them. Do not
substitute a different USDC address without re-verifying the pool.

| Item | Address | Verified |
|---|---|---|
| USDG (Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | yes — `Global Dollar / USDG / 6`, totalSupply 632,184,048, natively issued on Robinhood Chain (Paxos) |
| USDG/USD feed | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` | yes — 8 decimals, `USDG / USD`, $0.99995842 at check |
| ETH/USD feed | `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` | yes — 8 decimals, `ETH / USD`, $2,131.28 at check |
| WETH/USD G 500 pool | `0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a` | yes — deepest pool (liquidity 2.638e17); QuoterV2: 1 WETH → 2,127.56 USDG |
| WETH/USD G 3000 pool | `0xa9188730Fe85Be88ad499D7d52B099e800fB0334` | yes — liquidity 8.055e16 |
| WETH/USD G 10000 pool | `0x5f009E071F07e92B6C624e83F52F17bBDa34680D` | yes — liquidity 4.902e15 |

Proposed `ChainlinkNavFeed` for USDG: asset USDG, 6 decimals, asset/USD feed
`0x61B7e5650328764B076A108EFF5fa7282a1B9aD2`, ETH/USD feed
`0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`, no sequencer requirement (no L2 sequencer
uptime feed exists on this chain — unvetted, but no such feed was found in the Chainlink
directory). Proposed allowlist entry: `maxStale` **86400 s (1 day)**, `minPriceX18` /
`maxPriceX18` set to **80% / 125% of the live `latestPrice` at proposal time**
(priceX18 is ETH wei per 1e18 raw USDG units, ~4.7e26 at $2,131/ETH — do not use the
0.95/1.05 ether values from the mock tests, those are for 18-decimal tokens).

**Feed staleness, read this before arguing for 1 hour:** the stablecoin feeds (USDC, USDT,
USDG) had not updated in ~14 h at check time. Their heartbeat is 24 h
(`ChainlinkNavFeed.datasetHeartbeat()` = 86400). A `maxStale` of 1 h would reject every
stablecoin feed as read, permanently. Only ETH/USD and WBTC/USD were < 1 h old. The
1-day bound is the honest one for a stablecoin feed on this chain; the ±20–25% price
band and the 50% execution-deviation check are the guards that matter. If Jon wants a
tighter staleness bound, the answer is not a smaller number — it is a different asset
whose feed updates hourly, and no such asset was found. **Contract change made for
this:** `FundAllowlist.MAX_STALE` was raised from 1 hour to 1 day in this work, because
the old ceiling made any stablecoin feed unusable. Each asset still gets its own
`maxStale` (1 day for USDG); the ceiling is the heartbeat, not a trading bound.

USDG caveats (unvetted): the token is an ERC-1967 proxy — implementation and admin were
not reviewed. V4 pools were not checked. USDG was not in the original USDC-first
shortlist; if the mandate strictly requires USDC/USDT/WBTC, the safe fallback is a
**WETH-only launch** with no non-WETH asset.

## 5. Fund defaults (what `createFund` sends when a manager leaves caps at 0)

- Max position 75% of NAV in one asset; max trade 75% of NAV in one trade; max execution
  deviation 50% from the feed price. Set once at creation; no setter (the manager cannot
  loosen them later). NAV excludes unclaimed entry/protocol fees.
- Mandate: text + `mandateUri` (ipfs:// or https://, 1–512 bytes, required); the vault
  stores the URI and emits `MandatePublished(mandateHash, mandateUri)`.
- NAV checkpoint: `checkpointNav()` is permissionless, at most once an hour; no keeper is
  deployed yet — anyone (or a future keeper) calls it. The blotter still records
  `navAfter` on every trade.
- Fees: protocol 0.2%, entry 0–5% per fund (manager's choice at creation).

## 6. Alchemy — off-chain only

Alchemy is **not** a router and **not** an on-chain price feed. It has no feed contract the
vault can read; `ChainlinkNavFeed` stays the on-chain oracle. Alchemy is proposed only
for off-chain use: RPC endpoint for the fork tests (`FORK_RPC`), the Token Prices API for
the UI/keeper, and indexing. Do not put an Alchemy key in the contracts, and do not
allowlist anything Alchemy-shaped on-chain.

## 7. Testnet plan (before mainnet)

1. Deploy the full Phase 2 set to a Robinhood Chain testnet (or a local fork) with the
   same script and the same env shape, using testnet WETH/router/feed addresses.
2. Run the fork suite with `FORK_RPC` pointed at mainnet (read-only fork, nothing
   broadcast) — `FOUNDRY_PROFILE=fork forge test --match-contract Fork` — including the
   adapter fork test against the real USDG 500-fee pool.
3. Exercise the UI end to end on the testnet deploy: create an investing fund, mint,
   close the raise, enable investing, swap WETH→USDG and back, refund a failed raise,
   exit, claim owed — with `FUND_ROUTES_ENABLED=enabled` only on the test deploy.
4. Get the audit (scope in `docs/AUDIT_SCOPE.md`, plus the new adapter and the cap/
   deviation code), then re-run 1–3 on the audited code.

## 8. What is still unvetted

- The contracts (including the new adapter, caps, deviation check, and fee-excluded NAV)
  are **unaudited**. Slither 0.11.6 was run on `src/fund/phase2/` (129 results, all in
  informational detector categories — reentrancy-balance on the pre-existing swap
  architecture, arbitrary-send-eth on the allowlisted router / payout sends, the
  controlled-delegatecall to the immutable swap facet; nothing new and actionable was
  found in the new cap/deviation/checkpoint/adapter code). That is not an audit.
- **Fork test status:** the adapter fork test
  (`test/fork/UniswapV3RouterAdapterFork.t.sol`) is written and reaches the swap, but
  does not pass end to end on the public RPC: forge's fork backend fails fetching USDG
  proxy storage (`too_many_data_frames` from https://rpc.mainnet.chain.robinhood.com)
  and the test reverts on the RPC error, not on a contract revert. The same RPC
  flakiness makes other fork tests fail or pass depending on the run
  (`test_fork_invest_path_leaves_the_live_factory` fails in a full-suite run, passes
  alone). The pool path itself was confirmed live with `cast` (QuoterV2: 0.5 WETH →
  1,052,598,163 USDG at fee 500, 2026-11-09), and the adapter is covered end to end
  through a real vault by unit tests with a mock V3 router. Re-run the fork test with
  a paid/unthrottled RPC (e.g. Alchemy) before treating it as green.
- USDG proxy implementation/admin; WETH proxy admin; V3Factory owner is a single address
  (`0x05C420bC4823e039AA4dA645eDde743486dAAA25`) — Uniswap-controlled, not ours.
- No L2 sequencer uptime feed on Robinhood Chain; `ChainlinkNavFeed` is deployed without
  the sequencer guard by necessity, not by choice.
- The 500-fee USDG pool is the deepest, but pool liquidity was measured once (2026-11-09);
  re-check depth before any large first trade, and keep the first fund small.
- The front end (`polypad.family`) is a separate Abacus project; getting the Phase 2 UI
  live there is a manual resync + env + deploy in Abacus (see §9 of the report). The repo
  has no deploy pipeline to polypad.family.
