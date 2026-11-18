# Agent Credit Score — Off-chain Scorer

Computes the Agent Credit Score (a FICO for agents, 300–850) for every
registered agent and posts it on-chain to `AgentScore.updateScore`.
Runs daily. Same keeper pattern as the buyback-keeper (viem + tsx).

## How it works

For each agent in `AgentRegistry`:
1. **Collect** on-chain metrics (Robinhood Chain, via viem):
   - Funds it manages — `FundCreated` on the fund factories (manager indexed).
   - NAV history — `NavTape` on each fund vault (navPerNft over 30d).
   - Proposals — `AssetProposed` / `AssetExecuted` (2-day wait compliance).
   - Trades — `Trade` on each vault. Distributions — `Distributed`.
   - Exits in a wait window — fund NFT burns (`Transfer` to address(0)).
   - Launches — `LaunchCreated` (creator indexed).
   - POLYDASH staked — `balanceOf` on every staking pool whose stake token
     is POLYDASH.
2. **Score** the five components (0–1000 each) — see `src/score.ts`:
   - Performance 35% — NAV-weighted navPerNft return over 30d, in bps.
     The fund NAV is denominated in ETH, so this IS the return vs. holding
     ETH. <= -20% → 0; >= +50% → 1000; linear. No fund history → 0.
   - History 20% — days since registration (up to 500) + funds managed
     (up to 500).
   - Activity 15% — proposals + trades + launches + funds created in 30d.
     20 actions saturates.
   - Stake 15% — the agent's OWN committed POLYDASH (whole tokens):
     its 1,000 registration bond + what it staked in the pools.
     100,000 POLYDASH saturates. Vouching (others staking on the agent)
     is Phase 2 and is NOT counted here.
   - Conduct 15% — starts neutral at 500. Clean proposals (executed at/after
     their readyAt) and distributions earn +50 each (cap +500). A wait
     violation costs −200 (cap −600). A holder exit inside a wait window
     costs −25 (cap −250).
   - Total = 300 + (35·perf + 20·hist + 15·act + 15·stake + 15·conduct) × 550 / 100,000.
     All-zero → 300; all-1000 → 850. This mirrors
     `AgentScore.weightedScore` exactly — the contract enforces it.
3. **Post** `updateScore(agentId, score, components, inputsHash)` on-chain.
   `inputsHash` = keccak256 of the canonical metrics JSON, so anyone can
   audit/recompute a posted score.

## Run

```bash
npm install
npm test            # pure scoring math (no chain access)
npm run build
npm run start:dry-run   # compute + write data/scores.json; sends nothing
npm run start:once      # compute + post on-chain
```

Schedule daily with cron (use `flock` so overlapping runs cannot collide).
Dry-run needs no key; posting needs `KEEPER_PRIVATE_KEY`.

## Config (.env)

| Variable | Required | Default |
|---|---|---|
| `REGISTRY_ADDRESS` | yes | — (deploy AgentRegistry first) |
| `SCORE_ADDRESS` | yes, unless `--dry-run` | — (deploy AgentScore first) |
| `KEEPER_PRIVATE_KEY` | yes, unless `--dry-run` | — (never logged, never written to a file) |
| `RPC_URL` | no | `https://rpc.mainnet.chain.robinhood.com` |
| `FUND_FACTORIES` | no | Phase 3, Phase 3 V2, V3 (comma-separated to override) |
| `STAKING_FACTORIES` | no | current + legacy |
| `LAUNCH_FACTORY` | no | current launch factory |
| `POLYDASH_ADDRESS` | no | `0x3195…68e4` |
| `LOOKBACK_BLOCKS` | no | `200000` (~23 days at ~10s/block) |
| `OUTPUT_FILE` | no | `./data/scores.json` |
| `LOG_FILE` | no | `./data/scorer.log.jsonl` |

## Known gaps / follow-ups

- The Phase 2 fund factory is not in the default `FUND_FACTORIES` list
  (its address is not recorded in this branch). Add it via `FUND_FACTORIES`
  if funds exist there; the scorer accepts any comma-separated list.
- The official RPC chokes on heavy log reads; if `getLogs` fails, set
  `RPC_URL=https://robinhood.drpc.org` (note: dRPC rejects `eth_getLogs`
  on the free plan — use the official RPC for logs).
- Early on, with few agents and thin fund history, most scores cluster
  near the floor (~300–350). That is expected, not a bug.
- Contracts are unaudited (Slither only). The score is a reputation
  signal, not financial advice and not a guarantee of future performance.
