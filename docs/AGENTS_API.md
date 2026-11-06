# Agent launch API

Polypad exposes an HTTP API so an external agent can prepare a `createLaunch` transaction without Polypad taking custody of a key.

The API validates parameters, runs `eth_call` against the factory on Robinhood Chain, and returns the unsigned transaction. The caller signs that transaction with their own wallet and broadcasts it. Polypad does not see the signature and does not send the transaction.

Discovery, including the factory address and the rate limit, is `GET /api/agents/v1` on the Polypad site. The in-site writeup is [`/docs#agent-launched`](https://polypad.family/docs#agent-launched).

Direct factory calls, for an operator who builds the transaction themselves, stay documented in [AGENTS_LAUNCH.md](AGENTS_LAUNCH.md).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/agents/v1` | Chain, factory, limits, and endpoint list. |
| `POST` | `/api/agents/v1/validate` | Check parameters. No RPC call. |
| `POST` | `/api/agents/v1/simulate` | Check parameters, `eth_call` `createLaunch`, return `unsignedTx`. |
| `GET` | `/api/agents/v1/marks?from=0x…` | Per-process log of successful simulations for that signer. |

`POST` bodies are JSON, at most 16 KiB. Responses set `access-control-allow-origin: *` so a server or a browser agent can call them. `OPTIONS` answers a CORS preflight.

The optional header `X-Polypad-Client` may carry a client name of 1–64 characters (`A–Z`, `a–z`, `0–9`, `.`, `_`, `:`, `-`). It is stored on the process log only.

## Custody

Send the signer as `from`, a 20-byte hex address. Do not send a private key, a seed phrase, or a field whose name is one of those. If the JSON object contains such a field at any depth, the API returns `400 KEY_MATERIAL_REJECTED` and does not echo the value.

`unsignedTx` contains `from`, `to` (the factory), `data`, `value` (wei, decimal string), `valueHex`, and `chainId` (4663 on Robinhood Chain). The `value` must be sent with the transaction and must equal `devBuyEth`.

## Parameters

Same fields as [LAUNCH_FLOW.md](LAUNCH_FLOW.md). Amounts are base-10 integer strings of wei, not ETH decimals and not floating point. `creatorFeeBps` is required. `agentMark` defaults to `true`.

`repository`, when set, must be `https://github.com/owner/repo`. See [BUILD_ACTIVITY.md](BUILD_ACTIVITY.md).

### Agent mark

With `agentMark: true` (the default), the API appends this exact URL to `socialLinks` if it is not already present:

```text
https://polypad.family/docs#agent-launched
```

The factory stores that list on the token. The website reads it and shows an **Agent-launched** badge. The deployed factory is unchanged; there is no new on-chain event. Set `agentMark` to `false` to omit the URL.

The mark uses one of the 10 social-link slots. If the list is already full, validation fails and names `socialLinks` so the caller can drop a link or include the mark themselves.

A person using the website can get the same mark by opening `/create?agent=1`. That query parameter is not stored by itself. The wizard writes the mark into `socialLinks` before the wallet signs.

`GET /api/agents/v1/marks` lists recent successful simulations in that server process. It is an operator log. It is not the badge, and it is empty on a different instance.

## Responses

Success from `simulate`:

```json
{
  "ok": true,
  "chainId": 4663,
  "factory": "0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2",
  "agentLaunched": true,
  "unsignedTx": { "from": "0x…", "to": "0x…", "data": "0x…", "value": "0", "valueHex": "0x0", "chainId": 4663 },
  "simulation": { "success": true, "launch": "0x…", "token": "0x…", "gas": "1200000" },
  "custody": "non-custodial"
}
```

`launch` and `token` are the addresses `eth_call` returned. They match a later broadcast only if the same `from` account sends this calldata at the same nonce.

| HTTP | `error.code` | When |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Body is not a JSON object. |
| 400 | `INVALID_PARAMS` | A field breaks a factory or API limit. `error.fields` names them. |
| 400 | `KEY_MATERIAL_REJECTED` | A private key or seed field was present. |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 16 KiB. |
| 422 | `SIMULATION_REVERTED` | `eth_call` reverted. `unsignedTx` is still included. `error.revert` is the error name when the API recognises it (`InvalidParams`, `HookNotSet`, and the other factory errors in the local ABI fragment). |
| 429 | `RATE_LIMITED` | More than 20 validate, simulate, or marks requests from one IP in 10 minutes. `Retry-After` is 600. The window is in memory, per process. A shared store is required for a limit across instances. Validate and simulate share one bucket. |
| 503 | `RPC_UNAVAILABLE` | The Robinhood Chain RPC did not answer. `unsignedTx` is still included so the caller can simulate elsewhere. |

## Rate of calls

Twenty requests per ten minutes per client IP is the published limit. It exists so a broken agent cannot hammer `eth_call` against the public RPC. It is not an authentication scheme.

## MCP

[`agents/polypad-mcp`](../agents/polypad-mcp) is a stdio MCP server with `polypad_validate_launch` and `polypad_prepare_launch`. The prepare tool POSTs to `/api/agents/v1/simulate` and returns that JSON, including `unsignedTx`. Tool schemas are in [`agents/polypad-mcp/schemas/tools.json`](../agents/polypad-mcp/schemas/tools.json).

```bash
POLYPAD_API_BASE=https://polypad.family python agents/polypad-mcp/polypad_mcp.py
```

## Example

```bash
curl -s https://polypad.family/api/agents/v1/simulate \
  -H 'content-type: application/json' \
  -H 'x-polypad-client: example' \
  -d '{
    "from": "0x1111111111111111111111111111111111111111",
    "name": "Example",
    "symbol": "EXM",
    "imageUri": "https://example.com/logo.png",
    "description": "Example token",
    "socialLinks": ["https://example.com"],
    "repository": "https://github.com/polydash-labs/Polydash",
    "creatorFeeBps": 100,
    "devBuyEth": "0",
    "totalSupply": "0",
    "virtualEthReserve": "0",
    "launchDelay": "0"
  }'
```

Sign `unsignedTx.data` to the factory from `from`. The operator is responsible for what the agent launches.

Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.
