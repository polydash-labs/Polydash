"""
Poly Agent - Polydash / Polypad staking-pool monitor for Robinhood Chain.

READ-ONLY: this agent never signs or sends transactions. "Manage" means
monitor and report. All config comes from environment variables:

  ROBINHOOD_RPC_URL            (default https://rpc.mainnet.chain.robinhood.com)
  OPENAI_API_KEY               (or whichever key your MODEL_NAME provider needs)
  MODEL_NAME                   (default gpt-4o-mini)
  POLY_AGENT_ALERT_THRESHOLD   (token amount, default 1000)
  POLY_AGENT_LOG_CHUNK         (max blocks per eth_getLogs, default 10000)

Usage:
  python poly_agent.py                    # sample LLM query
  python poly_agent.py "your question"    # custom LLM query
  python poly_agent.py --tools            # run on-chain tools only (no LLM)
  python poly_agent.py --watch [secs]     # poll for stake/withdraw alerts
"""
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

from web3 import Web3

RPC_URL = os.getenv("ROBINHOOD_RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o-mini")
ALERT_THRESHOLD = float(os.getenv("POLY_AGENT_ALERT_THRESHOLD", "1000"))
LOG_CHUNK = int(os.getenv("POLY_AGENT_LOG_CHUNK", "10000"))

POLYDASH_TOKEN = "0x319525528f42167ef7fc18b77b889958080568e4"
FACTORIES = {
    "v1": "0x0aAEa47d2e7303EC5a809062eafa59e7F011D857",
    "v2": "0x904b8F5d95B593b5F4a6Dbb116b58e1d5CBe93f0",
}
# Fallback if factory getters fail.
KNOWN_POOLS = {
    "0x8fbd1d0a4d07ffe10c6e4ac03230015083818c0b": "v1",
    "0xadf34a657cf2dcd3703a5478d9fae4a325dba8ad": "v2",
    "0xe798d753ba2d9584e86e490b48d8c572e726cf33": "v2",
    "0x0f50043e172b8652bb786c4f14f30c415e5760ab": "v2",
}
SECONDS_PER_YEAR = 365 * 24 * 3600


def _fn(name: str, outputs: str = "uint256", inputs: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "type": "function", "name": name, "stateMutability": "view",
        "inputs": [{"name": f"a{i}", "type": t} for i, t in enumerate(inputs or [])],
        "outputs": [{"name": "", "type": outputs}],
    }


# Names below match the verified sources: PolydashStakingFactoryV2 / PolydashStakingPoolV2
# (Sourcify exact match, solc 0.8.24, chain 4663). v1 shares the same getter names.
FACTORY_ABI = [_fn("poolsLength"), _fn("allPools", "address", ["uint256"])]
FACTORY_V2_ABI = FACTORY_ABI + [_fn("verified", "bool", ["address"])]
POOL_ABI = [
    _fn("name", "string"), _fn("stakeToken", "address"), _fn("rewardToken", "address"),
    _fn("totalStaked"), _fn("rewardRate"), _fn("startTime"), _fn("endTime"),
    _fn("totalRewards"), _fn("totalRewardsPaid"), _fn("stakerCount"),
    _fn("maxTotalStake"), _fn("isActive", "bool"), _fn("funded", "bool"),
]
# v2-only getters (verified PolydashStakingPoolV2). totalStaked is in *shares*
# (1:1 with tokens while solvent); principalBacking() is the token amount backing them.
POOL_V2_ABI = POOL_ABI + [_fn("principalBacking"), _fn("description", "string"), _fn("claimFeeBps")]
RATE_PRECISION_V2 = 10 ** 18  # PolydashStakingPoolV2.RATE: rewardRate = tokens/sec * 1e18
ERC20_ABI = [_fn("symbol", "string"), _fn("decimals", "uint8")]

def _topic(sig: str) -> str:
    return "0x" + Web3.keccak(text=sig).hex().removeprefix("0x")


# Event topics -> (flow type, index of the token-amount word in log data).
# v1: Staked(user, amount), Withdrawn(user, amount, fee)
# v2 (verified): Staked(user, amount, shares), Withdrawn(user, shares, amount),
#                EmergencyWithdrawn(user, shares, amount)
TOPICS = {
    "v1": {_topic("Staked(address,uint256)"): ("stake", 0),
           _topic("Withdrawn(address,uint256,uint256)"): ("withdraw", 0)},
    "v2": {_topic("Staked(address,uint256,uint256)"): ("stake", 0),
           _topic("Withdrawn(address,uint256,uint256)"): ("withdraw", 1),
           _topic("EmergencyWithdrawn(address,uint256,uint256)"): ("withdraw", 1)},
}

w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 30}))
_token_cache: Dict[str, Dict[str, Any]] = {}
_pool_cache: Dict[str, str] = {}


def _hex(t: Any) -> str:
    s = t.hex() if hasattr(t, "hex") else str(t)
    return s if s.startswith("0x") else "0x" + s


def _token(addr: str) -> Dict[str, Any]:
    addr = Web3.to_checksum_address(addr)
    if addr not in _token_cache:
        c = w3.eth.contract(address=addr, abi=ERC20_ABI)
        try:
            sym = c.functions.symbol().call()
        except Exception:
            sym = addr[:8]
        try:
            dec = c.functions.decimals().call()
        except Exception:
            dec = 18
        _token_cache[addr] = {"address": addr, "symbol": sym, "decimals": dec}
    return _token_cache[addr]


def _safe(c, name: str):
    try:
        return getattr(c.functions, name)().call()
    except Exception:
        return None


def _discover() -> Dict[str, str]:
    if _pool_cache:
        return _pool_cache
    for ver, fac in FACTORIES.items():
        try:
            c = w3.eth.contract(address=Web3.to_checksum_address(fac), abi=FACTORY_ABI)
            for i in range(c.functions.poolsLength().call()):
                _pool_cache[c.functions.allPools(i).call().lower()] = ver
        except Exception:
            pass
    for p, ver in KNOWN_POOLS.items():
        _pool_cache.setdefault(p, ver)
    return _pool_cache


def list_pools() -> str:
    """List every Polydash staking pool (v1 + v2 factories) on Robinhood Chain.

    Returns:
        JSON list of {pool, version, name, stake_token, reward_token, active}.
    """
    out = []
    for p, ver in _discover().items():
        c = w3.eth.contract(address=Web3.to_checksum_address(p), abi=POOL_ABI)
        st, rt = _safe(c, "stakeToken"), _safe(c, "rewardToken")
        out.append({"pool": p, "version": ver, "name": _safe(c, "name"),
                    "stake_token": _token(st)["symbol"] if st else None,
                    "reward_token": _token(rt)["symbol"] if rt else None,
                    "active": _safe(c, "isActive")})
    return json.dumps(out, indent=2)


def _stats(pool: str) -> Dict[str, Any]:
    pool = pool.lower()
    ver = _discover().get(pool, "v2")
    c = w3.eth.contract(address=Web3.to_checksum_address(pool), abi=POOL_V2_ABI if ver == "v2" else POOL_ABI)
    st, rt = _token(_safe(c, "stakeToken")), _token(_safe(c, "rewardToken"))
    sd, rd = 10 ** st["decimals"], 10 ** rt["decimals"]
    total_staked = (_safe(c, "totalStaked") or 0) / sd
    start, end = _safe(c, "startTime") or 0, _safe(c, "endTime") or 0
    total_rewards = (_safe(c, "totalRewards") or 0) / rd
    raw_rate = _safe(c, "rewardRate") or 0
    if ver == "v2":
        rate = raw_rate / RATE_PRECISION_V2 / rd  # verified: tokens/sec * 1e18
    else:
        # v1 is unverified: infer whether rewardRate is 1e18-scaled.
        duration = max(end - start, 1)
        rate = raw_rate / rd
        if total_rewards and rate * duration > total_rewards * 1e6:
            rate = raw_rate / rd / 1e18
    now = int(time.time())
    extra: Dict[str, Any] = {}
    if ver == "v2":
        pb = _safe(c, "principalBacking")
        extra = {"principal_backing": pb / sd if pb is not None else None,
                 "claim_fee_bps": _safe(c, "claimFeeBps")}
        try:
            fac = w3.eth.contract(address=Web3.to_checksum_address(FACTORIES["v2"]), abi=FACTORY_V2_ABI)
            extra["factory_verified_badge"] = fac.functions.verified(Web3.to_checksum_address(pool)).call()
        except Exception:
            extra["factory_verified_badge"] = None
    return {**extra,
        "pool": pool, "version": ver, "name": _safe(c, "name"),
        "stake_token": st, "reward_token": rt,
        "total_staked": total_staked,
        "max_total_stake": (_safe(c, "maxTotalStake") or 0) / sd,
        "reward_rate_per_second": rate,
        "reward_per_day": rate * 86400,
        "total_rewards": total_rewards,
        "total_rewards_paid": (_safe(c, "totalRewardsPaid") or 0) / rd,
        "staker_count": _safe(c, "stakerCount"),
        "start_time": start, "end_time": end,
        "seconds_remaining": max(end - now, 0),
        "active": _safe(c, "isActive"), "funded": _safe(c, "funded"),
    }


def get_pool_stats(pool: str) -> str:
    """Get live on-chain stats for one staking pool.

    Args:
        pool: Pool contract address (0x...).

    Returns:
        JSON with total staked, reward rate, rewards, staker count, start/end times.
    """
    return json.dumps(_stats(pool), indent=2)


def _apr(s: Dict[str, Any]) -> Dict[str, Any]:
    base = {"pool": s["pool"], "name": s["name"]}
    if s["seconds_remaining"] == 0:
        return {**base, "apr_pct": 0.0, "note": "Pool ended; no rewards accruing."}
    if s["total_staked"] <= 0:
        return {**base, "apr_pct": None, "note": "Nothing staked, so a percentage rate is undefined."}
    if s["stake_token"]["address"] != s["reward_token"]["address"]:
        return {**base, "apr_pct": None,
                "reward_per_staked_token_per_year": s["reward_rate_per_second"] * SECONDS_PER_YEAR / s["total_staked"],
                "note": f"Stake token {s['stake_token']['symbol']} differs from reward token "
                        f"{s['reward_token']['symbol']}; no price feed, so a percentage rate is not computable. "
                        "Figure shown is token-denominated."}
    apr = s["reward_rate_per_second"] * SECONDS_PER_YEAR / s["total_staked"] * 100
    return {**base, "apr_pct": round(apr, 4),
            "note": f"Token-denominated ({s['stake_token']['symbol']} rewards per {s['stake_token']['symbol']} staked), "
                    "at current total staked; changes as stake changes. Not a promise of returns."}


def get_apr(pool: str) -> str:
    """Token-denominated reward rate from on-chain rewardRate and totalStaked.

    The JSON field is still named apr_pct so existing tool calls keep working.
    The figure is not a promised return.

    Args:
        pool: Pool contract address.

    Returns:
        JSON with apr_pct, or null when a percentage is not computable.
    """
    return json.dumps(_apr(_stats(pool)), indent=2)


def _flows(pool: str = "all", lookback_blocks: int = 50000) -> List[Dict[str, Any]]:
    pools = _discover()
    targets = list(pools) if pool in ("all", "", None) else [pool.lower()]
    latest = w3.eth.block_number
    start = max(latest - int(lookback_blocks), 0)
    events = []
    for p in targets:
        ver = pools.get(p, "v2")
        st = _token(w3.eth.contract(address=Web3.to_checksum_address(p), abi=POOL_ABI).functions.stakeToken().call())
        topic_map = TOPICS[ver]
        frm = start
        while frm <= latest:
            to = min(frm + LOG_CHUNK - 1, latest)
            logs = w3.eth.get_logs({"address": Web3.to_checksum_address(p), "fromBlock": frm,
                                    "toBlock": to, "topics": [list(topic_map)]})
            for lg in logs:
                data = _hex(lg["data"])
                kind, word = topic_map[_hex(lg["topics"][0])]
                amount = int(data[2 + 64 * word: 66 + 64 * word], 16) / 10 ** st["decimals"]
                events.append({"pool": p, "type": kind,
                               "user": "0x" + _hex(lg["topics"][1])[-40:], "amount": amount,
                               "token": st["symbol"], "block": lg["blockNumber"],
                               "tx": _hex(lg["transactionHash"])})
            frm = to + 1
    events.sort(key=lambda e: e["block"])
    return events


def get_staking_flows(pool: str = "all", lookback_blocks: int = 50000) -> str:
    """Detect stake (inflow) and withdraw (outflow) events for a pool or all pools.

    Args:
        pool: Pool address, or "all".
        lookback_blocks: How many recent blocks to scan (chunked getLogs).

    Returns:
        JSON summary with inflow/outflow totals, net flow and the events.
    """
    ev = _flows(pool, lookback_blocks)
    inflow = sum(e["amount"] for e in ev if e["type"] == "stake")
    outflow = sum(e["amount"] for e in ev if e["type"] == "withdraw")
    return json.dumps({"lookback_blocks": lookback_blocks, "event_count": len(ev),
                       "inflow": inflow, "outflow": outflow, "net": inflow - outflow,
                       "events": ev[-50:]}, indent=2)


def find_opportunities() -> str:
    """List pools currently accepting stake (active, not ended, not full), newest end first.

    Returns:
        JSON list with total staked, reward-rate info and time remaining. Informational only.
    """
    out = []
    for p in _discover():
        try:
            s = _stats(p)
        except Exception:
            continue
        full = s["max_total_stake"] > 0 and s["total_staked"] >= s["max_total_stake"]
        if s["seconds_remaining"] > 0 and not full and s["active"] is not False:
            out.append({"pool": p, "name": s["name"], "stake_token": s["stake_token"]["symbol"],
                        "reward_token": s["reward_token"]["symbol"], "total_staked": s["total_staked"],
                        "days_remaining": round(s["seconds_remaining"] / 86400, 2), "apr": _apr(s)})
    out.sort(key=lambda x: -x["days_remaining"])
    return json.dumps(out, indent=2)


SYSTEM_PROMPT = """You are Poly Agent, the Polydash staking analyst for Polypad on Robinhood Chain.
You monitor Polydash staking pools (v1 and v2 factories), detect stake inflows and withdraw
outflows, and report on-chain staking data: total staked, reward rates, pool end times and
open pools.
Rules:
- Always call your tools for numbers; cite on-chain figures with pool addresses and token symbols.
- If a tool returns apr_pct or reward_per_staked_token_per_year, describe it as a token-denominated
  rate at the current stake. It changes when stake changes. It is not a promised return.
  If the tool says a percentage is not computable, say so.
- The POLYDASH token has no price feed in this agent; never invent prices or fiat values.
- Never promise returns, never give financial advice, never tell users to buy, sell or stake.
- Never name or compare other launchpads or tokens.
- You are read-only: you cannot and must not sign or send transactions.
Be concise, factual and structured."""


def build_agent():
    from swarms import Agent  # imported lazily so --tools/--watch work without swarms
    return Agent(
        agent_name="Poly-Agent",
        agent_description="Polydash staking pool monitor and analyst for Polypad on Robinhood Chain",
        system_prompt=SYSTEM_PROMPT,
        model_name=MODEL_NAME,
        max_loops=1,
        tools=[list_pools, get_pool_stats, get_staking_flows, get_apr, find_opportunities],
    )


def watch(interval: int = 30) -> None:
    """Poll for new stake/withdraw events and print alerts above threshold."""
    last = w3.eth.block_number
    print(f"Watching {len(_discover())} pools from block {last}, threshold {ALERT_THRESHOLD}")
    while True:
        time.sleep(interval)
        try:
            cur = w3.eth.block_number
            if cur <= last:
                continue
            for e in _flows("all", cur - last):
                if e["block"] > last and e["amount"] >= ALERT_THRESHOLD:
                    arrow = "INFLOW " if e["type"] == "stake" else "OUTFLOW"
                    print(f"[ALERT] {arrow} {e['amount']:,.2f} {e['token']} pool {e['pool']} "
                          f"user {e['user']} block {e['block']} tx {e['tx']}", flush=True)
            last = cur
        except Exception as exc:
            print(f"[warn] {exc}", flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--watch":
        watch(int(args[1]) if len(args) > 1 else 30)
    elif args and args[0] == "--tools":
        print("chain id:", w3.eth.chain_id)
        print(list_pools())
        for p in _discover():
            print(get_pool_stats(p))
            print(get_apr(p))
        f = json.loads(get_staking_flows("all", 200000))
        print({k: f[k] for k in ("event_count", "inflow", "outflow", "net")})
        print(find_opportunities())
    else:
        q = " ".join(args) or "List Polypad staking pools with total staked, reward rate and time remaining, and summarize recent inflows and outflows."
        print(build_agent().run(q))
