# Poly Agent

![Poly Agent](assets/cover.png)

Poly Agent monitors and manages staking pools on Polypad, the token launchpad in the Polydash ecosystem on Robinhood Chain. It tracks inflows and outflows across staking pools in real time and reports live APRs, pool sizes and staking activity.

Read-only: it never signs or sends transactions.

## Swarms Marketplace

- **Live listing:** [https://swarms.world/agent/fbd6fcd5-8187-4bc7-98b2-59c9fc93a271](https://swarms.world/agent/fbd6fcd5-8187-4bc7-98b2-59c9fc93a271)
- **Categories:** Finance / Data & Analytics / Automation
- **Tags:** defi, staking, apr, robinhood-chain, polypad, polydash, onchain-data
- **Pricing:** Free

### Use cases
1. **Pool flow alerts:** detects large deposits and withdrawals in Polypad staking pools as they happen.
2. **Live APR lookup:** gives current APRs and total staked for every active pool.
3. **Staking opportunities:** surfaces new and active pools on Polypad with their terms.

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
