# Fund core fix status

These contracts are unaudited. An outside review is planned. Not financial advice. This note is not a completion claim.

## What landed before this change

Phase 1 `FundFactory` `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878` on Robinhood Chain (chain ID 4663) is deployed. Its source in `src/fund/FundFactory.sol`, `FundVault.sol`, and `FundNFT.sol` is not modified here. Those vaults cannot gain a deadline, a refund, an exit, or a price feed.

Phase 2 source from PR 23 is on `main` at `5757b07` and was not deployed. This change edits that same `src/fund/phase2` set. It does not add a second factory.

## What this change adds

- `raiseDuration` of 1 hour to 30 days. Filling the cap or supply at or before the deadline sets `RaisingClosed`. After the deadline, `failRaise` sets `Failed` if the raise is still open.
- `refund` on `Failed` pays the current NFT holder a pro-rata share of spendable ETH. It is not the mint price. The 0.2% protocol fee and any entry fee stay withheld. The last outstanding units receive rounding dust.
- `exit` on `RaisingClosed` or `Investing` pays a pro-rata share of spendable ETH, WETH, and mandate tokens. Pause does not block it. Native ETH is sent even if a later token transfer reverts and the tokens are still in the vault. That share is reserved as `tokenOwed` and is not given to the next holder. `claimOwed` retries it. If the token balance changes and the holder does not receive the full amount, the exit reverts. Fee-on-transfer tokens are not supported. A recipient that rejects ETH reverts that holder's exit. Wrap and unwrap revert unless the WETH amount equals the ETH amount.
- `nav()` is ETH plus WETH at face value, plus mandate balances at the allowlist feed. A missing, reverting, stale, zero, or out-of-bounds price reverts. Cost basis is not that number.
- Non-quote assets cannot be enabled without a feed that has code. The deploy script still starts with WETH only.

## Deployment readiness

Not ready to sign as a public fund, and not deployed.

`script/DeployFundFactoryInvest.s.sol` still reverts unless `CONFIRM_FUND_PHASE2_DEPLOY=yes`. It was not broadcast. Compiled ABIs are in `polypad/abi/phase2/`. They match this source, not an on-chain deployment.

Feeds are published. They are not allowlisted and not deployed into a fund.

The public dataset for Robinhood Chain mainnet lists primary Shared SVR proxies. A read on chain 4663 showed 9571 bytes of code, 8 decimals, a positive `latestRoundData` answer, and `answeredInRound == roundId`. The dataset heartbeat is 86400 seconds and the deviation threshold is 0.5. That heartbeat is the feed's advertised update interval. It is not a trading freshness bound. This allowlist rejects a staleness ceiling above 1 hour, so 86400 cannot be configured as `maxStale`.

| Pair | Proxy | Label |
| --- | --- | --- |
| ETH/USD | `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` | Shared SVR |
| USDC/USD | `0x9e6f4605992a899eE2999999F3Ec80C41F452546` | Shared SVR |
| USDT/USD | `0xbf3550B6fAe1671da7C238Af12e03Ac586BEf3B1` | Shared SVR |
| WBTC/USD | `0x62107b0d3adA75fc1697fD342d99eed947a3aA5E` | Shared SVR |

`ChainlinkNavFeed` divides asset/USD by ETH/USD and scales into raw token units. A decimal shift alone is not that conversion. Secondary proxies were not read. Shared SVR access and integration were not reviewed. No canonical ERC-20 address is tied to USDC, USDT, or WBTC here. Robinhood's contract page lists WETH at `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. SwapRouter02 `WETH9()` and the recorded V2 router `WETH()` return that address. It is an ERC-1967 proxy. A fork exercise of `deposit`, `withdraw`, `transfer`, and a zero `balanceOf` is 1:1, which is what face-value NAV assumes. That is not a review of the proxy admin, and it does not connect WETH to the ETH/USD feed. Chainlink's published L2 sequencer list still omits Robinhood Chain, and the chain docs do not name an uptime proxy. The adapter reverts when a sequencer guard is required and no sequencer is set. No other network's uptime feed is copied. The deploy script does not set any of these proxies.

Price-dependent production use stays blocked until source, access semantics, canonical assets, a reviewed freshness bound, the outage guard, and a bounded router simulation are validated.

Uniswap's Robinhood Chain V3 deployment list names contracts whose code size was read at the RPC. They are not allowlisted and this source does not call them:

| Contract | Address | Code size read |
| --- | --- | --- |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` | 24497 bytes |
| UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` | 24546 bytes |
| V3Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | 24535 bytes |

QuoterV2 `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` has 8273 bytes of code and was not called. Its source, ABI, and pools are not verified here. SwapRouter02 `WETH9()` and Uniswap V2 router `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` `WETH()` both return the documented WETH. Those routers are not allowlisted and no swap was simulated through them. UniversalRouter is not given a blanket allow. Ethereum example token addresses are not copied.

Until `proposeAsset` receives a reviewed feed and the timelock elapses, every asset except WETH stays disabled. ETH and WETH can be valued at face value. A mandate asset cannot.

Do not set `FUND_ROUTES_ENABLED`. Do not set `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS`. Header and footer do not link to `/funds`. Direct `/funds` routes render a not-live page.

## Abacus sync

Do not enable public Funds. Leave `FUND_ROUTES_ENABLED` unset. Leave `NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` unset. Do not broadcast `DeployFundFactoryInvest`. Do not allowlist SwapRouter02, UniversalRouter, or V3Factory from this note. Phase 2 is not deployed. Non-quote assets stay disabled until a reviewed feed is set. Phase 1 factory `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878` is unchanged.

## Still later

Secondary listings, living metadata, CarryNFT and a high-water mark, conviction locks, per-share wallets, NAV-floor bids, agent execution, seasons, clone-a-mandate, and distributions. Stock tokens are not in this change. None of that is deployed.
