# Deployments

Canonical machine-readable list: [`deployments/robinhood-chain.json`](../deployments/robinhood-chain.json).

Every address in that file is already recorded elsewhere in this repository. The manifest does not add contracts, transactions, or constructor arguments that the repo does not already contain. The Polypad launchpad ABI bundle remains [`polypad/deployments.json`](../polypad/deployments.json).

Network: **Robinhood Chain**, chain ID **4663**.

- RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)
- Human-readable tables: [README](../README.md#deployed-contracts) and [creator contracts](CREATOR_CONTRACTS.md)

## Two Polypad generations

| | Current | Earlier |
| --- | --- | --- |
| Factory | `0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2` | `0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2` |
| Launch implementation | `0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad` | `0xef7684268f13bc06cb02755642ceabef422b8b70` |
| Uniswap V4 hook | `0x4d3066bBfF889023def912D2fDe36c44357fA0cC` | `0x04990E6671C98e1B43034E52366Af11396d960CC` |
| Commit vault | `0xF013bF17D511E2f65D0dA4Bd320948646F567Ae4` | `0x8f125c9ec7acd52b9cd39f2a7441085559d84104` |
| Creator fee cap | 500 bps (5%) | 200 bps (2%) |

`polypad/deployments.json` records the **earlier** commit vault (`0x8f125c…`). The root README lists `0xF013bF…` as the current commit vault. Both are verified on Sourcify under the name `PolydashCommitVault`. Launches from the earlier factory stay listed.

The in-repo launchpad sources match the current factory, launch implementation, and hook, as described in [`polypad/README.md`](../polypad/README.md). NFT factory, marketplace, and token-link contracts are deployed and listed, and their source is not in this repository. Sourcify names for those addresses: `PolypadNFTFactory`, `PolypadCurveFactory`, `PolypadNFTMarket`, and `PolypadTokenLink` (the README lists the last of these as NFT token rewards).

## Verification

Sourcify status in the manifest is the status already stated in this repository, except the current commit vault and the four NFT contracts above, whose Sourcify v2 records were checked when this manifest was added (`match`, solc 0.8.26). Verification is not a review.

Staking factory v1 (`0x0aAEa47d2e7303EC5a809062eafa59e7F011D857`) is legacy and is not described as explorer-verified. See the v1 warning in the README.

These contracts are unaudited. An outside review is planned. Not financial advice.

## Tokenized funds

| Contract | Address | Verification |
| --- | --- | --- |
| `FundFactory` | [`0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878`](https://robinhoodchain.blockscout.com/address/0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878) |

Phase 1a source is [`src/fund`](../src/fund). Deploy transaction [`0x3b02110bb45f421591c6712ce4498b5533286cbaf4d46581a1ed0c6deea49bf3`](https://robinhoodchain.blockscout.com/tx/0x3b02110bb45f421591c6712ce4498b5533286cbaf4d46581a1ed0c6deea49bf3). `owner` and `feeRecipient` are the platform fee wallet `0x9a21c75aC263cC43125E70200636f6397f8776d0`. `createFund` deploys each `FundVault` and `FundNFT`. Blockscout's API verification was blocked by Cloudflare. Sourcify is the verification of record. These contracts are unaudited. An outside review is planned. Not financial advice. Verification is not a review.

Phase 2 is deployed and is a different factory. It does not modify the Phase 1a factory above. Source commit `e4ceacaab5175bc4e7724fafe3fedc8831085563`. The security scan is [phase2-live-scan.md](security/phase2-live-scan.md). That scan is not a review.

| Contract | Address | Verification |
| --- | --- | --- |
| `FundSwapFacet` | [`0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0`](https://robinhoodchain.blockscout.com/address/0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0) |
| `UniswapV3RouterAdapter` | [`0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581`](https://robinhoodchain.blockscout.com/address/0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581) |
| `FundAllowlist` | [`0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19`](https://robinhoodchain.blockscout.com/address/0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19) |
| `FundFactoryInvest` | [`0xd3c6ae470c25989cC8d2876c1855fB570B98894E`](https://robinhoodchain.blockscout.com/address/0xd3c6ae470c25989cC8d2876c1855fB570B98894E) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0xd3c6ae470c25989cC8d2876c1855fB570B98894E) |

`script/DeployFundFactoryInvest.s.sol` reverts unless `CONFIRM_FUND_PHASE2_DEPLOY=yes`. Fund routes stay off unless `FUND_ROUTES_ENABLED=enabled`. `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` stays unset in the repo.
