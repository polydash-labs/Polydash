# Tokenized funds (Phase 1a)

These contracts are unaudited. An outside review is planned. Not financial advice. `FundFactory` is deployed on Robinhood Chain. Details are in [Deployment](#deployment-robinhood-chain-chain-id-4663). Sourcify exact match is a bytecode check. It is not a review.

Phase 1a is the raise. A manager creates a fund the way a creator creates an NFT collection, as an alternative to launching a token. Buyers mint ERC-721 units at a fixed ETH price. Each NFT is one equal unit. A wallet's share of what has been minted is `balanceOf(wallet) / totalMinted`.

Phase 2 investing is a separate set of contracts in [`phase2`](phase2). It is not deployed. The live `FundFactory` does not create those vaults. See [Phase 2](#phase-2-not-deployed).

`FundFactory` deploys one `FundVault` and one `FundNFT` per fund with `new`. That is the same style as the staking, vesting, bond, and NFT staking factories. There is no proxy and no upgrade path.

## What a manager sets

- Name (1–64 bytes) and symbol (1–16 bytes).
- Image URI and base URI (each at most 512 bytes). The base URI can be changed until the first mint, then it is fixed. `tokenURI` is `baseURI + id + ".json"`, or the image URI when the base URI is empty.
- `mintPrice` in wei, from 0.00001 ETH to 100 ETH. Buyers pay exactly `qty * mintPrice`.
- `raiseCap` in wei. `maxSupply = raiseCap / mintPrice`, rounded down, and it must be from 1 to 10,000. `raiseCap % mintPrice` wei cannot mint another NFT. `previewSupply` returns that remainder. When `maxSupply` is minted, recorded raised ETH is `maxSupply * mintPrice`, which is less than or equal to `raiseCap`.
- `entryFeeBps`, optional, 0 to 500 (0% to 5%). This is the manager's fee on mint ETH, the same cap as the launchpad creator fee.
- `minSkinBps`, optional. `0` selects the default of 500 (5%). Any other value must be from 500 to 10,000. The required unit count is `ceil(maxSupply * minSkinBps / 10_000)`.

## Raise

ETH paid to mint is forwarded to the vault in the same transaction. It is not sent to the manager's wallet.

`raised` on the vault is the gross ETH from mints. The protocol fee and the entry fee are floored independently out of that gross amount (same rounding as the launchpad fee split). The remainder is `principal`.

The protocol fee is 0.2% (`PROTOCOL_FEE_BPS = 20`), the same hard-coded platform fee as the launchpad. There is no setter. It is paid to `feeRecipient` on the factory when anyone calls `withdrawProtocolFee`. The factory owner can point `feeRecipient` at a new address. That does not move principal, and it does not change the rate.

The manager can pull accrued entry fees to the payout wallet (`withdrawEntryFee`). The payout wallet starts as the manager and can be changed by the manager. That pull does not send principal.

The manager must mint at least `skinRequired` units, paying `mintPrice` like anyone else, before another wallet can mint. After that, `publicOpen` is true. The manager's later transfers do not close public minting again: the requirement is to mint, not to keep holding.

Minting stops when the vault is `RaisingClosed`. That happens when gross raised ETH is at least `raiseCap`, or when `maxSupply` NFTs have been minted. Phase 1a has no further status. There is no function that withdraws principal to an externally owned account, and no function that invests it.

`navPerNft()` is `address(vault).balance / totalSupply()`. It counts ETH only. Integer division leaves a remainder in the vault. It is not a market price. `ownershipBps(account)` is `balanceOf(account) * 10_000 / totalMinted`, also floored.

Direct ETH transfers to the vault revert. ETH forced into the vault stays there, increases `navPerNft`, and cannot be pulled by the fee functions.

## Not in Phase 1a

A carry NFT, token-bound accounts, a floor bid, a secondary market, redeeming units, metadata that changes after mint, and an agent executor. Those are not implemented. Allowlisted swaps are Phase 2, in separate files, and they are not on the deployed factory.

## Phase 2 (not deployed)

`FundFactoryInvest`, `FundVaultInvest`, `FundNFTInvest`, `FundSwapFacet`, `FundAllowlist`, and `NAVReader` are unaudited. The swap body is in `FundSwapFacet`. Each vault delegatecalls it, so the factory does not carry a copy of that code. A direct call to the facet reverts. An outside review is planned. Not financial advice. Do not broadcast them until that deploy is intentional. `script/DeployFundFactoryInvest.s.sol` reverts unless `CONFIRM_FUND_PHASE2_DEPLOY=yes`. It does not call the live factory. There is no proxy and no upgrade of a Phase 1a vault. A Phase 1a fund stays raise-only.

The raise and the mint match Phase 1a, including the manager skin gate, plus a raise deadline of 1 hour to 30 days. Filling the supply or the cap at or before the deadline sets `RaisingClosed`. After the deadline, anyone can call `failRaise` if it is still `Raising`. That sets `Failed`. Minting stops. The manager cannot open investing. The current holder of each NFT calls `refund` and receives a pro-rata share of spendable ETH. Unclaimed entry and protocol fees are not part of that payment and can still be pulled. A transferred NFT pays the current holder. The last outstanding units receive the rounding dust.

After `RaisingClosed` or `Investing`, the current holder calls `exit` and receives a pro-rata share of spendable ETH, WETH, and mandate tokens. The last outstanding units receive the dust. Pause does not block `exit` or `refund`. Native ETH is sent first. If a token transfer reverts or returns false and the tokens are still in the vault, that share is reserved as `tokenOwed` and the ETH payment stands. `claimOwed` can be retried. A fee-on-transfer token is not supported: a short delivery is not reversed and is not reserved. A recipient that rejects ETH reverts the whole exit, because the ETH was not accepted. There is still no function that sends principal to the manager.

A failed-raise refund is the spendable ETH only. It is not a return of the mint price. The 0.2% protocol fee and any entry fee stay withheld and can still be pulled.

The mandate hash is stored at create. The asset list stored with it is the per-fund universe. It must already be on the global allowlist, and it cannot include WETH. WETH is the wrapped quote. ETH is the native quote. A swap is quote against one mandate asset, through an allowlisted router, or a direct ETH ↔ WETH wrap with no router. The vault measures its own balances. `minAmountOut` has to be greater than zero. The router address has code. Proceeds that do not arrive at the vault revert the transaction.

`nav()` is the vault's ETH, plus its WETH at the same face value, plus each mandate asset at its allowlist feed. `navPerNft()` divides that by the outstanding NFTs. Integer division leaves a remainder. A missing feed, a feed that reverts, a stale timestamp, a zero price, or a price outside the configured bounds makes `nav()` revert. Cost basis is still stored for the blotter and is not this number. This repository does not record a production price feed for Robinhood Chain. The deploy script does not set one. A non-quote asset stays disabled until a reviewed feed is passed to `proposeAsset`.

`Trade(asset, side, size, price, navAfter)` is the blotter event. The vault also keeps the latest 32 trades for readers that do not scan logs. `side` is 0 for a buy or a wrap, and 1 for a sell or an unwrap. `price` is quote wei per 1e18 raw token units.

The allowlist's constructor set is active immediately. Later additions and removals wait `delay` (at least one day, default two days in the deploy script, and the delay can only be lengthened). Pause is immediate and blocks swaps. It does not move balances. The manager can pause that vault's swaps immediately. The manager can name up to eight executors. An executor can swap. An executor cannot open investing, change the payout wallet, or pull fees.

`protectionBits()` reports custody, the allowlist, skin once the manager share is minted, published source, and the allowlist timelock. The high-water mark bit is unset. The source bit means this code is in the repository. It is not a review.

The deploy script's initial allowlist is WETH as the quote and nothing else. Routers are added with `propose`. Other assets are added with `proposeAsset` and a feed, then `execute` after the delay. `FUND_INVEST_WETH` is required and has no default. One reference for that address is `weth()` on `PolydashBuybackVault` `0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193`. The signer sets `FEE_RECIPIENT` or `FUND_INVEST_FEE_RECIPIENT`, and `PRIVATE_KEY` unless `DEPLOY_FUND_INVEST_PK` is set for a test. Leave `DEPLOY_FUND_INVEST_PK` unset for a broadcast. Do not commit a key. Do not put a guessed feed address in the script.

```bash
export ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export CONFIRM_FUND_PHASE2_DEPLOY=yes
export FUND_INVEST_WETH=0xWETH_ON_ROBINHOOD_CHAIN
export FEE_RECIPIENT=0x9a21c75aC263cC43125E70200636f6397f8776d0
export PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY_HERE

forge script script/DeployFundFactoryInvest.s.sol --rpc-url robinhood --broadcast
```

That command is not a broadcast from this change. The site fund routes stay off unless the server variable `FUND_ROUTES_ENABLED` is exactly `enabled`. Do not set that for a public resync. `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` stays unset. The header and footer do not link to `/funds`.

## Tests

`test/fund/Fund.t.sol` and `test/fund/DeployFundFactory.t.sol` cover Phase 1a.

`test/fund/FundInvest.t.sol` and `test/fund/DeployFundFactoryInvest.t.sol` cover the invest path, the allowlist, NAV, the raise-to-invest transition, and the skin gate. `test/fork/FundInvestFork.t.sol` runs the same path on a local fork and checks that the live factory's code is unchanged. It returns immediately when `FORK_RPC` is unset.

## Deployment (Robinhood Chain, chain ID 4663)

These contracts are unaudited. An outside review is planned. Not financial advice. Sourcify exact match is a bytecode check. It is not a review.

| Contract | Address | Verification |
| --- | --- | --- |
| `FundFactory` | [`0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878`](https://robinhoodchain.blockscout.com/address/0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878) | [Sourcify exact match](https://sourcify.dev/server/v2/contract/4663/0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878) |

Deploy transaction: [`0x3b02110bb45f421591c6712ce4498b5533286cbaf4d46581a1ed0c6deea49bf3`](https://robinhoodchain.blockscout.com/tx/0x3b02110bb45f421591c6712ce4498b5533286cbaf4d46581a1ed0c6deea49bf3) (block 107836877). `owner` and `feeRecipient` are `0x9a21c75aC263cC43125E70200636f6397f8776d0`. Phase 1a is the raise and the mint. `createFund` deploys one `FundVault` and one `FundNFT` per fund. Blockscout's API verification was blocked by Cloudflare. Sourcify is the verification of record, the same pattern as the other factories.

The NatSpec titles in `src/fund` still say "DRAFT - not reviewed, not deployed". They are left unchanged so the source stays the verified exact match.

`script/DeployFundFactory.s.sol` is the script that broadcast this factory. It reads `PRIVATE_KEY` and `FEE_RECIPIENT`. Both were required. The script has no default recipient. Leave `DEPLOY_FUND_FACTORY_PK` unset. If that variable is set, the script uses it instead of `PRIVATE_KEY`. The unit test is the only caller that sets it, so the test does not share `PRIVATE_KEY` with the staking deploy test in one Foundry process. Copy [`.env.example`](../../.env.example) to `.env` on the machine that signs. Do not commit `.env`, a key, or a keystore. Running the command again deploys a second factory.

Compiler settings come from [`foundry.toml`](../../foundry.toml): solc 0.8.24, optimizer 200 runs, via-IR, `bytecode_hash = "ipfs"`, and EVM `paris` for `src/fund/**`.

```bash
export ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export FEE_RECIPIENT=0x9a21c75aC263cC43125E70200636f6397f8776d0
export PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY_HERE

forge script script/DeployFundFactory.s.sol --rpc-url robinhood --broadcast
```

`ROBINHOOD_RPC_URL` can be the public RPC or an Alchemy URL for chain ID 4663. `--rpc-url robinhood` reads that variable. The script logs the factory address, `owner`, and `feeRecipient`.

Sourcify, already recorded for the address above:

```bash
forge verify-contract 0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878 src/fund/FundFactory.sol:FundFactory --chain 4663 --verifier sourcify
```

Sourcify compares the on-chain creation code, which includes the fee-recipient constructor argument. If a new submission needs that argument called out, add `--guess-constructor-args`, or pass `--creation-transaction-hash 0x3b02110bb45f421591c6712ce4498b5533286cbaf4d46581a1ed0c6deea49bf3`.
