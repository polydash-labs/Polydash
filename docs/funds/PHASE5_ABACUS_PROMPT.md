# Abacus prompt: Phase 5 on the public fund pages

Add Phase 5 to the existing public fund pages at polypad.family/funds. Keep the current black background and white text. Use short sentences. Put a plain-language tip under each control. Do not add a new visual theme. Share art from `FundShareRenderer` is black and white (`#000000` and `#ffffff` only).

Copy rules for every string you write are the same as [PHASE4_ABACUS_PROMPT.md](../PHASE4_ABACUS_PROMPT.md). Write "Not audited" if you mention review status. Write "Not financial advice" on every panel that moves ETH or a share. Write "Robinhood Chain" in full. The chain id is 4663.

Contracts are live on Robinhood Chain (chain ID 4663). Set:

- `NEXT_PUBLIC_FUND_PHASE5_ADDRESS=0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81`
- `NEXT_PUBLIC_FUND_SECONDARY_MARKET_ADDRESS=0xa2bE46731340A9a5C53DA7D21b6bB8DA3faaC23C`
- `NEXT_PUBLIC_FUND_SHARE_RENDERER_ADDRESS=0x6DbC2Df3AE18a610978Ac3c0b765057800CABd0b`
- `NEXT_PUBLIC_FUND_CARRY_RIGHTS_ADDRESS=0x37d171924Af4072F62ad564C954E977E1D3967c9`
- `NEXT_PUBLIC_FUND_CONVICTION_LOCK_ADDRESS=0x4D216Ad3f28e9eF183483f37b7Ec05b9b46C9B95`
- `NEXT_PUBLIC_FUND_NAV_FLOOR_ADDRESS=0x8e4f163e6dCe71Ef1290Ed264c6F11f13F309afb`

Until those env vars are set in the Abacus deploy, show the panels as not live and do not ask a wallet to send a Phase 5 transaction. Do not broadcast from the app. The wallet owner signs.

Read the ABIs from `src/fund/phase5`. `FundPhase5` is `0x0c98b0E09E4Aa425BD2A85060BE58282E21d0c81`. The market, renderer, carry token, conviction lock, and nav-floor queue are the addresses above, created in that constructor. The live Phase 3 factory stays `0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`.

## Pages

On `/funds`, add a Phase 5 add-ons card that names the six contracts and links to a Phase 3 fund page. On a fund detail page, add the panels below only when that fund was created by the Phase 3 factory. Leave Phase 1 and Phase 2 pages as they are.

## List one share

Show this to the current holder.

Tip: "You set a fixed ETH price. An approval listing leaves the share in your wallet until someone buys it, and that buy needs your approval of this contract. An escrow listing moves the share in now, and cancel sends it back. The seller pulls the ETH after the sale. This is not leaving the fund. Not financial advice."

"List" calls `list` on `FundSecondaryMarket` with the share id and the price. "List in escrow" calls `listEscrow`. The buyer calls `fill` with `msg.value` equal to the price. "Cancel" calls `cancel`. "Withdraw" calls `withdraw` for the connected wallet's proceeds.

If the share is in the conviction lock, or the manager skin lock still applies, say the listing cannot open. Do not describe the price as a value the fund will pay.

## Share art

Read `tokenURI` or `svg` on `FundShareRenderer` with the fund share contract and the token id. Render the SVG as returned. It is black and white.

Tip: "This picture is a reading from the vault: net value per share, the change versus the mint price, the drawdown brake, and the lock length. It is not a price a buyer will pay. If a feed does not answer, the card says unavailable. Not financial advice."

## Conviction lock

Tip: "You can place one share here for 30, 90, or 180 days. Until you unlock it, you cannot transfer it, list it, or leave the fund with it. There is no payment for locking. Not financial advice."

The holder picks 30, 90, or 180 and calls `lock`. Show `tierOf` and whether `isLocked` is still true. "Unlock" calls `unlock` and stays disabled until the recorded time. Say that an escrow listing cannot move into the lock, and that sending the share here with a plain transfer does not record a holder.

## Carry

Show this to the manager for arming, and to the current carry holder for claim.

Warning, always visible: "The manager can point the payout wallet at another address later. While the payout wallet is this contract, entry fees and performance fees the manager withdraws are credited to the carry holder. Protocol fees are not. This token does not promise a payment. Not financial advice."

Two steps, in order, for the manager:

1. Call `setPayoutWallet` on the fund vault with the `FundCarryRights` address.
2. Call `arm` on `FundCarryRights` with the fund share contract.

Show `routed`. If it is false after arming, say the payout wallet no longer points here. Amounts already received stay with the carry holder. "Claim" calls `claim` and shows `claimable`. Say that a transfer of the carry token reverts while the raise is still open, while the drawdown brake is on, or while that brake cannot be read.

## Queue an in-kind exit

Tip: "You queue one share for one day. After that, this contract calls the share's existing exit, or refund after a failed raise, and forwards the ETH, WETH, and mandate tokens the vault already pays. You can cancel and take the share back. This does not trade. The fund does not add a payment. Not financial advice."

"Queue" calls `queue`. Show `quote` as the floored ETH reading for one share, and say the last outstanding share's exit receives the remainder. "Cancel" calls `cancel`. "Redeem" calls `redeem` and is disabled until the day has passed. If a mandate token does not arrive in full, say the redemption reverts and the share stays queued, and the holder can cancel and call `exit` on the share. A holder who has not queued can still call `exit` on the share. A skin-locked share cannot be transferred into the queue.

Not audited. Not a review. Not financial advice.
