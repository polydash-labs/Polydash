# Poly Agent

![Poly Agent](assets/cover.png)

Poly Agent monitors staking pools on Polypad, the token launchpad Polydash runs on Robinhood Chain. It tracks inflows and outflows and reports pool sizes, reward rates, and staking activity. A reward rate is a token-denominated snapshot at the current stake. It is not a promised return.

Read-only: it never signs or sends transactions. "Monitor" is the whole of what "manage" means here.

## Swarms Marketplace

- **Live listing:** [https://swarms.world/agent/fbd6fcd5-8187-4bc7-98b2-59c9fc93a271](https://swarms.world/agent/fbd6fcd5-8187-4bc7-98b2-59c9fc93a271)
- **Categories:** Finance / Data & Analytics / Automation
- **Tags:** defi, staking, robinhood-chain, polypad, polydash, onchain-data
- **Pricing:** Free

### Use cases
1. **Pool flow alerts:** detects large deposits and withdrawals in Polypad staking pools as they happen.
2. **Pool lookup:** reports total staked, the reward rate, and time remaining for a pool.
3. **Open pools:** lists pools that are still accepting stake, with their terms.

## Requirements

- Python 3.10+
- `swarms`, `web3` (see [requirements.txt](requirements.txt))

## Setup

```bash
cd agents/poly-agent
pip install -r requirements.txt
cp .env.example .env   # set OPENAI_API_KEY; RPC, model and alert threshold are optional
```

Never commit your `.env`.

## Run

```bash
python poly_agent.py --tools   # print raw on-chain pool data (no LLM)
python poly_agent.py --watch   # live inflow/outflow alerts
python poly_agent.py           # ask the agent about Polypad staking
```

## Links
[Website](https://dasheco.xyz) · [Staking](https://dasheco.xyz/staking) · [X](https://x.com/Polydash_) · [Telegram](https://t.me/polydashofficial)
