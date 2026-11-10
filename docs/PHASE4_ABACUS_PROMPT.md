# Abacus prompt: Phase 4 on the public fund pages

Add Phase 4 to the existing public fund pages at polypad.family/funds. Keep the current black background and white text. Use short sentences. Put a plain-language tip under each control. Do not add a new visual theme.

Copy rules for every string you write:

- Write "Not audited" if you mention review status. Do not write audited.
- Do not write safe, guaranteed, first, or best.
- Do not state a price target, a return, or an ROI.
- Write "Not financial advice" on every panel that moves ETH or a share.
- Write "Robinhood Chain" in full. The chain id is 4663.

Contracts are not deployed yet. Read addresses from env after a deploy is recorded. Until `NEXT_PUBLIC_FUND_PHASE4_ADDRESS` is set, show the panels as not live and do not ask a wallet to send a Phase 4 transaction. Do not broadcast from the app. The wallet owner signs.

Use the ABIs in `polypad/abi/phase4`. `FundPhase4` is the add-on. `FundShareAccount` is the per-share wallet implementation. The live Phase 3 factory stays `0xb9BA453677A6b2C49290CfD4D0713502Ec6bF82B`.

## Pages

On the fund list and the fund detail page, add a Phase 4 section only for funds created by the Phase 3 factory. Leave Phase 1 and Phase 2 pages as they are.

## Copy this mandate

Button label: "Copy this mandate".

Tip: "This starts a new fund with the same rules as this one. Your wallet becomes the manager. You still mint the manager shares yourself. One signature."

Call `cloneFromFund` on `FundPhase4` with the fund address and the name, symbol, image, mint price, raise cap, entry fee, manager share, and raise length the person typed. Send the returned `data` to the returned `target` from the connected wallet. Do not send it from another contract. After it confirms, link to the new fund.

If the name, price, or dates are outside the factory limits, say what to change. Do not describe the copy as a result.

## Trading agent

Show this to the manager only.

Tip: "You can name one address that may trade inside the rules already on this fund. It cannot withdraw, and you can remove it in one signature. It stops at the time you pick, at most 30 days out."

Two steps, in order:

1. The manager calls `setExecutor` on the fund vault with the Phase 4 address and `true`.
2. The manager calls `arm` with the agent address, the end time, and an optional max trade size. Explain that 0 means the fund's own trade cap still applies.

Show the agent, the end time, and whether the gate is still an executor (`agentOf`). "Remove agent" calls `revoke`. Also offer "Turn off the gate", which is `setExecutor(phase4, false)` on the vault. Say that remove takes effect in that transaction.

## Report card

Title: "Report card".

Tip: "These are readings of net value per share. The largest drop is only the readings someone recorded, not every moment in between. Not financial advice."

Show `liveCard`: net value, net value per share, high-water mark, drop from the peak, and trade count. If the read fails, show "Unavailable" and say the price feed did not answer.

A button "Start a card" calls `openSeason`. "Update the drop" calls `pokeSeason`. "Close the card" calls `closeSeason` and is disabled until one day has passed. For each closed card from `seasonOf`, show the start reading, the end reading, the change versus the start, the change versus the high-water mark, the largest recorded drop, and the number of trades. Show the basis-point figures as percentages with a minus sign when they are negative. Do not label them as a return you expect.

## Per-share wallet

Call `shareWallet`. If `enabled` is false, show: "Per-share wallets are off on Robinhood Chain right now." Do not offer a button.

If enabled, show the wallet address for the selected share. "Create the wallet" calls `createShareAccount` if the address has no code yet.

Tips, both visible:

- "Anything in this wallet belongs to whoever holds the share. If you transfer the share, the next holder can use the wallet."
- "Leaving the fund burns the share and freezes the wallet. Move assets out before you exit or refund. Do not send the share into its own wallet."

Not financial advice.

## Offer to buy one share

Title: "Offer to buy one share".

Tip: "You lock your own ETH. The offer has to be at or below the current net value per share. The holder accepts in one signature. This is not leaving the fund. The fund does not pay anyone. The offer can fail if the value falls or the price feed does not answer. Not financial advice."

The bidder enters an amount and an end time (at most 30 days) and calls `placeBid`. Show open offers from `BidPlaced` logs with `bidStatus`: open, expired, and whether the amount is still within net value. The holder approves this contract for that share, then "Accept offer" calls `settleBid`. "Cancel offer" calls `cancelBid`. After the end time, show that anyone can cancel so the bidder gets the ETH back.

If the share is still in the manager lock, say the offer can be placed but cannot complete until the lock ends.

Do not call this an exit, a floor that the protocol funds, or a promise that a holder can sell.
