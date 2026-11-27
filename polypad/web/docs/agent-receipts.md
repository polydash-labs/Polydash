# Agent action receipts

A Polypad agent action receipt is a public, verifiable record of one action an
agent (or an automated keeper acting for the platform) took on-chain. Anyone
can re-check a receipt against Robinhood Chain with only the receipt JSON and
a public RPC — no account, no key, no private data.

A receipt **proves what happened**. It is **not** a guarantee, reimbursement,
or insurance promise. No receipt, spec, verifier output, or page on
polypad.family promises cover, compensation, or reimbursement if something
goes wrong. A receipt is a record, not a guarantee.

This format is v1 (`polypad.agent-receipt/1`). It covers two action types.
More types can be added without changing the envelope.

## The four sections

Every receipt has the same four sections, in the spirit of Catena Assure's
record model (identity → authority → approval → settlement), minus the funded
guarantee, which is out of scope for this build.

| Section | Question it answers | Rule |
| --- | --- | --- |
| **Identity** | Who acted? | The acting address, and — for registered agents — the on-chain registry entry (agent id, name, wallet, bond, registration time, active flag). |
| **Authority** | Under what power? | The contract rule that let this actor act (e.g. only the registered updater may post scores; `execute` has no caller restriction once the timelock passes), plus the on-chain record proving the actor held that power at the time. |
| **Approval** | What was approved before it settled? | The approval step the action went through (the score formula enforced by the contract; the owner's proposal plus the full 2-day public wait). Every value is re-readable on-chain. |
| **Settlement** | How did it land? | The transaction (hash, block, sender, recipient, status), the resulting on-chain state, and the events emitted. |

### Field rule

A field may only appear in a receipt if Polypad already records it on-chain
or in a verified transaction. Nothing is invented, estimated, or taken from
off-chain claims. If a fact is not on-chain, the receipt does not claim it.

### What v1 does not cover

- No funded guarantee, no reimbursement, no claims flow. Those are separate
  decisions, and a receipt must never be read as one.
- Only the two action types below. A receipt for any other action type is
  invalid under this format version.

## Action type: `agent-score-posted`

A credit score posted for a registered agent (`AgentScore.updateScore`).

| Field | Source (on-chain) |
| --- | --- |
| identity.agentId / name / wallet / agentAccount / stake / registeredAt / active | `AgentRegistry.getAgent(agentId)` |
| identity.wallet maps back to the id | `AgentRegistry.agentIdByWallet(wallet)` |
| authority.updater | `AgentScore.updater()` |
| authority: the sender was the updater | settlement transaction `from` |
| approval.components (5 × 0–1000) | `AgentScore.getScore(agentId)` + settlement transaction input |
| approval.weightedScore | `AgentScore.weightedScore(components)` recomputed on-chain; must equal the posted score |
| approval.inputsHash | `AgentScore.getScore(agentId).inputsHash` + settlement transaction input |
| settlement.score / updatedAt / exists | `AgentScore.getScore(agentId)` |
| settlement.band | `AgentScore.bandOf(agentId)` |
| settlement.transaction / block / status | transaction + receipt from a public RPC |
| settlement.event | `ScoreUpdated` log in the settlement transaction |

## Action type: `allowlist-executed`

An allowlist proposal executed (`FundAllowlist.execute`).

| Field | Source (on-chain) |
| --- | --- |
| identity.executor | settlement transaction `from`. `execute` is permissionless after the timelock; no registered-agent identity is claimed for the executor. |
| authority: no caller restriction | Demonstrated, not asserted: the executor was not the contract owner, yet the call succeeded. `execute` has no access control on the caller in the contract. |
| approval.proposal record | `FundAllowlist.proposals(id)` — target, feed, maxStale, price band, readyAt, executed, canceled |
| approval.proposedBy | propose transaction `from` must equal `FundAllowlist.owner()` (`proposeAsset` is `onlyOwner`) |
| approval.readyAt = propose time + delay | propose block timestamp + `FundAllowlist.delay()` (172800 s) |
| approval.wait elapsed | settlement block timestamp ≥ readyAt |
| approval.feed + band stored | `FundAllowlist.feedOf(target)` |
| settlement.transaction / block / status | transaction + receipt from a public RPC |
| settlement.state | `FundAllowlist.assetAllowed(target)` + `proposals(id).executed` |
| settlement.events | `Executed` + `FeedSet` logs in the settlement transaction |

## Verification

`lib/receipts/verifier.ts` is the verifier. It takes a receipt and a public
RPC client, re-reads every claimed fact, and returns a per-field pass/fail
list plus an overall verdict:

- `verified` — every check passed.
- `failed` — at least one check failed (the receipt does not match the chain).
- `incomplete` — no check failed, but at least one could not run (e.g. the
  RPC was unreachable). An incomplete result is not a pass.

Run it from a terminal (third parties need only the receipt file):

```bash
npx tsx scripts/verify-receipt.ts public/receipts/<receipt>.json
# exit 0 when verified, 1 otherwise
```

Or in the browser on [/agents/receipts](https://polypad.family/agents/receipts),
which runs the same verifier against the public RPC.

The verifier checks the receipt format and disclaimer first, then the four
sections. Every check names its on-chain source in its detail line, so a
failure tells you exactly which fact did not match.

## Files

| Piece | Location |
| --- | --- |
| This spec | `docs/agent-receipts.md` |
| JSON Schema | `lib/receipts/receipt.schema.json` |
| Types | `lib/receipts/types.ts` |
| Verifier | `lib/receipts/verifier.ts` |
| Contract ABIs used by the verifier | `lib/receipts/receipts-abi.ts` |
| CLI | `scripts/verify-receipt.ts` |
| Receipts (public JSON) | `public/receipts/*.json` + `public/receipts/index.json` |
| Receipts page | `app/agents/receipts/` |

## Known quirks (viem 2.58)

Two viem behaviors shaped the verifier implementation; both are worked around
in code, not hidden:

1. `readContract` mis-decodes struct returns that contain a dynamic string
   (`AgentRegistry.getAgent`). The verifier reads the raw return data with
   `client.call` and decodes the tuple explicitly with `decodeAbiParameters`
   (verified against the live return bytes).
2. `readContract` returns multi-output results positionally, not by name.
   The verifier maps tuple positions to names explicitly (e.g. `getScore`
   returns `[score, performance, history, activity, stake, conduct,
   updatedAt, inputsHash, exists]`).

## First receipts

- `public/receipts/agent-score-posted-1-0x552d903e.json` — Quant Trader
  (agent 1) score 424 posted Nov 21, 2026 by the registered updater.
  15/15 checks verified.
- `public/receipts/allowlist-executed-17-0x0741a46d.json` — FRONG allowlist
  proposal 17 executed Nov 21, 2026 after the full 2-day wait.
  14/14 checks verified.
- `public/receipts/allowlist-executed-18-0x188b45e4.json` through
  `allowlist-executed-23-0x8f5bf4af.json` — batch 3 (AI, INDEX, ROBINCAT,
  UP, OAK, HEY) proposals 18–23 executed Nov 21, 2026 after the full
  2-day wait. 14/14 checks verified each. Tamper test on #18
  (minPriceX18 +1) correctly fails 12/14.
