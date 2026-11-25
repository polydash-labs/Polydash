# Polypad Agent Runner

The off-chain service for Phase 4 AI agent funds. It watches the chain, evaluates
a rule-based strategy, and — only when there is an action — signs a trade
instruction that the on-chain `AgentExecutor` verifies before the vault swaps.

The runner **never holds money and never moves money itself**. It only signs
instructions. Every check that matters (caps, allowlist, mandate, daily limit,
circuit breaker, rebalance interval) is enforced on-chain by the executor and
the vault, so a compromised or buggy runner cannot drain a fund.

## Hosted vs self-hosted

Every agent fund has a `runnerMode` in the on-chain registry:

- **Self-hosted (mode 0)** — the fund creator (or anyone they trust) runs this
  package themselves with their own agent key. This repo is that package.
- **Polypad-hosted (mode 1)** — the Polypad platform runs this same package on
  the creator's behalf. The hosted service itself (servers, secrets management,
  multi-tenant operation) is platform ops and is **not** part of this build;
  until an operator starts it, the front-end shows
  "Hosted runner: waiting for the platform to start it" — it never pretends a
  hosted runner is running when it is not.

Either way the safety story is the same: the agent key can only authorize
trades inside the on-chain caps.

## How to run

```bash
npm install
cp .env.example .env   # then fill in the real values (see below)
npm start              # poll loop (default every 60s)
# or: npm run start:once   # a single loop, for smoke tests / hosted runners
```

Requires Node 22+.

### Configuration (`.env`)

| Variable | What it is |
| --- | --- |
| `RPC_URL` | RPC endpoint for Robinhood Chain (chain id 4663) |
| `CHAIN_ID` | Default `4663` |
| `EXECUTOR_ADDRESS` / `VAULT_ADDRESS` | The agent's executor + vault contracts |
| `REGISTRY_ADDRESS` + `AGENT_ID` | Alternative: look the agent up in the on-chain registry (overrides the two addresses above) |
| `AGENT_PRIVATE_KEY` | The agent's signing key (0x hex). Signs instructions **and** pays gas |
| `ROUTER_ADDRESS` | Allowlisted swap router (e.g. the UniswapV3RouterAdapter). Unset = the runner only ever logs `hold` |
| `ASSET_ADDRESS` | Non-WETH mandate asset to trade. Unset = first non-WETH mandate asset |
| `POLL_INTERVAL_SECONDS` | Default `60` |
| `SLIPPAGE_BPS` | Slippage for `minAmountOut`, default `100` (1%) |
| `INSTRUCTION_TTL_SECONDS` | How long a signed instruction stays valid, default `600` |
| `STRATEGY_TEMPLATE_ID` / `STRATEGY_RISK_LEVEL` | Override the executor's on-chain params (0 = use on-chain) |
| `CUSTOM_RULES_JSON` | Rules for the Custom template (see below) |
| `DATA_DIR` | Local state directory, default `./data` |
| `HEALTH_PORT` | Default `8080` |
| `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` | Optional reasoning hook (see below) |

## What it does each loop

1. Reads vault state (`status`, `nav`, `navPerNft`, `spendableEth`, balances)
   and executor state (`paused`, `retired`, `nextNonce`, params, high-water NAV).
2. Skips cleanly — logs `hold` — when the fund is not **Investing**, the
   executor is paused / retired / revoked, or swaps are paused on the vault.
3. Prices the mandate asset via the allowlist `quote` (a bad price reverts,
   and the runner fails closed) and appends the price to the local history.
4. Evaluates the strategy and decides **buy / sell / hold** with reasoning.
5. On an action: sizes the trade inside the caps, sets `minAmountOut` from the
   configured slippage, signs the instruction (EIP-712), calls the executor's
   `validate()`, and submits `execute()` only when `validate()` says ok.
   A rejected `execute` reverts on-chain with a custom error; the revert is
   decoded and logged.

## Strategies (v1, deterministic)

| Template | Rule |
| --- | --- |
| **Momentum** (0) | Price up > 2% over the last day and position under cap → buy; down > 2% → sell to WETH. |
| **Dip-buyer** (1) | Price down > 5% from the recent high → buy a tranche. |
| **Defensive** (2) | High volatility (> 5%) or NAV drawdown past half the circuit breaker → rotate everything to WETH. |
| **DCA** (3) | On each rebalance interval, buy a fixed slice of the available WETH. |
| **Balanced** (4) | Rebalance to 50/50 WETH/asset when the drift is over 10%. |
| **Custom** (5) | First matching rule in `CUSTOM_RULES_JSON` fires. Each rule is `{"label", "metric", "operator", "value", "windowSeconds?", "action": "buy"|"sell", "fractionBps"}`. Metrics: `priceChangePct`, `navDrawdownBps`, `secondsSinceTrade`, `volatilityPct`. |

Trade sizes scale with risk (conservative / balanced / aggressive): buys use
10% / 25% / 50% of available WETH, sells 50% / 75% / 100% of the asset,
DCA 10% / 20% / 30%, dip tranches 20% / 30% / 50%. Every amount is then
capped by the effective trade cap and position-cap headroom
(executor params tightened by the vault caps; 0 = the vault's cap).

## The LLM reasoning hook (optional)

If `LLM_API_KEY` is set, the runner POSTs the decision context (template,
decision, price change, drawdown) to an OpenAI-compatible chat-completions
endpoint and uses the reply as the plain-language reasoning in the decision
log. **The LLM never sets amounts** — it only ever returns a short
explanation string, and any failure falls back to the rule-based reasoning.
No secret is ever sent to the LLM: no private key, no signature.

## Heartbeat + decision log

State lives in `DATA_DIR` (default `./data`):

- `decisions.jsonl` — one JSON object per line, **every** decision
  (executed, rejected, and hold), e.g.:
  ```json
  {"ts":"2026-11-09T20:00:00.000Z","agentId":"3","executor":"0x…","vault":"0x…","template":"Momentum","action":"buy","rule":"momentum-up","reasoning":"Price is up 3.10% over the last day, so the trend is up — buying with 25% of the available WETH.","validateReason":"ok","status":"executed","assetIn":"0x…","assetOut":"0x…","amountIn":"1250000000000000000","minAmountOut":"…","nonce":"7","txHash":"0x…","error":null}
  ```
  `validateReason` is the executor's kebab-case reason (`ok`,
  `trade-cap`, `too-soon`, `daily-limit`, …) or the hold reason.
  Amounts are raw units as decimal strings (wei for WETH).
- `price-history.json` — stored prices per asset (7 days, max 10,000 points),
  used by the strategy rules and by the front-end's paper-trade backtest.
- `heartbeat.json` — written every loop: last loop time, loop count, last
  decision/action/tx, error count.

Health endpoints (default port 8080):

- `GET /health` → `{"status":"ok"}`
- `GET /status` → the same summary as `heartbeat.json`

## Security notes

- **The agent key signs instructions AND pays gas.** Keep it in a secrets
  manager (or an env file that never enters git), never in chat, never in a
  log, never in a screenshot.
- **If the key leaks, the worst case is a valid-but-bad trade inside the
  caps.** The executor + vault enforce the trade cap, position cap,
  allowlist, mandate, daily limit, circuit breaker, and rebalance interval
  on every instruction. The key cannot drain the vault, send money to
  itself, or change the rules. Rotate it at once anyway: the fund manager
  calls `updateAgentKey` on the executor.
- **The manager stays in control.** The fund creator is the vault manager
  and can pause swaps (`vault.setSwapsPaused`), pause the agent
  (`executor.pause()`), or revoke it entirely (`vault.setExecutor(executor,
  false)` + `registry.retireAgent`) with one transaction each.
- **Router calldata is opaque.** Trust comes from the router allowlist +
  amount caps + `minAmountOut`, not from inspecting `data` — the runner
  sends empty calldata (`0x`) and lets the router do a plain swap.
- **Fail-closed everywhere.** A bad price quote reverts, a failed
  `validate()` means no submission, and a reverted `execute` rolls the
  whole trade back.

## Tests

```bash
npm test        # node:test + tsx: strategy engine + EIP-712 signing
npx tsc --noEmit
```

The signing test uses the well-known Hardhat account #0 as its test key —
a test key only, never a real key.
