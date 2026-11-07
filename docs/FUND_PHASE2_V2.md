# Phase 2 v2

These contracts are unaudited. An outside review is planned. Not financial advice.

Phase 2 v1 is deployed and is not the factory the site should use:

| Contract | Address |
| --- | --- |
| `FundFactoryInvest` | `0x0849195DCBCD4a06265563dC3ebC4eb1a656aabe` |
| `FundAllowlist` | `0x2A9173fcBF90b0915b8Ee0c94C8aB1eFEE8549B0` |
| `FundSwapFacet` | `0x9F21F4555ADa5791a23060A2Ee46855109Cbd434` |

`NEXT_PUBLIC_FUND_INVEST_FACTORY_ADDRESS` ignores that factory. Fund routes stay off unless `FUND_ROUTES_ENABLED=enabled` on the server. Do not set that for a public site. Do not point the site at v1.

Phase 1 `FundFactory` `0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878` is unchanged.

## v2 source

`src/fund/phase2v2` is a new factory. It is not deployed. `script/DeployFundFactoryV2.s.sol` reverts unless `CONFIRM_FUND_PHASE2_V2_DEPLOY=yes`. It was not broadcast. It does not call Phase 1 or v1.

- A raise lasts 1 to 90 days. Filling the cap or the supply before the deadline closes it. After the deadline, a short raise is `Failed`.
- On `Failed`, the current holder burns units and receives `mintPrice` for each one. Entry and protocol fees stay in the vault until the target is met, so the refund can be the full mint price. Fees cannot be pulled on a failed raise.
- After a successful close, the manager can start a wind-down. That stops swaps. Holders burn units and receive a pro-rata share of ETH, WETH, and mandate tokens. The last outstanding units take the remainder. There is no function that sends principal to the manager.
- `nav()` is ETH plus WETH at face value. `totalCostBasis` is the quote spent on other holdings. It is not `nav()` and it is not a market price. `oracle` starts at the zero address. `indicatedQuote` reads it only when it is set, and a stale or zero answer contributes nothing. `nav()` does not use it.

The allowlist starts with WETH and no router. Later routers and assets wait out the delay. Crypto assets only. No stock tokens.

```bash
export ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export CONFIRM_FUND_PHASE2_V2_DEPLOY=yes
export FUND_V2_WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
export FEE_RECIPIENT=0x9a21c75aC263cC43125E70200636f6397f8776d0
export PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY_HERE

forge script script/DeployFundFactoryV2.s.sol --rpc-url robinhood --broadcast
```

Leave `FUND_V2_DEPLOY_PK` unset for a broadcast. Do not commit a key. After a signed deploy, record the new addresses and still leave the website env unset until a later decision. Do not reuse the v1 address.
