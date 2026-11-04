"""Offline checks for PolyCTO routing and Poly Agent rate math."""

import json

import poly_agent
import polycto


def test_route_picks_a_specialist():
    assert polycto.route("scan this contract for a proxy owner") == "security"
    assert polycto.route("who are the top holders") == "token"
    assert polycto.route("draft a launch plan for next week") == "marketing"
    assert polycto.route("write a telegram welcome") == "community"
    assert polycto.route("hello there") == "community"


def test_scam_scorer_flags_seed_phrase_and_ignores_plain_text():
    bad = json.loads(polycto.check_message_for_scam("send me your seed phrase to claim the airdrop"))
    plain = json.loads(polycto.check_message_for_scam("hello, welcome to the group"))
    assert bad["score"] >= 30
    assert bad["suggested_action"] in {"review", "delete + warn"}
    assert plain["score"] == 0
    assert plain["suggested_action"] == "none"


def test_project_context_names_the_chain():
    ctx = json.loads(polycto.project_context())
    assert ctx["chain"] == "Robinhood Chain (4663)"
    assert ctx["launchpad"] == "Polypad by Polydash"
    assert "private" not in json.dumps(ctx).lower()


def test_same_token_rate_is_not_described_as_a_promised_return():
    stats = {
        "pool": "0x0000000000000000000000000000000000000001",
        "name": "example",
        "seconds_remaining": 3600,
        "total_staked": 1000,
        "stake_token": {"address": "0x1", "symbol": "A"},
        "reward_token": {"address": "0x1", "symbol": "A"},
        "reward_rate_per_second": 1,
    }
    out = poly_agent._apr(stats)
    expected = round(1 * poly_agent.SECONDS_PER_YEAR / 1000 * 100, 4)
    assert out["apr_pct"] == expected
    assert "Not a promise" in out["note"]


def test_different_token_rate_stays_token_denominated():
    stats = {
        "pool": "0x0000000000000000000000000000000000000001",
        "name": "example",
        "seconds_remaining": 3600,
        "total_staked": 100,
        "stake_token": {"address": "0x1", "symbol": "STAKE"},
        "reward_token": {"address": "0x2", "symbol": "REWARD"},
        "reward_rate_per_second": 2,
    }
    out = poly_agent._apr(stats)
    assert out["apr_pct"] is None
    assert out["reward_per_staked_token_per_year"] == 2 * poly_agent.SECONDS_PER_YEAR / 100
    assert "token-denominated" in out["note"]


def test_ended_and_empty_pools():
    ended = poly_agent._apr(
        {
            "pool": "0x1",
            "name": "ended",
            "seconds_remaining": 0,
            "total_staked": 10,
            "stake_token": {"address": "0x1", "symbol": "A"},
            "reward_token": {"address": "0x1", "symbol": "A"},
            "reward_rate_per_second": 1,
        }
    )
    empty = poly_agent._apr(
        {
            "pool": "0x1",
            "name": "empty",
            "seconds_remaining": 10,
            "total_staked": 0,
            "stake_token": {"address": "0x1", "symbol": "A"},
            "reward_token": {"address": "0x1", "symbol": "A"},
            "reward_rate_per_second": 1,
        }
    )
    assert ended["apr_pct"] == 0.0
    assert empty["apr_pct"] is None


def test_factory_addresses_match_the_documented_deployments():
    assert poly_agent.FACTORIES["v2"].lower() == "0x904b8f5d95b593b5f4a6dbb116b58e1d5cbe93f0"
    assert poly_agent.FACTORIES["v1"].lower() == "0x0aaea47d2e7303ec5a809062eafa59e7f011d857"
    assert poly_agent.POLYDASH_TOKEN.lower() == "0x319525528f42167ef7fc18b77b889958080568e4"
