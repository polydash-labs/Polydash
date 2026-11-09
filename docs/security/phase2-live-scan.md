# Phase 2 live security scan

This is a security scan of the Phase 2 contracts that are on Robinhood Chain (chain ID 4663). It is not a review, and it is not a statement that the contracts are audited, safe, or guaranteed. Not financial advice.

Scanned at block 110,286,627 on 2026-11-09. Reads used `https://rpc.mainnet.chain.robinhood.com`. The Blockscout HTTP API returned Cloudflare 403 from this environment, the same limitation recorded for the Phase 1a factory. Sourcify is the verification of record.

## Verdict

No Critical or High finding. Two Medium findings are operational and policy bounds, not a path that moves vault principal to the owner today. The live allowlist has one router (the adapter) and one asset (WETH). No fund has been created (`allFundsLength` is 0). The signer nonce after the factory transaction is 38, so nothing was sent after nonce 37.

## Deployment

Source commit `e4ceacaab5175bc4e7724fafe3fedc8831085563` (`Phase 2 finish: fee-excluded NAV, caps, mandate URI, checkpoint, V3 router adapter`). The broadcast record on that commit names the same commit. Later commits `9e33f76`, `1077c25`, and `0766444` do not change these `.sol` files. `main` at `91c3c9d` does not reproduce the creation bytecode. Open PRs #25 and #26 do not either: #25 is a separate v2 factory, and #26 republishes the `5757b07` creation package.

Compiler, taken from the Sourcify metadata and recompiled with `solc 0.8.24+commit.e11b9ed9`: via-IR, optimizer on, 200 runs, EVM `paris`, `bytecodeHash` `ipfs`. Creation code from that standard JSON was compared to each transaction input with the ABI constructor arguments removed. The bytes match. The arguments below are the removed suffix.

| Contract | Address | Nonce | Tx | Creation bytes (with args) | Input keccak |
| --- | --- | --- | --- | --- | --- |
| `FundSwapFacet` | `0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0` | 34 | [`0x662d664a…9012`](https://robinhoodchain.blockscout.com/tx/0x662d664a123b146f13f7e35ee20a3d3c0841f603ec522a969b2ed404464c9012) | 8753 | `0x4c961d71687ac6095ee0edbb6e80b27dd6ebdb6ea924a8c384e4cb12b4621cb1` |
| `UniswapV3RouterAdapter` | `0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581` | 35 | [`0x351a70ec…cb47`](https://robinhoodchain.blockscout.com/tx/0x351a70eccbff7dbcc82c214ab769b17d06d99b69d025db7b4e5cdd5ba9b1cb47) | 2777 | `0xe5fcb40b35382374659eb58fd57c376ad83b9c4607b68522ed284cc5c8511ce7` |
| `FundAllowlist` | `0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19` | 36 | [`0x63ef7353…ec03`](https://robinhoodchain.blockscout.com/tx/0x63ef73531d00c303869cfe38de6e45316a4f0aa8cf59366a241214d8a263ec03) | 8111 | `0x3c80bf32fce9d3de958c70093602a0356321d1269937dae3d3101ef772b310b8` |
| `FundFactoryInvest` | `0xd3c6ae470c25989cC8d2876c1855fB570B98894E` | 37 | [`0xaeae5c14…32fd`](https://robinhoodchain.blockscout.com/tx/0xaeae5c14d51d7d81ed44bf3f2c6f1e7babfc05246b8307a7b33c283cc71c32fd) | 34758 | `0x951e469cba5446afdcd090b52deba8d4c91514285e1ceb130bf26efd0655e0bb` |

Deployer and owner: `0x9a21c75aC263cC43125E70200636f6397f8776d0`. Timestamps: facet, adapter, and allowlist at 2026-11-09 14:14:20–25Z; factory at 2026-11-09 16:18:27Z.

Constructor arguments:

- Facet: none. `self()` is the facet address.
- Adapter: SwapRouter02 `0xCaf681a66D020601342297493863E78C959E5cb2`, WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. `router()` and `weth()` return those values. `WETH9()` on SwapRouter02 returns the same WETH.
- Allowlist: owner = deployer, delay = 172800, routers = `[adapter]`, assets = `[WETH as quote, no feed]`.
- Factory: fee recipient = deployer, allowlist, WETH, facet. `PROTOCOL_FEE_BPS` is 20. `vaultDeployer` is `0x111aC00A91944477141aDe12ebB6BcB0CEFC3a95`. `nftDeployer` is `0x5766A7A937D0De897C2d90df0D045f9067fd72D5`.

The NatSpec titles in `src/fund/phase2` still say the contracts are not deployed. Those strings are part of the verified source and were not edited.

## Live config

| Getter | Value |
| --- | --- |
| Factory `owner`, `feeRecipient` | `0x9a21c75aC263cC43125E70200636f6397f8776d0` |
| `pendingOwner` (factory and allowlist) | zero |
| `weth` | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| `allowlist` | `0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19` |
| `swapFacet` | `0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0` |
| `allFundsLength` | 0 |
| Allowlist `delay` | 172800. `MIN_DELAY` is 86400. `setDelay` cannot shorten it. |
| `paused` | false |
| `quoteAsset` | WETH. `feedOf(WETH)` is the zero address. |
| Routers | 1, the adapter. `routerAllowed(SwapRouter02)` is false. |
| Assets | 1, WETH. No non-quote asset. `proposalCount` is 0. |
| `MAX_STALE` | 86400 |
| Sequencer | No `ChainlinkNavFeed` was deployed in these four transactions. The allowlist has no feed. A feed constructed with `requireSequencer = true` and no sequencer address reverts `OutageGuardMissing`. |

## Sourcify

Exact match (`creationMatch` and `runtimeMatch`) for all four, solc 0.8.24+commit.e11b9ed9:

| Address | Sourcify | Verified at |
| --- | --- | --- |
| Facet | [match 58916575](https://sourcify.dev/server/v2/contract/4663/0xA2620b14d1A39d4afbEAA4b87a7E7871050b50a0) | 2026-11-09T18:49:06Z |
| Adapter | [match 58916647](https://sourcify.dev/server/v2/contract/4663/0xA5187f8e56Dd0784624D833CEE3bF6f2Aa5E7581) | 2026-11-09T18:49:58Z |
| Allowlist | [match 58916751](https://sourcify.dev/server/v2/contract/4663/0x7A42Dc64f77711EA20d163eFB1B9FaCCC2cA2c19) | 2026-11-09T18:51:05Z |
| Factory | [match 58916718](https://sourcify.dev/server/v2/contract/4663/0xd3c6ae470c25989cC8d2876c1855fB570B98894E) | 2026-11-09T18:50:51Z |

The verified sources are the files at that commit, including `src/fund/phase2/UniswapV3RouterAdapter.sol`. Blockscout's API did not answer (Cloudflare 403), so this scan did not push a second verification. Sourcify already has the exact match.

## What was run

- `solc 0.8.24` standard JSON against the Sourcify metadata settings. Creation bytecode matches, as above.
- `forge test --match-path test/fund`: 65 tests passed, including fuzz `testFuzz_conservation` (1000 runs), `testFuzz_refund_matches_spendable_and_leaves_fees` (1000), and `testFuzz_raise_then_round_trip_conserves_fees` (1000).
- `forge test --match-contract Phase2LiveForkTest` with `FORK_RPC` pointed at the public Robinhood RPC: `test_live_config` and `test_live_lifecycle` passed. The lifecycle runs on a local fork of the live addresses. It creates a fund, mints, fails a raise and refunds spendable ETH, passes the 172800-second allowlist timelock, checks manager and executor limits, rejects a router that keeps the ETH, wraps and unwraps WETH 1:1, swaps through the live adapter against the live USDG pool (fee tier 500), reads `nav()`, and pays a pro-rata exit. An exit callback that calls `withdrawProtocolFee` is rejected and the 20 bps fee stays in the vault. Nothing was broadcast.
- Slither 0.11.6 on `src/fund/phase2`. Detectors that fired, and how they were triaged:
  - `arbitrary-send-eth` and `controlled-delegatecall`: the router call is the allowlisted swap, and the delegatecall target is the immutable facet with a fixed selector. A direct call to the facet reverts.
  - `reentrancy-balance` and `reentrancy-eth`: `swap`, `settleExit`, `settleRefund`, and the fee pulls are `nonReentrant`. The before/after balances are the measurement. The fork test rejects a reentrant fee pull during exit.
  - `uninitialized-state` on the facet: those variables live in the vault. The facet runs by delegatecall. A direct call reverts.
  - `divide-before-multiply`: `maxSupply = raiseCap / mintPrice`, then skin is computed from that supply. That rounding is the intended supply rule.
  - `incorrect-equality`: the 1:1 wrap check and the exact token-delivery check.
  - `unused-return`, `constable-states`, `immutable-states`: the ignored words are the Chainlink round fields the code does not use, and Slither reads the facet's copy of storage as if the facet were a standalone vault.

No Slither result above was left as an untriaged defect.

## Findings

| Rank | Finding |
| --- | --- |
| Medium | The allowlist and the factory are owned by one EOA, `0x9a21c75aC263cC43125E70200636f6397f8776d0`, which is also the fee recipient. `pendingOwner` is zero. The deploy notes describe a later 2-of-3 transfer. That transfer is not on chain (nonce stopped at 38). The owner can pause immediately, queue a router or asset that becomes active after 172800 seconds, and change the fee recipient. The owner cannot shorten the delay. There is no function that sends vault principal to the owner. |
| Medium | If a non-quote asset is allowlisted later, a fund created with the zero cap arguments uses the defaults: 75% of fee-excluded NAV in one position, 75% in one trade, and execution within 50% of the feed (`DEFAULT_MAX_POSITION_BPS`, `DEFAULT_MAX_TRADE_BPS`, `DEFAULT_MAX_DEVIATION_BPS`). Caps are fixed at creation. No non-quote asset is allowlisted now, so this path is not live. |
| Low | `MAX_STALE` is 1 day. A feed can be 24 hours old and still pass `quote`. The deviation check is the other bound. The live allowlist has no feed. |
| Low | `UniswapV3RouterAdapter` has no reentrancy guard and no sweep. A callback token could reenter `swap` on the adapter. The vault does not approve the router; it transfers `amountIn` and measures its own balances. Raw SwapRouter02 is not allowlisted. No non-quote asset is live. |
| Low | `checkpointNav` is not `nonReentrant`. A callback while `inSwap` is true can write one mid-swap checkpoint. It does not move balances. |
| Info | A failed raise refunds pro-rata spendable ETH. Entry and protocol fees stay in the vault. It is not a return of the mint price. The fork test observed 1 ETH with a 100 bps entry fee refund 0.988 ETH and leave 0.010 ETH entry plus 0.002 ETH protocol. |
| Info | The constructor set (adapter and WETH) is active immediately. Later allowlist edits wait 172800 seconds. Pause is immediate and does not block `exit` or `refund`. |
| Info | WETH wrap and unwrap revert unless the WETH balance change equals the ETH amount. The fork test wrapped and unwrapped 0.2 ETH 1:1 on a vault created by the live factory. |
| Info | Protocol fee is the constant 20 bps. `deposit` checks the NFT's fee split against `(msg.value * bps) / 10_000`. |
| Info | Phase 1a factory `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878` codehash was unchanged across the fork test. |

## What this scan did not do

It did not sign or broadcast. It did not move ownership. It did not allowlist a non-quote asset on mainnet. The USDG allowlist change in the fork test exists only in that test's local fork. Fund routes stay off unless `FUND_ROUTES_ENABLED` is exactly `enabled`, and `getFundInvestFactoryAddress()` stays null until `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` is set.
