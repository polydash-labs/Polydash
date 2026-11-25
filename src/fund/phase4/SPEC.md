# Phase 4 — AI Agent Funds: shared spec

Status: build in progress on branch `phase4-agent-funds`, from `phase2-deploy-weth-only` @ 4999aa6.
Do NOT push, do NOT deploy to mainnet, do NOT publish. Do NOT change Phase 2 contract behavior; reuse it.
WETH-only default. Plain language in all user-facing copy, no unexplained jargon.

## The idea in one paragraph

One fund creation flow asks "Who manages this fund?" Human → the existing 5-step wizard.
AI agent → a new agent wizard. Both create the same fund via `FundFactoryInvest`.
The agent NEVER holds money. An off-chain runner signs trade instructions; an on-chain
`AgentExecutor` (a vault executor via the existing `FundVaultInvest.setExecutor`) verifies
every instruction before the vault swaps. The human creator stays vault manager and can
pause swaps or revoke the executor with one transaction. If the agent key leaks, the worst
case is a valid-but-bad trade inside the caps — it cannot drain the vault, send money to
itself, or change the rules.

## Phase 2 facts the build relies on (verified in the repo)

- `FundVaultInvest.swap(router, assetIn, assetOut, amountIn, minAmountOut, data)` delegatecalls
  `FundSwapFacet.swap`, which enforces: caller is manager or `isExecutor`, status is Investing,
  swaps not paused, asset in mandate, asset + router allowlisted, position/trade/deviation caps.
  Balances stay in the vault.
- `FundVaultInvest.setExecutor(address, bool)` is manager-only, max 8 executors.
  `setSwapsPaused(bool)` is manager-only. `enableInvesting()` is manager-only, requires the
  manager skin minted.
- Public vault getters the executor may use: `manager()`, `status()`, `swapsPaused()`,
  `isExecutor(address)`, `inMandate(address)`, `allowlist()`, `weth()`, `maxPositionBps()`,
  `maxTradeBps()`, `maxDeviationBps()`, `nav()`, `navPerNft()`, `spendableEth()`,
  `mandateAssets(uint256)`, `mandateAssetCount()`.
- `IFundAllowlist`: `assetAllowed`, `routerAllowed`, `quote(asset, amount)` (reverts on a bad
  price — fail-closed), `checkPrice`, `paused()`, `delay()`.
- `FundFactoryInvest.createFund(Params)` where Params = {name, symbol, imageUri, baseURI,
  mintPrice, raiseCap, entryFeeBps, minSkinBps, raiseDuration, mandateHash, assets,
  mandateUri, maxPositionBps, maxTradeBps, maxDeviationBps}. Caps of 0 mean "use the vault
  defaults" (75% position / 75% trade / 50% deviation).
- `forge fmt --check` IGNORES `src/**/*.sol` (see foundry.toml `[fmt] ignore`); it DOES check
  `test/**/*.sol`, so test files must be fmt-clean. `forge build` takes minutes (via_ir).
- Web app: `polypad/web`, `npm test` runs the listed `lib/*.test.ts` files, `npx tsc --noEmit`
  must be clean. `viem` + `wagmi` are already dependencies. Reuse `lib/logo-upload.ts` for
  logo upload. The human wizard is `app/funds/create/_components/create-fund-wizard.tsx` —
  do not break it.

## Contracts — `src/fund/phase4/` (Solidity 0.8.24, NatSpec, custom errors, same style as phase2)

### Shared types (`AgentTypes.sol`)

```solidity
struct StrategyParams {
    uint8 templateId;               // 0 Momentum, 1 DipBuyer, 2 Defensive, 3 Dca, 4 Balanced, 5 Custom
    uint8 riskLevel;                // 0 conservative, 1 balanced, 2 aggressive
    uint16 maxPositionBps;          // 0 = use the vault's cap
    uint16 maxTradeBps;             // 0 = use the vault's cap
    uint16 maxDeviationBps;         // 0 = use the vault's cap
    uint16 dailyTradeLimit;         // max executed instructions per UTC day; 0 = 5
    uint16 circuitBreakerBps;       // NAV-per-NFT drawdown vs high-water that trips the breaker; 0 = 1000 (10%)
    uint32 rebalanceIntervalSeconds;// minimum seconds between executions; 0 = 3600 (1h)
    bytes32 rulesHash;              // keccak of the off-chain rules JSON (the agent's constitution detail)
}

struct Instruction {
    address vault;
    address router;
    address assetIn;
    address assetOut;
    uint256 amountIn;
    uint256 minAmountOut;
    bytes data;
    uint256 deadline;
    uint256 nonce;
}
```

### `AgentExecutor.sol`

- Constructor `(address vault_, address agentKey_, StrategyParams memory params_, address registry_)`.
  Stores vault (immutable), agentKey, params, registry. `paused = false`, `retired = false`,
  `nextNonce = 0`, `highWaterNavPerNft = 0` (0 means "not set yet").
- EIP-712 domain: name `"PolypadAgentExecutor"`, version `"1"`, chainId, verifyingContract =
  address(this). Type: `Instruction(address vault,address router,address assetIn,address assetOut,uint256 amountIn,uint256 minAmountOut,bytes data,uint256 deadline,uint256 nonce)`,
  with `data` hashed as `keccak256(data)`. Verify with OpenZeppelin `ECDSA` + `EIP712`.
- `execute(Instruction calldata ix, bytes calldata signature)` external, nonReentrant.
  Anyone may submit; the signature is the authorization. Checks, in order, each a custom error:
  1. `ix.vault == vault` else `WrongVault`; `ix.deadline >= block.timestamp` else `Expired`;
     `ix.nonce == nextNonce` else `BadNonce`.
  2. Signature recovers `agentKey` else `BadSignature`.
  3. `!paused && !retired` else `AgentPaused`.
  4. Vault state: `vault.status() == Investing` else `NotInvesting`; `!vault.swapsPaused()`
     else `VaultPaused`; `vault.isExecutor(address(this))` else `NotExecutor`.
  5. Asset checks: each of `assetIn`/`assetOut` must be `address(0)` (ETH), `vault.weth()`,
     or `vault.inMandate(...)` else `NotInMandate`. Any non-ETH/WETH asset must be
     `allowlist.assetAllowed(...)` else `NotAllowlisted`. If `router != address(0)` it must be
     `allowlist.routerAllowed(router)` else `BadRouter`. (Router `address(0)` is only valid for
     an ETH<->WETH wrap/unwrap pair; the facet enforces the rest.)
  6. Trade cap: trade value in ETH is `amountIn` if `assetIn` is ETH/WETH, else
     `allowlist.quote(assetIn, amountIn)` (reverts on a bad price — fail-closed). Effective
     trade cap = `params.maxTradeBps == 0 ? vault.maxTradeBps() : min(params.maxTradeBps, vault.maxTradeBps())`.
     Require `tradeValueEth * 10_000 <= tradeCapBps * vault.nav()` else `TradeCap`.
  7. Position cap (pre-check, conservative): post-trade balance estimate for the bought asset
     is `current balance + minAmountOut` (for sells the position only shrinks — skip). Effective
     position cap = `params.maxPositionBps == 0 ? vault.maxPositionBps() : min(params.maxPositionBps, vault.maxPositionBps())`.
     Value the estimate at the feed (`allowlist.quote`) and require it within the cap of
     `vault.nav()` else `PositionCap`. The facet enforces the exact post-swap position cap
     and deviation afterwards; a facet revert rolls the whole `execute` back (fail-closed).
  8. Daily limit: day = `block.timestamp / 1 days`; `tradesToday` for that day must be
     `< dailyLimit` (effective limit = `params.dailyTradeLimit == 0 ? 5 : params.dailyTradeLimit`)
     else `DailyLimitExceeded`.
  9. Circuit breaker: `current = vault.navPerNft()`; if `highWaterNavPerNft > 0` and
     `current < highWaterNavPerNft * (10_000 - breakerBps) / 10_000` (effective breaker =
     `params.circuitBreakerBps == 0 ? 1000 : params.circuitBreakerBps`), then set
     `paused = true`, emit `CircuitBreakerTripped`, revert `CircuitBreakerTripped`.
  10. Rebalance interval: `block.timestamp >= lastExecution + interval` (effective interval =
      `params.rebalanceIntervalSeconds == 0 ? 3600 : params.rebalanceIntervalSeconds`) else `TooSoon`.
  Then: `nextNonce++`, `lastExecution = block.timestamp`, `tradesToday[day]++`,
  `highWaterNavPerNft = max(highWaterNavPerNft, current)`, call
  `vault.swap(ix.router, ix.assetIn, ix.assetOut, ix.amountIn, ix.minAmountOut, ix.data)`,
  emit `InstructionExecuted(vault, assetIn, assetOut, amountIn, minAmountOut, nonce, navPerNftAfter)`.
- `validate(Instruction calldata ix, bytes calldata signature)` external view returns
  `(bool ok, string memory reason)`: runs checks 1–10 without state changes. Reasons are
  kebab-case strings: `"ok"`, `"wrong-vault"`, `"expired"`, `"bad-nonce"`, `"bad-signature"`,
  `"paused"`, `"not-investing"`, `"vault-paused"`, `"not-executor"`, `"not-in-mandate"`,
  `"not-allowlisted"`, `"bad-router"`, `"trade-cap"`, `"position-cap"`, `"daily-limit"`,
  `"circuit-breaker"`, `"too-soon"`. The runner calls this before submitting; the front-end
  uses it to explain rejections.
  DESIGN NOTE (decided): rejected `execute` calls REVERT with a custom error, so there is no
  on-chain `InstructionRejected` event — a revert rolls the log back. Rejections are observable
  via `validate()` and the runner's decision log. Do not invent a non-reverting execute.
- `pause()` — manager or agentKey. `unpause()` — manager only. `retire()` — manager only:
  sets `retired = true`, `paused = true`, emits `AgentRetired` (the manager also calls
  `vault.setExecutor(executor, false)` and `registry.retireAgent` from the front-end).
- `updateAgentKey(address newKey)` — manager only, emits `AgentKeyUpdated`.
- Events: `InstructionExecuted`, `CircuitBreakerTripped`, `AgentPaused`, `AgentUnpaused`,
  `AgentKeyUpdated`, `AgentRetired`. Custom errors for every check above.
- Security: `ReentrancyGuard` on `execute`. Router `data` is opaque calldata — trust comes
  from the router allowlist + amount caps + `minAmountOut`; document this in the NatSpec.

### `AgentRegistry.sol`

- `Agent` struct: `{address fund; address vault; address executor; address creator; address agentKey; string name; string logoURI; string description; uint8 templateId; uint8 runnerMode; bytes32 strategyHash; bytes32 rulesHash; uint64 createdAt; bool active}`.
  `runnerMode`: 0 = self-hosted, 1 = Polypad-hosted.
- `registerAgent(Agent memory a)` — caller must be the vault's manager (`vault.manager() == msg.sender`);
  one agent per fund (`agentOfFund[fund] == 0`); emits `AgentRegistered(agentId, fund, executor, creator)`.
  Returns the new `agentId`.
- `updateAgent(uint256 agentId, string logoURI, string description, bytes32 rulesHash)` — creator only.
- `retireAgent(uint256 agentId)` — creator only; `active = false`; emits `AgentRetired`.
- Views: `getAgent(uint256)`, `agentOfFund(address)`, `agentCount()`, `agentsByCreator(address)`
  (returns ids), `activeAgents(uint256 offset, uint256 limit)` (returns ids, newest first).
- Events: `AgentRegistered`, `AgentUpdated`, `AgentRetired`.
- NatSpec must state: the registry is a DIRECTORY, not a security boundary. Safety lives in
  the executor + vault; the registry only records what the front-end publishes.

### `AgentStrategies.sol` (library)

- `uint8 constant TEMPLATE_COUNT = 6`; template ids 0 Momentum, 1 DipBuyer, 2 Defensive, 3 Dca,
  4 Balanced, 5 Custom. `templateName(uint8)` returns the plain name.
- `defaults(uint8 templateId, uint8 riskLevel)` returns `StrategyParams` with `rulesHash = 0`
  (filled in by the caller). Risk mapping — conservative: maxPosition 3000, maxTrade 2000,
  breaker 500 (5%), daily limit 3; balanced: 5000 / 5000 / 1000 (10%) / 6; aggressive:
  7500 / 7500 / 2000 (20%) / 12. Rebalance defaults (seconds): Momentum 4h, DipBuyer 1h,
  Defensive 24h, Dca 24h, Balanced 12h, Custom 12h. Deviation cap left 0 (use the vault's).

### Tests — `test/fund/phase4/`

- Reuse existing `test/fund/` helpers/mocks where they exist (check before writing new ones).
  Non-fork tests only (no RPC). `forge test` must pass; `forge fmt --check` must be clean.
- Cover: executor happy path; each rejection (not-in-mandate, not-allowlisted, over trade cap,
  bad signature, expired, bad nonce, revoked executor, daily limit exceeded, circuit breaker
  tripped, too-soon, paused); registry register/update/retire + lookups; strategy defaults;
  full lifecycle: create fund via the factory → close raise + manager skin → enable investing →
  authorize executor → agent trades → NAV moves → holder exits.

## Runner — `polypad/agent-runner/` (TypeScript, Node 22, viem)

- `package.json` (deps: `viem`, `dotenv`; dev: `tsx`, `typescript`, `@types/node`), `tsconfig.json`,
  `src/`: `index.ts` (polling loop), `config.ts` (env + on-chain registry reads), `chain.ts`
  (viem clients + ABIs — write the executor/registry/vault ABIs from this spec's exact
  signatures; they will be verified against compiled output at integration), `strategy.ts`
  (rule engine per template + local price-history store as JSON), `llm.ts` (optional reasoning
  hook: if `LLM_API_KEY` is set, POST the decision context to an OpenAI-compatible endpoint
  and use its short plain-language reasoning; otherwise rule-based reasoning text. The LLM
  NEVER sets amounts — caps are enforced on-chain regardless), `signer.ts` (EIP-712 signing
  with viem, same domain/type as the executor), `executor.ts` (`validate()` pre-check, `execute`
  submission, receipt handling, revert decoding), `decisions.ts` (JSONL decision log — every
  decision, executed or rejected, with reasoning and the `validate()` reason), `health.ts`
  (tiny HTTP server: `/health` and `/status`, plus a `heartbeat.json` written every loop).
- Poll every 60s (env `POLL_INTERVAL_SECONDS`): read vault state (`status`, `navPerNft`,
  balances), prices via the allowlist `quote`, evaluate the strategy, decide buy/sell/hold
  with reasoning, sign + submit only when there is an action. Skip cleanly (log `hold`) when
  the fund is not Investing, the executor is paused/revoked, or `validate()` says no.
- Strategy v1 rules (deterministic, documented in README): Momentum — price up >2% over the
  stored window and position under cap → buy; down >2% → sell to WETH. Dip-buyer — price down
  >5% from the recent high → buy a tranche. Defensive — high volatility or NAV drawdown →
  rotate to WETH. DCA — on each rebalance interval, buy a fixed fraction. Balanced — rebalance
  to 50/50 WETH/asset when drift >10%. Custom — evaluate the rules JSON (conditions on price
  change, NAV, time). All amounts sized inside the executor caps; `minAmountOut` from a
  configurable slippage (default 1%).
- `README.md`: hosted vs self-hosted modes, how to run (`npm install`, `.env`, `npm start`),
  heartbeat + decision-log format, security notes (the agent key signs instructions AND pays
  gas; if it leaks, the worst case is a valid-but-bad trade inside the caps — it cannot drain
  the vault, send money to itself, or change the rules; keep the key in secrets, never in chat
  or git). `.env.example` with placeholder values ONLY. No real keys anywhere.
- Tests: `npm test` (node:test + tsx) covering the strategy engine (each template's buy/sell/hold
  decisions) and EIP-712 signing (a signature the executor would accept — verified against the
  contract's domain at integration).

## Front-end — `polypad/web`

- Creation fork: the first question in the create flow is "Who manages this fund?" — Human →
  the existing wizard, untouched and working. AI agent → a new wizard
  `app/funds/create/_components/agent-fund-wizard.tsx`, 5 steps:
  1. Name the agent, upload a logo (reuse `lib/logo-upload.ts`), short description.
  2. Strategy template picker — 6 plain-language cards (Momentum = follows the trend;
     Dip-buyer = buys the dips; Stable-yield/defensive = moves to safety when shaky;
     DCA accumulator = buys a little on a schedule; Balanced rebalancer = keeps the mix;
     Custom = your own plain-language rules) + risk slider (conservative / balanced / aggressive).
  3. Guardrails in plain language — max position, max trade, daily trade limit, circuit
     breaker % (auto-pause on a NAV drop), rebalance frequency, which assets (from the allowlist;
     reuse the existing token-addresses input, empty = WETH only).
  4. Fund setup — the SAME fields as the human flow (share price, goal, deadline, fees).
  5. Review — the mandate is AUTO-WRITTEN from the strategy + guardrails and shown in plain
     language (the agent's constitution: mandate hash + link); deploy button.
  On deploy: create the fund via the factory → deploy the `AgentExecutor` → register the agent
  → `vault.setExecutor(executor, true)` → show the runner setup card (hosted vs self-hosted,
  with the exact env values + commands for self-host). The human creator is the vault manager.
- Pure logic in `lib/fund/agent.ts` (mandate-text generation from strategy + guardrails,
  strategy defaults mapping, guardrail validation) with `lib/fund/agent.test.ts`; add the test
  file to the `npm test` script list. Components stay thin.
- Agent fund page: the fund detail page shows an agent card (logo, name, strategy, live NAV,
  decision feed, pause/revoke controls) when the fund has a registered agent. Decision feed:
  read `Trade` events from the vault blotter + `InstructionExecuted` events; each entry shows
  a plain-language explanation derived from the strategy template and the trade's numbers
  (the rule that fired + the numbers). The LLM's reasoning lives in the runner's decision log,
  not on-chain — do not pretend otherwise. "Ask the agent why" = the rule + numbers per decision.
- Leaderboard: `app/funds/leaderboard/page.tsx` — registered agents ranked by NAV-per-NFT
  change since investing began (baseline = first `NavCheckpoint` after investing starts;
  show "too early" when there is none). Columns: agent (logo + name), strategy, fund, NAV per
  share, change since start, trades, status. Reads via viem.
- Copy-an-agent: "Use this strategy" on the leaderboard + agent card opens the agent wizard
  prefilled with that agent's template + guardrails (clone the STRATEGY, not the fund).
- One-click pause: the manager sees Pause/Resume on the agent card (calls
  `executor.pause()` / `unpause()`); Revoke calls `vault.setExecutor(executor, false)` +
  `registry.retireAgent(agentId)`. Both are one transaction each, confirmed in the UI.
- Investors see a badge on every fund: "Managed by a human" or "Managed by an AI agent"
  (with the agent's live record linked).
- Backtest/paper-trade mode: in the agent wizard, a "Try it on paper first" toggle runs the
  chosen strategy against the runner's stored price history locally (no chain, no money) and
  shows the result + a "Backtested" badge on the agent card. Implement the paper run in
  `lib/fund/agent.ts` (pure function over a price series) so it is unit-testable; the runner
  shares the same rule logic where practical.
- Do NOT break the human flow: existing wizard + tests keep passing. `npm test` must pass,
  `npx tsc --noEmit` clean. Plain language throughout.

## Out of scope (do NOT build here)

- ERC-6551 token-bound accounts, NAV-floor bid, season badges (Phase 4 mentions them; they
  are explicitly out of this build).
- The live Polypad-hosted runner SERVICE itself (servers, secrets management, multi-tenant
  operation). This build ships the runner package + the mode selection + registry field; the
  hosted service is platform ops afterwards. The front-end must not fake a hosted runner as
  running when it is not — show "Hosted runner: waiting for the platform to start it" until
  an operator starts it.
- No mainnet deploy, no push, no publish, no merge.

## Work rules for every workstream

- Work ONLY inside your own files (contracts: `src/fund/phase4/` + `test/fund/phase4/`;
  runner: `polypad/agent-runner/`; front-end: `polypad/web/`). Do NOT touch the other
  workstreams' files. Do NOT touch Phase 2 contracts.
- Do NOT commit, push, switch branches, or deploy. Leave your work uncommitted; the
  coordinator verifies and commits. Do NOT run `git` write commands at all.
- Run your own tests before reporting back, and report the exact results (counts + any failure).
- No secrets, no real keys, no credentials in code, logs, or reports. Test keys only.
