# Polypad creator contracts

Contracts that Polypad token creators use after launch: NFT staking, creator vesting, creator bonds, token-gated NFT mints, treasury rules and token-backed NFT collections, plus the POLYDASH buyback vault and rewards pool. Phase 1a tokenized funds (`src/fund`) sit with them: a raise that mints ERC-721 units into a vault. They live alongside the staking contracts in this repository and share its toolchain (via-IR, optimizer 200 runs, OpenZeppelin v5.0.2). The first five modules and `src/fund` use solc 0.8.24 and EVM `paris`; `src/floorvault` and `src/buyback` use solc 0.8.26 and EVM `cancun` because they integrate with Uniswap V4 (v4-core v4.0.0). `foundry.toml` pins the EVM version per module with `compilation_restrictions`.

> **Not audited.** The deployed contracts below were deployed before an external audit; an outside review is planned. `src/fund` is not deployed. Automated scans are not audits. See [SECURITY.md](../SECURITY.md).

## Modules

| Module | Contracts | Purpose | Tests |
| --- | --- | --- | --- |
| [`src/nftstaking`](../src/nftstaking) | `NftStakingFactory`, `NftStakingPool` | Stake ERC-721s for ERC-20 rewards over a fixed window, with optional loyalty and set boosts | 40 |
| [`src/vesting`](../src/vesting) | `CreatorVestingFactory`, `CreatorVestingVault` | Ownerless cliff + linear vesting, optionally staked in a Polydash staking V2 pool | 22 |
| [`src/bond`](../src/bond) | `CreatorBondFactory`, `CreatorBond` | ETH bond backing a creator's commitment to hold a floor balance | 31 |
| [`src/gatedmint`](../src/gatedmint) | `PolypadGatedNFTFactory`, `PolypadGatedCollection` | Creator-only NFT collections with an optional token-holder phase | 27 |
| [`src/treasury`](../src/treasury) | `TreasuryRulesFactory`, `TreasuryRules` | Per-token treasury with on-chain rules and a timelock for operator-run tasks | 30 |
| [`src/floorvault`](../src/floorvault) | `PolypadTokenFloorFactory`, `PolypadTokenFloorCollection` | Fixed-price NFT collections whose mint share funds an ETH + launch-token vault redeemable pro rata by burning | 115 |
| [`src/buyback`](../src/buyback) | `PolydashBuybackVault`, `PolydashRewardsPool` | Capped on-chain POLYDASH buys from the fee share: 62.5% burned, 37.5% streamed to stakers | 70 |
| [`src/fund`](../src/fund) | `FundFactory`, `FundVault`, `FundNFT` | Phase 1a fund raise: fixed ETH mint price, ERC-721 units, vault holds the ETH. Factory broadcast script is ready; not deployed | 16 |
| [`test/fork`](../test/fork) | | Fork tests against Robinhood Chain state | 10 |

## Deployed addresses (Robinhood Chain, chain ID 4663)

| Contract | Address | Verification |
| --- | --- | --- |
| `NftStakingFactory` | [`0x827b9BB6a176D13Ea7E05b8e5891c8040cb822B1`](https://robinhoodchain.blockscout.com/address/0x827b9BB6a176D13Ea7E05b8e5891c8040cb822B1) | [Sourcify exact match](https://repo.sourcify.dev/4663/0x827b9BB6a176D13Ea7E05b8e5891c8040cb822B1) |
| `CreatorVestingFactory` | [`0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022`](https://robinhoodchain.blockscout.com/address/0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022) | [Sourcify exact match](https://repo.sourcify.dev/4663/0xbbF618395E6C7ac0E9AC6dBEC26BA8cd160d7022) |
| `CreatorBondFactory` | [`0x876170251e30F99E27119AF0e90648A88D508f97`](https://robinhoodchain.blockscout.com/address/0x876170251e30F99E27119AF0e90648A88D508f97) | [Sourcify exact match](https://repo.sourcify.dev/4663/0x876170251e30F99E27119AF0e90648A88D508f97) |
| `PolypadGatedNFTFactory` | [`0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d`](https://robinhoodchain.blockscout.com/address/0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d) | [Sourcify exact match](https://repo.sourcify.dev/4663/0x64727D49FB9F8E669C0759B9b8e8f1bd6c99325d) |
| `TreasuryRulesFactory` | [`0x2A06dafEd9A5CaBC7693683E24025f96D7AF656f`](https://robinhoodchain.blockscout.com/address/0x2A06dafEd9A5CaBC7693683E24025f96D7AF656f) | [Sourcify exact match](https://repo.sourcify.dev/4663/0x2A06dafEd9A5CaBC7693683E24025f96D7AF656f) |
| `TreasuryRules` (implementation, created by the factory) | [`0x77Ef2141D3d79e2D2b9a094D2C6d2aab826D4ccb`](https://robinhoodchain.blockscout.com/address/0x77Ef2141D3d79e2D2b9a094D2C6d2aab826D4ccb) | [Sourcify exact match](https://repo.sourcify.dev/4663/0x77Ef2141D3d79e2D2b9a094D2C6d2aab826D4ccb) |
| `PolypadTokenFloorFactory` | [`0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c`](https://robinhoodchain.blockscout.com/address/0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c) | [Sourcify match](https://repo.sourcify.dev/4663/0xdD149A1a76363BaAaFEF97c3E8d8cfdD2E7A277c) |
| `PolypadTokenFloorCollection` (implementation, created by the factory) | [`0xFa23E496f7244d1674fA8bE5C42556bd054140EA`](https://robinhoodchain.blockscout.com/address/0xFa23E496f7244d1674fA8bE5C42556bd054140EA) | [Sourcify match](https://repo.sourcify.dev/4663/0xFa23E496f7244d1674fA8bE5C42556bd054140EA) |
| `PolydashRewardsPool` | [`0x608d106Bb58A804fcd45823e0C6087801dee2aCa`](https://robinhoodchain.blockscout.com/address/0x608d106Bb58A804fcd45823e0C6087801dee2aCa) | [Sourcify match](https://repo.sourcify.dev/4663/0x608d106Bb58A804fcd45823e0C6087801dee2aCa) |
| `PolydashBuybackVault` | [`0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193`](https://robinhoodchain.blockscout.com/address/0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193) | [Sourcify match](https://repo.sourcify.dev/4663/0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193) |

`FundFactory` has no row yet. [`script/DeployFundFactory.s.sol`](../script/DeployFundFactory.s.sol) is the broadcast, and [`src/fund/README.md`](../src/fund/README.md) has the forge commands. `createFund` deploys each vault and fund NFT. These contracts are unaudited. Not financial advice.

Pools, vaults, bonds and collections are deployed by these factories from the verified source. Treasury vaults and token-backed collections are EIP-1167 minimal proxies (clones) of their implementations. "Match" means Sourcify matched the creation and runtime bytecode but not the metadata hash.

Routing fees to a project treasury is handled by the Polypad site and has no dedicated contract.

## Architecture

- **Factory per module.** Each module exposes a factory that deploys per-instance contracts and indexes them for front ends (`isPool`, `isVault`, `vaultsByToken`, ...). Treasury instances and token-backed collections are EIP-1167 clones of one implementation. Staking, vesting, bonds, NFT staking, and tokenized funds deploy full contracts with `new`.
- **Polypad token check.** Vesting, bond, gated mint and treasury only accept tokens launched through the Polypad launch factories. They resolve a token to its launch with `launchOfToken` on the current factory (`0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2`) and the earlier factory (`0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2`), passed as constructor arguments. The shared interfaces are in `src/bond/IPolydashLaunchInfo.sol`.
- **Staking integration.** Vesting and treasury integrate with the deployed `PolydashStakingFactoryV2` (`0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0`); unit tests run against the real V2 source in `src/v2/`.
- **No upgradeability.** None of the modules use proxies for upgrades. Vesting vaults and bonds have no owner or admin.
- **Defensive token handling.** Amounts are measured by balance deltas (fee-on-transfer aware), external calls are `nonReentrant`, and ERC-20 transfers use `SafeERC20`.

## Source provenance

The deployed `.sol` files in these modules are byte-identical to the source verified on Sourcify. `src/fund` is new Phase 1a source and is not part of that set. They are not reformatted (`forge fmt` ignores `src/`) and their NatSpec headers are left as they were at deployment, including the earlier "DRAFT" titles, because any change would alter the metadata hash. Compiling inside this repository yields the same runtime code; only the trailing CBOR metadata hash differs, because Foundry records this repository's auto-detected remappings in the metadata. Use the standard-JSON input on Sourcify to reproduce an exact match.

## Build and test

```bash
git submodule update --init --recursive
forge build
forge test --match-path "test/{nftstaking,vesting,bond,gatedmint,treasury,floorvault,buyback,fund}/*"

# Fork tests (read-only against mainnet state, executed in a local fork)
FORK_RPC=https://rpc.mainnet.chain.robinhood.com FOUNDRY_PROFILE=fork forge test --match-contract Fork
```

Without `FORK_RPC` the fork tests return early. Fuzz tests run 1,000 runs by default and 5,000 under `FOUNDRY_PROFILE=ci`.
