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

Phase 2 v1 `FundFactoryInvest` `0x0849195DCBCD4a06265563dC3ebC4eb1a656aabe` is deployed and is not the factory the site should use. Phase 2 v2 is source in `src/fund/phase2v2` and is not deployed. See [FUND_PHASE2_V2.md](FUND_PHASE2_V2.md). `script/DeployFundFactoryV2.s.sol` reverts unless `CONFIRM_FUND_PHASE2_V2_DEPLOY=yes`. It does not call the Phase 1 factory or the v1 factory.
