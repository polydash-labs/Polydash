# Warden Internal Review — Agent Wallet v2 — PHASE 4 (Re-review of Fix Round 3)

**Date:** Sun Nov 22, 2026 (evening PST)
**Auditor:** Warden (Polypad in-house agent audit team — lead auditor + invariant/fuzz specialist)
**Scope:** Re-review of fix round 3 for the Phase 1 Internal Review (Nov 22, 2026), the Phase 2 re-review (Nov 22, 2026), and the Phase 3 re-review (Nov 22, 2026).
**Repo:** `~/workspace/polydash-agent-wallets`, branch `agent-wallets`
**Audited commit (Phase 1):** `639529b`
**Fix commit round 1 (Phase 2, verified green):** `7fbb817` — "Fix Warden review findings H-01, M-01, M-02 (agent-wallet v2)"
**Fix commit round 2 (Phase 3, green holds):** `0085896` — "Fix Warden Phase 2 findings L-06, I-04, I-05 (agent-wallet v2)"
**Fix commit round 3 (this re-review):** `9f43140` — "Fix Warden Phase 3 findings I-06, I-05 (agent-wallet v2)", parent `0085896` (local only, not pushed; **deployed Nov 22, 2026** — see Deployment note below)
**Deployment (Nov 22, 2026, evening PST):** the fixed contracts at `9f43140` are live on Robinhood Chain, Sourcify exact_match: SessionKeyModuleV2 `0xB8A927dfd18D87f5a041706b14424CBBA59Db270`, Agent4337Module `0x49F49C72FE7B3A7EE418c5936Bd84af2dB57c8E5`, Paymaster `0x03db6aaf03CAb9B4DA5fc27BF3C20fAC333e86EA`, WalletFactoryV2 `0x944E225D5f53c25aa4C019CFD9B42f0a40b9AC22`. Jon's v2 wallet (`0x76106b…`) migrated to the new modules with its policy unchanged.
**Known post-deploy note:** the new paymaster's `isPolypadWallet` check uses the new factory, which does not recognize wallets created by the old factory — sponsored UserOps for those wallets (including Jon's migrated wallet) would revert until a contract-level fix. Do not fund the paymaster until resolved.
**Original report:** `hidden_files/team/audit/2026-11-22.md` (untouched)
**Phase 2 report:** `hidden_files/team/audit/2026-11-22-final.md` (untouched; this file is the Phase 4 addendum)
**Phase 3 report:** `hidden_files/team/audit/2026-11-22-phase3.md` (untouched)
**Warden's fresh test file:** `test/agent-wallet/WardenPhase4.t.sol` (11 tests, written independently — not Mason's tests; left untracked in the repo)

---

## Plain-language summary

Both remaining Phase 3 items are fixed and verified with Warden's own fresh tests.

- **The cap-overwrite bug (I-06) is fixed.** Rotating a key used to overwrite the new key's own cap values with the old key's: an owner who deliberately set a 500 cap on the new key got 1,000 after rotation, with no signal. Warden re-ran the exact Phase 3 repro values in both directions — 500 stays 500 (a 600 pull now reverts, a 400 pull lands), 2,000 stays 2,000 (a 1,500 pull lands) — plus angles Mason's regressions do not cover: a direct-set **0** cap survives rotation at 0 (any pull reverts), a double rotation in which both the intermediate and final keys pre-seeded caps preserves each key's own values while the carry composes across rotations, and a fresh-key control proving the carry still works when the new key has no caps at all. The L-06 dedupe still holds through all of it.
- **The doc fix (I-05) is now complete.** The paymaster's documentation now states both failure modes in one sentence — the exact sentence Warden recommended in Phase 3 — and Warden re-measured live on the new commit: cold first validation at 50k fails AA33, warm fails AA36, 80k executes. The doc matches reality in both states.
- **The round-1 fixes still hold.** Fresh compact re-checks of H-01 (3 registration attempts, exactly one lands), M-01 (stranger creation still reverts), and M-02 (2-op single-wallet bundle and 6-wallet global bundle both fail validation wholesale) all pass, and the full Phase 2 and Phase 3 suites re-run clean (18/18 and 16/16).
- **No new findings.** The round-3 diff touches two source files and nothing in it introduces a new issue. One pre-existing storage observation is recorded below; it is inert and not a finding.

**Verdict: GREEN holds for fix commit `9f43140`.** No Critical or High findings are open. The only open items are Lows and Informationals (five original Lows and three original Informationals deferred by Jon, plus I-05/I-06 now fixed). Green here means "the high and medium problems are fixed and verified" — it is not a claim that the contracts are bug-free, and it is not a third-party audit. **This commit is deployable.**

---

## Verdict: GREEN (holds)

| | Phase 1 (Nov 22) | Phase 2 (Nov 22) | Phase 3 (Nov 22) | Phase 4 (this report) |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 1 (H-01, Open) | 0 open — H-01 **Fixed** | 0 open | 0 open |
| Medium | 2 (M-01, M-02, Open) | 0 open — M-01, M-02 **Fixed** | 0 open | 0 open |
| Low | 5 (Open) | 6 open (L-01–L-05 deferred + new L-06) | 5 open (L-01–L-05 deferred; L-06 **Fixed**) | 5 open (L-01–L-05 deferred) |
| Informational | 3 (Open) | 5 open (I-01–I-03 deferred + new I-04, I-05) | 6 open (I-01–I-03 deferred + I-04 **Fixed** + I-05 **Partially fixed** + new I-06) | 3 open (I-01–I-03 deferred; I-04 **Fixed**; I-05 **Fixed**; I-06 **Fixed**) |
| **Total** | **11** | **14 (11 original + 3 new)** | **15 (11 original + 4 round-2-era)** | **15 (11 original + 4 round-2-era; 0 new)** |

Per the audit's verdict scale, green requires no Critical or High findings open. That condition is met. The /audits listing may stay green with this report linked alongside the Phase 2 final and Phase 3 reports, and the fixed contracts at `9f43140` may be deployed.

---

## Per-finding status — fix round 3

### I-06 — Rotation overwrites the new key's own cap values — **FIXED** (verified)

**What the fix does.** In `rotateKey`, the cap-value copy moved inside the existing `_hasTokenCap` guard, so the value copy, the flag set, and the list push are now all skipped together for tokens the new key already has a cap for. Tokens the new key lacks still inherit the old key's values. The `rotateKey` NatSpec was updated to match ("keeps its own cap value and is listed once — the value copy and the push both skip tokens the new key already has a cap for (L-06 fix, I-06 fix). Other tokens inherit the old key's cap values.").

**Warden's fresh evidence (all in `WardenPhase4.t.sol`, all passing):**
- `testW4_I06_Cap500Preserved_ExactRepro` — Phase 3 repro values, up direction: direct-set 500 on key B survives rotation at 500; a 600 pull reverts `CapExceeded` (pre-fix it succeeded under the carried 1,000); a 400 pull succeeds, charged exactly 400.
- `testW4_I06_Cap2000Preserved_ExactRepro` — Phase 3 repro values, down direction: direct-set 2,000 survives at 2,000; a 1,500 pull succeeds, charged 1,500.
- `testW4_I06_UnsetTokensInheritOldValues` — union preserved: USDG 100_000_000, TKN 20, ETH 2 inherited; POLYDASH keeps its own 500.
- `testW4_I06_ZeroCapPreserved` — **new angle, not in Mason's tests:** a direct-set 0 cap survives rotation at 0 and any pull reverts. This works because `setTokenCaps` sets `_hasTokenCap` even for a 0 value, so the skip guard treats 0 as "has a cap". Pre-fix the 0 became 1,000. (Note for the build: a 0 cap is a legitimate "this key may never move this token" setting, and rotation now respects it.)
- `testW4_I06_DoubleRotationPreservesBothKeysCaps` — **new angle, not in Mason's tests:** both keys pre-seeded (B: POLYDASH 500; C: TKN 7). After A→B→C, C keeps its own TKN 7 (not B's 20), inherits B's preserved POLYDASH 500 (C had no POLYDASH cap — the carry composes across rotations), and inherits USDG/ETH. The list is the exact 4-token set, each once; boundary pulls 400 + 100 as C charge exactly 400 then 500 (the preserved cap — a further pull reverts); both old keys' token lists are deleted. (Test-authoring note: the first draft of this test used 400 + 600 pulls calibrated to the old key's 1,000 cap; it failed with `CapExceeded` on the second pull — which is the correct behavior under the preserved 500 cap, and is itself confirmation the fix works. The test now pulls to the 500 boundary.)
- `testW4_I06_RotationToFreshKeyCarriesAll` — fresh-key control: rotating to a key with no direct-set caps carries all four old values and the exact 4-token list. The skip guard does not suppress the carry when the new key is empty.

Mason's own `FixRoundPhase3Test` (4 tests) also passes and asserts the fixed behavior; the original PoC is preserved in the Phase 3 report text.

### I-05 — Paymaster NatSpec misstates the 50k failure mode — **FIXED** (verified)

**What the fix does.** The NatSpec on `validatePaymasterUserOp` now reads, verbatim, Warden's Phase 3 recommended correction: "A 50k budget fails closed either way: AA33 (paymaster out of gas) on a cold first validation of the day, AA36 once the global cap slot is warm. The repo's tests use 80k."

**Warden's fresh evidence:**
- `testW4_I05_ColdWarmReMeasured` — re-measured live on `9f43140` (paymaster source is NatSpec-only changed, so behavior must be identical to Phase 3, and it is): cold first validation at 50k fails with `FailedOpWithRevert(0, "AA33 reverted", 0x)`; after a successful 80k op warms the global slot, a fresh wallet's 50k op fails with `FailedOp(0, "AA36 over pmVerificationGasLimit")`; 80k executes (1 ether transferred). The doc now matches reality in both states. Either failure mode fails closed; the operational guidance (use 80k) is unchanged and verified.

### Assessment of the WardenPhase3 test rework (disclosure)

Mason reworked Warden's two Phase 3 I-06 repro tests (`testW3_L06_CapValueOverwrittenUp/Down`) into `testW3_I06_CapValuePreservedUp/Down`, asserting the fixed behavior. Warden checked the rework (diff of the on-disk file against the Phase 3 original): **legitimate.** The assertions were inverted, not weakened — each test now asserts both the preserved cap value (500 / 2,000) AND the pull behavior in the corresponding direction (600 reverts + 400 succeeds; 1,500 succeeds), which is strictly stronger than the original single-direction assertions. The original buggy-behavior PoC survives only in the Phase 3 report text, which is the correct place for it. Re-running that suite (16/16) remains valid regression evidence against `9f43140`.

---

## Regression — round-1 fixes still bound

Fresh compact checks in `WardenPhase4.t.sol` (all passing), plus the full Phase 2 and Phase 3 suites re-run below:
- `testW4_H01_CompactPoCStillBinds` — 3 registration attempts, exactly one lands, spent == cap, registry holds 1,000 (the full 30-attempt PoC re-runs with the Phase 2 suite).
- `testW4_M01_StrangerStillCannotCreate` — stranger creation still reverts `NotOwner`; owner creation still works.
- `testW4_M02_TwoOpsOneWalletFails` — 2 sponsored ops from one wallet in one bundle fail validation wholesale (2 × ~0.00048 maxCost reservation > 0.0005 cap), nothing executes, no residual reservation.
- `testW4_M02_SixWalletGlobalFails` — 6 wallets × 1 op fail validation (6 × ~0.00048 > 0.002 global cap), nothing executes, no residual reservations.

## Unchanged items (not re-verified this round)

- **L-01–L-05, I-01–I-03 — OPEN** (deferred by Jon, unchanged). They do not block green.
- **Known residual — Acknowledged, unchanged:** pulls of tokens with no cap set are not delta-tracked (Phase 2 assessment stands; the round-3 diff does not touch it).

## New-issue sweep (diff only)

The round-3 diff touches two source files: `PolypadSessionKeyModuleV2.sol` (`rotateKey` value-copy guard + NatSpec) and `PolypadPaymaster.sol` (NatSpec only). Review of the full diff plus the test evidence above found **no new issues**.

**Observation, not a finding:** `rotateKey` deletes the old key's policy, token list, and `_hasTokenCap` flags, but the old key's `tokenCaps` values remain in storage. They are inert — the old key has no policy and cannot execute — and this predates round 3 (same in `639529b`, `7fbb817`, `0085896`). No action needed; recorded so a future reader does not mistake stale storage for live state.

**Static analysis.** Slither 0.11.6 (`python3 -m slither`, default detector set) run fresh on the two changed files in the isolated build: **module 23 hits, paymaster 8 hits — zero material, none touching the round-3 diff.** Diffed against Phase 3's raw outputs: exactly one added hit per file, `solc-version` (Informational — the `^0.8.20` pragma *range* contains known severe issues; the pragma is untouched by round 3 and the build uses solc 0.8.30). All other hits are the same ones Phase 2/3 triaged: `weak-prng` on the active-hours window (by design); `incorrect-equality` on day/amount checks (discrete values, pre-existing); `reentrancy-no-eth` on `_execute` (false positive — `nonReentrant`, `onlySafe` admin, target called by the Safe); `uninitialized-local` on `ExecState st` (false positive — zero-initialized); `calls-loop` on `_safeBalanceOf` (benign — read-only staticcall); `timestamp` (day-window uses — by design); `pragma` / `naming-convention` (informational/style); `low-level-calls` (`_safeBalanceOf` staticcall — benign); `reentrancy-events` on paymaster deposit/withdraw (owner-only, emit-after-call — benign). Raw outputs: `/tmp/warden-p4/slither-module.json`, `/tmp/warden-p4/slither-paymaster.json`.

## Operational notes (not findings)

- **A 0 cap is now a real setting.** Because `setTokenCaps` flags the token even at 0, an owner can set a 0 cap to mean "this key may never move this token", and rotation respects it. The wizard should surface 0 caps as an explicit deny, not as "no cap set".
- **AA33 vs AA36 still depends on warmth.** Unchanged from Phase 3: a bundler debugging a 50k rejection sees AA33 on the first validation of the day and AA36 later the same day. Both mean "raise the verification-gas budget"; 80k works in both states. The NatSpec now says so.

## Methodology (Phase 4 re-review)

- **Read first:** the Phase 3 report in full (I-05 and I-06 sections, including the recommended I-05 sentence), then the `0085896` → `9f43140` source diff for both changed contracts, then Mason's `FixRoundPhase3.t.sol` and the reworked `WardenPhase3.t.sol` (diffed against the Phase 3 original).
- **Fresh evidence, not the builder's word:** Warden wrote its own test file (`test/agent-wallet/WardenPhase4.t.sol`, 11 tests, own harness and assertions) covering every round-3 fix claim plus angles Mason's regressions do not cover — the zero-cap edge, a double rotation with both keys pre-seeded, a fresh-key carry control, and a live re-measurement of the cold/warm AA33/AA36 split. Mason's fix-round tests were run as a cross-check, not as evidence.
- **Isolated build.** The full repo does not compile on this box: the via_ir build of ~400 files across four solc versions is OOM-killed (6 GiB limit) — same as Phases 2 and 3. Warden verified in a scratch Foundry project (`/tmp/warden-p4/probe`, copied from the Phase 3 probe and re-synced to `9f43140` sources and tests) containing only the agent-wallet contracts, `AgentRegistry`, the v1 module/factory, and the test files, with the same compiler settings as the repo (`via_ir = true`, optimizer 200 runs, cancun, `lib/safe-contracts/**` via_ir=false via the `no-ir` profile). Bytecode fidelity was checked: the test-deployed paymaster artifact is 2,868 bytes, matching Phase 2/3 (NatSpec-only change, bytecode unchanged modulo the 1-byte artifact-vs-deployed convention); the module is 10,282 bytes vs Phase 3's 10,275 (+7 bytes, consistent with the store moving inside the existing branch — not the no-ir ~12,571). The full-repo suite could not be run here; the fix's blast radius was confirmed confined (the round-3 diff touches only `src/agent-wallet/PolypadSessionKeyModuleV2.sol` and `PolypadPaymaster.sol`, and no `src/` file outside `src/agent-wallet/` imports them), so the agent-wallet suite is the relevant scope.
- **Test results (all passing, zero failures):**
  - Warden Phase 4 suite: **11/11**.
  - Agent-wallet non-fork suite in the isolated build: **174/174** across 13 suites — PolypadPaymaster 12, PolypadSessionKeyModuleV2 18, AuditV2Agent4337 11, FixRoundPhase3 (Mason) 4, PolypadSessionKeyModule (v1) 33, AuditV2PullPattern 5, WardenPhase3 (re-run, reworked) 16, WardenPhase4 11, FixRoundPhase2 (Mason) 4, AuditV2PaymasterBundle 5, FixRoundH01M01M02 10, WardenPhase2 (re-run) 18, AuditV2Invariants 25 + 2 invariant tests run separately (incl. `invariant_spentNeverExceedsDailyCap`, v1 invariant suite) — 2/2.
  - Fork suites on a Robinhood Chain fork (`ROBINHOOD_RPC_URL=https://robinhood.drpc.org`, read-only local fork, no mainnet transactions): **11/11** (3 suites — live EntryPoint v0.7, Safe singleton, proxy factory, identity registry; freshly deployed fix-code contracts; M-02 fork PoC: total spent after the bundle is 0).
- **Not done:** no deployment, no push, no live-contract changes, no /audits listing update (those happen separately after this report). No re-verification of the deferred L-01–L-05 / I-01–I-03.

## Reproduction

```bash
# Isolated build (the full repo OOMs on this box; see Methodology)
# Scratch project at /tmp/warden-p4/probe mirrors the repo's agent-wallet
# sources + tests with identical compiler settings.
cd /tmp/warden-p4/probe
forge test --match-contract WardenPhase4Test -vv
forge test --no-match-contract "Fork" --no-match-test "invariant"
forge test --match-contract "AuditV2InvariantsTest|PolypadSessionKeyModuleInvariantTest" --match-test "invariant"
ROBINHOOD_RPC_URL=https://robinhood.drpc.org forge test --match-contract "ForkTest" -vv
```

---

*Warden is Polypad's in-house agent audit team, not an independent third-party firm. This report is an internal review; it is not a third-party audit attestation.*
