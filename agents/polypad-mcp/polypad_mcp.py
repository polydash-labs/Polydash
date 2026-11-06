"""MCP server for Polypad agent launches.

Speaks MCP JSON-RPC 2.0 over stdio (protocol 2024-11-05, Content-Length framing).
`polypad_prepare_launch` calls the Polypad HTTP API and returns an unsigned
transaction. This process never asks for or forwards a private key.

Run: POLYPAD_API_BASE=https://polypad.family python agents/polypad-mcp/polypad_mcp.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO, Callable

PROTOCOL = "2024-11-05"
SERVER_NAME = "polypad-launch"
SERVER_VERSION = "1.2.0"
SCHEMA = json.loads((Path(__file__).resolve().parent / "schemas" / "tools.json").read_text())
LIMITS = SCHEMA["limits"]
AGENT_MARK = SCHEMA["agentMark"]
TOOLS = SCHEMA["tools"]
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
GITHUB = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$")
UINT = re.compile(r"^[0-9]+$")

HttpPost = Callable[[str, dict[str, Any], dict[str, str]], tuple[int, dict[str, Any]]]


def _key_field(name: str) -> bool:
    normalized = re.sub(r"[^a-z]", "", name.lower())
    return "privatekey" in normalized or normalized in {"mnemonic", "seed"} or "seedphrase" in normalized


def contains_key_material(value: Any) -> bool:
    if isinstance(value, dict):
        return any(_key_field(str(key)) or contains_key_material(child) for key, child in value.items())
    if isinstance(value, list):
        return any(contains_key_material(item) for item in value)
    return False


def normalize_repository(value: str) -> str | None:
    text = value.strip()
    if text.endswith(".git"):
        text = text[:-4]
    if text.endswith("/"):
        text = text[:-1]
    match = GITHUB.fullmatch(text)
    if not match:
        return None
    owner, repo = match.group(1), match.group(2)
    if owner in {".", ".."} or repo in {".", ".."}:
        return None
    return f"https://github.com/{owner}/{repo}"


def _uint(value: Any, field: str, errors: dict[str, str], default: int | None = 0) -> int | None:
    if value is None or value == "":
        return default
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        errors[field] = "Use a non-negative base-10 integer string."
        return None
    text = str(value)
    if not UINT.fullmatch(text):
        errors[field] = "Use a non-negative base-10 integer string."
        return None
    return int(text)


def validate_arguments(args: Any, *, require_from: bool) -> tuple[dict[str, Any] | None, dict[str, str]]:
    """Local precheck. Numeric bounds come from schemas/tools.json, which CI compares to the TypeScript API."""
    errors: dict[str, str] = {}
    if contains_key_material(args):
        errors["body"] = "This tool does not accept private keys or seed phrases."
        return None, errors
    if not isinstance(args, dict):
        return None, {"body": "Expected an object."}

    name = args.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.strip().encode()) > LIMITS["maxNameBytes"]:
        errors["name"] = f"Required. At most {LIMITS['maxNameBytes']} UTF-8 bytes."
    symbol = args.get("symbol")
    if not isinstance(symbol, str) or not symbol.strip() or len(symbol.strip().encode()) > LIMITS["maxSymbolBytes"]:
        errors["symbol"] = f"Required. At most {LIMITS['maxSymbolBytes']} UTF-8 bytes."

    image = args.get("imageUri", "")
    if image is None:
        image = ""
    image_bad = not isinstance(image, str) or (
        bool(image) and (len(image) > LIMITS["maxImageChars"] or any(ch.isspace() for ch in image) or not (image.startswith("https://") or image.startswith("ipfs://")))
    )
    if image_bad:
        errors["imageUri"] = "Use an https:// or ipfs:// URL, or omit it."

    description = args.get("description", "")
    if description is None:
        description = ""
    if not isinstance(description, str) or len(description) > LIMITS["maxDescriptionChars"]:
        errors["description"] = f"At most {LIMITS['maxDescriptionChars']} characters."

    links: list[str] = []
    raw_links = args.get("socialLinks", [])
    if raw_links is None:
        raw_links = []
    if not isinstance(raw_links, list):
        errors["socialLinks"] = "Expected an array of strings."
    else:
        for entry in raw_links:
            if not isinstance(entry, str):
                errors["socialLinks"] = "Expected an array of strings."
                break
            link = entry.strip()
            if not link:
                continue
            allowed = link.startswith("https://") or link.startswith("ipfs://") or link == AGENT_MARK
            if not allowed or len(link) > LIMITS["maxLinkChars"] or any(ch.isspace() for ch in link):
                errors["socialLinks"] = "Social links must be https://, ipfs://, or the agent mark."
                break
            if link in links:
                errors["socialLinks"] = "Duplicate social links are not accepted."
                break
            links.append(link)

    repository = args.get("repository")
    if repository not in (None, ""):
        if not isinstance(repository, str) or normalize_repository(repository) is None:
            errors["repository"] = "Expected https://github.com/owner/repo with no extra path."
        else:
            repository = normalize_repository(repository)
            if repository not in links:
                links.append(repository)
    else:
        repository = None

    agent_mark = args.get("agentMark", True)
    if not isinstance(agent_mark, bool):
        errors["agentMark"] = "Expected a boolean."
        agent_mark = True
    if AGENT_MARK not in links and agent_mark:
        links.append(AGENT_MARK)
    if not agent_mark:
        links = [link for link in links if link != AGENT_MARK]
    if len(links) > LIMITS["maxSocialLinks"]:
        errors["socialLinks"] = f"At most {LIMITS['maxSocialLinks']} social links, including the agent mark and repository."

    fee = args.get("creatorFeeBps", None)
    if fee is None or fee == "":
        errors["creatorFeeBps"] = f"Required. An integer from 0 to {LIMITS['maxCreatorFeeBps']}."
    elif isinstance(fee, bool) or not isinstance(fee, int) or fee < 0 or fee > LIMITS["maxCreatorFeeBps"]:
        errors["creatorFeeBps"] = f"Must be an integer from 0 to {LIMITS['maxCreatorFeeBps']}."

    dev_buy = _uint(args.get("devBuyEth", "0"), "devBuyEth", errors)
    supply = _uint(args.get("totalSupply", "0"), "totalSupply", errors)
    virtual = _uint(args.get("virtualEthReserve", "0"), "virtualEthReserve", errors)
    delay = _uint(args.get("launchDelay", "0"), "launchDelay", errors)
    if supply not in (None, 0) and not (int(LIMITS["minTotalSupplyWei"]) <= supply <= int(LIMITS["maxTotalSupplyWei"])):
        errors["totalSupply"] = "Use 0 for the factory default, or a supply inside the published range."
    if virtual not in (None, 0) and not (int(LIMITS["minVirtualEthWei"]) <= virtual <= int(LIMITS["maxVirtualEthWei"])):
        errors["virtualEthReserve"] = "Use 0 for the factory default, or a value from 0.01 ETH to 1,000 ETH, in wei."
    if delay is not None and delay > LIMITS["maxLaunchDelaySeconds"]:
        errors["launchDelay"] = "Must be from 0 to 2592000 seconds."

    signer = args.get("from")
    if require_from and (not isinstance(signer, str) or not ADDRESS.fullmatch(signer) or int(signer, 16) == 0):
        errors["from"] = "The address that will sign is required. Do not send a private key."
    elif signer not in (None, "") and (not isinstance(signer, str) or not ADDRESS.fullmatch(signer)):
        errors["from"] = "Expected a 20-byte hex address."

    payout = args.get("creatorPayoutWallet", "")
    if payout not in (None, "") and (not isinstance(payout, str) or not ADDRESS.fullmatch(payout)):
        errors["creatorPayoutWallet"] = "Expected a 20-byte hex address."

    if errors or fee is None or dev_buy is None or supply is None or virtual is None or delay is None:
        return None, errors

    body: dict[str, Any] = {
        "name": name.strip(),
        "symbol": symbol.strip(),
        "imageUri": image.strip(),
        "description": description.strip(),
        "socialLinks": links,
        "creatorFeeBps": fee,
        "devBuyEth": str(dev_buy),
        "totalSupply": str(supply),
        "virtualEthReserve": str(virtual),
        "launchDelay": str(delay),
        "agentMark": AGENT_MARK in links,
    }
    if repository:
        body["repository"] = repository
    if isinstance(signer, str) and signer:
        body["from"] = signer
    if isinstance(payout, str) and payout:
        body["creatorPayoutWallet"] = payout
    return body, {}


def default_post(url: str, body: dict[str, Any], headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
    data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"ok": False, "error": {"code": "HTTP_ERROR", "message": raw[:300]}}
        return exc.code, parsed


def _result(msg_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def _error(msg_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def _tool_text(payload: dict[str, Any], is_error: bool) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload)}], "isError": is_error}


def handle_rpc(message: dict[str, Any], *, post: HttpPost, api_base: str) -> dict[str, Any] | None:
    method = message.get("method")
    msg_id = message.get("id")
    if not method:
        return _error(msg_id, -32600, "Invalid request")
    if msg_id is None:
        return None

    if method == "initialize":
        return _result(msg_id, {
            "protocolVersion": PROTOCOL,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })
    if method == "ping":
        return _result(msg_id, {})
    if method == "tools/list":
        return _result(msg_id, {"tools": TOOLS})
    if method != "tools/call":
        return _error(msg_id, -32601, f"Unknown method: {method}")

    params = message.get("params") or {}
    name = params.get("name")
    arguments = params.get("arguments") or {}
    if name == "polypad_validate_launch":
        body, errors = validate_arguments(arguments, require_from=False)
        if errors:
            return _result(msg_id, _tool_text({"ok": False, "error": {"code": "INVALID_PARAMS", "fields": errors}}, True))
        return _result(msg_id, _tool_text({"ok": True, "params": body, "agentMark": AGENT_MARK, "custody": "non-custodial"}, False))
    if name == "polypad_prepare_launch":
        body, errors = validate_arguments(arguments, require_from=True)
        if errors:
            return _result(msg_id, _tool_text({"ok": False, "error": {"code": "INVALID_PARAMS", "fields": errors}}, True))
        status, payload = post(
            f"{api_base.rstrip('/')}/api/agents/v1/simulate",
            body or {},
            {"content-type": "application/json", "x-polypad-client": "polypad-mcp"},
        )
        failed = status >= 400 or payload.get("ok") is not True
        return _result(msg_id, _tool_text(payload, failed))
    return _result(msg_id, _tool_text({"ok": False, "error": {"code": "UNKNOWN_TOOL", "message": str(name)}}, True))


def read_message(stream: BinaryIO) -> dict[str, Any] | None:
    headers: dict[str, str] = {}
    while True:
        line = stream.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        decoded = line.decode("utf-8")
        if ":" not in decoded:
            continue
        key, value = decoded.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    if length <= 0:
        return None
    raw = stream.read(length)
    if len(raw) < length:
        return None
    return json.loads(raw.decode("utf-8"))


def write_message(stream: BinaryIO, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    stream.write(f"Content-Length: {len(raw)}\r\n\r\n".encode() + raw)
    stream.flush()


def serve(stdin: BinaryIO, stdout: BinaryIO, *, post: HttpPost = default_post, api_base: str | None = None) -> None:
    base = (api_base or os.environ.get("POLYPAD_API_BASE", "https://polypad.family")).rstrip("/")
    while True:
        message = read_message(stdin)
        if message is None:
            return
        response = handle_rpc(message, post=post, api_base=base)
        if response is not None:
            write_message(stdout, response)


def main() -> None:
    serve(sys.stdin.buffer, sys.stdout.buffer)


if __name__ == "__main__":
    main()
