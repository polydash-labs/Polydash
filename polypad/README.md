# Polypad

Token launchpad on Robinhood Chain: commitment window, bonding curve, graduation to Uniswap V4.

Network: **Robinhood Chain** (chain ID 4663) · RPC `https://rpc.mainnet.chain.robinhood.com` · Explorer [https://robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)

**Status:** Unaudited. An outside review is planned.

> All deployed contracts listed below (current and legacy) are verified on [Sourcify](https://sourcify.dev). The sources in `contracts/src` match the current verified factory, launch and hook sources (creator fee cap 500 bps). The legacy set was compiled from the same code with a 200 bps cap (creation and runtime bytecode match; status "match" rather than "exact_match" because they were compiled with `bytecode_hash = none`, so there is no metadata hash to compare).

## How it works

1. **Commitment window.** Users commit to a new launch through `PolydashCommitVault`.
2. **Bonding curve.** The launch (an EIP-1167 clone of `PolydashLaunch`) trades on a bonding curve.
3. **Graduation.** The launch graduates to a Uniswap V4 pool that uses `PolydashHook`.

## Contracts

| Contract | Address | Deploy tx | ABI | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| **PolydashFactory** | [`0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2`](https://robinhoodchain.blockscout.com/address/0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2) | [`0x9febcb0c…`](https://robinhoodchain.blockscout.com/tx/0x9febcb0ced4fea460faeba948d911b7c03a41f02ccfdd7f31ba479c94b9d97b9) | [`abi/PolydashFactory.json`](abi/PolydashFactory.json) | [Verified on Sourcify](https://sourcify.dev/server/v2/contract/4663/0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2) | **Current.** Creates launches (clones of PolydashLaunch). Creator fee 0–5% (500 bps). `createLaunch` is permissionless, see [docs/AGENTS_LAUNCH.md](../docs/AGENTS_LAUNCH.md). |
| **PolydashLaunch** | [`0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad`](https://robinhoodchain.blockscout.com/address/0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad) | [`0x36555c8f…`](https://robinhoodchain.blockscout.com/tx/0x36555c8fe7d668e5967c499d9200c35b81b3a932b551298f53d381218cda869e) | [`abi/PolydashLaunch.json`](abi/PolydashLaunch.json) | [Verified on Sourcify](https://sourcify.dev/server/v2/contract/4663/0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad) | Current launch implementation (EIP-1167 clones). |
| **PolydashHook** | [`0x4d3066bBfF889023def912D2fDe36c44357fA0cC`](https://robinhoodchain.blockscout.com/address/0x4d3066bBfF889023def912D2fDe36c44357fA0cC) | [`0xd8b340b8…`](https://robinhoodchain.blockscout.com/tx/0xd8b340b8576d94035afa337965754f726e1699b3a9657d2672c40b52e5470e0a) | [`abi/PolydashHook.json`](abi/PolydashHook.json) | [Verified on Sourcify](https://sourcify.dev/server/v2/contract/4663/0x4d3066bBfF889023def912D2fDe36c44357fA0cC) | Current Uniswap V4 hook used after graduation. |
| **PolydashCommitVault** (current) | [`0xF013bF17D511E2f65D0dA4Bd320948646F567Ae4`](https://robinhoodchain.blockscout.com/address/0xF013bF17D511E2f65D0dA4Bd320948646F567Ae4) | — | [`abi/PolydashCommitVault.json`](abi/PolydashCommitVault.json) | [Verified on Sourcify](https://sourcify.dev/server/v2/contract/4663/0xF013bF17D511E2f65D0dA4Bd320948646F567Ae4) | Current commit vault, listed in the root README. Deploy tx is not recorded in `deployments.json`. |
| **PolydashCommitVault** (earlier) | [`0x8f125c9ec7acd52b9cd39f2a7441085559d84104`](https://robinhoodchain.blockscout.com/address/0x8f125c9ec7acd52b9cd39f2a7441085559d84104) | [`0xdd691f09…`](https://robinhoodchain.blockscout.com/tx/0xdd691f0979329d68cef3c185fd912857e402df12e739574df2c7c44d2b53074f) | [`abi/PolydashCommitVault.json`](abi/PolydashCommitVault.json) | [Verified on Sourcify](https://repo.sourcify.dev/4663/0x8f125c9ec7acd52b9cd39f2a7441085559d84104) | Commit vault deployed with the earlier factory. This is the address stored on `PolydashCommitVault` in `deployments.json`. |
| **PolydashToken** | — | — | [`abi/PolydashToken.json`](abi/PolydashToken.json) | — | ERC-20 deployed per launch by the factory (no single address). |
| **BuybackRouter** | — | — | [`abi/BuybackRouter.json`](abi/BuybackRouter.json) | — | Not deployed. |

Each deployed address above was checked with `eth_getCode` on the Robinhood Chain RPC on 2026-10-28 and has contract code (Factory 13704 bytes, Launch 10649 bytes, Hook 10005 bytes, CommitVault 5357 bytes).

### Tokenized funds (Phase 1a)

Unaudited. An outside review is planned. Not financial advice. Phase 1a is the raise and the mint. `createFund` deploys one `FundVault` and one `FundNFT` per fund. Source is `src/fund/` in the repository root, compiled with solc 0.8.24, optimizer 200 runs, via-IR, and EVM `paris`. That is separate from the launchpad compiler settings above.

| Contract | Address | Deploy tx | ABI | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| **FundFactory** | [`0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878`](https://robinhoodchain.blockscout.com/address/0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878) | [`0x3b02110b…`](https://robinhoodchain.blockscout.com/tx/0x3b02110bb45f421591c6712ce4498b5533286cbaf4d46581a1ed0c6deea49bf3) | [`abi/FundFactory.json`](abi/FundFactory.json) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878) | Constructor argument `0x9a21c75aC263cC43125E70200636f6397f8776d0` (owner and fee recipient). |
| **FundNFT** | — | — | [`abi/FundNFT.json`](abi/FundNFT.json) | `src/fund/FundNFT.sol` | Deployed per fund. No single address. |
| **FundVault** | — | — | [`abi/FundVault.json`](abi/FundVault.json) | `src/fund/FundVault.sol` | Deployed per fund. Holds mint ETH. |


### Legacy contracts

The earlier factory set (creator fee cap 0–2%, 200 bps). Launches created through it stay live and are still listed on polypad.family.

| Contract | Address | Deploy tx | ABI | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| PolydashFactory (legacy) | [`0x2c84cfcd8d283ef750e09fbed735d67f67845db2`](https://robinhoodchain.blockscout.com/address/0x2c84cfcd8d283ef750e09fbed735d67f67845db2) | [`0x966d0bd8…`](https://robinhoodchain.blockscout.com/tx/0x966d0bd8be8e220d0f961b850d8ede49ac11ad9114669bf2e33ae3825f609ded) | [`abi/PolydashFactory.json`](abi/PolydashFactory.json) | [Verified on Sourcify](https://repo.sourcify.dev/4663/0x2c84cfcd8d283ef750e09fbed735d67f67845db2) | Creates launches (clones of PolydashLaunch). |
| PolydashLaunch (legacy) | [`0xef7684268f13bc06cb02755642ceabef422b8b70`](https://robinhoodchain.blockscout.com/address/0xef7684268f13bc06cb02755642ceabef422b8b70) | [`0x60a54314…`](https://robinhoodchain.blockscout.com/tx/0x60a54314fdade940734d8e999bc9b846f82cf155ecb8d65197d79f50b5485ff0) | [`abi/PolydashLaunch.json`](abi/PolydashLaunch.json) | [Verified on Sourcify](https://repo.sourcify.dev/4663/0xef7684268f13bc06cb02755642ceabef422b8b70) | Launch implementation. Each launch is an EIP-1167 clone of this address. |
| PolydashHook (legacy) | [`0x04990e6671c98e1b43034e52366af11396d960cc`](https://robinhoodchain.blockscout.com/address/0x04990e6671c98e1b43034e52366af11396d960cc) | [`0xcfc039ca…`](https://robinhoodchain.blockscout.com/tx/0xcfc039ca3454373f97fc2e476ce643f20167527fd87c0679f61fc4d9ffa76fd8) | [`abi/PolydashHook.json`](abi/PolydashHook.json) | [Verified on Sourcify](https://repo.sourcify.dev/4663/0x04990e6671c98e1b43034e52366af11396d960cc) | Uniswap V4 hook used after graduation. |

### Constructor arguments

- `PolydashFactory` (current): `0x9a21c75aC263cC43125E70200636f6397f8776d0`, `0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad`, `0x9a21c75aC263cC43125E70200636f6397f8776d0`
- `PolydashFactory` (legacy): `0x9a21c75aC263cC43125E70200636f6397f8776d0`, `0xEf7684268f13BC06CB02755642CeAbEf422b8B70`, `0x9a21c75aC263cC43125E70200636f6397f8776d0`
- `PolydashHook` (legacy): `0x8366a39CC670B4001A1121B8F6A443A643e40951`, `0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2`
- `PolydashCommitVault` (deployed with the legacy factory): `0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2`

## Compiler settings

`solc 0.8.26`, optimizer enabled (200 runs), `via_ir = true`, EVM `cancun`, `bytecode_hash = none`.

## Layout

- [`contracts/`](contracts): Foundry project (`src/`, `test/`, `script/`, `docs/`, `abis/`).
- [`web/`](web): Next.js frontend for the launchpad.
- [`deployments.json`](deployments.json) and [`abi/`](abi): deployed addresses and ABIs.

## Build and test

```sh
cd polypad/contracts
./install-deps.sh   # installs forge-std, OpenZeppelin, Uniswap v4-core and v4-periphery into lib/ (pinned in foundry.lock)
forge build
forge test
```

Frontend: `cd polypad/web && cp .env.example .env && yarn install && yarn dev`.

## Docs

- [Architecture](contracts/docs/ARCHITECTURE.md)
- [Owner capabilities](contracts/docs/OWNER_CAPABILITIES.md)
- [Creator fee safety](contracts/docs/CREATOR_FEE_SAFETY.md)
- [Slither report](contracts/SLITHER_REPORT.md): static analysis output, not an audit.

## Files

- [`deployments.json`](deployments.json): full manifest (addresses, deploy txs, constructor args, compiler settings, ABIs).
- [`abi/`](abi): one ABI file per contract.

## License

MIT. See [LICENSE](LICENSE).
