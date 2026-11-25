# POLYDASH buyback keeper

A tiny service that makes the deployed `PolydashBuybackVault` actually run.
Buys are **not automatic**: the vault needs an external caller to run
`observePrice()` → wait 5–60 minutes → `buy()`, and then `releaseToTarget()`
to stream the stakers' share to the rewards pool. This keeper is that caller.

It also keeps the Phase 6 `PolydashTwapFeed` price feed alive (see
"Poking the TWAP feed" below) — the feed is self-observing and fails closed
without regular pokes.

It does nothing else. It never touches the launch factories, never creates a
fund, never moves POLYDASH anywhere except through the vault's own functions.

## Contracts (Robinhood Chain, chain 4663)

| Contract | Address |
|---|---|
| BuybackVault | `0x35Ad6AC64fb53ED7154b6e6E0Ef84C6E12d7B193` |
| RewardsPool | `0x608d106Bb58A804fcd45823e0C6087801dee2aCa` |
| POLYDASH | `0x319525528f42167eF7fC18b77b889958080568e4` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| PolydashTwapFeed (Phase 6) | `0x5FDE0DB5AAFa8E20E76ca0D763C2c3eD49Af84fC` |

## What one cycle does

0. **Poke the TWAP feed.** Call `poke()` on the PolydashTwapFeed (see
   below). This runs first, on every cycle, independent of the buyback
   decision — the feed is poked even when the vault is empty and the buyback
   skips.
1. **Read state.** Vault ETH balance, `buyCount`, `totalBurned`, `obsTime`,
   `lastBuyTime`, `maxBuyEth` (0.02 ETH), and the POLYDASH held for stakers.
2. **Skip if the vault holds less than `MIN_BUY_ETH` (default 0.005 ETH).**
   A buy spends at most `maxBuyEth` (0.02 ETH) per call, so below 0.005 ETH
   the buy is too small to be worth a transaction. The vault simply waits
   until more fees arrive. This threshold is a keeper policy, not a contract
   rule — tune it with `MIN_BUY_ETH`.
3. **Skip if the 10-minute buy cooldown is still running** (contract
   `BUY_COOLDOWN` = 600 s since `lastBuyTime`).
4. **Observe.** If there is no observation, or the last one is older than 60
   minutes, call `observePrice()`. If the observation is younger than 5
   minutes, wait until it is 6 minutes old (the contract requires `buy()` 5–60
   minutes after `observePrice()`; the keeper waits 360 s by default, leaving
   margin on both sides).
5. **Buy.** Call `buy()`. The contract itself enforces the 2% band: it
   reverts (`PriceMoved`) if spot moved more than 2% from the observation.
   If `buy()` reverts, the keeper logs it and backs off — **it never spins in
   a retry loop**. The next scheduled run re-evaluates from fresh state.
   A successful buy spends at most 0.02 ETH and splits the POLYDASH bought:
   **62.5% burned** (to `0x000000000000000000000000000000000000dEaD),
   **37.5% held in the vault for stakers**.
6. **Release.** If the vault holds POLYDASH for stakers after the buy, call
   `releaseToTarget()`, which sends it to the RewardsPool. The pool then
   streams it to stakers over 30 days (`notifyRewardAmount`).

Each cycle takes ~6–7 minutes when it observes (the 6-minute wait dominates).
When the vault is empty or cooling down, a cycle finishes in seconds.

## Poking the TWAP feed

The Phase 6 `PolydashTwapFeed`
(`0x5FDE0DB5AAFa8E20E76ca0D763C2c3eD49Af84fC`) is the price feed that lets
funds buy POLYDASH. It is **self-observing**: it has no oracle of its own —
`poke()` (permissionless, no arguments) records the pool's current tick into
a 30-minute ring buffer, and `latestPrice` computes the TWAP from those
observations. That means:

- `latestPrice` **reverts until the ring holds observations spanning 30
  minutes**, and fails closed again if the newest observation goes stale
  (maxObservationAge 1800 s). A fund cannot buy POLYDASH while the feed is
  dark.
- The keeper pokes **once per cycle** (every 15 minutes via cron), before
  the buyback decision and independent of it — the feed is poked even when
  the vault is empty and the buyback skips. A second poke in the same block
  is a no-op in the feed, so poking every cycle is safe.
- One poke costs ~98k gas (~0.000002 ETH at current prices) from the keeper
  wallet — the same wallet that pays buyback gas, no extra funding needed.

**Failure policy: best-effort.** If `poke()` reverts or fails to send, the
keeper logs `poke-failed` and the cycle continues normally — the feed keeps
its last observation, the buyback is unaffected, and the next cycle retries.
A poke failure never fails the run and never blocks a buy.

**Bootstrapping note:** after a fresh feed deployment (or a long gap with no
pokes) the feed stays dark for ~30 minutes even with the keeper running —
`latestPrice` needs 30 minutes of poke history before it returns a price.
That is by design, not a keeper failure. First live poke: 2026-11-10
(tx `0x6c8bb5d1da8d97196a101ea31c614a2868ffba3d4106d019ad4a107d6c07b31b`,
observationCount 0 → 1); the feed becomes usable once the 15-minute pokes
have built 30 minutes of history.

## Prerequisite: the fee flow (already done)

The vault only fills up if platform fees are routed to it. That is the
`setBuybackConfig(true, 4000, vault)` call on each launch factory
(owner-only), which sends 40% of collected platform fees to the vault and 60%
to the fee wallet.

**This was done on 2026-11-09 ~16:54 PST** — no action needed unless a new
launch factory is deployed:

- Current factory `0xfDfD…` — tx
  `0x6b31b022c1412d23aadfc0e2840b3e3558cf0ce8b95a20c1de4f102f8ad1baed`
  (block 110489520)
- Earlier factory `0x2C84…` — tx
  `0x41a3142be78c9c9645ecc7fea57fd123a0a405c85b6f689a814f8869a3a6ac64`
  (block 110489551)

Both verified on-chain afterwards (`buybackEnabled=true`, 4000 bps,
`buybackContract` = the vault). With buyback on, the fee split is: 60% fee
wallet (team revenue), 25% burned, 15% to stakers. With it off, 100% goes to
the fee wallet.

## Still needed before it runs live

1. **A funded keeper wallet.** The keeper pays gas and receives nothing.
   Generate a fresh wallet (any throwaway key is fine — it holds no funds
   beyond gas money and has no special permissions), send it a few dollars of
   ETH on Robinhood Chain, and put its key in `KEEPER_PRIVATE_KEY` (see
   below). At current gas prices a few dollars covers months of 15-minute
   cycles, because most cycles are read-only skips that cost nothing.
2. **Scheduling** (see below). No cron exists yet — that is a deliberate
   choice, not an oversight: scheduling is an ops decision, not part of this
   build.

Honest caveat: as of 2026-11-09 the vault holds 0 ETH and only ~0.000006 ETH
of platform fees sits uncollected across all launches (total launch trading
volume so far is ~0.003 ETH). The keeper will mostly log
`skip / insufficient-balance` until real volume exists. Switching the fee
flow on (done) does not create volume — it just routes the fees that do
arrive.

## Setup

```sh
cd buyback-keeper
npm install
cp .env.example .env   # then fill in KEEPER_PRIVATE_KEY (see Security)
npm run build
```

Node ≥ 22. No other services needed.

### Configuration (environment variables)

| Variable | Default | Notes |
|---|---|---|
| `RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | Public RPC is fine for the keeper's reads and 1–3 txs per cycle. |
| `KEEPER_PRIVATE_KEY` | _(none)_ | **Required** unless `--dry-run`. 0x-prefixed 32-byte hex key. |
| `MIN_BUY_ETH` | `0.005` | Minimum vault ETH balance that triggers a buy. |
| `OBSERVE_WAIT_SECONDS` | `360` | Wait after `observePrice()` before `buy()`. Must be 300–3600. |
| `POLL_INTERVAL_SECONDS` | `60` | Between cycles in `--watch` mode. |
| `LOG_FILE` | `./data/keeper.log.jsonl` | JSONL log, created if missing. |

## Running it

```sh
# Read-only: log what WOULD happen, send nothing, needs no key.
npm run start:dry-run

# One full cycle (observe -> wait ~6 min -> buy -> release) and exit.
# This is the cron-friendly mode.
npm run start:once

# Loop forever (useful on a server; cron is the recommended alternative).
npm start -- --watch
```

### Scheduling with cron (recommended)

One cycle takes up to ~7 minutes when it observes, so run it every 15
minutes. Use `flock` so overlapping runs cannot collide (a slow run must not
start a second one):

```cron
*/15 * * * * /usr/bin/flock -n /tmp/buyback-keeper.lock /bin/bash -lc 'cd /path/to/buyback-keeper && KEEPER_PRIVATE_KEY="<key>" npm run start:once >> /path/to/buyback-keeper/data/cron.log 2>&1'
```

Or, preferably, put `KEEPER_PRIVATE_KEY` in the `.env` file (never in the
crontab itself) and drop the inline variable:

```cron
*/15 * * * * /usr/bin/flock -n /tmp/buyback-keeper.lock /bin/bash -lc 'cd /path/to/buyback-keeper && npm run start:once >> /path/to/buyback-keeper/data/cron.log 2>&1'
```

`flock -n` exits immediately if a previous run is still holding the lock, so
a long cycle is simply skipped rather than doubled.

## Keeper gas autopilot (Tier B mechanism + Tier A alerting)

The buyback keeper runs dry every few days; when it does, all V4 feed
pokes fail, feeds go stale, and V4-asset fund buys fail closed. The
autopilot (`src/autopilot.ts`, CLI `src/autopilot-run.ts`) is the structural
fix — off-chain only, no contracts, and a separate step from the buyback
cycle (it never touches `keeper.ts`).

Each run (same 15-minute cadence as the keeper cycle):
1. Reads the keeper balance, the reserve balance, and every V4 feed's
   newest-observation age (via `observationCount` + `observationAt` —
   NOT `latestPrice`, whose `updatedAt` is always `block.timestamp`).
2. Raises/clears structured alerts (JSON log + `data/autopilot-state.json`):
   keeper < 0.002 ETH (~14h cover), again at < 0.0005 ETH (~3.5h), any V4
   feed stale > 1h, reserve < 0.01 ETH. Alerts fire on transition into a
   condition, not every run.
3. If armed and the keeper is below 0.002 ETH, sends exactly 0.01 ETH
   from the dedicated reserve wallet to the keeper.

Hard caps (enforced in code, unit-tested): max 0.01 ETH per top-up, max
0.02 ETH per UTC day (persisted in the state file), refuse if the send
would drop the reserve below 0.005 ETH, refuse if the reserve balance is
unknown. NEVER draws from the deployer or fee wallet — reserve only.

Kill-switch: `AUTOPILOT_ENABLED` must be exactly `true` (default off)
AND no `data/autopilot.kill` file may exist. Either one off stops all
sends. The build ships ARMED-OFF.

### Arming (after Jon funds the reserve)

1. Fund the reserve wallet `0x2696a61a51eB47233e19b85A9EF5261dDB40481C`
   with 0.05 ETH (~15 days) or 0.10 ETH (~30 days). The key is in
   `.env.autopilot-reserve` (mode 600, git-ignored) — never share it.
2. Set `AUTOPILOT_ENABLED=true` (in `.env.autopilot-reserve` or the env).
3. Add the 15-minute cron (flock, same pattern as the keeper cycle):
   `*/15 * * * * /usr/bin/flock -n /tmp/buyback-autopilot.lock /bin/bash -lc 'cd /path/to/buyback-keeper && npm run autopilot >> /path/to/buyback-keeper/data/cron.log 2>&1'`
4. Watch the first live top-up in `data/autopilot.log.jsonl` (event
   `autopilot-topup`: amount + tx hash + keeper balance after) and confirm
   the keeper balance on-chain. To stop it instantly: `touch
   data/autopilot.kill` (or unset `AUTOPILOT_ENABLED`).

### Commands

```sh
npm run autopilot:dry-run   # Read-only: alerts + the plan. Sends nothing, needs no key.
npm run autopilot           # One check; sends ONLY when armed.
```

Logs: `data/autopilot.log.jsonl` (JSONL, same format as the keeper log).
State: `data/autopilot-state.json` (last check, balances, daily spent,
top-ups with tx hashes, active alerts, per-feed ages).

### Tests

```sh
npm test   # 37/37 pass (21 autopilot + 16 keeper)
```

Send-path verified on a local Anvil fork of mainnet (2026-11-22): an armed
run sent exactly 0.01 ETH to the keeper (keeper 0.00115 → 0.01115 ETH,
reserve 0.5 → 0.49 ETH); a second top-up the same day sent again
(daily 0.02 ETH); a third was blocked by the daily cap. No mainnet sends
were made during the build.

## Logs

Every check and action is one JSON line in `data/keeper.log.jsonl`:

```json
{"ts":"2026-11-10T01:07:19.709Z","event":"state","pendingEth":"0","buyCount":"0","totalBurned":"0","maxBuyEth":"0.02","targetActive":true}
{"ts":"2026-11-10T01:07:19.709Z","event":"decision","kind":"skip","reason":"insufficient-balance","pendingEth":"0","minBuyEth":"0.005"}
{"ts":"2026-11-10T01:07:19.710Z","event":"cycle-done","observed":false,"bought":false,"released":null}
```

Events: `start`, `state`, `decision` (`skip` / `observe` / `wait` / `buy`),
`dry-run-plan`, `poked`, `poke-failed`, `observe`, `buy` (with `ethIn`,
`burned`, `toStakers`), `buy-reverted`, `release`, `cycle-done`,
`cycle-error`. The keeper key is never logged; only the keeper address
appears in the `start` line.

## Failure modes

- **`poke()` fails** → logged as `poke-failed`, the cycle continues
  normally and the next run retries. The feed keeps its last observation.
  Only a problem if it fails for hours: the feed goes stale after 30
  minutes without a poke and `latestPrice` reverts until pokes resume and
  30 minutes of history rebuilds.
- **Vault empty** → `skip / insufficient-balance`. Normal. Wait for fees.
- **Cooldown** → `skip / cooldown` with `cooldownRemainingSeconds`.
- **`buy()` reverts (`PriceMoved` / `Slippage`)** → logged as
  `buy-reverted`, no retry in that cycle. Next cron run re-evaluates. This is
  expected whenever the price moves >2% in the 6 minutes after the
  observation; it is not an error in the keeper.
- **RPC down / throttled** → the cycle throws, `cycle-error` is logged, the
  process exits non-zero. Cron retries in 15 minutes. The public RPC is
  rate-limited; if this becomes frequent, point `RPC_URL` at a keyed provider
  (Alchemy / QuickNode / dRPC).
- **Keeper wallet out of gas money** → the process refuses to start with a
  clear error. Top it up and re-run.
- **Observation expired** (observation older than 60 min, e.g. a run died
  mid-cycle) → the next cycle takes a fresh observation. No manual cleanup.

## Security

- The keeper key comes **only** from the `KEEPER_PRIVATE_KEY` environment
  variable (or `.env`, which is git-ignored). It is never written to any
  other file, never logged, and never committed. `.env.example` contains no
  real values.
- The keeper wallet needs **no permissions**: it is not the vault owner, not
  the factory owner, and cannot move funds except by calling the vault's
  public `observePrice()` / `buy()` / `releaseToTarget()` — the same calls
  anyone can make. The worst case if the key leaks is someone else paying gas
  to run buys. Still: use a fresh wallet that holds only gas money.
- `npm audit` the dependencies before running on a server; the only runtime
  dependencies are `viem` and `dotenv`.

## Tests

```sh
# Unit tests (decision logic: balance threshold, cooldown, observation
# windows 5-60 min, release condition; plus the TWAP-feed poke step: poked
# every cycle including buyback skips, poke failure never breaks the cycle,
# poke uses the keeper wallet, dry-run plans but never sends). No network needed.
npm test          # 16/16 pass

# Fork test: the full observe -> buy -> release cycle against the live
# contracts on a fork. See test/buyback/BuybackKeeperFork.t.sol.
cd ..
FORK_RPC=https://robinhood.drpc.org forge test --match-contract BuybackKeeperFork -vv
```

Fork-test notes (learned the hard way, 2026-11-09/10):

- The test pins the fork to **block 104500000** by default (overridable with
  `FORK_BLOCK=<n>`). At the latest block the pool has so much accrued fee
  state that the Uniswap V4 hook's fee-collection path needs more storage
  proofs than the free public RPCs will serve in one batch, and the test
  fails intermittently with `FatalExternalError` inside the hook — an RPC
  limitation, not a contract failure. At the pinned block the same cycle
  runs reliably.
- Use **dRPC** (`https://robinhood.drpc.org`) as `FORK_RPC`. The official
  public RPC (`https://rpc.mainnet.chain.robinhood.com`) cannot serve the
  pinned block's historical state ("historical state … is not available") and
  also aborts the latest-block proof batches (`too_many_data_frames`). For
  fully reliable runs, use a keyed provider RPC (Alchemy free tier works).
- If `FORK_RPC` is unset the test skips instead of failing.

**Fork test result (2026-11-10): PASS** — `test_keeper_cycle()` passes
against dRPC at the pinned block (gas 1,033,822), and passed at blocks
104500000, 106000000 and 108000000. The cycle it proves, with the vault
funded with 0.005 ETH: `observePrice()` → warp 360 s → `buy()` (buyCount 1,
62.5% of the POLYDASH bought burned, 37.5% held) → `releaseToTarget()`
(held POLYDASH sent to the RewardsPool, `RewardAdded`, streaming over 30
days). Against the latest block the same test is flaky on every free public
RPC (~1 in 4 runs pass) for the proof-serving reason above; the pinned-block
run is the reliable one.

## Files

```
buyback-keeper/
  README.md            this file
  .env.example         config template, no real values
  package.json         @polypad/buyback-keeper, Node + viem
  src/
    chain.ts           Robinhood Chain definition, vault ABI, addresses
    config.ts          env config (key only from KEEPER_PRIVATE_KEY)
    keeper.ts          decision logic + the observe/buy/release cycle
    index.ts           CLI (--once / --watch / --dry-run)
    log.ts             JSONL logger
    autopilot.ts       keeper gas autopilot: alerts + capped auto-top-up (Tier B)
    autopilot-run.ts   autopilot CLI (--dry-run); ships ARMED-OFF
  tests/
    keeper.test.ts     11 unit tests for the decision logic
    autopilot.test.ts  21 unit + mock-client tests for the autopilot
  data/
    keeper.log.jsonl   created on first run (git-ignored)
    autopilot.log.jsonl  autopilot JSONL log (git-ignored)
    autopilot-state.json autopilot state: balances, daily spend, top-ups, alerts (git-ignored)
    autopilot.kill     kill-switch file: if present, the autopilot never sends
```

The fork test lives in the repo root, not here:
`test/buyback/BuybackKeeperFork.t.sol`.
