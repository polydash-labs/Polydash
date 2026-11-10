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

`script/DeployFundFactoryInvest.s.sol` reverts unless `CONFIRM_FUND_PHASE2_DEPLOY=yes`. Fund routes stay off unless `FUND_ROUTES_ENABLED=enabled`. `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` stays unset in the repo. The header does not link to `/funds`.

Phase 3 is deployed from commit `0848c9c6271537ad5601415ad9f43fed5280169c`. It does not modify the Phase 1a or Phase 2 contracts. Sourcify exact match was confirmed by lookup on 2026-11-09. This record is not a review. Not financial advice.

| Contract | Address | Verification |
| --- | --- | --- |
| `StrategyTemplate` | [`0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba`](https://robinhoodchain.blockscout.com/address/0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0xb2a958a9779E02764dE006C8aeEbc36174E2E3Ba) |
| `FundSwapFacetPhase3` | [`0x40Ef3ae910A46aDDC14f45F0983060161884f045`](https://robinhoodchain.blockscout.com/address/0x40Ef3ae910A46aDDC14f45F0983060161884f045) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x40Ef3ae910A46aDDC14f45F0983060161884f045) |
| `FundFactoryPhase3` | [`0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`](https://robinhoodchain.blockscout.com/address/0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B) |

Deploy transactions: [`0x6cf3598a…1265`](https://robinhoodchain.blockscout.com/tx/0x6cf3598a2be973c1f35a6febc015e432b5e5efb6b894a4e578c7a7c40cf01265) (nonce 38), [`0xad686b96…f6b5`](https://robinhoodchain.blockscout.com/tx/0xad686b96634519ad554b7a39a8c4f0259c32e45df7f787acae1486188528f6b5) (nonce 39), [`0x51afc05a…cdd5`](https://robinhoodchain.blockscout.com/tx/0x51afc05a8d6bca09ecaafb2dc08b8fcb87ed93d30bd872e5349de014b699cdd5) (nonce 40). Signer `0x9a21c75aC263cC43125E70200636f6397f8776d0`. The factory fee recipient is that wallet. Its allowlist is the live Phase 2 allowlist and its WETH is `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. Its facet and template are the two contracts above.

Phase 4 is deployed from commit `8786fac1775c66d77deb3138771a740b3e466d0a`. It does not modify the Phase 1a, Phase 2, or Phase 3 contracts. Sourcify exact match was confirmed by lookup on 2026-11-09 (America/Los_Angeles). This record is not a review. Not audited. Not financial advice.

| Contract | Address | Verification |
| --- | --- | --- |
| `FundPhase4` | [`0x3cd372e32Da71321D795a32b244eAa16724531dB`](https://robinhoodchain.blockscout.com/address/0x3cd372e32Da71321D795a32b244eAa16724531dB) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x3cd372e32Da71321D795a32b244eAa16724531dB) |
| `FundShareAccount` | [`0xC189EBc950D3e3EE7AbBd597060C36DD3E06295E`](https://robinhoodchain.blockscout.com/address/0xC189EBc950D3e3EE7AbBd597060C36DD3E06295E) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0xC189EBc950D3e3EE7AbBd597060C36DD3E06295E) |

Deploy transaction: [`0x7e41f0f3…6653`](https://robinhoodchain.blockscout.com/tx/0x7e41f0f3a493c498e52ef36d8bdeed012db2e6e3a58e0779e003de5284a16653) (nonce 44). Signer `0x9a21c75aC263cC43125E70200636f6397f8776d0`. The constructor argument is the live Phase 3 factory `0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`. `FundShareAccount` is created inside that constructor. The ERC-6551 registry remains `0x000000006551c19487814612e58FE06813775758`. `script/DeployFundPhase4.s.sol` reverts unless `CONFIRM_FUND_PHASE4_DEPLOY=yes`. The unsigned package remains [`deploy/phase4/unsigned`](../deploy/phase4/unsigned).

Phase 5 is deployed from commit `63d4f745b83d89a2863ff3a82f010ff1da2c501c`. It does not modify the Phase 1a, Phase 2, Phase 3, or Phase 4 contracts. Sourcify exact match was confirmed by lookup on 2026-11-09 (America/Los_Angeles). This record is not a review. Not audited. Not financial advice.

| Contract | Address | Verification |
| --- | --- | --- |
| `FundPhase5` | [`0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81`](https://robinhoodchain.blockscout.com/address/0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81) |
| `FundSecondaryMarket` | [`0xa2bE46731340A9a5C53DA7D21b6bB8DA3faaC23C`](https://robinhoodchain.blockscout.com/address/0xa2bE46731340A9a5C53DA7D21b6bB8DA3faaC23C) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0xa2bE46731340A9a5C53DA7D21b6bB8DA3faaC23C) |
| `FundShareRenderer` | [`0x6DbC2Df3AE18a610978Ac3c0b765057800CABd0b`](https://robinhoodchain.blockscout.com/address/0x6DbC2Df3AE18a610978Ac3c0b765057800CABd0b) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x6DbC2Df3AE18a610978Ac3c0b765057800CABd0b) |
| `FundCarryRights` | [`0x37d171924Af4072F62ad564C954E977E1D3967c9`](https://robinhoodchain.blockscout.com/address/0x37d171924Af4072F62ad564C954E977E1D3967c9) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x37d171924Af4072F62ad564C954E977E1D3967c9) |
| `FundConvictionLock` | [`0x4D216Ad3f28e9eF183483f37b7Ec05b9b46C9B95`](https://robinhoodchain.blockscout.com/address/0x4D216Ad3f28e9eF183483f37b7Ec05b9b46C9B95) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x4D216Ad3f28e9eF183483f37b7Ec05b9b46C9B95) |
| `FundNavFloor` | [`0x8e4f163e6dCe71Ef1290Ed264c6F11f13F309afb`](https://robinhoodchain.blockscout.com/address/0x8e4f163e6dCe71Ef1290Ed264c6F11f13F309afb) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x8e4f163e6dCe71Ef1290Ed264c6F11f13F309afb) |

Deploy transaction: [`0xfa8af1123322d5d171997be0961333b94c1633ee728697df3af2d321a77e004f`](https://robinhoodchain.blockscout.com/tx/0xfa8af1123322d5d171997be0961333b94c1633ee728697df3af2d321a77e004f) (nonce 45). Signer `0x9a21c75aC263cC43125E70200636f6397f8776d0`. The constructor argument is the live Phase 3 factory `0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`. The five modules are created inside that constructor. `script/DeployPhase5.s.sol` reverts unless `CONFIRM_FUND_PHASE5_DEPLOY=yes`.
