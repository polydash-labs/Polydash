# Warden Internal Review — Agent Wallet v2 — PHASE 3 (Re-review of Fix Round 2)

**Date:** Sun Nov 22, 2026 (evening PST)
**Auditor:** Warden (Polypad in-house agent audit team — lead auditor + invariant/fuzz specialist)
**Scope:** Re-review of fix round 2 for the Phase 1 Internal Review (Nov 22, 2026) and the Phase 2 re-review (Nov 22, 2026).
**Repo:** `~/workspace/polydash-agent-wallets`, branch `agent-wallets`
**Audited commit (Phase 1):** `639529b`
**Fix commit round 1 (Phase 2, verified green):** `7fbb817` — "Fix Warden review findings H-01, M-01, M-02 (agent-wallet v2)"
**Fix commit round 2 (this re-review):** `0085896` — "Fix Warden Phase 2 findings L-06, I-04, I-05 (agent-wallet v2)", parent `7fbb817` (local only, not pushed; superseded by fix commit `9f43140`, deployed Nov 22, 2026)
**Original report:** `hidden_files/team/audit/2026-11-22.md` (untouched)
**Phase 2 report:** `hidden_files/team/audit/2026-11-22-final.md` (untouched; this file is the Phase 3 addendum)
**Warden's fresh test file:** `test/agent-wallet/WardenPhase3.t.sol` (16 tests, written independently — not Mason's tests; left untracked in the repo)

---

## Plain-language summary

The three problems from the Phase 2 report are addressed — two fully verified fixed, one partially.

- **The double-charge bug (L-06) is fixed.** Rotating an agent key to a key that already had a cap set used to list the token twice, so one pull was charged twice. Warden re-ran the exact scenario plus a double rotation (key A → B → C): each token is listed exactly once, and pulls of 400 then 600 against a 1,000 cap land at exactly 1,000 spent. The fix composes across rotations.
- **The missing event (I-04) is fixed.** A pull through an allowlisted target now emits a new `DeltaCharged` event with the net amount charged, so receipts and indexers can see movements the old `Executed` event never reported. Warden checked the pair together in one pull: `DeltaCharged` says 1,000, `Executed` still says token = zero, amount = 0 — the old event is byte-identical, the new one fills the gap. A pull fully covered by a same-day pre-payment emits no `DeltaCharged`, and a partially covered pull emits exactly the net (approve 400, pull 1,000 → `DeltaCharged` 600). Nothing double-counts. One gap remains for consumers: receipts and indexers must adopt the new event — until they do, they still miss pull movements.
- **The doc fix (I-05) is only half right.** The paymaster's documentation now says a 50k gas budget fails with error AA36. Warden re-measured live and the answer splits: on a **cold** first validation of the day, 50k fails with AA33 (the paymaster call itself runs out of gas); only once the global cap slot is **warm** does 50k fail with AA36. The doc states AA36 unconditionally, so it is wrong for the cold case. This is documentation only — the operational guidance (use 80k) is correct and verified, and either failure mode fails closed. One sentence in the NatSpec would close it.
- **One new, small issue was found while grading the fix (I-06, Informational).** Rotating a key still overwrites the new key's own cap values with the old key's: an owner who deliberately set a 500 cap on the new key gets 1,000 after rotation, with no signal. It is owner-only, pre-existing since the first review (not introduced by round 2), and now documented in the code — but it can silently raise a key's spending power above what the owner explicitly set.
- **The round-1 fixes still hold.** Fresh compact re-checks of H-01 (3 registration attempts, exactly one lands), M-01 (stranger creation still reverts), and M-02 (2-op single-wallet bundle and 6-wallet global bundle both fail validation wholesale) all pass, and the full Phase 2 suite re-runs 18/18.

**Verdict: GREEN holds for fix commit `0085896`.** No Critical or High findings are open. The only open items are Lows and Informationals (five original Lows and three original Informationals deferred by Jon, plus one new Low-resolved/Informational set from this round: I-06 new, I-05 partially fixed). Green here means "the high and medium problems are fixed and verified" — it is not a claim that the contracts are bug-free, and it is not a third-party audit.

---

## Verdict: GREEN (holds)

| | Phase 1 (Nov 22) | Phase 2 (Nov 22) | Phase 3 (this report) |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 1 (H-01, Open) | 0 open — H-01 **Fixed** | 0 open |
| Medium | 2 (M-01, M-02, Open) | 0 open — M-01, M-02 **Fixed** | 0 open |
| Low | 5 (Open) | 6 open (L-01–L-05 deferred + new L-06) | 5 open (L-01–L-05 deferred; L-06 **Fixed**) |
| Informational | 3 (Open) | 5 open (I-01–I-03 deferred + new I-04, I-05) | 6 open (I-01–I-03 deferred + I-04 **Fixed** + I-05 **Partially fixed** + new I-06) |
| **Total** | **11** | **14 (11 original + 3 new)** | **15 (11 original + 4 round-2-era)** |

Per the audit's verdict scale, green requires no Critical or High findings open. That condition is met. The /audits listing may stay green with this report linked alongside the Phase 2 final report.

---

## Per-finding status — fix round 2

### L-06 — Duplicate `policyTokens` entries double-charge pulls — **FIXED** (verified)

**What the fix does.** `rotateKey` now guards the push the same way `setTokenCaps` does: `if (!_hasTokenCap[safe][newKey][token])` before pushing. The cap *value* copy is unchanged (still the old key's — see I-06 below).

**Warden's fresh evidence (all in `WardenPhase3.t.sol`, all passing):**
- `testW3_L06_DoubleRotationNoDuplicates` — A→B→C, both B and C pre-seeded with a direct-set cap. After two rotations the list has 4 entries, POLYDASH exactly once, both old policies deleted; pulls of 400 then 600 as key C charge 400 then 1,000 total. The dedupe composes.
- `testW3_L06_RotatedListIsExactSet` — after rotation the list is the same SET as the original policy (each of the 4 tokens exactly once). Observation recorded, not a defect: the order changes — the direct-set token was pushed first, so it leads the list. Order is irrelevant to the delta loop.
- `testW3_L06_PullToExactCapAfterRotation` — boundary discriminator: 400 + 600 hits the 1,000 cap exactly; both succeed. Under the old double-charge the first pull alone would read 800 and the second would revert.
- `testW3_L06_ExtraTokenSurvivesRotation` — a token the old key never had (direct-set cap for the uncapped token, 5,000) survives rotation untouched: list becomes the union (5 entries), its cap preserved at 5,000.

Mason's own `FixRoundPhase2Test` (4 tests) also passes and asserts the fixed behavior; the original L-06 PoC (5 entries, 800 charge) is preserved in the Phase 2 report.

### I-04 — `Executed` event under-reports pull movements — **FIXED** (verified)

**What the fix does.** New additive event `DeltaCharged(safe, key, token, amount)` emitted in `_chargeDelta` with the net charge after any same-day pre-payment offset, only when `chargeable > prePaid`. The existing `Executed` event is untouched (same signature, fields, and values).

**Warden's fresh evidence (all passing):**
- `testW3_I04_PairEventsOnPull` — one owner-allowance registry pull (1,000): exactly one `DeltaCharged` (safe, key, POLYDASH, 1,000) AND the `Executed` event on the same call is unchanged (target = registry, token = address(0), amount = 0, value = 0). The pair proves the old event is byte-identical and the new one fills the gap.
- `testW3_I04_PartialPrepayNet` — owner approves 1,000, agent `increaseAllowance` 400 (its `Executed` reports POLYDASH/400), pull 1,000 → `DeltaCharged` 600; spent = 1,000. 400 + 600 = 1,000 moved, no double-count. (Setup note: the agent must use `increaseAllowance`, not `approve` — `approve` would overwrite the owner's allowance to 400 and the 1,000 pull could not land at all.)
- `testW3_I04_PlainTransferNoDelta` — a plain 1-ether transfer emits zero `DeltaCharged` and its `Executed` event is exact (target = token, token = token, amount = 1 ether, value = 0). The new event fires only for delta charges, never for pre-charged moves.
- `testW3_I04_PrepaidViaIncreaseAllowanceVault` — pre-payment via `increaseAllowance` (not `approve`) through the generic vault (not the registry): no `DeltaCharged`, spent stays 1,000. Same outcome, different mechanism and target from Mason's prepaid test.
- `testW3_I04_DeltaChargedVia4337` — the event also fires through the 4337 path (self-funded `registerAgent` op): exactly one `DeltaCharged` of 1,000, spent = cap.

**Consumer gap (not a finding, recorded for the build):** `DeltaCharged` only helps readers that listen for it. Receipts, indexers, and any UI reading `Executed` will still miss pull movements until they adopt the new event. The on-chain accounting was already correct; this fix is about observability, and it is only complete once consumers adopt it.

### I-05 — Paymaster NatSpec misstates the 50k failure mode — **PARTIALLY FIXED**

**What the fix does.** The NatSpec on `validatePaymasterUserOp` now says: "A 50k budget is rejected by the EntryPoint with AA36 before the paymaster is called (AA33 is only the failure mode for a budget between the EntryPoint minimum and the ~59.7k cold validation cost)."

**Warden's fresh evidence — the claim splits by storage warmth:**
- `testW3_I05_50kDependsOnWarmth_80kPasses` — three live measurements in one test:
  - **Cold** (first paymaster interaction of the day, both cap slots cold): a 50k op fails with `FailedOpWithRevert(0, "AA33 reverted", 0x)` — the paymaster call itself runs out of gas inside the 50k budget. **Not AA36.**
  - **Warm** (after a successful 80k op warmed the global cap slot that day): a fresh wallet's 50k op fails with `FailedOp(0, "AA36 over pmVerificationGasLimit")` — the call succeeds, but the EntryPoint-measured gas exceeds the limit. This is the case the NatSpec describes.
  - **80k executes** (1 ether transferred, recipient balance +1). The operational guidance is correct and verified.

  Why the split: the EntryPoint (account-abstraction v0.9.0 in the repo's lib) calls the paymaster with exactly `paymasterVerificationGasLimit` gas; if that call runs out of gas it reverts AA33 (`_callValidatePaymasterUserOp`, line 710). Only if the call returns does the AA36 check (`preGas - gasleft() > pmVerificationGasLimit`, `_validatePaymasterPrepayment`) get a chance to fire. Cold validation costs ~59.7k, so at 50k cold the call dies first (AA33); with the global slot warm the call costs ~40k, succeeds, and the measured total overruns 50k (AA36). Phase 2's gas test passed with AA36 because it warmed the global slot with two direct validation calls before the 50k op — the NatSpec generalized from that warm measurement.

**Status: partially fixed.** The NatSpec is now correct for the warm case but states AA36 unconditionally, which is wrong for the cold first-validation case. Documentation only — no on-chain behavior issue, and either failure mode fails closed. **Recommended correction (one sentence):** "A 50k budget fails closed either way: AA33 (paymaster out of gas) on a cold first validation of the day, AA36 once the global cap slot is warm. The repo's tests use 80k."

### I-06 — Rotation overwrites the new key's own cap values — **Informational, OPEN (new)**

**Evidence** (`testW3_L06_CapValueOverwrittenUp`, `testW3_L06_CapValueOverwrittenDown`, both passing):
- Direct-set a 500/day POLYDASH cap on key B by owner Safe transaction; rotate the live key to B. Key B's cap is now **1,000** (the old key's) — and a 600 pull succeeds, which the owner's explicit 500 would have forbidden.
- The reverse: direct-set 2,000 on key B; after rotation the cap is **1,000**, and a 1,500 pull reverts `CapExceeded`. The rotation never preserves the new key's own cap values for carried tokens.

**Grading:** pre-existing behavior, not introduced by round 2 — the value copy (`tokenCaps[safe][newKey][token] = tokenCaps[safe][oldKey][token]`) was unconditional in `639529b` and `7fbb817` too. Owner-only action (`onlySafe`), no third-party path, and now documented in the round-2 NatSpec ("The carried cap value is still the old key's"). The risk is a silent owner footgun: an owner who pre-configures a key with a deliberate cap and then rotates to it gets a different cap than the one they set, with no event or signal distinguishing the overwrite. **Severity: Informational.** **Fix suggestion:** in `rotateKey`, skip the value copy for tokens the new key already has a cap for (mirror the list dedupe), or emit the carried cap values in `KeyRotated`. Recommended for the next fix round; not verdict-blocking.

---

## Regression — round-1 fixes still bound

Fresh compact checks in `WardenPhase3.t.sol` (all passing), plus the full Phase 2 suite re-run below:
- `testW3_H01_CompactPoCStillBinds` — 3 registration attempts, exactly one lands, spent == cap, registry holds 1,000 (the full 30-attempt PoC is re-run with the Phase 2 suite).
- `testW3_M01_StrangerStillCannotCreate` — stranger creation still reverts `NotOwner`; owner creation still works.
- `testW3_M02_TwoOpsOneWalletFails` — 2 sponsored ops from one wallet in one bundle fail validation wholesale (2 × ~0.00048 maxCost reservation > 0.0005 cap), nothing executes, no residual reservation.
- `testW3_M02_SixWalletGlobalFails` — 6 wallets × 1 op fail validation (6 × ~0.00048 > 0.002 global cap), nothing executes, no residual reservations.

## Unchanged items (not re-verified this round)

- **L-01–L-05, I-01–I-03 — OPEN** (deferred by Jon, unchanged). They do not block green.
- **Known residual — Acknowledged, unchanged:** pulls of tokens with no cap set are not delta-tracked (Phase 2 assessment stands; the round-2 diff does not touch it).

## New-issue sweep (diff only)

The round-2 diff touches two source files: `PolypadSessionKeyModuleV2.sol` (DeltaCharged event, rotateKey dedupe guard, NatSpec) and `PolypadPaymaster.sol` (NatSpec only). Review of the full diff plus the test evidence above found **one new issue: I-06** (Informational, above). No other new issues.

**Static analysis.** Slither 0.11.6 (`python3 -m slither`, default detector set) run fresh on the two changed files in the isolated build: **module 22 hits, paymaster 7 hits — zero material, none touching the round-2 diff.** Triaged: `weak-prng` on the active-hours window (`block.timestamp` hour — by design, not randomness); `incorrect-equality` on `day == day` / `amount == 0` checks (discrete day values, pre-existing); `reentrancy-no-eth` on `_execute` (false positive — `execute`/`executeVia4337` are `nonReentrant`, admin functions are `onlySafe`, the target is called by the Safe and cannot impersonate it); `uninitialized-local` on `ExecState st` (false positive — memory struct zero-initialized); `calls-loop` on `_safeBalanceOf` (benign — read-only staticcall, gas bounded by the op's limits); `timestamp` (10 hits, all day-window uses — by design); `pragma` (multi-version repo state — informational); `low-level-calls` (`_safeBalanceOf` staticcall with returndata length check — benign); `reentrancy-events` on paymaster `depositToEntryPoint`/`withdrawFromEntryPoint` (owner-only, emit-after-call — benign); `naming-convention` (underscore params — style). Counts differ from Phase 2's reported 9/4 because this run used Slither's default detector set including the informational `timestamp`/`pragma`/`naming-convention` classes; the material classes are the same ones Phase 2 triaged, unchanged in substance. Raw outputs: `/tmp/warden-p3/slither-module.json`, `/tmp/warden-p3/slither-paymaster.json`.

## Operational notes (not findings)

- **Rotated token-list order changes.** After a rotation to a key with a direct-set cap, that token leads the new key's `policyTokens` list (it was pushed first). Harmless — the delta loop is order-insensitive — but anyone diffing token lists across a rotation should expect the reorder.
- **AA33 vs AA36 depends on warmth.** A bundler debugging a 50k rejection will see AA33 on the first validation of the day and AA36 later the same day. Both mean "raise the verification-gas budget"; 80k works in both states.

## Methodology (Phase 3 re-review)

- **Read first:** the Phase 2 report in full (L-06, I-04, I-05 sections), then the `7fbb817` → `0085896` source diff for both changed contracts.
- **Fresh evidence, not the builder's word:** Warden wrote its own test file (`test/agent-wallet/WardenPhase3.t.sol`, 16 tests, own harness and assertions) covering every round-2 fix claim plus angles Mason's regressions do not cover — double rotation, exact-set list equality, boundary pull to the exact cap, cap-value overwrite in both directions, extra-token survival, the `DeltaCharged`+`Executed` pair in one call, partial-prepay netting, plain-transfer silence, prepaid via `increaseAllowance` through the vault, the event through the 4337 path, and the cold/warm AA33/AA36 split. Mason's fix-round tests were run as a cross-check, not as evidence.
- **Disclosure on the Phase 2 test file:** the on-disk `WardenPhase2.t.sol` was reworked after Phase 2 (Mason's `FixRoundPhase2.t.sol` header confirms it) so its L-06 test now asserts the FIXED behavior (`testW2_H01_DuplicatePolicyTokensFixed`); the original buggy-behavior assertion (`testW2_H01_DuplicatePolicyTokensDoubleChargesPull`) survives only in the Phase 2 report text. Re-running that suite is still valid regression evidence against `0085896`, but it is no longer the original Phase 2 evidence.
- **Isolated build.** The full repo does not compile on this box: the via_ir build of ~400 files across four solc versions is OOM-killed (6 GiB limit) — same as Phase 2. Warden verified in a scratch Foundry project (`/tmp/warden-p3/probe`) containing only the agent-wallet contracts, `AgentRegistry`, the v1 module/factory, and the test files, with the same compiler settings as the repo (`via_ir = true`, optimizer 200 runs, cancun, `lib/safe-contracts/**` via_ir=false via the `no-ir` profile). Bytecode fidelity was checked: the test-deployed paymaster is 2,867 bytes, matching Phase 2's via_ir artifact exactly (NatSpec-only change); the module is 10,275 bytes vs Phase 2's 10,121 (+154 bytes, consistent with one new event plus one conditional branch — not the no-ir ~12,571). The full-repo suite could not be run here; the fix's blast radius was confirmed confined (the round-2 diff touches only `src/agent-wallet/PolypadSessionKeyModuleV2.sol` and `PolypadPaymaster.sol`, and no `src/` file outside `src/agent-wallet/` imports them), so the agent-wallet suite is the relevant scope.
- **Test results (all passing, zero failures):**
  - Warden Phase 3 suite: **16/16**.
  - Agent-wallet non-fork suite in the isolated build: **159/159** across 12 suites — PolypadPaymaster 12, AuditV2PullPattern 5, AuditV2Agent4337 11, AuditV2PaymasterBundle 5, PolypadSessionKeyModuleV2 18, FixRoundH01M01M02 10, FixRoundPhase2 (Mason) 4, WardenPhase2 (re-run) 18, WardenPhase3 16, PolypadSessionKeyModule (v1) 33, PolypadSessionKeyModuleInvariant (v1) 1, AuditV2Invariants 26 (incl. `invariant_spentNeverExceedsDailyCap`).
  - Fork suites on a Robinhood Chain fork (`ROBINHOOD_RPC_URL=https://robinhood.drpc.org`, read-only local fork, no mainnet transactions): **11/11** (3 suites — live EntryPoint v0.7, Safe singleton, proxy factory, identity registry; freshly deployed fix-code contracts; M-02 fork PoC: total spent after the bundle is 0).
- **Not done:** no deployment, no push, no live-contract changes, no /audits listing update (those happen separately after this report). No re-verification of the deferred L-01–L-05 / I-01–I-03.

## Reproduction

```bash
# Isolated build (the full repo OOMs on this box; see Methodology)
# Scratch project at /tmp/warden-p3/probe mirrors the repo's agent-wallet
# sources + tests with identical compiler settings.
cd /tmp/warden-p3/probe
forge test --match-contract WardenPhase3Test -vv
forge test --no-match-contract "Fork"
ROBINHOOD_RPC_URL=https://robinhood.drpc.org forge test --match-contract "ForkTest" -vv
```

---

*Warden is Polypad's in-house agent audit team, not an independent third-party firm. This report is an internal review; it is not a third-party audit attestation.*
