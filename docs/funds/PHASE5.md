# Phase 5

Phase 5 is an add-on for a fund created by `FundFactoryPhase3`. It does not modify the live Phase 1a factory, the live Phase 2 contracts, or the live Phase 3 template, facet, factory, vault, or share. One broadcast of `script/DeployPhase5.s.sol` deploys `FundPhase5`. Its constructor deploys the market, the share renderer, the carry token, the conviction lock, and the nav-floor queue. Deployed on Robinhood Chain from commit `63d4f745b83d89a2863ff3a82f010ff1da2c501c`. Addresses are in [DEPLOYMENTS.md](../DEPLOYMENTS.md). Not audited. Not a review. Not financial advice.

The share NFT remains the ownership claim. These contracts read it. They do not replace `exit` or `refund` on the share.

Constructor argument for `FundPhase5`: the Phase 3 factory. On Robinhood Chain that factory is `0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`. Each module is constructed with that factory and the `FundPhase5` address. `FundConvictionLock` reads the market from `FundPhase5` when a lock is opened.

## Secondary listings

`FundSecondaryMarket` lists one share at a fixed ETH amount.

- `list` leaves the share with the holder. `fill` requires this contract to be approved for that share.
- `listEscrow` pulls the share in. `cancel` is the seller, and it sends the share back.
- After a fill, the seller and any royalty receiver call `withdraw`. The market does not push ETH during the transfer.
- A share that sits in `FundConvictionLock` cannot be listed. A skin-locked share cannot be listed. The Phase 3 share still enforces the skin lock on `transferFrom`.

Phase 3 charges the manager entry fee and the 20 bps protocol fee on mint. This market does not mint and does not call `exit`, so a listing does not change vault fee balances or the number of outstanding shares. It calls `royaltyInfo` when that call succeeds. It has no argument that sets the reported amount to zero. A reported amount above the price reverts the fill. The Phase 3 share has no royalty interface, so that read pays nothing on a Phase 3 share. A direct `transferFrom` on the share does not pass through this market.

## Share art

`FundNFTPhase3.tokenURI` returns the image URI or `baseURI + id + ".json"`. It has no external hook, and `setBaseURI` reverts once any share has been minted. `FundShareRenderer.tokenURI(nft, tokenId)` is the read for a UI or an indexer. The SVG is built in the contract from `#000000` and `#ffffff` only. It shows the fund name, net value per share, the change versus the stored mint price in basis points, the drawdown brake (`ON`, `OFF`, `UNSET`, or `UNREAD`), and the conviction-lock tier (`0`, `30`, `90`, or `180`).

The figures are vault readings. They are not a quote of what a buyer will pay. A feed that cannot be read is labelled unavailable, and the call still returns. The JSON description includes "Not financial advice".

## Conviction locks

`FundConvictionLock.lock` pulls one share for 30, 90, or 180 days. Until `unlock`, the share is held here, so the holder cannot transfer it, list it, or call `exit`. `unlock` reverts before `expiry`, and only the recorded holder can call it. `tierOf` returns 30, 90, 180, or 0. There is no payment for locking.

An approval listing is cleared in the same call. An escrow listing cannot be locked, because the market already holds the share. The Phase 3 contract has no transfer hook, so the lock is this escrow. Send the share only through `lock`. A plain `transferFrom` into the lock does not record a holder.

## Carry

`FundCarryRights` mints one ERC-721 per fund when the manager calls `arm`. `payoutWallet` on the vault must already be this contract. ETH the vault then sends here is credited to the current token holder, who calls `claim`.

The Phase 3 vault pays entry fees and performance fees to the same `payoutWallet`. While that wallet is this contract, both withdrawals the manager sends are credited to the carry holder. Protocol fees still use the factory fee recipient. The manager can point `payoutWallet` at another address later, because `setPayoutWallet` and `withdrawPerformanceFee` on the vault are unchanged. A vault that paid the carry holder and ignored `setPayoutWallet` would be a new vault, and it would not attach to a fund already created by the live factory. `routed` reports whether the wallet still points here. Amounts already received stay with the carry holder.

Transfer of the carry token reverts while vault status is Raising, while the drawdown brake is on, or while a configured brake cannot be read because `navPerNft` reverts. A max drawdown of 0 cannot turn the brake on. The token does not promise a payment.

## Nav-floor exit

`FundNavFloor` queues one share for one day, then calls the share's `exit` or, after a failed raise, `refund`. The day matches the minimum allowlist delay that Phase 3 counts in `protectionBits`. The holder can `cancel` and take the share back. `redeem` has no owner and no pause. It still runs when swaps are paused and when the drawdown brake is on.

The assets are forwarded in kind: ETH, WETH, and mandate tokens, in the amounts the vault already pays. This path does not call the swap facet. That call is limited to the manager or an executor, and a trade would change the book for the shares that remain. `spendableEth` already excludes entry, protocol, and performance fees. The Phase 3 vault has no separate exit-fee field. `quote` is the floored one-share reading; the last outstanding share's `exit` receives the remainder. If a mandate token does not arrive in full, the redemption reverts and the share stays queued. The holder can cancel and call `exit` on the share.

The share's own `exit` stays available to a holder who has not queued here. A skin-locked share cannot be transferred into the queue until the skin lock allows the transfer. The holder can still call `exit` on the share during that lock, which is the Phase 3 rule for a burn.

## Deploy

Live addresses (Robinhood Chain, chain ID 4663), commit `63d4f745b83d89a2863ff3a82f010ff1da2c501c`:

| Contract | Address |
| --- | --- |
| `FundPhase5` | [`0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81`](https://robinhoodchain.blockscout.com/address/0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81) |
| `FundSecondaryMarket` | [`0xa2bE46731340A9a5C53DA7D21b6bB8DA3faaC23C`](https://robinhoodchain.blockscout.com/address/0xa2bE46731340A9a5C53DA7D21b6bB8DA3faaC23C) |
| `FundShareRenderer` | [`0x6DbC2Df3AE18a610978Ac3c0b765057800CABd0b`](https://robinhoodchain.blockscout.com/address/0x6DbC2Df3AE18a610978Ac3c0b765057800CABd0b) |
| `FundCarryRights` | [`0x37d171924Af4072F62ad564C954E977E1D3967c9`](https://robinhoodchain.blockscout.com/address/0x37d171924Af4072F62ad564C954E977E1D3967c9) |
| `FundConvictionLock` | [`0x4D216Ad3f28e9eF183483f37b7Ec05b9b46C9B95`](https://robinhoodchain.blockscout.com/address/0x4D216Ad3f28e9eF183483f37b7Ec05b9b46C9B95) |
| `FundNavFloor` | [`0x8e4f163e6dCe71Ef1290Ed264c6F11f13F309afb`](https://robinhoodchain.blockscout.com/address/0x8e4f163e6dCe71Ef1290Ed264c6F11f13F309afb) |

Creation transaction [`0xfa8af1123322d5d171997be0961333b94c1633ee728697df3af2d321a77e004f`](https://robinhoodchain.blockscout.com/tx/0xfa8af1123322d5d171997be0961333b94c1633ee728697df3af2d321a77e004f) (nonce 45) from `0x9a21c75aC263cC43125E70200636f6397f8776d0`. Constructor arg: Phase 3 factory `0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`. The five modules are created inside that constructor. Sourcify exact match for all six contracts. Not a review. Not audited. Not financial advice.

Do not broadcast this from the repository. The script reverts unless `CONFIRM_FUND_PHASE5_DEPLOY=yes`. It reads `PRIVATE_KEY` unless `DEPLOY_FUND_PHASE5_PK` is set. The unit test sets the latter. Optional `FUND_PHASE3_FACTORY` overrides the default live factory. Do not commit a key.

```bash
export ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export CONFIRM_FUND_PHASE5_DEPLOY=yes
export PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY_HERE

forge script script/DeployPhase5.s.sol --rpc-url robinhood --broadcast
```

`0xYOUR_DEPLOYER_PRIVATE_KEY_HERE` is a placeholder. Not audited. Not financial advice.

The frontend note is [PHASE5_WEB_PROMPT.md](PHASE5_WEB_PROMPT.md).
