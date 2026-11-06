# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/).

## [Unreleased]
### Changed
- A holder exit reverts when tokens leave the vault and the holder does not receive the full amount. Wrap and unwrap revert unless the WETH amount equals the ETH amount. Robinhood's published WETH is `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. These contracts are not deployed.
- Phase 2 investing vaults, which are not deployed, now have a raise deadline. `ChainlinkNavFeed` prices a token in ETH from asset/USD divided by ETH/USD. The 86400-second dataset heartbeat is not the trading staleness ceiling. Primary Shared SVR proxy addresses are recorded and not allowlisted. A required sequencer guard with no feed reverts. Robinhood Chain has no sequencer proxy in this source. A filled raise closes. A missed deadline can be marked failed. The current NFT holder can refund spendable ETH on a failed raise, or exit a pro-rata share of ETH, WETH, and mandate tokens after a successful close. Fees stay out of those payments. The last outstanding units take rounding dust. Pause does not block the exit. `nav()` quotes mandate assets from an allowlist feed and reverts when the price is missing, stale, or outside its bounds. Cost basis is not that figure. The published proxies are not set on the allowlist. Fund routes on the site render a not-live page unless `FUND_ROUTES_ENABLED=enabled` on the server. The header and footer do not link to them. Phase 1a source is unchanged. Unaudited. Not financial advice.
### Added
- Phase 2 tokenized-fund investing in `src/fund/phase2`: `FundAllowlist`, `FundFactoryInvest`, `FundVaultInvest`, `FundNFTInvest`, `FundSwapFacet`, and `NAVReader`. After a raise closes, the manager can open investing and swap ETH or WETH through an allowlisted router into that fund's asset list. The vault measures what comes back. See the Changed note for the deadline, refund, exit, and feed-based NAV. Allowlist edits wait at least a day. Pause is immediate. These contracts are not deployed. `script/DeployFundFactoryInvest.s.sol` reverts unless `CONFIRM_FUND_PHASE2_DEPLOY=yes` and does not call the live factory. The fund pages show holdings, a blotter, a NAV tape, and a protections score, and a manager desk that asks the wallet to sign. `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` stays unset until a later deploy. Phase 1a raise and mint are unchanged. Unaudited. Not financial advice.
- Polypad fund pages in `polypad/web`: a Funds list (search, status filters, newest and most-raised sort), a separate Create fund wizard at `/funds/create`, and a fund page with raise progress and minting. The wizard calls `createFund` on FundFactory `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878`. The caller signs in their wallet. Phase 1a is raise and mint only. Unaudited. Not financial advice. Token create, staking, and the other factories are unchanged.
- `FundFactory` on Robinhood Chain (chain ID 4663) at `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878`. Deploy tx `0x3b02110bb45f421591c6712ce4498b5533286cbaf4d46581a1ed0c6deea49bf3`. Owner and fee recipient `0x9a21c75aC263cC43125E70200636f6397f8776d0`. Sourcify exact match. Blockscout's API verification was blocked by Cloudflare; Sourcify is the verification of record. `script/DeployFundFactory.s.sol` is the broadcast script (`PRIVATE_KEY` and `FEE_RECIPIENT`). `createFund` deploys each `FundVault` and `FundNFT`. Phase 1a is raise and mint only. Not audited. Not financial advice.
- Phase 1a tokenized funds in `src/fund`: `FundFactory`, `FundVault`, and `FundNFT`. A manager sets the name, symbol, image, base URI, fixed ETH mint price, raise cap, and an optional entry fee of 0% to 5%. Buyers mint ERC-721 units at that price while the raise is open. ETH is held by the vault. The manager must mint at least 5% of supply (or a higher configured share) before other wallets can mint. `maxSupply` is `raiseCap / mintPrice`, rounded down; the remainder cannot mint another unit. The raise closes at that supply. A 0.2% protocol fee matches the launchpad platform fee and can be pulled to the factory fee recipient. The manager can pull the entry fee. This phase does not withdraw principal and does not invest it. The factory address is recorded above. Not audited.

## [1.2.0] - 2026-11-06
### Security
- Polypad logo upload (`polypad/web/app/api/upload/logo`) no longer returns an unbounded S3 PUT URL. It returns a presigned POST with a 1 byte–5 MB `content-length-range`, an exact image `Content-Type` (png, jpeg, webp, gif), a server-chosen key under `token-logos/<uuid>.<ext>`, and a 5-minute expiry. The route rate-limits by IP in memory (10 requests / 10 minutes per process; a shared store is required across instances). The web app has no session or wallet-auth helper, so the route requires `Origin` or `Referer` to match the app host.
- Documented a v1 staking-pool issue: `_sendPrincipal` pushes the unstake fee to `feeRecipient`, so a stake token that reverts on that transfer (blocklist or a refusing recipient) reverts `withdraw`, `exit`, and `emergencyWithdraw` until the factory owner rotates the recipient. V1 is legacy, with a single third-party pool. Deployed Solidity is unchanged. V2 uses a pull for platform fees and is not affected. Reported by r00k, Hey Research Lab. Demonstration: `test/PolydashStakingPoolFeeRecipient.t.sol`.
### Fixed
- `test_fork_rewards_pool_path` credits its staker on the fork instead of transferring POLYDASH from a live wallet whose balance can be zero. The fork CI job skips when the Robinhood Chain RPC is unreachable, and a reachable RPC with a failing test fails the check.
### Added
- Polypad agent launch HTTP API under `polypad/web/app/api/agents/v1`. `POST /validate` checks `createLaunch` parameters. `POST /simulate` runs `eth_call` and returns an unsigned transaction. The caller signs and broadcasts it. The route rejects private-key fields, rate-limits by IP (20 requests / 10 minutes per process), and records an Agent-launched mark in `socialLinks` (`https://polypad.family/docs#agent-launched`). The deployed factory bytecode is unchanged. The site shows an Agent-launched badge from that mark, and `/create?agent=1` writes the same mark. A GitHub `repository` field is labelled Build on the token page.
- MCP server `agents/polypad-mcp` (`polypad_validate_launch`, `polypad_prepare_launch`) with tool schemas in `schemas/tools.json`. It calls the HTTP API and does not sign.
- Public docs index in `docs/README.md` (launch flow, commitment window, graduation and the V4 hook, Holder Protections, build activity, agent API, risk) and a Polypad `/docs` page linked from the header, footer, and About page.
- `deployments/robinhood-chain.json` and `docs/DEPLOYMENTS.md`: one address list for Robinhood Chain, taken from addresses already recorded in the repo. Notes the current and earlier Polypad sets, including both commit vaults.
- `docs/README.md` index of the docs.
- Agent CI: Ruff and pytest for Poly Agent and PolyCTO, plus offline tests for routing, scam scoring, and reward-rate math.
- `script/scan_secrets.py` and a CI job that runs it.
- `agents/polycto/.env.example`, which the PolyCTO README already told readers to copy.
- Polypad creator contracts with tests: `src/nftstaking` (NFT staking with optional boosts), `src/vesting` (creator vesting vaults), `src/bond` (creator bonds), `src/gatedmint` (token-gated NFT mints) and `src/treasury` (treasury rules). Source is byte-identical to the Sourcify-verified deployments. Overview in `docs/CREATOR_CONTRACTS.md`. Not audited.
- `fork` Foundry profile and a CI job for the creator fork tests.
- `src/floorvault`: token-backed NFT collections (`PolypadTokenFloorFactory`, `PolypadTokenFloorCollection`) with unit, fuzz, hardening and invariant tests and a fork test against the deployed factory. Sourcify match. Not audited.
- `src/buyback`: `PolydashBuybackVault` (capped POLYDASH buys, 62.5% burned, 37.5% to stakers, 48-hour timelocked rewards target) and `PolydashRewardsPool` (ongoing POLYDASH staking with reward top-ups), with unit, fuzz and invariant tests and fork tests against the deployed contracts. Sourcify match. Not audited.
- Uniswap v4-core v4.0.0 submodule; per-module EVM targets in `foundry.toml` (`paris` for existing modules, `cancun` for the V4 modules).
- `src/v2/`: verified source of the deployed `PolydashStakingFactoryV2` and `PolydashStakingPoolV2` (byte-for-byte, no source changes), with provenance and compiler settings in `src/v2/README.md`.
- `script/v2/compare_bytecode.py`: compares locally compiled V2 runtime bytecode with on-chain code for the factory and two pools (match, ignoring metadata hash and immutables).
- `test/v2/`: unit, precision and fuzz tests for V2 (stake, withdraw, claim, claim fee bounds 1-5%, owner cannot move pool funds, reward period end, 6-decimal reward precision, conservation fuzzing).
### Changed
- README: architecture diagram, module overview, quickstart, build and test, security posture, and roadmap. Clone URL and CI badge point at `polydash-labs/Polydash`.
- Security wording states that the contracts are unaudited and that an outside review is planned.
- Poly Agent public copy no longer presents reward rates as a promised return.
- Polypad web example env and About page use the current factory (creator fee cap 5%) and the current commit vault. The earlier set stays documented.
- `polypad/contracts/README.md` no longer says the Robinhood Chain deployment does not exist.
- README and `docs/AUDIT_SCOPE.md`: V2 source now in `src/v2/`; v1 factory marked legacy with a warning against 6-decimal reward tokens.

## [1.1.0] - 2026-10-29
### Added
- CI: gas snapshot, LCOV coverage artifact, Slither SARIF report; CODEOWNERS and Dependabot for GitHub Actions.
- README: full Robinhood Chain deployments table (staking and Polypad), Polypad links.
### Added
- Polypad launchpad contracts in `polypad/`: deployment manifest, ABIs for 6 contracts and a README with Robinhood Chain addresses. Not yet externally audited.
- Polypad Solidity source (`polypad/contracts/`: Foundry project with src, tests, scripts, docs and Slither static-analysis report) and Next.js frontend (`polypad/web/`). Not yet externally audited.
- PolyCTO agent in `agents/polycto/`: multi-role AI team member for Polypad launches (Telegram community, marketing, on-chain token analysis, heuristic contract security scan). [Live on Swarms](https://swarms.world/agent/645381f2-f41d-4220-9ea3-3d05932ef0bc).
### Changed
- Polypad PolydashFactory, PolydashLaunch, PolydashHook and PolydashCommitVault are verified on Sourcify (Robinhood Chain, match).
- StakingFactory v2 (`0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0`) is now source-verified on Robinhood Chain (exact match, solc 0.8.24): [Blockscout](https://robinhoodchain.blockscout.com/address/0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0?tab=contract).
- Poly Agent uses the verified v2 ABI names; fixes v2 `Withdrawn(user, shares, amount)` decoding and counts `EmergencyWithdrawn` as outflow.
### Pending
- Verify the individual v2 pools on the explorer.

## [1.0.0] - 2026-10-28
### Added
- `PolydashStakingFactory` and `PolydashStakingPool` v1 (deployed at `0x0aAEa47d2e7303EC5a809062eafa59e7F011D857`).
- Foundry project, unit + fuzz test suite, deploy script, CI, docs, logo and banner.
