# Fund core fix status

These contracts are unaudited. An outside review is planned. Not financial advice. This note is not a completion claim.

## What landed before this change

Phase 1 `FundFactory` `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878` on Robinhood Chain (chain ID 4663) is deployed. Its source in `src/fund/FundFactory.sol`, `FundVault.sol`, and `FundNFT.sol` is not modified here. Those vaults cannot gain a deadline, a refund, an exit, or a price feed.

Phase 2 source from PR 23 is on `main` at `5757b07` and was not deployed. This change edits that same `src/fund/phase2` set. It does not add a second factory.

## What this change adds

- `raiseDuration` of 1 hour to 30 days. Filling the cap or supply at or before the deadline sets `RaisingClosed`. After the deadline, `failRaise` sets `Failed` if the raise is still open.
- `refund` on `Failed` pays the current NFT holder a pro-rata share of spendable ETH. Entry and protocol fees stay out of that payment. The last outstanding units receive rounding dust.
- `exit` on `RaisingClosed` or `Investing` pays a pro-rata share of spendable ETH, WETH, and mandate tokens. Pause does not block it. A token that delivers less than the vault sent reverts the call, and the NFT stays in place.
- `nav()` is ETH plus WETH at face value, plus mandate balances at the allowlist feed. A missing, reverting, stale, zero, or out-of-bounds price reverts. Cost basis is not that number.
- Non-quote assets cannot be enabled without a feed that has code. The deploy script still starts with WETH only.

## Deployment readiness

Not ready to sign as a public fund, and not deployed.

`script/DeployFundFactoryInvest.s.sol` still reverts unless `CONFIRM_FUND_PHASE2_DEPLOY=yes`. It was not broadcast. Compiled ABIs are in `polypad/abi/phase2/`. They match this source, not an on-chain deployment.

Blocker: this repository has no production price-feed address for Robinhood Chain. The script does not invent one. Until a reviewed feed is supplied to `proposeAsset` and the timelock elapses, every asset except WETH stays disabled. ETH and WETH can be valued at face value. A mandate asset cannot.

Do not set `FUND_ROUTES_ENABLED`. Do not set `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS`. Header and footer do not link to `/funds`. Direct `/funds` routes render a not-live page.

## Abacus sync

Do not enable public Funds. Leave `FUND_ROUTES_ENABLED` unset. Leave `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` unset. Do not broadcast `DeployFundFactoryInvest`. Phase 2 is not deployed. There is no production price feed in this repo, so non-quote assets stay disabled. Phase 1 factory `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878` is unchanged.

## Still later

Secondary listings, living metadata, CarryNFT and a high-water mark, conviction locks, per-share wallets, NAV-floor bids, agent execution, seasons, clone-a-mandate, and distributions. Stock tokens are not in this change. None of that is deployed.
