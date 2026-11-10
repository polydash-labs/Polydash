# Phase 4

Phase 4 is an add-on. It does not modify the live Phase 1a factory, the live Phase 2 contracts, or the live Phase 3 template, facet, or factory. One transaction deploys `FundPhase4`. Its constructor deploys `FundShareAccount`. Nothing in this change was signed or broadcast. Not audited. Not a review. Not financial advice.

The NFT remains the ownership claim. A clone, an agent, a season card, a bid, and a per-share wallet all read that NFT. They do not replace `exit` or `refund`.

## What shipped

`FundPhase4` is constructed with the live Phase 3 factory `0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`.

**Clone a mandate.** `cloneFromFund` and `cloneFromTemplate` return the live factory address and the `createFund` calldata. The wallet that sends that calldata becomes the manager, in one transaction. This contract does not send it. A wrapper that called `createFund` would become the manager, and the manager is the wallet that must mint the skin shares.

**Agent.** The manager calls `setExecutor` on the vault with this contract, then `arm` with one address, an expiry of at most 30 days, and an optional raw `maxAmountIn` (`0` adds no extra ceiling). `agentSwap` forwards one swap. The vault still enforces the template caps, the allowlist, and the drawdown brake. `revoke` clears the grant in that transaction. After expiry, anyone may `kick` the grant. The vault flag is cleared only by the manager, because the vault checks `msg.sender`. The agent cannot pull fees, distribute, set the payout wallet, or move the NFT. There is no generic call and no token approval.

**Seasons.** Anyone may open a season after investing starts, poke it, and close it after one day. The card stores net value per share at the open and the close, the change versus the start and versus the high-water mark in basis points, the largest drop among the readings, and the trade count. The largest drop is only what was read at open, poke, or close. It is not a continuous path. `liveCard` reads the vault without writing. A feed that cannot be used reverts the write.

**NAV bids.** `placeBid` escrows the bidder's ETH. The amount must be at least 0.00001 ETH and at or below net value per share, checked again at `settleBid`. The current holder must have approved this contract. ETH and the share move in that transaction. The bidder may cancel before expiry. Anyone may cancel after expiry. This is not a vault exit. The fund does not pay the seller. A skin-locked share cannot transfer, so settlement reverts and the bid stays open until it is cancelled. If net value per share falls below the bid, or the feed reverts, settlement reverts.

**Per-share wallets.** The canonical ERC-6551 registry `0x000000006551c19487814612e58FE06813775758` had 571 bytes of code on Robinhood Chain at block 110,469,147. This repository does not deploy a registry. `shareAccountsEnabled` is true only while that address has code. `createShareAccount` asks the registry for a proxy to `FundShareAccount`. The current NFT owner is the only caller. CALL is the only operation. Exiting or refunding burns the share and freezes the wallet, because there is no owner to call it. Move assets out before that. Sending the share into its own wallet freezes both. A bid whose bidder is that wallet is rejected.

## Not in this change

Secondary listings, metadata that changes with net value, and conviction locks are not in this change. Stock tokens are not in this change.

## Deploy

Unsigned creation bytes, compiler settings, the constructor argument, and the gas estimate are in [deploy/phase4/unsigned](../deploy/phase4/unsigned). `script/DeployFundPhase4.s.sol` reverts unless `CONFIRM_FUND_PHASE4_DEPLOY=yes`. Nonces are not recorded. Read the signer's nonce immediately before signing.

At base fee 20,028,000 wei during the fork measurement, the estimate for that one transaction is about 0.000076 ETH. The fees wallet `0x9a21c75aC263cC43125E70200636f6397f8776d0` held about 0.002084 ETH at block 110,469,147. Re-read the base fee and the balance before signing. The estimate has no tip. A tip near 1 gwei would cost more than that balance.

Compiled ABIs are in [polypad/abi/phase4](../polypad/abi/phase4). The frontend note is [PHASE4_ABACUS_PROMPT.md](PHASE4_ABACUS_PROMPT.md).
