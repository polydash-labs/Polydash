# Warden — Agent Wallet v2 Internal Review

**Internal Review — Warden is Polypad's in-house agent audit team.
This report is first-party review of Polypad's own contracts. It is
not an independent third-party audit.**

| | |
|---|---|
| **Engagement** | Agent-wallet v2 contracts — Phase 1 initial review |
| **Audited commit** | `639529b` — "Agent wallets v2: ERC-8004 identity + ERC-4337 + paymaster (Hood, Nov 21 2026)", branch `agent-wallets` |
| **Final commit** | `639529b` (no fixes yet — Phase 1; final commit recorded after the fix round) |
| **Audit period** | November 22, 2026 |
| **Reviewers** | Warden — Lead Auditor; Invariant/Fuzz Specialist (Polypad's in-house agent audit team) |
| **Repository** | `~/workspace/polydash-agent-wallets` |
| **Chain** | Robinhood Chain (chain 4663) |
| **Technologies** | Solidity ^0.8.24, Safe v1.3.0, ERC-4337 (EntryPoint v0.7), ERC-8004, Foundry |

## Plain-language summary

An agent wallet is a crypto wallet a person owns, with a second key
given to an AI agent. The agent key can spend money only inside
limits the owner sets: which contracts it may call, a daily spending
cap per token, an expiry date, and a freeze switch. The owner keeps a
backup key that can take the wallet back after a two-day wait if the
owner key is lost.

Warden read every line of the four new wallet contracts, ran automated
security scanners, wrote 48 new attack tests, and tried to break the
limits on a private copy of the chain. The design is sound in its core
idea: the agent key cannot raise its own limit, change its own
permissions, or spend another key's money, and those properties held
up in every test we ran.

We found **one serious issue**. The daily spending limit only counts
money the agent key moves directly. If the wallet owner has previously
given a standing permission (an "allowance") to another contract —
something owners do routinely, for example when registering the
wallet's own agent — the agent key can use that contract to move money
without the limit counting it at all. In our test, an agent key moved
30,000 tokens against a 1,000-per-day limit, and the limit still read
zero. The money is recoverable by the attacker, not locked. Nothing is
at risk today — every wallet currently holds zero funds — but this must
be fixed before any wallet is funded or given a spending cap while such
contracts are allowed.

We also found two medium issues (the wallet factory lets anyone create
a wallet for someone else, which matters only if the product ever
pre-funds wallets before they exist; and the paymaster that pays gas
for agents can be pushed about 17% over its daily cap inside a single
batch of transactions), five small issues, and three notes. The full
list, with fixes, is below. After the fixes, Warden re-checks the code
and issues a final report.

## Executive summary

### What was reviewed

The four agent-wallet v2 contracts (1,575 lines) deployed November 21,
2026 on Robinhood Chain: `PolypadSessionKeyModuleV2` (session keys —
daily caps, allowlist, expiry, freeze, owner rotation), `PolypadAgent4337Module`
(ERC-4337 account abstraction — agent-key UserOp validation and
execution), `PolypadPaymaster` (gas sponsorship with per-wallet and
global daily caps), and `PolypadWalletFactoryV2` (permissionless wallet
creation with policy setup and ERC-8004 registration). All four are
Sourcify exact_match. Design decisions taken as given (Jon, Nov 21):
Safe v1.3.0; daily cap $1–$5,000 user-picked; 2-day backup-key recovery
wait; big moves can just move — the daily cap is the only bound.

### Verdict

**No Critical findings. One High, two Medium, five Low, three
Informational — 11 findings total.** The core design is sound: admin
gating, cap accounting on the inspected paths, 4337 agent binding,
and factory setup all held up under manual review, static analysis,
and 120 passing tests (48 new). The High finding (H-01, the
pull-pattern cap bypass) is conditional on an owner-granted allowance
to an allowlisted pull-pattern contract, which is the realistic
production case — it is the one finding that must be fixed before any
wallet is funded with POLYDASH or granted a POLYDASH cap while
pull-targets are allowlisted. The Mediums are conditional in the same
way (M-01 needs a counterfactual pre-funding flow; M-02 needs a
funded, active paymaster). Live exposure today is zero: all five agent
wallets hold 0, the paymaster is inactive and unfunded, and Jon's v2
wallet has no POLYDASH cap and no allowance to the registry.

### Findings overview

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 1 | H-01 |
| Medium | 2 | M-01, M-02 |
| Low | 5 | L-01 – L-05 |
| Informational | 3 | I-01 – I-03 |
| **Total** | **11** | |

All findings are status **Open** (Phase 1 initial report). Fix
verification (Phase 2) follows after the code owner addresses them.

## Scope and engagement record

### Files and paths in scope

| Contract | File | Lines | Deployed address (Robinhood Chain 4663) |
|---|---|---|---|
| PolypadSessionKeyModuleV2 | `src/agent-wallet/PolypadSessionKeyModuleV2.sol` | 487 | 0xA8eEa6e2EB81ae31d95566dC28F7e4BC1bb7Aec9 |
| PolypadAgent4337Module | `src/agent-wallet/PolypadAgent4337Module.sol` | 565 | 0x987bBCBcD83b023361DB96967D74A32672FfdaF7 |
| PolypadPaymaster | `src/agent-wallet/PolypadPaymaster.sol` | 156 | 0xaD8ac233C8307D18dc2136ACF16502a0b856911F |
| PolypadWalletFactoryV2 | `src/agent-wallet/PolypadWalletFactoryV2.sol` | 367 | 0x1e32825c6Dc7C14b72ae2bbC6e6a4Fe4De50e6Ae |

Total in scope: 1,575 lines. The v1 module
(`PolypadSessionKeyModule.sol`) and v1 factory were read only as a
diff reference. Out of scope: staking, NFT, and token-launch
contracts; fund contracts; the credit-score contracts; the site and
API. Live-state verification was done with read-only `cast` calls
against the public RPCs (official and dRPC) on November 22, 2026.

## Methodology

Warden ran the same four-part methodology the top firms use, and this
section records what was actually run.

1. **Manual line-by-line review.** The lead auditor read all 1,575
   in-scope lines plus the v1 diff reference, working through access
   control, cap enforcement, allowlist enforcement, expiry/freeze,
   4337 signature validation and key binding, paymaster accounting,
   factory setup, owner rotation, reentrancy, and griefing/DoS.
   Deployed state was verified on-chain where it matters to a
   finding (paymaster active/balance/caps, factory configuration,
   Jon's wallet modules/agent key/cap/expiry/allowlist spot-checks).
2. **Static analysis.** Slither 0.11.6 (solc 0.8.30) run fresh on all
   four in-scope files, November 22, 2026 — 34 detector hits total
   (Paymaster 2, ModuleV2 5, 4337Module 6, FactoryV2 21). Every hit
   was triaged: **zero material findings.** The hits are
   reentrancy-events ordering notes on owner-only functions calling
   the trusted EntryPoint or a freshly deployed Safe proxy
   (event-after-call only, no state change after the call);
   timestamp-detector hits on intentional expiry/timelock/active-hours
   comparisons; a weak-PRNG flag on the active-hours clock
   (`block.timestamp` is the clock, not randomness); an unused-return
   on the `missingAccountFunds` prefund call that is intentional and
   documented in the code ("the entry point is responsible for
   verifying the prefund… matches the reference base account
   implementation"); and OpenZeppelin `Math.mulDiv` false positives
   in a dependency. No high- or medium-severity detector findings.
3. **Dynamic / fuzz + invariant testing.** The fuzz specialist wrote
   48 new tests in 5 new files under `test/agent-wallet/`
   (1,928 lines, uncommitted; no `src/` file touched, no existing
   test edited): `AuditV2Invariants.t.sol` (26 tests, incl. invariant
   handler fuzz 256 runs / ~128,000 calls, admin-attempt fuzz 1,000
   runs, split-spend fuzz 1,000 runs, factory final-state fuzz 25
   runs), `AuditV2Agent4337.t.sol` (11), `AuditV2PaymasterBundle.t.sol`
   (5), `AuditV2PaymasterBundleFork.t.sol` (1, live EntryPoint v0.7
   fork), `AuditV2PullPattern.t.sol` (5, real `AgentRegistry`
   artifact). All 48 pass. Baseline: the existing agent-wallet suite
   passes (64 non-fork + 8 fork tests); combined non-fork run 111
   passed, 0 failed. Grand total across all runs: 120 tests, all
   passing. Exploit attempts ran on a local Anvil/dRPC fork with
   cheatcode funding only — never on mainnet, never with real funds.
   Methodology note: the repo's `@account-abstraction` lib is v0.9.0
   (EntryPoint v0.8 semantics) while the live EntryPoint is v0.7;
   the v0.8 `handleOps` has an EOA-bundler guard, so local 4337 /
   paymaster tests simulate the bundler with `vm.prank(bundler,
   bundler)`; the live v0.7 has no such guard. The paymaster bundle
   race (M-02) was confirmed on both the local v0.8 simulation and
   the live v0.7 fork.
4. **Centralization / privilege analysis.** Owner powers, single-key
   risks, and who-can-call-what were analyzed as their own section
   (see Centralization risks). The deployer EOA's powers over the
   paymaster and the wider platform were verified live.

## Findings

### High

#### H-01 — Pull-pattern cap bypass: the daily cap bounds approvals, not token movement

**Severity: High — Status: Open**

##### Description

Location: `PolypadSessionKeyModuleV2.sol` — `_execute` L369–462
(selector inspection ~L410–455), `_charge` L480–488. Same code in v1;
v2 did not close it.

`_execute` charges the daily cap only for (a) ETH `value`, (b) ERC20
`transfer` / `transferFrom` / `approve` calldata decoded from the
top-level call. Any other call to an allowlisted target passes the
value check only. A target that pulls tokens via `transferFrom` moves
funds the module never charges. The `approve` handling charges the
approval once, but the pull itself is free, so the cap is enforced on
*granting* allowance, never on *spending* it. Three concrete escapes:

1. **Pre-existing allowance.** Any allowance the owner granted
   directly (owner Safe tx, bypassing the module) lets an allowlisted
   pull-target move up to `min(allowance, balance)` per call,
   unlimited calls per day, zero cap charge.
2. **Cross-day leftover allowance.** Day 1: agent approves C (charged
   C, cap hit), pulls 0. Day 2: agent pulls C free (fresh cap
   untouched) *and* approves a new C and pulls it — up to ~2× the
   daily cap moved in a day, sustained, with no violation.
3. **Uninspected selectors.** `increaseAllowance` (0x39509351) is not
   checked — if the token contract is allowlisted (USDG *is*
   allowlisted on the test wallet), the agent can raise a spender's
   allowance with no charge and then pull via the allowlisted spender.
   ERC721 `safeTransferFrom` (0xb88d4fde) and ERC1155 `safeTransferFrom`
   (0x2eb2c2d6) are not checked (ERC721 `transferFrom` shares selector
   0x23b872dd so it is charged, but with `tokenId` misread as `amount`
   — blocking only when cap = 0). Multicall-wrapped pulls on an
   allowlisted router likewise escape inspection.

The Registry instance: `AgentRegistry.registerAgent` pulls
`REGISTRATION_STAKE = 1,000 ether` POLYDASH per call
(`src/agent/AgentRegistry.sol:22,94`) via
`safeTransferFrom(msg.sender, …)`, attributing the bond to the
wallet named in the call. Sentinel's Nov 22 report (M3) said this was
"not live today because all 5 wallets hold 0 and the staking pool is
not allowlisted." The balance part is right; the allowlist part is
wrong for the Registry: **the Registry IS already allowlisted on
Jon's wallet (verified live, `allowedTargets = true`)**. The remaining
gates today are POLYDASH balance 0, POLYDASH cap 0 (so any
`approve(Registry, 1000 POLYDASH)` reverts `CapExceeded`), and
allowance to Registry 0. A compromised agent key cannot exploit it
today — three independent blocks. But it becomes exploitable with *no
code change* the moment the owner sets a POLYDASH cap and funds
POLYDASH. The agent can also today call `updateAgent` on the Registry
for id 26299 (rename / repoint `agentAccount`) and `unregisterAgent`
(bond returns to the Safe, no loss) — integrity-only, no fund impact.

##### Proof of concept

`test/agent-wallet/AuditV2PullPattern.t.sol` (local fork, mock
POLYDASH, real `AgentRegistry` artifact):

- `testRepro_PreExistingAllowance_FullDrainZeroCapCharged` — wallet
  funded with 100,000 POLYDASH, POLYDASH cap 1,000/day, owner had once
  approved `AgentRegistry` with `type(uint256).max` via a direct Safe
  tx. Agent key called `registerAgent` 30× with fresh wallet
  addresses: **30,000 POLYDASH drained vs a 1,000 cap (30×),
  `spentDaily` stayed 0 the whole time**. Each attacker wallet then
  called `unregisterAgent` directly and recovered its 1,000 bond —
  **30,000 fully recovered, registry left at 0**. Real theft, not
  funds locked in the registry.
- `testRepro_NoPolydashCap_StillDrainsWithPreExistingAllowance` —
  sharpest form: wallet with **no POLYDASH cap at all** (cap 0 = "not
  allowed"). The agent's own `approve` correctly reverts
  `CapExceeded`, but the pull needs no agent approval: **10,000
  POLYDASH drained, 0 charged**.
- `testRepro_GenericPullVault_DrainsWithPreExistingAllowance` — same
  hole in a generic `deposit()` vault (DEX-router / lending-pool
  shape): **50,000 POLYDASH in 10 calls, 0 charged**. The vulnerable
  primitive is "allowlisted contract + pre-existing allowance", not
  `AgentRegistry` specifically.
- Control (`testControl_NoPreExistingAllowance_DrainBoundedByCap`):
  with **no** pre-existing allowance the drain IS bounded — the agent
  must `approve` first, which is charged (approve 1,000 → spent
  1,000; second registration reverts `ModuleCallFailed` on exhausted
  allowance; further approve reverts `CapExceeded`). So the bypass is
  conditional on an owner-granted allowance — which is the realistic
  case (owner approves the registry/router once, commonly max, e.g.
  when registering the wallet's own agent). An agent-granted approval
  is charged on the grant day but the allowance persists indefinitely,
  so charge and pull can be days apart.

(SpendVault could not be tested — no `SpendVault` contract exists
anywhere in the repo.)

##### Impact

Direct loss of funds up to the wallet's token balance in a day, with
the daily cap untouched. For the Registry instance, max drain is the
POLYDASH daily cap C per day once a cap is set (each 1,000-POLYDASH
registration needs a fresh 1,000 approve charged against C;
⌊C/1e21⌋ registrations/day; e.g. C = 5,000 POLYDASH → 5,000
POLYDASH/day to attacker wallets) — and with a pre-existing
owner-granted allowance, the drain is the full allowance/balance with
no cap at all. The bond is attributed to the attacker's wallet, not
recoverable by the Safe.

##### Likelihood

Medium. Requires a compromised or malicious agent key (the threat
model the product exists to bound) plus a funded wallet with an
allowlisted pull-target and an owner-granted allowance — all normal
production states. The Registry is already allowlisted on Jon's
wallet today, so only funding + a POLYDASH cap + an approval stand
between the current state and exploitability.

##### Recommendation

(a) **Structural (preferred): balance-delta accounting in `_execute`** —
for a configured set of tracked tokens, record the Safe's balance
before/after the call and charge any decrease against the daily cap;
that covers every pull shape, including ones not yet imagined.
(b) Default-deny unknown selectors per allowlisted target — maintain
a per-target selector allowlist; any call whose selector is not
recognised for that target reverts. (c) Explicitly handle
`increaseAllowance` / `decreaseAllowance` like `approve` (charge +
spender-allowlist check) and ERC721/1155 `safeTransferFrom` (charge
the amount against the token's cap, or revert). (d) Operational:
before enabling an agent key, the owner/frontend must revoke
pre-existing allowances to allowlisted pull-targets; do not allowlist
a pull-target (Registry, staking pool, router) unless the token it
pulls has a cap set *and* the owner understands the cap bounds
approvals, not pulls. At minimum, document this in the module NatSpec
and the wizard UI.

##### Status

**Open.** Grading note: the lead auditor initially graded this Medium
(latent; blocked today by zero balance/cap/allowance). The fork proof
of concept above — 30× cap drained and fully recovered by attacker
wallets, including a drain with no cap set at all — upgrades it to
High.

### Medium

#### M-01 — Factory is permissionless: front-run counterfactual funding with a malicious policy

**Severity: Medium (conditional) — Status: Open**

##### Description

Location: `PolypadWalletFactoryV2.sol` — `createWallet` L182–211,
`_setupInitializer` L~280, `predictWalletAddress` L247–266.

`createWallet` / `createWalletCustom` are callable by anyone for any
`owner`, with attacker-chosen `backupKey`, `agentKey`, `dailyCap`, and
`allowedTargets`. The wallet address depends only on `(owner,
saltNonce)` via CREATE2 (`predictWalletAddress` exists precisely to
expose it in advance). The factory sets policy — agent key, backup
key, allowlist — at creation, so whoever creates first dictates the
policy.

##### Proof of concept

No on-chain proof of concept (this is a mempool race, not fuzzable):
the attack is reasoned from the code and the CREATE2 formula.

##### Impact

If the victim pre-funds the predicted address before the creation tx
confirms (the counterfactual flow `predictWalletAddress` enables),
an attacker monitoring the mempool can front-run with identical
`(owner, saltNonce)` but attacker `agentKey` / `backupKey`, max
$5,000 cap, attacker allowlist. The victim's tx reverts (CREATE2
collision — proxy already exists). The attacker's agent key drains up
to $5,000/day of the pre-funded USDG, and the attacker's backup key
can complete a full ownership takeover after the 2-day timelock unless
the owner notices and cancels via Safe tx.

##### Likelihood

Low unless the product offers counterfactual pre-funding. If the
product never pre-funds predicted addresses, this is not reachable and
drops to Low (griefing only: an attacker can squat a salt; the victim
retries with another salt). Whether the frontend pre-funds could not
be confirmed from the repo; the existence of `predictWalletAddress`
makes the flow plausible enough to grade Medium-conditional.

##### Recommendation

Require `msg.sender == owner` in `createWallet` / `createWalletCustom`,
or require an EIP-712 owner signature over the full policy, or a
commit-reveal on the salt. Any of these kills the front-run while
keeping the one-tx UX.

##### Status

**Open.**

#### M-02 — Paymaster per-wallet and global daily caps breached by multiple UserOps in one bundle

**Severity: Medium — Status: Open**

##### Description

Location: `PolypadPaymaster.sol` — `validatePaymasterUserOp` L129–144,
`postOp` L146–155; caps L~60–66.

Caps are checked against `maxCost` at validation time on read-only
state, but `spentDaily` / `spentGlobalDaily` are only incremented in
`postOp`. EntryPoint v0.7/v0.8 validates **all** ops in a bundle first
(`_iterateValidationPhase`), then executes them one by one with
`postOp` in between. `validatePaymasterUserOp` is read-only (no
reservation), so every op in a bundle is validated against the **same
stale** `spent` value; `postOp` then charges each op's actual cost.
Within one bundle this is sequential per op, but UserOps validated
concurrently across bundles/bundlers — or multiple ops in flight in
the mempool — all read the same stale `spentDaily` and all pass. A
day-boundary straddle (validate day N, postOp day N+1) is a second,
negligible instance of the same mismatch. This is a known, standard
paymaster limitation (validation must stay read-only for bundler
simulation).

##### Proof of concept

`test/agent-wallet/AuditV2PaymasterBundle.t.sol` (local, EntryPoint
v0.8 simulation) and `AuditV2PaymasterBundleFork.t.sol` (live
EntryPoint v0.7 fork):

- `testRepro_PerWalletCapBreachedInOneBundle` (local): probe measured
  ~0.000181 ETH actual/op in-bundle; 4 sponsored agent ops from one
  wallet in one bundle, each `maxCost` 0.00045 (< cap, so every
  validation passed, `handleOps` did not revert) →
  **`spentDaily` = 0.000583011 ETH > 0.0005 cap (16.6% over)**; all 4
  token transfers executed.
- `testRepro_GlobalCapBreachedInOneBundle` (local): 11 different
  wallets × 1 op in one bundle, each wallet under its per-wallet cap
  → **`spentGlobalDaily` = 0.002148484 ETH > 0.002 cap (7.4% over)**.
- `testRepro_PerWalletCapBreachedInOneBundle_Fork` (live v0.7): 4 ops
  → **0.000522986 ETH > 0.0005 cap**. Same race on the live
  EntryPoint.
- Controls hold: a single sponsored op stays under cap; two ops in
  **separate** bundles enforce the cap (the second bundle's validation
  sees the first's `postOp` charge and the whole bundle reverts) — the
  hole is strictly intra-bundle.

##### Impact

Total sponsored spend can exceed the per-wallet and global caps by a
multiple of the number of concurrently-validated ops. Realistic
overspend is a small multiple of the 0.0005 / 0.002 ETH caps
(~0.0001–0.0005 ETH per bundle), bounded by the EntryPoint deposit
balance — not a drain of the wallet. No live exposure today: the
paymaster is `active = false`, balance 0, EntryPoint deposit 0.

##### Likelihood

Medium once the paymaster is funded and active; the overspend needs
only several UserOps in one bundle, which a bundler does routinely.
Low today (unfunded, inactive).

##### Recommendation

Reserve in validation and settle in `postOp`: `validatePaymasterUserOp`
writes `spent += maxCost` (reservation), `postOp` replaces the
reservation with the actual cost (`spent -= (maxCost -
actualGasCost)`). On-chain sequential validation within a bundle then
sees prior reservations; a would-be-breaching op fails validation
(fail-closed, whole bundle reverts). Caveat: this changes the
read-only-simulation assumption — bundlers simulate ops individually,
so an op that passes simulation may fail on-chain validation if
bundled with others; that is the correct fail-closed direction, but
confirm bundler behavior before shipping. Cheaper mitigations (not
fixes): keep caps/deposit small and alert on `spentDaily` approaching
cap with the owner kill-switch ready.

##### Status

**Open.** Grading note: the lead auditor initially graded this Low
("bounded by the deposit, standard paymaster limitation"). The fork
proof of concept — caps breached on the live v0.7 EntryPoint, 16.6%
over per-wallet in one bundle — upgrades it to Medium.

### Low

#### L-01 — Owner rotation: pending record sticks after a failed completion, bricking recovery if the owner key is lost

**Severity: Low — Status: Open**

##### Description

Location: `PolypadSessionKeyModuleV2.sol` — `completeOwnerRotation`
L322–336.

Sentinel's Nov 22 report (L4) stated that `completeOwnerRotation`
deletes the pending rotation *before* the Safe call, so a reverted
swap loses the rotation and forces a new 2-day wait. **That mechanism
is refuted:** `execTransactionFromModule` returns a bool rather than
propagating the inner revert, and the module reverts on `!success` —
which rolls back the whole transaction, including the earlier
`delete`. The pending rotation survives a failed completion, and the
backup key can retry after fixing the owners, with no new 2-day wait.

The fuzz specialist found the real defect in the same function: the
surviving record then **sticks**. If the owner rotated directly
out-of-band after the backup initiated (so the pending
`swapOwner(old, new)` can never succeed), `completeOwnerRotation`
reverts `ModuleCallFailed` after the 2-day wait — and the pending
record survives. The backup's re-initiate reverts
`RotationAlreadyPending`, and only the Safe (owner) can
`cancelOwnerRotation`. If the owner key is lost — the exact situation
recovery exists for — recovery is bricked with no backup-key path out.

##### Proof of concept

`testRotationL4_PendingSurvivesFailedCompleteAndSticks`
(`test/agent-wallet/AuditV2Invariants.t.sol`): backup initiates
rotation to `newOwner`; owner then rotates directly to someone else,
so pending `swapOwner(old, new)` can never succeed. After the 2-day
wait, `completeOwnerRotation` reverts `ModuleCallFailed` — pending
record survives (the good half of L4) — but backup re-initiate reverts
`RotationAlreadyPending` and only the owner can cancel.

##### Impact

Availability of the recovery path in the exact scenario it exists for
(lost owner key + out-of-band owner change). No funds at risk.

##### Likelihood

Low: requires the owner to rotate directly after a backup-initiated
rotation is pending, *and* the owner key to then be lost.

##### Recommendation

Let the backup key cancel (or overwrite by re-initiating) a pending
rotation once `executeAfter` has passed — e.g.
`initiateOwnerRotation` overwrites a stale pending whose timelock
expired, or a `cancelOwnerRotationByBackup` callable by the backup
after `executeAfter`. As hygiene, also move the `delete` after the
successful call (checks-effects-interactions ordering).

##### Status

**Open.**

#### L-02 — `setKeyPolicy` silently creates a second live key; the direct path ignores `agentKeyOf`

**Severity: Low — Status: Open**

##### Description

Location: `PolypadSessionKeyModuleV2.sol` — `setKeyPolicy` L189–210,
`execute` L340–348, `agentKeyOf` mapping.

`setKeyPolicy` writes `policies[safe][key]` and overwrites
`agentKeyOf[safe]` but never deletes the previous key's policy. The
module claims "single key per wallet in v2," but the 4337 path (which
checks `agentKeyOf`, `PolypadAgent4337Module.sol:496`) and the direct
path (which checks only `policies[safe][msg.sender].exists`) disagree:
after an owner "replaces" a key via `setKeyPolicy`, the old key keeps
full direct-path authority indefinitely (until expiry / freeze /
`revokeKey`), and each key gets its own full daily cap — 2× cap/day
with two keys.

##### Proof of concept

Reasoned from the code (no fork test; the path is an owner mistake,
not an attacker primitive).

##### Impact

If triggered, full policy authority for the "rotated-out" key via
direct `execute`, and a doubled daily cap.

##### Likelihood

Low: requires the owner to use `setKeyPolicy` with a new key instead
of `rotateKey` (L246, which correctly deletes the old policy) — e.g.
rotating *because* the old key leaked. No attacker-only path: admin
functions are `onlySafe`.

##### Recommendation

In `setKeyPolicy`, if `agentKeyOf[safe]` is set and differs from
`key`, delete the old key's policy (and its `policyTokens` /
`tokenCaps`, or document retention); or revert when
`agentKeyOf[safe] != address(0) && agentKeyOf[safe] != key`, forcing
key changes through `rotateKey`.

##### Status

**Open.**

#### L-03 — Setter cross-checks present at creation are missing from the setters

**Severity: Low — Status: Open**

##### Description

Location: `PolypadSessionKeyModuleV2.sol` — `setBackupKey` L273–278,
`setKeyPolicy` L189–210, `revokeKey` L237–241; factory
`_validateInputs` (FactoryV2 L~260) enforces `KeysMustDiffer` only at
creation.

(a) `setBackupKey` accepts `backupKey == agentKeyOf[safe]` — the
factory forbids this at creation, but the setter doesn't, so the agent
key can later be made the backup key and initiate an owner rotation
(2-day wait; owner can cancel while alive — but if the owner key is
also lost, the agent key alone takes over). (b) `setKeyPolicy` accepts
`key == backupKey[safe]`, conflating the recovery role with spending
power. (c) `revokeKey` deletes the policy but leaves `tokenCaps` /
`policyTokens` in place — re-adding the same key later via
`setKeyPolicy` silently restores its old caps. (d) `rotateKey` (L246)
to a key that previously had caps set without a policy duplicates
`policyTokens` entries (harmless duplicate bookkeeping, wrong
`getPolicyTokens` output).

##### Proof of concept

`testRepro_SetBackupKeyToAgentKeyLetsAgentInitiateRotation`
(`test/agent-wallet/AuditV2Invariants.t.sol`): owner calls
`setBackupKey(safe, agentKey)` — succeeds; the agent key can then call
`initiateOwnerRotation` itself. Related:
`testFactoryAllowsOwnerEqualsBackupKey` — the factory also does not
forbid `owner == backupKey` (harmless, the owner can already rotate,
but it defeats the purpose of a recovery key).

##### Impact

(a) is the sharpest: an agent key that is also the backup key can
initiate owner rotation; impact is limited to a rotation the owner
must notice and cancel (2-day window). (b)–(d) are hygiene / stale-state
issues.

##### Likelihood

Low: (a) requires the owner to set the agent key as backup (or an
attacker who already holds the agent key to benefit from an owner
mistake).

##### Recommendation

Mirror the factory's `KeysMustDiffer` checks in `setBackupKey`
(reject `== agentKeyOf[safe]`) and `setKeyPolicy` (reject `==
backupKey[safe]`); clear caps on `revokeKey` or document that caps
persist; dedupe in `rotateKey`. Consider rejecting `owner ==
backupKey` at creation or documenting it.

##### Status

**Open.**

#### L-04 — Global daily paymaster cap is exhaustible by a cheap Sybil grief (sponsorship DoS)

**Severity: Low — Status: Open**

##### Description

Location: `PolypadPaymaster.sol` — caps L~60–66,
`validatePaymasterUserOp` L129–144; factory permissionless creation
(see M-01).

Global cap is 0.002 ETH/day shared by all wallets; per-wallet cap is
0.0005 ETH/day. Wallet creation is permissionless and costs cents on
4663. An attacker creates 4 wallets, each sponsors 0.0005 ETH/day of
attacker UserOps (gas paid by the paymaster, ~free to the attacker),
exhausting the global cap and denying sponsorship to every legitimate
wallet for the rest of the day.

##### Proof of concept

Reasoned from the caps and the permissionless factory (no fork test;
the arithmetic is 4 × 0.0005 = 0.002 = global cap).

##### Impact

Availability of *sponsorship*, not of the wallets: self-funded
fallback (omit the paymaster) still works.

##### Likelihood

Medium that the grief is attempted once the paymaster is funded (it is
cheap); impact is Low.

##### Recommendation

Per-wallet caps already limit each Sybil; raise the global cap
relative to per-wallet, require wallets to be "warmed" (e.g. funded,
or past a minimum age) before sponsorship, or accept as a known DoS
with monitoring/alerting on `SponsorshipUsed`.

##### Status

**Open.**

#### L-05 — Owner rotation does not revoke the agent key

**Severity: Low — Status: Open**

##### Description

Location: `PolypadSessionKeyModuleV2.sol` — `completeOwnerRotation`
L322–336 (no policy/key changes).

The recovery scenario is a lost/stolen owner key. After the backup key
completes rotation, the old agent key's policy, caps, and allowlist are
untouched — if the attacker also holds the agent key, they retain up
to $5,000/day spend under the new owner. The new owner must remember
to `revokeKey` / `rotateKey` separately; nothing in the flow prompts it.

##### Proof of concept

Reasoned from the code (no fork test).

##### Impact

Up to the daily cap per day under the new owner, if the attacker holds
the agent key as well as the (compromised) owner key.

##### Likelihood

Low: requires the attacker to hold the agent key *and* the owner key
to have been compromised.

##### Recommendation

Revoke (or at least freeze) the agent key in `completeOwnerRotation`,
or document the post-recovery checklist in the frontend.

##### Status

**Open.**

### Informational

#### I-01 — `_agentKeyFor` assembly reads past the array end; no reachable exploit

**Severity: Informational — Status: Open**

##### Description

Location: `PolypadAgent4337Module.sol` — `_agentKeyFor` L443–488
(assembly ~L470–480: `innerSelector := mload(add(data, 32))`, `safe
:= mload(add(data, 36))`, `key := mload(add(data, 68))` after only
`if (data.length < 4) return (0, false)`).

For inner `data` of 4–67 bytes, the `mload`s at offsets 36 and 68 read
past the end of the `bytes memory` array (out-of-bounds read; in
practice reads zero/free memory, does not revert). Sentinel's claim of
"no reachable exploit" is verified, rigorously: returning
`isAgentOp = true` additionally requires `innerSelector ==
executeVia4337.selector` *and* `safe == userOp.sender`, and then
`_validateAgentSignature` (L490–502) requires `signatures.length ==
65`, `agentKey == agentKeyOf(sender)`, `isKeyActive(...)`, and
`ECDSA.recover(keccak256(operationData), signatures) == agentKey` —
where `operationData` commits to the *entire* `userOp.callData`,
including any malformed inner bytes. An attacker without the agent key
cannot forge that signature over malformed calldata (the signature is
bound to the exact bytes); an attacker *with* the agent key gains
nothing from malformed calldata versus a well-formed op. Worst case
for malformed input is `isAgentOp = false` → owner path →
`checkSignatures` fails (agent key is not an owner) →
`SIG_VALIDATION_FAILED`. No fund movement, no privilege gain, no
revert-based grief beyond a dropped op.

##### Proof of concept

`testL5_MalformedInnerCalldataSweep`
(`test/agent-wallet/AuditV2Agent4337.t.sol`, observed `validateUserOp`
verdicts via the Safe fallback path): inner lengths 4, 20, 36, 67 →
`validationData = 1` (rejected — out-of-bounds reads return zeros, so
the garbage `safe` never equals the sender); **68 bytes validates**
(`validationData = 0`, safe+key readable) but
`testL5_68ByteInnerCalldataExecutesNothing` proves execution reverts
(missing args) with **zero** tokens moved and zero spent; 100/195
also validate-then-revert; 196 (well-formed) validates and executes.
Current safety relies on unwritten memory being zero — true in
practice, but unchecked out-of-bounds memory access.

##### Impact

None reachable. Defense-in-depth note only.

##### Recommendation

Add `if (data.length < 68) return (address(0), false);` (or `< 100`
for the full `executeVia4337` head) before the assembly block.

##### Status

**Open.**

#### I-02 — Validation reverts instead of returning `SIG_VALIDATION_FAILED`

**Severity: Informational — Status: Open**

##### Description

Location: `PolypadAgent4337Module.sol` — `validateUserOp` L227
(`bytes4(userOp.callData)` L243 reverts if `callData < 4` bytes),
`_getSafeOp` L~515 (`sig[0:6]` / `sig[6:12]` revert if `signature <
12` bytes), `_validateAgentSignature` L490–502 (`ECDSA.recover` L500
reverts on malleable-`s` signatures in OZ v5).

ERC-4337 specifies validation *should* return
`SIG_VALIDATION_FAILED`, not revert. A bundler can malleate a valid
agent signature (`(r,s,v) → (r,n−s,v^1)` recovers the same signer)
and the malleated op makes `validateUserOp` revert rather than fail
cleanly; short `callData` / signature inputs revert the same way.

##### Impact

Griefing only — the op is dropped, the agent retries; no fund
movement, no state change, and the bundler pays the gas.

##### Recommendation

Use `ECDSA.tryRecover` (return `false` on failure) and length-guard
the `callData` / signature slices before indexing.

##### Status

**Open.**

#### I-03 — Allowlist hygiene: sensitive targets are not blocked, and the USDG cap is unreachable on Jon's wallet

**Severity: Informational — Status: Open**

##### Description

Location: `PolypadSessionKeyModuleV2.sol` — `_execute` L369–462 (only
`to == address(this)` / `to == safe` are forbidden); live allowlist
reads below.

The module does not forbid the Safe singleton (`0xd9Db…`), the
EntryPoint, the paymaster, the factory, or the 4337 module as targets
— an owner who allowlists one of them hands the agent surprising
powers (e.g. EntryPoint `depositTo` moves Safe ETH, value-bounded by
the ETH cap — currently 0 on Jon's wallet; direct singleton calls
operate on singleton storage and revert for lack of singleton owners,
so no wallet-fund risk, but it is unexamined surface). Separately, an
operational observation: Jon's wallet has a $5,000/day USDG cap but
USDG itself is **not** allowlisted, so the agent cannot do a plain
USDG `transfer` — the cap is only reachable through whatever
pull-targets are allowlisted (Registry/AgentScore move no USDG).
Either the allowlist is intentionally narrow (fine) or the cap is dead
config (worth confirming in the frontend, which should display the
effective allowlist — it cannot be enumerated on-chain).

##### Impact

None live. Unexamined surface + a possibly-dead cap config.

##### Recommendation

Consider a blocklist of sensitive targets (singleton, EntryPoint,
paymaster, factory, 4337 module) in the module or the wizard, and
confirm in the frontend whether the USDG cap is intentionally
unreachable. The frontend should record the full allowlist off-chain
per wallet — the mapping has no enumerating getter.

##### Status

**Open.**

## Centralization risks

These are not findings with a single fix; they are the privilege
structure of the system, stated plainly.

- **C-1 — Single-EOA ownership of every core contract (highest
  leverage).** The deployer EOA `0x9a21c75aC263cC43125E70200636f6397f8776d0`
  owns the v2 paymaster (verified live), `AgentRegistry`,
  `AgentScore`, `FundAllowlist`, the V3 fund factory, and the staking
  factory V2. The paymaster owner can drain the EntryPoint deposit,
  `setFactory` to a malicious factory (sponsor arbitrary wallets),
  change caps, and toggle `active`. One key compromise hands an
  attacker allowlist/feed/pause control, score-updater replacement,
  and paymaster control. The modules and the factory have no owner
  (immutables only) — M2 does not apply to them. **Mitigation
  pending: complete the 2-of-3 multisig ownership transfer,
  FundAllowlist first, then AgentScore/registry/factories/paymaster.**
  Still the single highest-leverage security action open on the
  platform.
- **C-2 — Permissionless factory (see M-01).** Anyone can create a
  wallet for any owner with any policy. Harmless unless the product
  pre-funds predicted addresses.
- **C-3 — Owner-key compromise and recovery.** The backup key + 2-day
  timelock is the recovery path, but rotation does not revoke the
  agent key (L-05), and a stuck pending rotation can brick recovery
  if the owner key is lost (L-01).
- **C-4 — Paymaster owner powers.** The paymaster owner controls the
  deposit, the factory pointer, the caps, and the active flag. The
  deposit is the loss bound for M-02 and L-04; keep it small relative
  to the caps.
- **C-5 — Agent-key compromise.** Bounded by the daily cap on
  inspected paths — except H-01, where a pre-existing allowance to an
  allowlisted pull-target voids the cap for that token.
- **Trusted externals.** Safe v1.3.0 singleton
  (`0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552`), canonical EntryPoint
  v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`), and the ERC-8004
  registries (registration is best-effort — a registry failure does
  not revert wallet creation).

## Checked and clear

- **Access control:** all admin functions `onlySafe(safe)`
  (msg.sender == Safe, i.e. owner-signed Safe tx or an enabled module
  acting for the Safe); agent key can never call them (10 admin entry
  points fuzzed as the agent, 1,000 runs, 0 successes; caps /
  allowlist / key / backup / expiry unchanged across the whole handler
  fuzz). `initiateOwnerRotation` restricted to `backupKey`;
  `cancelOwnerRotation` owner-only; `completeOwnerRotation`
  permissionless but timelocked and owner-cancellable.
- **Cap enforcement on inspected paths:** exact-boundary (spent +
  amount > daily reverts; equal-to-cap passes), UTC day rollover by
  new day index, zero cap = deny, `_charge` before the external call,
  `nonReentrant` on `execute` / `executeVia4337` /
  `completeOwnerRotation`; `transferFrom` requires `from == safe`;
  `approve` requires allowlisted spender and charges immediately; ETH
  `value` charged against the ETH cap; combined value+transfer
  charges both. Verified by handler fuzz (256 runs, ~128k calls),
  split-spend fuzz (1,000 runs), and exact-boundary tests.
- **4337 agent binding:** `_agentKeyFor` requires outer
  `executeUserOp[WithErrorString]`, `to == SESSION_KEY_MODULE`,
  `value == 0`, `operation == Call`, inner selector `executeVia4337`,
  inner `safe == sender`; `_validateAgentSignature` requires signer
  == *current* `agentKeyOf` (rotated-out keys fail), key active
  (exists/unexpired/unfrozen/in-window), 65-byte sig; full policy
  re-enforced at execution in `_execute`; owner path is canonical
  Safe4337Module behavior (length check + `checkSignatures`
  try/catch); replay protected by EntryPoint nonce + opHash committing
  to all UserOp fields; `executeUserOp` is EntryPoint-only and
  DelegateCall is unreachable on the agent path (operation == 0
  enforced at validation). Verified by 11 local 4337 tests + the
  existing 8-test fork suite: wrong-key, owner-signed agent-path,
  non-allowlisted-target, and over-cap ops all fail; same-nonce replay
  fails (AA25); replay with a fresh nonce after key rotation fails
  validation; `executeVia4337` reverts `NotSafe` when called directly
  by the agent.
- **Factory:** setup owners `[factory, user]` threshold 1 → config
  steps → `removeOwner` leaves `[user]`/1 (verified live: owners
  `[0x9a21…]`, threshold 1); atomic (a failed config step reverts the
  whole creation including proxy deployment); `approveHash` +
  approved-hash signature is the standard contract-owner flow;
  `createWallet` enforces $1–$5,000 cap-token range and
  `KeysMustDiffer`; ERC-8004 registration is genuinely best-effort
  (`_execOptional` returns false on registry failure rather than
  reverting creation); `predictWalletAddress` matches the CREATE2
  formula; immutables, no admin keys. Verified by factory final-state
  fuzz (25 runs, caps $1–$5,000).
- **Paymaster (outside the bundle race, M-02):** EntryPoint-only
  `validate` / `postOp`; `active` defaults false (verified false
  live); deposit-balance check; no ERC-20 gas path anywhere (native
  ETH only, per Jon's decision); `postOp` charges actual cost even on
  reverted UserOps (correct — gas was consumed); owner
  `withdrawFromEntryPoint` / `depositToEntryPoint` move only the
  paymaster's own deposit. Single-op spend ≤ caps; sequential bundles
  enforce caps; caps reset at the day boundary; inactive / non-wallet /
  insufficient-deposit reverts all hold.
- **Expiry/freeze:** `block.timestamp > expiry` + frozen + active-hours
  re-checked at execution on both direct and 4337 paths
  (validation-time checks are fail-fast only, as documented); freeze
  blocks agent execution but not owner Safe txs. Expired, frozen,
  rotated-out, and revoked keys execute nothing (direct path; via
  4337, frozen-key and rotated-out-key UserOps fail validation).
- **Reentrancy/DoS on the happy path:** short calldata decodes fail
  closed (revert, no bypass); `execute` / `executeVia4337` refuse
  DelegateCall and target == module/Safe.
- **Live state (verified by `cast`, Nov 22):** paymaster `active =
  false`, per-wallet cap 0.0005 ETH, global cap 0.002 ETH, owner =
  deployer EOA, EntryPoint canonical v0.7, balance 0, EntryPoint
  deposit 0. FactoryV2: singleton Safe v1.3.0, capToken USDG
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, module, 4337 module,
  paymaster all match the deployed addresses.
  `isPolypadWallet(0x7610…) = true`. Jon's wallet
  `0x76106bfbE487402a381cA8B7411eF7262d7dE70F`: owners `[0x9a21…776d0]`,
  threshold 1, both modules enabled, `agentKeyOf =
  0x29A06C1CF960c6AF76E42F586817116A2114f3f3`, frozen = false, backup
  key `0x976A793c51C5266382B6A949D8C3F13428bC8Aa5`, policy expiry
  1803089198 (Sat Feb 20 2027 02:06 UTC, 90 days), USDG cap
  5,000,000,000 ($5,000), **POLYDASH cap 0, ETH cap 0**,
  `policyTokens = [USDG]` only, balances 0. Allowlist spot-checks:
  Registry `0x514e…` = true, AgentScore `0x1f7e…` = true, USDG =
  false, POLYDASH = false (the full allowlist is not enumerable
  on-chain — mapping with no getter — so these are spot checks only).
  Test wallet `0x6eC36d…`: Registry = false, USDG = true.
  Registry `agentIdByWallet` = 0 for Jon's wallet; POLYDASH and USDG
  allowance to Registry both 0.

Design note (not a finding): a token transfer's *recipient* is not
allowlisted — only the token contract (the call target) is. The agent
can send capped funds to any address; the daily cap is the control, so
this is consistent with the stated design ("daily cap is the only
bound").

## Sentinel items — final grades

Warden was asked to verify or close the open items from Sentinel's
Nov 22 security report:

- **M3 (pull-pattern gap): CONFIRMED and upgraded — H-01 (High).**
  Mechanism verified in code and against `AgentRegistry.registerAgent`;
  the fork proof of concept quantified the drain (30× cap; full
  recovery by attacker wallets; drain possible with no cap at all
  given a pre-existing allowance). One correction to Sentinel's
  premise: the Registry **is** already allowlisted on Jon's wallet —
  the live blockers are zero POLYDASH balance, zero POLYDASH cap, and
  zero allowance, not the allowlist.
- **L4 (rotation delete-before-call): REFUTED as a live defect, with
  a replacement finding — L-01 (Low).** The `delete` is rolled back
  when the swap fails because the module reverts on `!success`, so no
  rotation is lost and no new 2-day wait is imposed. The real defect
  in the same function is the stuck pending record: a failed
  completion leaves a pending rotation the backup cannot replace and
  only the owner can cancel — bricking recovery if the owner key is
  lost.
- **L5 (assembly out-of-bounds read): CONFIRMED as a defect, no
  reachable exploit — I-01 (Informational).** Proof by signature
  binding over the full UserOp, plus empirical fork tests (malformed
  calldata rejected; 68-byte input validates but execution reverts
  with zero moved).
- **Context (not re-audited):** M2 single-EOA ownership — confirmed
  in scope for the paymaster (owner is the deployer EOA, verified
  live); see C-1. L1 (staking FoT), L2 (FundSwapFacet nonReentrant),
  L3 (AgentScore single-step ownership transfer): no v2 code path
  changes them — nothing in the four contracts touches those flows.

## Final assessment

This is Warden's Phase 1 initial report on the agent-wallet v2
contracts at commit `639529b`. **0 Critical, 1 High, 2 Medium, 5 Low,
3 Informational — 11 findings, all status Open.** No finding is fixed
or acknowledged yet; the code owner (Mason) fixes what Jon approves
and records what is acknowledged instead, and Warden then re-reviews
the fix commit and issues the final report with each finding's status
updated to Fixed / Acknowledged / Mitigated (Phase 2, two-phase flow).

The single gating item is H-01: fix the pull-pattern cap bypass (or
de-allowlist pull-targets / lock the POLYDASH-cap policy) **before**
any wallet is funded with POLYDASH or granted a POLYDASH cap. M-01
should be fixed before any counterfactual pre-funding flow is offered,
and M-02 before the paymaster is funded and activated. Nothing in this
review warrants halting the v2 wallets' continued operation given zero
balances and an inactive, unfunded paymaster.

## Disclaimer

This review is not a guarantee of the contracts' security. It applies
only to the review context documented here — the four contracts at
commit `639529b`, the live state observed on November 22, 2026, and
the stated design decisions — and to the test coverage described in
Methodology. Later changes, including the fix round, require separate
analysis (Phase 2). Warden is Polypad's in-house agent audit team;
this internal review is first-party review of Polypad's own contracts,
not an independent third-party audit.
