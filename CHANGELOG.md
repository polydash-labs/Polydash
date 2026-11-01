# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/).

## [Unreleased]
### Added
- Polypad creator contracts with tests: `src/nftstaking` (NFT staking with optional boosts), `src/vesting` (creator vesting vaults), `src/bond` (creator bonds), `src/gatedmint` (token-gated NFT mints) and `src/treasury` (treasury rules, not yet deployed). Source is byte-identical to the Sourcify-verified deployments. Overview in `docs/CREATOR_CONTRACTS.md`. Not audited.
- `fork` Foundry profile and a CI job for the creator fork tests.
- `src/v2/`: verified source of the deployed `PolydashStakingFactoryV2` and `PolydashStakingPoolV2` (byte-for-byte, no source changes), with provenance and compiler settings in `src/v2/README.md`.
- `script/v2/compare_bytecode.py`: compares locally compiled V2 runtime bytecode with on-chain code for the factory and two pools (match, ignoring metadata hash and immutables).
- `test/v2/`: unit, precision and fuzz tests for V2 (stake, withdraw, claim, claim fee bounds 1-5%, owner cannot move pool funds, reward period end, 6-decimal reward precision, conservation fuzzing).
### Changed
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
