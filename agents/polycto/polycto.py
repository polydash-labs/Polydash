"""
PolyCTO - The AI CTO assigned to every Polypad launch.

Polydash (https://dasheco.xyz) assigns a PolyCTO agent to each project that
launches a token on Polypad (Robinhood Chain, chain id 4663). One coordinator
routes each request to four specialists:
  1. Community Manager  - Telegram engagement, welcomes, FAQ, spam/scam spotting
  2. Marketing Expert   - launch plans, X/Telegram drafts, campaign calendars
  3. Token Analyst      - on-chain token stats, holders, transfer flows
  4. Security Analyst   - heuristic scan of verified source (Sourcify). NOT an audit.

READ-ONLY on-chain: never signs or sends transactions. Config via env (never hard-code secrets):
  ROBINHOOD_RPC_URL      default https://rpc.mainnet.chain.robinhood.com
  OPENAI_API_KEY         (or the key your MODEL_NAME provider needs)
  MODEL_NAME             default gpt-4o-mini
  TELEGRAM_BOT_TOKEN     only for --telegram
  PROJECT_NAME, PROJECT_TOKEN_ADDRESS, PROJECT_LINKS (comma separated)
  POLYCTO_AUTO_MODERATE  default false (moderation is only suggested)
  POLYCTO_LOOKBACK       blocks scanned for Transfer logs, default 200000
  POLYCTO_LOG_CHUNK      max blocks per eth_getLogs, default 10000

Usage:
  python polycto.py                          # interactive chat
  python polycto.py --task "draft a launch week plan"
  python polycto.py --analyze 0xToken        # LLM-written token + security report
  python polycto.py --tools --analyze 0xToken  # raw tool output, no LLM needed
  python polycto.py --telegram               # run the Telegram group bot
"""
import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional

import requests
from web3 import Web3

CHAIN_ID = 4663
RPC_URL = os.getenv("ROBINHOOD_RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o-mini")
PROJECT_NAME = os.getenv("PROJECT_NAME", "this project")
PROJECT_TOKEN = os.getenv("PROJECT_TOKEN_ADDRESS", "")
PROJECT_LINKS = [item.strip() for item in os.getenv("PROJECT_LINKS", "").split(",") if item.strip()]
AUTO_MODERATE = os.getenv("POLYCTO_AUTO_MODERATE", "false").lower() == "true"
LOOKBACK = int(os.getenv("POLYCTO_LOOKBACK", "200000"))
LOG_CHUNK = int(os.getenv("POLYCTO_LOG_CHUNK", "10000"))
SOURCIFY = "https://sourcify.dev/server"
TRANSFER = "0x" + Web3.keccak(text="Transfer(address,address,uint256)").hex().removeprefix("0x")
ZERO = "0x" + "0" * 40
DEAD = "0x000000000000000000000000000000000000dead"

_w3: Optional[Web3] = None


def w3() -> Web3:
    global _w3
    if _w3 is None:
        _w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 30}))
    return _w3


def _fn(name: str, out: str = "uint256", ins: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": "function", "name": name, "stateMutability": "view",
            "inputs": [{"name": f"a{i}", "type": t} for i, t in enumerate(ins or [])],
            "outputs": [{"name": "", "type": out}]}


ERC20_ABI = [_fn("name", "string"), _fn("symbol", "string"), _fn("decimals", "uint8"),
             _fn("totalSupply"), _fn("balanceOf", "uint256", ["address"]), _fn("owner", "address")]
EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"


def _safe(c, name: str, *args):
    try:
        return getattr(c.functions, name)(*args).call()
    except Exception:
        return None


def _addr(a: str) -> str:
    if not Web3.is_address(a or ""):
        raise ValueError(f"not a valid address: {a!r}")
    return Web3.to_checksum_address(a)


# ---------------------------------------------------------------- token analyst
def _token_info(token: str) -> Dict[str, Any]:
    t = _addr(token)
    c = w3().eth.contract(address=t, abi=ERC20_ABI)
    dec = _safe(c, "decimals")
    supply = _safe(c, "totalSupply")
    owner = _safe(c, "owner")
    code = w3().eth.get_code(t)
    return {"address": t, "is_contract": len(code) > 0, "name": _safe(c, "name"),
            "symbol": _safe(c, "symbol"), "decimals": dec,
            "total_supply": supply / 10 ** dec if supply is not None and dec is not None else supply,
            "owner": owner,
            "ownership_renounced": None if owner is None else owner.lower() in (ZERO, DEAD)}


def _transfers(token: str, lookback: int = LOOKBACK) -> List[Dict[str, Any]]:
    t = _addr(token)
    head = w3().eth.block_number
    start = max(0, head - lookback)
    out: List[Dict[str, Any]] = []
    frm = start
    while frm <= head:
        to = min(head, frm + LOG_CHUNK - 1)
        try:
            logs = w3().eth.get_logs({"address": t, "fromBlock": frm, "toBlock": to, "topics": [TRANSFER]})
        except Exception:
            logs = []
        for lg in logs:
            if len(lg["topics"]) < 3:
                continue
            data = lg["data"] if isinstance(lg["data"], bytes) else bytes.fromhex(lg["data"][2:])
            out.append({"from": "0x" + bytes(lg["topics"][1])[-20:].hex(),
                        "to": "0x" + bytes(lg["topics"][2])[-20:].hex(),
                        "raw": int.from_bytes(data[:32], "big") if data else 0,
                        "block": lg["blockNumber"], "tx": "0x" + bytes(lg["transactionHash"]).hex().removeprefix("0x")})
        frm = to + 1
    return out


def analyze_token(token_address: str) -> str:
    """Token analyst: name, symbol, decimals, total supply, owner and renounce status for an ERC-20 on Robinhood Chain."""
    try:
        return json.dumps(_token_info(token_address), default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})


def get_holders_and_flows(token_address: str, lookback_blocks: int = LOOKBACK) -> str:
    """Token analyst: top holders (from recent Transfer logs, live balances), holder concentration and recent transfer flows."""
    try:
        info = _token_info(token_address)
        dec = info["decimals"] or 18
        logs = _transfers(token_address, lookback_blocks)
        seen = {x["to"] for x in logs} | {x["from"] for x in logs}
        seen -= {ZERO}
        c = w3().eth.contract(address=_addr(token_address), abi=ERC20_ABI)
        bals = []
        for a in list(seen)[:300]:
            b = _safe(c, "balanceOf", Web3.to_checksum_address(a)) or 0
            if b:
                bals.append((a, b / 10 ** dec))
        bals.sort(key=lambda x: -x[1])
        supply = info["total_supply"] or 0
        top = [{"address": a, "balance": round(b, 4),
                "pct_supply": round(100 * b / supply, 3) if supply else None,
                "is_contract": len(w3().eth.get_code(Web3.to_checksum_address(a))) > 0}
               for a, b in bals[:10]]
        top10 = sum(h["pct_supply"] or 0 for h in top)
        recent = [{"from": x["from"], "to": x["to"], "amount": round(x["raw"] / 10 ** dec, 4),
                   "block": x["block"], "tx": x["tx"]} for x in logs[-10:]]
        return json.dumps({
            "token": info["symbol"], "blocks_scanned": lookback_blocks, "transfers_found": len(logs),
            "addresses_seen": len(seen), "top_holders": top, "top10_pct_supply": round(top10, 2),
            "concentration": "high" if top10 > 70 else "medium" if top10 > 40 else "low",
            "note": "Holders are discovered from Transfer logs in the scanned window only; "
                    "contracts in the list may be LP pools, staking or lockers.",
            "recent_transfers": recent}, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ------------------------------------------------------------- security analyst
RISK_PATTERNS = [
    ("owner_mint", r"function\s+mint\s*\([^)]*\)[^{]*\b(onlyOwner|onlyRole|onlyMinter)", "high",
     "Privileged mint: supply can be increased by the owner/role."),
    ("blacklist", r"(blacklist|blackList|isBlacklisted|_isBot|isBot|denylist)", "high",
     "Blacklist logic: addresses can be blocked from transferring."),
    ("pausable", r"(whenNotPaused|function\s+pause\s*\(|Pausable)", "medium",
     "Pausable: transfers or functions can be paused."),
    ("fee_tax_setter", r"function\s+(set|update)\w*(Fee|Tax)(?!\w*(Recipient|Receiver|Wallet|Address|Collector|Exempt|Exclude))\w*\s*\(", "high",
     "Fee/tax setter: buy/sell fees can be changed after launch."),
    ("max_tx_wallet", r"(maxTx|maxTransaction|maxWallet|_maxTxAmount|maxWalletSize)", "medium",
     "Max-tx / max-wallet limits that the owner may be able to change."),
    ("proxy_upgradeable", r"(upgradeTo|UUPSUpgradeable|TransparentUpgradeableProxy|delegatecall|Initializable)", "high",
     "Upgradeable/proxy pattern: logic can be replaced."),
    ("trading_toggle", r"(tradingEnabled|tradingOpen|enableTrading|swapEnabled\s*=|canTrade)", "high",
     "Trading on/off switch: possible honeypot-style restriction."),
    ("transfer_restriction", r"require\s*\([^;]*(isExcluded|_isExcludedFrom|whitelist|allowed\[)[^;]*\)", "medium",
     "Conditional transfer restrictions based on owner-managed lists."),
    ("owner_withdraw", r"function\s+\w*(withdraw|rescue|recover|sweep)\w*\s*\([^)]*\)[^{]*onlyOwner", "low",
     "Owner can withdraw/rescue tokens or ETH from the contract."),
    ("self_destruct", r"selfdestruct\s*\(", "high", "selfdestruct present."),
]


def _sourcify(addr: str) -> Dict[str, Any]:
    r = requests.get(f"{SOURCIFY}/v2/contract/{CHAIN_ID}/{addr}", params={"fields": "sources,compilation,proxyResolution"}, timeout=30)
    if r.status_code == 404:
        return {"verified": False}
    r.raise_for_status()
    j = r.json()
    srcs = {k: v.get("content", "") for k, v in (j.get("sources") or {}).items()}
    comp = j.get("compilation") or {}
    return {"verified": True, "match": j.get("match") or j.get("runtimeMatch"),
            "contract_name": comp.get("name"), "compiler": comp.get("compilerVersion"),
            "proxy": j.get("proxyResolution"), "sources": srcs}


def security_scan(contract_address: str) -> str:
    """Security analyst: heuristic risk scan of a contract's verified source from Sourcify (chain 4663) plus on-chain owner/proxy checks. NOT an audit."""
    try:
        a = _addr(contract_address)
        res: Dict[str, Any] = {"address": a, "disclaimer": "Heuristic scan only. This is NOT a security audit."}
        c = w3().eth.contract(address=a, abi=ERC20_ABI)
        owner = _safe(c, "owner")
        res["owner"] = owner
        res["ownership_renounced"] = None if owner is None else owner.lower() in (ZERO, DEAD)
        impl = w3().eth.get_storage_at(a, EIP1967_IMPL)
        impl_addr = "0x" + bytes(impl)[-20:].hex()
        res["eip1967_proxy_impl"] = impl_addr if int(impl_addr, 16) else None
        try:
            s = _sourcify(a)
        except Exception as e:
            s = {"verified": None, "error": f"Sourcify lookup failed: {e}"}
        srcs = s.pop("sources", {}) or {}
        res["sourcify"] = s
        # skip library code (OpenZeppelin etc.) so imports don't create false positives
        own = {k: v for k, v in srcs.items() if not re.search(r"(@openzeppelin|node_modules|(^|/)lib/|(^|/)oz/)", k)} or srcs
        flags = []
        for key, pat, sev, desc in RISK_PATTERNS:
            hits = [f for f, code in own.items() if re.search(pat, code)]
            if hits:
                flags.append({"flag": key, "severity": sev, "detail": desc, "files": hits[:3]})
        if res["eip1967_proxy_impl"] and not any(f["flag"] == "proxy_upgradeable" for f in flags):
            flags.append({"flag": "proxy_upgradeable", "severity": "high", "detail": "EIP-1967 implementation slot is set.", "files": []})
        if owner and not res["ownership_renounced"]:
            flags.append({"flag": "active_owner", "severity": "info", "detail": f"Owner {owner} still holds admin rights.", "files": []})
        res["source_files_scanned"] = list(own)[:20]
        res["flags"] = flags
        if not srcs:
            res["note"] = "No verified source on Sourcify; only on-chain checks were run. Unverified code is itself a risk signal."
        return json.dumps(res, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ------------------------------------------------------------ community helpers
SCAM_PATTERNS = [r"seed\s*phrase", r"private\s*key", r"recovery\s*phrase", r"dm\s*me", r"airdrop.*claim",
                 r"connect\s*(your)?\s*wallet", r"support\s*team.*dm", r"t\.me/\+", r"guaranteed\s*(profit|return)",
                 r"double\s*your", r"validate\s*wallet", r"wallet\s*sync"]


def check_message_for_scam(text: str) -> str:
    """Community manager: score a Telegram message for spam/scam patterns and suggest (not take) a moderation action."""
    hits = [p for p in SCAM_PATTERNS if re.search(p, text or "", re.I)]
    links = re.findall(r"https?://\S+|t\.me/\S+", text or "")
    score = min(100, 30 * len(hits) + 10 * len(links))
    return json.dumps({"score": score, "patterns": hits, "links": links,
                       "suggested_action": "delete + warn" if score >= 60 else "review" if score >= 30 else "none",
                       "auto_moderate": AUTO_MODERATE})


def project_context() -> str:
    """Return the configured project name, token address and official links."""
    return json.dumps({"project": PROJECT_NAME, "token": PROJECT_TOKEN, "links": PROJECT_LINKS,
                       "chain": "Robinhood Chain (4663)", "launchpad": "Polypad by Polydash"})


# --------------------------------------------------------------------- agents
GUARDRAILS = """Rules you always follow:
- No price predictions, no ROI or profit promises, no financial advice. Say "DYOR".
- Never ask anyone for seed phrases, private keys or wallet "validation". Warn users that admins never DM first.
- Security output is a heuristic scan, NOT an audit. Always say so.
- Never name or compare against competitor projects. Never invent facts, partnerships, listings or "first" claims.
- Only use official links from project_context. Be concise, friendly and accurate."""

ROLES = {
    "community": ("PolyCTO-Community", "Telegram community manager: welcomes, FAQ answers, engagement posts, spam/scam spotting. "
                  "Moderation actions are only suggested unless auto-moderation is enabled.", [check_message_for_scam, project_context]),
    "marketing": ("PolyCTO-Marketing", "Marketing expert: launch plans, X and Telegram post drafts, campaign calendars, community growth ideas. "
                  "Honest, hype-free copy with no price talk.", [project_context, analyze_token]),
    "token": ("PolyCTO-TokenAnalyst", "Token analyst: on-chain stats, supply, holders, concentration and transfer flows on Robinhood Chain. "
              "Report numbers from tools only.", [analyze_token, get_holders_and_flows, project_context]),
    "security": ("PolyCTO-Security", "Smart contract security analyst: reviews verified source from Sourcify and on-chain owner/proxy state, "
                 "explains each flag in plain English. Always state this is not an audit.", [security_scan, analyze_token]),
}


def _need_llm():
    try:
        from swarms import Agent  # noqa: F401
    except ImportError:
        sys.exit("swarms is not installed. Run: pip install -r requirements.txt  (or use --tools for raw output)")
    if not any(os.getenv(k) for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY")):
        sys.exit("No LLM API key found. Set OPENAI_API_KEY (or your MODEL_NAME provider's key) in .env, "
                 "or run with --tools for raw on-chain output.")


def build_agent(role: str):
    from swarms import Agent
    name, desc, tools = ROLES[role]
    prompt = (f"You are {name}, part of PolyCTO, the AI CTO Polydash assigns to every Polypad launch. "
              f"You work for {PROJECT_NAME}. Role: {desc}\n{GUARDRAILS}")
    return Agent(agent_name=name, agent_description=desc, system_prompt=prompt,
                 model_name=MODEL_NAME, max_loops=1, tools=tools)


ROUTES = {"security": r"secur|audit|rug|honeypot|contract|mint|blacklist|proxy|owner|renounc",
          "token": r"holder|supply|token stat|flow|transfer|whale|concentrat|analy",
          "marketing": r"market|post|tweet|campaign|launch plan|calendar|announce|thread|promo",
          "community": r"telegram|welcome|faq|community|spam|scam|engag|moderat|group"}


def route(task: str) -> str:
    """Coordinator: pick the specialist for a task (keyword router, no LLM cost)."""
    for role, pat in ROUTES.items():
        if re.search(pat, task, re.I):
            return role
    return "community"


_agents: Dict[str, Any] = {}


def ask(task: str) -> str:
    role = route(task)
    if role not in _agents:
        _agents[role] = build_agent(role)
    out = _agents[role].run(task)
    return out if isinstance(out, str) else str(out)


# ------------------------------------------------------------------- telegram
def telegram_bot() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        sys.exit("Set TELEGRAM_BOT_TOKEN to run --telegram.")
    _need_llm()
    api = f"https://api.telegram.org/bot{token}"
    me = requests.get(f"{api}/getMe", timeout=30).json()["result"]["username"]
    print(f"PolyCTO Telegram bot @{me} running. Auto-moderate: {AUTO_MODERATE}")
    offset = 0
    while True:
        try:
            ups = requests.get(f"{api}/getUpdates", params={"offset": offset, "timeout": 50}, timeout=60).json().get("result", [])
        except Exception as e:
            print("poll error:", e)
            time.sleep(5)
            continue
        for u in ups:
            offset = u["update_id"] + 1
            m = u.get("message") or {}
            chat = m.get("chat", {}).get("id")
            if not chat:
                continue
            for nm in m.get("new_chat_members", []):
                links = " | ".join(PROJECT_LINKS)
                send = (f"Welcome {nm.get('first_name', 'friend')} to {PROJECT_NAME}! Official links: {links or 'see pinned'}. "
                        "Admins will never DM you first or ask for your seed phrase.")
                requests.post(f"{api}/sendMessage", json={"chat_id": chat, "text": send}, timeout=30)
            text = m.get("text") or ""
            if not text:
                continue
            scan = json.loads(check_message_for_scam(text))
            if scan["score"] >= 60:
                if AUTO_MODERATE:
                    requests.post(f"{api}/deleteMessage", json={"chat_id": chat, "message_id": m["message_id"]}, timeout=30)
                    print("deleted suspected scam:", scan["patterns"])
                else:
                    print(f"[suggest] delete msg {m['message_id']} in {chat}: {scan['patterns']}")
                continue
            if f"@{me}" in text or text.startswith("/ask") or m.get("chat", {}).get("type") == "private":
                q = text.replace(f"@{me}", "").removeprefix("/ask").strip() or "Introduce yourself"
                try:
                    ans = ask(q)
                except Exception as e:
                    ans = f"Sorry, I hit an error: {e}"
                requests.post(f"{api}/sendMessage", json={"chat_id": chat, "text": ans[:4000],
                              "reply_to_message_id": m["message_id"]}, timeout=30)


# ------------------------------------------------------------------------ cli
def raw_report(addr: str) -> str:
    return json.dumps({"token": json.loads(analyze_token(addr)),
                       "holders_flows": json.loads(get_holders_and_flows(addr)),
                       "security": json.loads(security_scan(addr))}, indent=2, default=str)


def main(argv: List[str]) -> None:
    tools_only = "--tools" in argv
    if "--analyze" in argv:
        i = argv.index("--analyze")
        addr = argv[i + 1] if len(argv) > i + 1 else PROJECT_TOKEN
        if not addr:
            sys.exit("Usage: --analyze <token_address> (or set PROJECT_TOKEN_ADDRESS)")
        if tools_only:
            print(raw_report(addr))
            return
        _need_llm()
        print(build_agent("security").run(
            f"Write a plain-English token and security report for {addr}. Use analyze_token and security_scan. "
            "End with: 'Heuristic scan, not an audit. DYOR.'"))
        return
    if tools_only:
        print(project_context())
        return
    if "--telegram" in argv:
        telegram_bot()
        return
    if "--task" in argv:
        i = argv.index("--task")
        _need_llm()
        print(ask(" ".join(argv[i + 1:])))
        return
    _need_llm()
    print(f"PolyCTO for {PROJECT_NAME}. Ask anything (community, marketing, token, security). Ctrl+C to quit.")
    while True:
        try:
            q = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if q:
            print(f"[{route(q)}]", ask(q))


if __name__ == "__main__":
    main(sys.argv[1:])
