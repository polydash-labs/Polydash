# PolyCTO — The AI CTO assigned to every Polypad launch

Every project that launches a token on **Polypad** (Polydash's launchpad on Robinhood Chain, chain id 4663) gets a PolyCTO agent: one AI team member with four roles, coordinated by a keyword router.

| Role | What it does | Tools |
|---|---|---|
| Community Manager | Telegram welcomes, FAQ answers, engagement posts, spam/scam spotting | `check_message_for_scam`, `project_context` |
| Marketing Expert | Launch plans, X/Telegram drafts, campaign calendars | `project_context`, `analyze_token` |
| Token Analyst | Name/symbol/decimals/supply, owner, top holders, concentration, recent transfers | `analyze_token`, `get_holders_and_flows` |
| Security Analyst | Heuristic scan of Sourcify-verified source + on-chain owner/EIP-1967 proxy checks | `security_scan` |

On-chain access is **read-only**: PolyCTO never signs or sends transactions.

## Setup
```bash
python -m venv venv && . venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in values, then: set -a; . ./.env; set +a
```

## Usage
```bash
python polycto.py                                   # interactive chat
python polycto.py --task "Draft a 7-day launch campaign"
python polycto.py --analyze 0xTOKEN                 # LLM-written token + security report
python polycto.py --tools --analyze 0xTOKEN         # raw JSON, no LLM key needed
python polycto.py --telegram                        # Telegram group bot
```

### Telegram mode
Add the bot to your group (disable privacy mode in BotFather to see all messages). It welcomes new members with your official links, answers when mentioned, on `/ask`, or in DMs, and scores every message for scam patterns. **It deletes nothing and bans nobody by default** — suspected scams are logged as suggestions. Set `POLYCTO_AUTO_MODERATE=true` to let it delete high-score messages (the bot needs admin rights). It never bans.

## Security scan scope
Flags: privileged mint, blacklist, pausable, fee/tax setters, max-tx/max-wallet limits, proxy/upgradeable, trading on/off switches, list-based transfer restrictions, owner withdraw/rescue, selfdestruct, and whether `owner()` is renounced. Library files (OpenZeppelin, `oz/`, `lib/`) are skipped to cut false positives. **This is a heuristic scan, not an audit.** Unverified contracts get on-chain checks only.

## Guardrails (built into every prompt)
No price predictions, ROI promises or financial advice; never asks for seed phrases or private keys; security output is labelled "not an audit"; never names other projects; only shares configured official links.

## Limitations
- Holders are discovered from `Transfer` logs in the last `POLYCTO_LOOKBACK` blocks (~0.1 s blocks, so 200k ≈ 5.5 h). Raise it for a fuller holder list; this costs more RPC calls.
- Regex heuristics can miss obfuscated logic or flag harmless code.
- Routing is keyword-based; ambiguous questions go to the Community Manager.

Links: https://dasheco.xyz · https://dasheco.xyz/staking · https://x.com/Polydash_ · https://t.me/polydashofficial
