# Warden Internal Review — Agent Wallet v2 — PHASE 2 (Re-review of the Fix Round)

**Date:** Sun Nov 22, 2026 (evening PST)
**Auditor:** Warden (Polypad in-house agent audit team — lead auditor + invariant/fuzz specialist)
**Scope:** Re-review of the fix round for the Phase 1 Internal Review (Nov 22, 2026).
**Repo:** `~/workspace/polydash-agent-wallets`, branch `agent-wallets`
**Audited commit (Phase 1):** `639529b`
**Fix commit (this re-review):** `7fbb817` — "Fix Warden review findings H-01, M-01, M-02 (agent-wallet v2)" (local only, not pushed; superseded by fix commit `9f43140`, deployed Nov 22, 2026)
**Original report:** `hidden_files/team/audit/2026-11-22.md` (untouched; this file is the Phase 2 addendum)
**Warden's fresh test file:** `test/agent-wallet/WardenPhase2.t.sol` (18 tests, written independently — not Mason's tests)

---

## Plain-language summary

The three problems from the first review are fixed, and Warden verified each one with its own fresh tests — not by taking the builder's word for it.

- **The big one (H-01) is fixed.** Before, an agent key could drain a wallet through a "pull" — a contract that takes tokens out of the wallet on the agent's behalf — without the daily spending cap noticing. Warden re-ran the exact attack (30 registrations, each pulling 1,000 POLYDASH against a 1,000/day cap): it now stops after the first one, and the cap records the full 1,000. The same holds for the other pull shapes Warden tried (a generic vault, a pull the day after an approval, a pull through the 4337 sponsored-transaction path), and an agent-approved pull is no longer charged twice.
- **The factory hole (M-01) is fixed.** A stranger can no longer create a wallet for someone else, and front-running the owner's own creation with the same salt fails. The owner creating their own wallet still works.
- **The paymaster hole (M-02) is fixed.** Before, several sponsored transactions bundled together could each pass the gas cap check against the same stale number and overspend. Now each one reserves its maximum gas cost up front, so a bundle that would exceed the per-wallet or global cap fails validation and the whole bundle is rejected. A bundle inside the caps still succeeds, and the paymaster settles each reservation against the real gas used afterward (refund when it cost less, top-up when it cost more).
- **Two new, smaller issues were found in the fix itself.** One is a Low: in one specific sequence (owner sets a token cap by direct transaction, then rotates the key to that key) the token list can end up duplicated, and a pull is then charged twice — it over-charges, never under-charges, so it cannot be used to bypass a cap. The other is Informational: the on-chain `Executed` event reports a pull as token = zero, amount = 0 even though 1,000 tokens moved and were charged — the money is tracked correctly on-chain, but anything reading the event (receipts, indexers) will miss pull movements. A second Informational: the paymaster's documentation says a 50k gas budget fails with error AA33; in fact the EntryPoint rejects it earlier with AA36. The operational guidance (use 80k) is still right.
- **One known limitation was confirmed and is honestly documented.** A pull of a token that has *no* cap set is not tracked by the balance check (the contract cannot list all the tokens a wallet holds). The owner must not give a pull-target an allowance for an uncapped token. This is written in the contract's own documentation and covered by a test. It does not change the verdict, because it needs an owner action the documentation explicitly warns against, and the live configuration caps the tokens the agent uses.

**Verdict recommendation: GREEN.** No Critical or High findings remain open after verification. The only open items are Lows and Informationals (five original Lows and three original Informationals deferred by Jon, plus one new Low and two new Informationals from this round). Green here means "the high and medium problems are fixed and verified" — it is not a claim that the contracts are bug-free, and it is not a third-party audit.

---

## Verdict recommendation: GREEN

| | Phase 1 (Nov 22) | Phase 2 (this report) |
|---|---|---|
| Critical | 0 | 0 |
| High | 1 (H-01, Open) | 0 open — H-01 **Fixed** |
| Medium | 2 (M-01, M-02, Open) | 0 open — M-01, M-02 **Fixed** |
| Low | 5 (Open) | 6 open (L-01–L-05 deferred + new L-06) |
| Informational | 3 (Open) | 5 open (I-01–I-03 deferred + new I-04, I-05) |
| **Total** | **11** | **14 (11 original + 3 new)** |

Per the audit's verdict scale, green requires no Critical or High findings open. That condition is met: H-01, M-01 and M-02 were each verified fixed with fresh evidence below. The remaining open findings are Low and Informational severity and do not block green. The /audits listing may be flipped to green with this report linked, per Jon's Nov 22 direction (verdict flips to green only after Warden's Phase 2 re-review verifies the fixes).

---

## Per-finding status — all 11 original findings

### H-01 — Pull-pattern cap bypass — **FIXED** (verified)

**What the fix does.** `_execute` was restructured into three steps: `_preCharge` (charges movement visible in the call itself — transfer / transferFrom / approve / increaseAllowance / decreaseAllowance), `_snapshotBalances` (records the Safe's balance of each of the key's capped tokens before the call), and `_chargeDelta` (after the call, charges any balance decrease not already covered by the pre-charge; a revert on the charge rolls the whole call back). A new `prepaidAllowance` mapping records approvals the agent granted through the module earlier the same day, so a same-day pull against that approval is not charged twice; `decreaseAllowance` shrinks the pre-payment; the pre-payment is same-day only, so a day-2 pull of a day-1 approval is charged in full. A token whose `balanceOf` reverts or returns short data is skipped by `_safeBalanceOf` (pre-charge still applies).

**Warden's fresh evidence (all in `WardenPhase2.t.sol`, all passing):**
- `testW2_H01_PoC30_BindsToCap` — the Phase 1 proof-of-concept replayed: owner grants the registry a max allowance, agent key attempts 30 registrations of 1,000 POLYDASH each against a 1,000/day cap. Result: exactly **1** bond lands, `spentDaily` = 1,000 (the full cap), the 2nd–30th attempts revert with `CapExceeded`. Before the fix, all 30 landed with `spentDaily` = 0.
- `testW2_H01_NoCapPullReverts` — a pull with no cap at all (the Phase 1 "drain with no cap" case) now reverts instead of draining.
- `testW2_H01_CrossDayLeftoverCharged` — an allowance granted on day 1 and pulled on day 2 is charged in full on day 2 (the same-day-only pre-payment does not leak across the boundary).
- `testW2_H01_GenericVaultBounded` — a pull through a generic vault contract (not the registry) is bounded the same way.
- `testW2_H01_AgentApproveNotDoubleCharged` — an agent-approved pull is charged exactly once (pre-payment offsets the delta).
- `testW2_H01_IncreaseDecreaseAllowance` — `increaseAllowance` / `decreaseAllowance` move the pre-payment correctly in both directions.
- `testW2_H01_PullVia4337Binds` — the same pull through the sponsored 4337 path (UserOp → EntryPoint → 4337 module → session-key module) binds identically: first registration lands, second fails at execution with `CapExceeded`, `handleOps` itself succeeds. (See Operational Notes for the gas detail: a registerAgent through the full 4337 path needs a ~500k call-gas limit, so this test uses self-funded ops.)
- Mason's own `FixRoundH01M01M02Test` (10 tests) and the updated `AuditV2PullPattern` repro tests also pass and now assert the fixed behavior; the original exploit PoCs are preserved in git history at `639529b` and in the Phase 1 report.

**Residual (assessed separately below):** pulls of tokens with *no* cap set are not delta-tracked. Confirmed real, accurately documented, graded Acknowledged — it does not change this verdict.

### M-01 — Permissionless factory front-run — **FIXED** (verified)

**What the fix does.** Both `createWallet` and `createWalletCustom` now require `msg.sender == owner` (`NotOwner` error). Chosen over EIP-712/commit-reveal as the smallest change for an owner-self-service flow.

**Warden's fresh evidence:**
- `testW2_M01_StrangerCannotCreate` — a stranger calling `createWallet`/`createWalletCustom` for the owner reverts with `NotOwner`.
- `testW2_M01_OwnerCanCreateOwnWallet` — the owner creating their own wallet still works (same salt, same flow).
- `testW2_M01_FrontRunSameSaltFails` — a front-run creation with the same salt fails (the stranger cannot claim the address, and the owner's own creation proceeds).

### M-02 — Paymaster intra-bundle cap breach — **FIXED** (verified)

**What the fix does.** `validatePaymasterUserOp` now reserves `maxCost` (`spentDaily` / `spentGlobalDaily` += maxCost) at validation time; `postOp` settles the reservation against the actual gas cost (refund if actual < reserved, top-up if actual > reserved). The context passed to `postOp` is now `(sender, maxCost)`. Because the EntryPoint validates all ops in a bundle before executing any, sequential validations in one bundle now see each other's reservations.

**Warden's fresh evidence:**
- `testW2_M02_PerWalletBundleFails` — the Phase 1 bundle (4 ops from one wallet, 0.000583 ETH vs the 0.0005 cap, +16.6%) now fails validation; the whole bundle is rejected and no gas is spent.
- `testW2_M02_GlobalBundleFails` — the Phase 1 bundle (11 wallets, 0.002148 vs the 0.002 global cap, +7.4%) now fails validation.
- `testW2_M02_WithinCapBundleSucceeds` — a bundle inside both caps still succeeds (no regression).
- `testW2_M02_PostOpRefundAndTopUp` — `postOp` settles correctly in both directions: reserve 0.00048 / actual 0.0002 → spent 0.0002 (refund); reserve 0.00048 / actual 0.0006 → spent 0.0006 (top-up).
- **Fork confirmation (live EntryPoint v0.7):** `AuditV2PaymasterBundleForkTest.testRepro_PerWalletCapBreachedInOneBundle_Fork` passes on a fork of Robinhood Chain against the live EntryPoint v0.7 with freshly deployed fix-code contracts — total spent after the bundle is 0 (rejected wholesale). The local tests use the repo's account-abstraction lib (EntryPoint v0.8 semantics); the fork test proves the fix also holds under the live v0.7 EntryPoint.
- Gas budget: see Operational Notes. Live validation costs 59,731 gas cold / 29,331 warm; the repo's 80k `paymasterVerificationGasLimit` is sufficient; 50k is rejected (AA36, not AA33 — see I-05).

### L-01 — Stuck pending rotation bricks recovery — **OPEN** (deferred by Jon, not addressed this round)
### L-02 — `setKeyPolicy` creates a second live key — **OPEN** (deferred by Jon)
### L-03 — Setter cross-checks missing — **OPEN** (deferred by Jon)
### L-04 — Global cap Sybil grief — **OPEN** (deferred by Jon)
### L-05 — Rotation doesn't revoke agent key — **OPEN** (deferred by Jon)
### I-01 — Assembly out-of-bounds read (no reachable exploit) — **OPEN** (deferred by Jon)
### I-02 — Validation reverts vs `SIG_VALIDATION_FAILED` — **OPEN** (deferred by Jon)
### I-03 — Allowlist hygiene / USDG cap unreachable on Jon's wallet — **OPEN** (deferred by Jon)

No re-verification was attempted on the deferred items; they are unchanged from Phase 1 and remain open by Jon's decision. They do not block a green verdict under the audit's scale.

---

## New findings from the fix round

### L-06 — Duplicate `policyTokens` entries double-charge pulls — **Low, OPEN**

**Severity rationale:** fail-safe direction (over-charge, never a bypass), but it can brick an agent key's spending and it is a real accounting error introduced by the fix's new delta loop.

**Evidence** (`testW2_H01_DuplicatePolicyTokensDoubleChargesPull`, passing — it asserts the buggy behavior): `setTokenCaps` dedupes via `_hasTokenCap`, but `rotateKey` pushes unconditionally. Sequence: owner sets a token cap for key B by direct Safe transaction (no policy), then rotates the live key to key B. `getPolicyTokens` then returns 5 entries with POLYDASH listed **twice**. The delta loop charges the same pull once per entry: a 400 POLYDASH pull is charged **800**; a further 200 pull then reverts with `CapExceeded` (800 + 400 > 1,000 cap). The tokens move correctly (the vault received exactly 400); only the accounting is wrong, and it is wrong in the direction that *stops* spending. No bypass is possible through this path.

**Fix suggestion:** dedupe in `rotateKey` the same way `setTokenCaps` does (check `_hasTokenCap` before pushing), or dedupe the delta loop by token. Recommended for the next fix round; not verdict-blocking.

### I-04 — `Executed` event under-reports pull movements — **Informational, OPEN**

**Evidence** (`testW2_H01_ExecutedEventUnderReportsPull`, passing — it asserts the observed behavior): a registerAgent pull moves 1,000 POLYDASH and `spentDaily` is charged the full 1,000, but the emitted `Executed` event carries `token = address(0)`, `amount = 0`. The event fields come from the pre-charge only, so a delta-charged pull is invisible in the event. On-chain accounting is correct; off-chain consumers (receipts, indexers, any UI reading the event) will miss pull movements.

**Fix suggestion:** populate the event from the delta charge as well (e.g. emit a second event, or extend `Executed` with the delta-charged token/amount). Recommended for the next fix round; not verdict-blocking.

### I-05 — Paymaster NatSpec misstates the 50k failure mode — **Informational, OPEN**

**Evidence** (`testW2_M02_ValidationGas`, passing): the NatSpec on `validatePaymasterUserOp` says "A 50k budget runs out of gas and the op fails with AA33." Measured live: a 50k `paymasterVerificationGasLimit` is rejected by the EntryPoint with `FailedOp(0, "AA36 over pmVerificationGasLimit")` **before the paymaster is even called**. AA33 (paymaster out of gas) is the failure mode only for a budget between the EntryPoint's minimum and the ~59.7k cold validation cost. The operational guidance itself (use 80k) is correct and verified — only the stated error code at 50k is wrong.

**Fix suggestion:** correct the NatSpec to AA36 at 50k. One-line documentation fix.

---

## Known residual — assessed

**"A pull of a token with NO cap set is not delta-tracked."** — **Acknowledged.**

- **Confirmed real:** `testW2_H01_UncappedTokenPullNotTracked_Residual` passes — a pull of an uncapped token through an allowlisted target moves funds without charging anything (there is no cap to charge against). The module cannot enumerate a Safe's holdings, so it can only track the tokens listed in the key's policy.
- **Confirmed accurately documented:** the module NatSpec states it plainly — *"Balance-delta tracking covers the key's capped tokens only (policyTokens). A token with NO cap set is not tracked: the owner must not grant an allowance to an allowlisted pull-target for a token without a cap, and must revoke such allowances before enabling an agent key (see the wizard UI). Direct transfers of an uncapped token are still denied (cap 0)."* The residual is also covered by a test in Mason's fix-round suite.
- **Grading:** this is a documented boundary of the fix, not a hole in it. It requires an owner action the documentation explicitly warns against (granting a pull-target allowance for an uncapped token). The live configuration caps the tokens the agent uses, and direct transfers of uncapped tokens are still denied (cap 0). **It does not change the verdict.** It should stay documented wherever owners set up agent keys (the wizard UI note referenced in the NatSpec is the right place).

---

## Operational notes (not findings)

- **Paymaster validation gas budget (live, authoritative).** Traced from real `handleOps` bundles: first validation in a bundle costs **59,731 gas cold**, later ones **29,331 gas** (global slot warm). This matches the NatSpec's "~65k cold, ~30k warm". The repo's 80k `paymasterVerificationGasLimit` is sufficient; 50k is rejected with AA36 (see I-05). A direct external-call measurement read 97,784 gas cold / 80,692 warm — that overstates the live cost (the test contract ABI-encodes the whole op struct and the EntryPoint account is cold in the direct path); the live trace is what bundlers experience, and Warden could not fully decompose the gap, so the direct figure is recorded here as a measurement caveat, not the budget.
- **Verification-gas ceiling.** `maxCost` grows with the verification-gas limit, so at these gas limits (150k verification / 150k call / 50k pre-verification / 50k post-op, 1 gwei) a `paymasterVerificationGasLimit` above 100k makes `maxCost` exceed the 0.0005 ETH per-wallet cap and the op can never validate (measured: 110k → `CapExceeded` at validation). The usable window is roughly 60k–100k; 80k sits comfortably inside it.
- **Effective sponsored throughput.** The reservation prices each sponsored op at `maxCost` (~0.00048 ETH at the test's gas limits) against the 0.0005 ETH/day per-wallet cap, so effectively **~1 sponsored op per wallet per day** at those limits — the second op's validation fails even though its actual gas cost (~0.00018–0.00030 ETH) would fit. Bundlers should use separate bundles per op or the cap should be sized with `maxCost` in mind. This is the intended fail-closed behavior of the M-02 fix, not a bug, but it is a real throughput consequence owners should know about.
- **Expensive agent actions need self-funding or higher caps.** A `registerAgent` through the full 4337 path needs a ~500k call-gas limit (nested Safe/module hops plus the registry's storage writes); with a 150k call-gas limit the op runs out of gas inside the registry (`ReentrancySentryOOG`) after the bond transfer already succeeded — the whole op then reverts, so no funds are lost, but the registration does not land. A sponsored op with that call-gas limit would price itself out of the 0.0005 cap via `maxCost`. Agents doing expensive calls should self-fund or the cap should be raised.

---

## Methodology (Phase 2 re-review)

- **Read first:** the Phase 1 report in full, then the `639529b` → `7fbb817` source diff for all four changed contracts (`PolypadSessionKeyModuleV2`, `PolypadAgent4337Module`, `PolypadPaymaster`, `PolypadWalletFactoryV2`).
- **Fresh evidence, not the builder's word:** Warden wrote its own test file (`test/agent-wallet/WardenPhase2.t.sol`, 18 tests, own harness and assertions) covering every fix claim plus the 4337 path, the event, the duplicate-token case, the residual, and the gas budget. Mason's fix-round tests were run as a cross-check, not as evidence.
- **Isolated build.** The full repo does not compile on this box: the via_ir build of ~400 files across four solc versions is OOM-killed (SIGKILL) even with `--jobs 1` (three attempts, 6 GiB limit). Warden therefore verified in a scratch Foundry project (`/tmp/warden-p2/probe`) containing only the agent-wallet contracts, `AgentRegistry`, the v1 module/factory, and the test files, with the same compiler settings as the repo (`via_ir = true`, optimizer 200 runs, cancun, same `compilation_restrictions` for safe-contracts). Bytecode fidelity was checked: the test-deployed paymaster is 2,867 bytes and the module 10,121 bytes, matching the via_ir artifacts (2,868 / 10,122), not the no-ir ones (3,655 / 12,571). The full-repo suite could not be run here; the fix's blast radius was confirmed confined (no `src/` file outside `src/agent-wallet/` imports these contracts), so the agent-wallet suite is the relevant scope.
- **Test results (all passing, zero failures):**
  - Warden Phase 2 suite: **18/18**.
  - Agent-wallet non-fork suite in the isolated build: **138/138** (10 suites — Warden 18, Mason FixRound 10, AuditV2 repros, module/paymaster/v1 tests).
  - `AuditV2InvariantsTest`: **26/26** (incl. `invariant_spentNeverExceedsDailyCap`).
  - V1 `PolypadSessionKeyModuleInvariantTest`: **1/1** suite.
  - Fork suites on a Robinhood Chain fork (`ROBINHOOD_RPC_URL=https://robinhood.drpc.org`, read-only local fork, no mainnet transactions): **11/11** (3 suites — live EntryPoint v0.7, Safe singleton, proxy factory, identity registry; freshly deployed fix-code contracts).
- **Static analysis.** Slither 0.11.6 (solc 0.8.30) run fresh on the three changed files: 27 hits total (ModuleV2 9, Paymaster 4, FactoryV2 14). Triaged: `reentrancy-no-eth` on `_execute` is a false positive (`execute`/`executeVia4337` are `nonReentrant`, admin functions are `onlySafe`, the target is called by the Safe and cannot impersonate it); `uninitialized-local` on `ExecState st` is a false positive (memory struct zero-initialized); `calls-loop` on `_safeBalanceOf` is benign (read-only staticcall, gas bounded by the op's limits); `incorrect-equality` on day==day checks is benign (discrete day values; the `_charge` amount==0 check is pre-existing); `incorrect-exp` / `divide-before-multiply` are OpenZeppelin `Math.mulDiv` dependency false positives (same as Phase 1). **Zero material new findings from Slither.** Raw outputs: `/tmp/warden-p2/slither-{PolypadSessionKeyModuleV2,PolypadPaymaster,PolypadWalletFactoryV2}.txt`.
- **Not done:** no deployment, no push, no live-contract changes, no /audits listing update (those happen separately after this report). No re-verification of the deferred L-01–L-05 / I-01–I-03.

## Reproduction

```bash
# Isolated build (the full repo OOMs on this box; see Methodology)
# Scratch project at /tmp/warden-p2/probe mirrors the repo's agent-wallet
# sources + tests with identical compiler settings.
cd /tmp/warden-p2/probe
forge test --match-contract WardenPhase2Test -vv
forge test --no-match-contract "Fork" --no-match-test "invariant"
ROBINHOOD_RPC_URL=https://robinhood.drpc.org forge test --match-contract "ForkTest" -vv
```

---

*Warden is Polypad's in-house agent audit team, not an independent third-party firm. This report is an internal review; it is not a third-party audit attestation.*
