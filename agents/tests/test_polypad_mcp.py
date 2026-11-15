"""Offline tests for the Polypad launch MCP server."""

import io
import json
import re
from pathlib import Path

import polypad_mcp

ROOT = Path(__file__).resolve().parents[2]
SIGNER = "0x1111111111111111111111111111111111111111"


def _const(source: str, name: str) -> str:
    match = re.search(rf"export const {name} = ([^;]+);", source)
    assert match, name
    return match.group(1).strip()


def _launch(**overrides):
    body = {
        "from": SIGNER,
        "name": "Example",
        "symbol": "EXM",
        "imageUri": "https://example.com/logo.png",
        "description": "Example token",
        "socialLinks": ["https://example.com"],
        "creatorFeeBps": 100,
        "devBuyEth": "0",
        "totalSupply": "0",
        "virtualEthReserve": "0",
        "launchDelay": "0",
    }
    body.update(overrides)
    return body


def test_schema_bounds_match_the_typescript_api():
    launch_src = (ROOT / "polypad/web/lib/agent-launch.ts").read_text()
    mark_src = (ROOT / "polypad/web/lib/agent-mark.ts").read_text()
    limits = polypad_mcp.LIMITS
    assert _const(launch_src, "MAX_CREATOR_FEE_BPS") == str(limits["maxCreatorFeeBps"])
    assert _const(launch_src, "MAX_NAME_BYTES") == str(limits["maxNameBytes"])
    assert _const(launch_src, "MAX_SYMBOL_BYTES") == str(limits["maxSymbolBytes"])
    assert _const(launch_src, "MAX_DESCRIPTION_CHARS") == str(limits["maxDescriptionChars"])
    assert _const(launch_src, "MAX_IMAGE_CHARS") == str(limits["maxImageChars"])
    assert _const(launch_src, "MAX_LINK_CHARS") == str(limits["maxLinkChars"])
    assert _const(launch_src, "MAX_LAUNCH_DELAY_SECONDS") == str(limits["maxLaunchDelaySeconds"])
    assert _const(launch_src, "AGENT_RATE_LIMIT") == str(limits["rateLimit"])
    assert _const(launch_src, "AGENT_RATE_WINDOW_MS") == str(limits["rateWindowSeconds"] * 1000)
    assert _const(mark_src, "MAX_SOCIAL_LINKS") == str(limits["maxSocialLinks"])
    assert _const(mark_src, "AGENT_LAUNCH_MARK") == repr(polypad_mcp.AGENT_MARK)
    assert "1_000_000n * 10n ** 18n" in launch_src
    assert "1_000_000_000_000n * 10n ** 18n" in launch_src
    assert int(limits["minTotalSupplyWei"]) == 1_000_000 * 10**18
    assert int(limits["maxTotalSupplyWei"]) == 1_000_000_000_000 * 10**18
    assert int(limits["minVirtualEthWei"]) == 10**16
    assert int(limits["maxVirtualEthWei"]) == 1000 * 10**18
    names = [tool["name"] for tool in polypad_mcp.TOOLS]
    assert names == ["polypad_validate_launch", "polypad_prepare_launch"]


def test_validate_tool_rejects_a_fee_above_the_factory_cap_without_http():
    calls = []

    def post(url, body, headers):
        calls.append(url)
        return 200, {"ok": True}

    response = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "polypad_validate_launch",
            "arguments": _launch(creatorFeeBps=501),
        }},
        post=post,
        api_base="https://polypad.family",
    )
    assert calls == []
    assert response["result"]["isError"] is True
    payload = json.loads(response["result"]["content"][0]["text"])
    assert "creatorFeeBps" in payload["error"]["fields"]


def test_prepare_posts_an_unsigned_request_and_refuses_key_material():
    seen = {}

    def post(url, body, headers):
        seen["url"] = url
        seen["body"] = body
        seen["headers"] = headers
        return 200, {"ok": True, "unsignedTx": {"to": "0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2", "value": "0"}}

    response = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
            "name": "polypad_prepare_launch",
            "arguments": _launch(repository="https://github.com/polydash-labs/Polydash.git"),
        }},
        post=post,
        api_base="https://polypad.family/",
    )
    assert seen["url"] == "https://polypad.family/api/agents/v1/simulate"
    assert seen["headers"]["x-polypad-client"] == "polypad-mcp"
    assert polypad_mcp.AGENT_MARK in seen["body"]["socialLinks"]
    assert seen["body"]["repository"] == "https://github.com/polydash-labs/Polydash"
    assert response["result"]["isError"] is False

    missing = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "polypad_prepare_launch",
            "arguments": _launch(**{"from": None}),
        }},
        post=post,
        api_base="https://polypad.family",
    )
    assert missing["result"]["isError"] is True

    key_name = "private" + "Key"
    rejected = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
            "name": "polypad_validate_launch",
            "arguments": {**_launch(), key_name: "not-sent"},
        }},
        post=post,
        api_base="https://polypad.family",
    )
    text = rejected["result"]["content"][0]["text"]
    assert "not-sent" not in text
    assert rejected["result"]["isError"] is True


def test_stdio_framing_lists_tools():
    request = {"jsonrpc": "2.0", "id": 7, "method": "initialize", "params": {}}
    raw = json.dumps(request).encode()
    stdin = io.BytesIO(f"Content-Length: {len(raw)}\r\n\r\n".encode() + raw)
    stdout = io.BytesIO()
    polypad_mcp.serve(stdin, stdout, post=lambda url, body, headers: (200, {}), api_base="https://polypad.family")
    framed = stdout.getvalue()
    assert framed.startswith(b"Content-Length:")
    body = framed.split(b"\r\n\r\n", 1)[1]
    payload = json.loads(body.decode())
    assert payload["result"]["protocolVersion"] == "2024-11-05"
    assert payload["result"]["serverInfo"]["name"] == "polypad-launch"
    listed = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 8, "method": "tools/list"},
        post=lambda url, body, headers: (200, {}),
        api_base="https://polypad.family",
    )
    assert len(listed["result"]["tools"]) == 2 + len(polypad_mcp.V2_TOOLS)


def test_v2_tool_names_match_the_typescript_registry():
    source = (ROOT / "polypad/web/lib/agents-api/v2/tools.ts").read_text()
    ts_names = re.findall(r"^    name: '(polypad_[a-z_]+)',", source, flags=re.M)
    assert ts_names, "no tools found in tools.ts"
    assert [t["name"] for t in polypad_mcp.V2_TOOLS] == ts_names
    assert all("x-path" not in t for t in polypad_mcp.V2_TOOLS)
    for tool in polypad_mcp.SCHEMA_V2["tools"]:
        assert tool["x-method"] in {"GET", "POST"}
        assert tool["inputSchema"]["type"] == "object"


def test_v2_read_tool_forwards_a_get_with_query_and_client_header():
    seen = {}

    def fake_get(url, headers):
        seen["url"], seen["headers"] = url, headers
        return 200, {"ok": True, "tokens": []}

    reply = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "polypad_list_tokens", "arguments": {"sort": "new", "agentLaunched": True}}},
        post=lambda *a: (500, {}),
        get=fake_get,
        api_base="https://polypad.family",
    )
    assert seen["url"] == "https://polypad.family/api/agents/v2/tokens?sort=new&agentLaunched=true"
    assert seen["headers"]["x-polypad-client"] == "polypad-mcp"
    assert reply["result"]["isError"] is False


def test_v2_prepare_tool_forwards_a_post_and_refuses_key_material():
    seen = {}

    def fake_post(url, body, headers):
        seen["url"], seen["body"] = url, body
        return 200, {"ok": True, "signing": {"url": "https://polypad.family/sign?v=1"}}

    args = {"token": "POLYCAT", "from": SIGNER, "amountEth": "0.01"}
    ok = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "polypad_prepare_buy", "arguments": args}},
        post=fake_post,
        get=lambda *a: (500, {}),
        api_base="https://polypad.family/",
    )
    assert seen["url"] == "https://polypad.family/api/agents/v2/prepare/buy"
    assert seen["body"] == args
    assert ok["result"]["isError"] is False
    seen.clear()
    bad = polypad_mcp.handle_rpc(
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "polypad_prepare_buy", "arguments": {**args, "privateKey": "x"}}},
        post=fake_post,
        get=lambda *a: (500, {}),
        api_base="https://polypad.family",
    )
    assert seen == {}
    assert bad["result"]["isError"] is True
    assert "key_material_rejected" in bad["result"]["content"][0]["text"]
