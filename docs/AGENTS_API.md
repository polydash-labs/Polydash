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

## Routes in this repository

`GET /api/agents/v1`, `POST /validate`, `POST /simulate`, and `GET /marks` are the handlers in this tree. `simulate` returns `unsignedTx` on success, on a revert (HTTP 422), and when the RPC is unreachable (HTTP 503). The caller signs and broadcasts. A body that contains a private key or seed field is rejected with HTTP 400 and the value is not copied into the response. Validate and simulate share an in-memory limit of 20 requests per 10 minutes per IP, per process.

Shared terms constants from the live application are in `polypad/web/lib/agents-api/terms.ts`: terms version `2026-10-30`, chain id 4663, and build limits of 3 per wallet and 10 per API key per 24 hours. Nothing in this tree enforces those build limits, because the key and launch-build routes are not compiled here.

The web `PolydashLaunchABI` fragment now includes the payout-wallet views, `initiatePayoutWalletChange`, `cancelPayoutWalletChange`, `executePayoutWalletChange`, `claimCreatorFees`, and the matching events and errors. Those entries were already in `polypad/abi/PolydashLaunch.json`. `claimCreatorFees` in the TypeScript fragment leaves the uint256 output unnamed, as in the live export. Encoding a call with no arguments is unchanged.

## Live export routes that are not served here

A live application export describes additional HTTP routes. They are not in this repository, and this tree does not advertise them from `GET /api/agents/v1`.

| Method | Path | Why it is not compiled here |
| --- | --- | --- |
| `GET` | `/api/agents/v1/spec` | Imports trade helpers that need the launch snapshot service and the database client. |
| `GET` | `/api/agents/v1/tokens` | Same. `getLaunchesSnapshot` is not in the export or this tree. |
| `GET` | `/api/agents/v1/quote` | Same. Quote reads `quoteBuy` / `quoteSell` through that client. |
| `POST` | `/api/agents/v1/tx/{action}` | Same. Actions are buy, sell, commit, uncommit, withdraw-commitment, claim-refund, and claim-fees. |
| `GET` | `/api/agents/v1/token/{address}` | Also imports sanitizers, holder-protection reads, and `prisma.agentLaunch`. |
| `POST` | `/api/agents/v1/keys` | Imports the database client and sanitizers. |
| `POST` | `/api/agents/v1/metadata` | Imports API-key auth, which needs the database client. Bucket helpers in `lib/s3.ts` and `lib/aws-config.ts` do exist. |
| `POST` | `/api/agents/v1/launch/build` | Imports the database client. `getFactoryAddress` does exist. |
| `POST` | `/api/agents/v1/launch/register` | Imports the database client. |
| `GET` | `/api/agents/v1/launch/{txHash}` | Imports the database client and `getFactoryAddresses`, which this tree does not export. `getFactoryAddress` is singular and reads one env address. |
| `GET` | `/api/agents/v1/launched` | Reads `AgentLaunch` rows through the database client. |
| `GET` | `/api/agents/v1/treasury-tasks` | Imports `lib/treasury-server` and `lib/treasury`. |
| `GET` | `/api/agents/v1/floor-vault-tasks` | Imports `lib/floor-vault-server` and `lib/floorVault`. |
| `GET` | `/api/agents/v1/buyback-tasks` | Imports `lib/buyback-server`. |
| `GET` | `/api/agents/v1/slice-tasks` | Imports `lib/slice-server`. |

The exported trade builder returns unsigned transactions. Only step 1 is simulated with `eth_call`. Later steps, such as sell after approve, are marked unsimulated. If step 1 reverts, the HTTP status is 422 and the unsigned transactions are still in the body. If the RPC cannot be reached, the status is 503 and no transaction list is returned for that failure. Buys and sells on a graduated token or outside the trading phase return 409. A sell whose `from` balance is below `amount` returns 409. Key material in the JSON is rejected with HTTP 400. Quote and tx routes share an in-memory limit of 60 requests per minute per IP. None of that behavior is executed by this repository.

Equivalents that do exist here, and are not enough to stand in for the missing modules: `lib/chain.ts` (`robinhoodChain`), `lib/token-types.ts` (`LaunchToken`), `lib/contracts/addresses.ts` (`getFactoryAddress`), `lib/s3.ts`, `lib/aws-config.ts`, and the client hook `lib/hooks/use-launches.ts`. That hook reads launches in the browser. It is not `getLaunchLookup` / `getLaunchesSnapshot`, and it is not a server snapshot with the export's timeout and missing-token result. Holder Protections exist as Solidity and as `docs/HOLDER_PROTECTIONS.md`. There is no `getHolderProtections` TypeScript module.

## Database

The export's Prisma schema includes `AgentApiKey`, `AgentTermsAcceptance`, `AgentBuild`, and `AgentLaunch`, plus many unrelated application models. The export has no migrations directory. This web app has no Prisma project and no database client. This change does not add `schema.prisma`, does not add a migration, and does not connect to a database. `package.json` is unchanged except for the test script. Prisma and NextAuth versions in the export were not added to the dependency stack.

## Oak

Oak is installed separately. The install manifest pins `@oakagentkit/addon` 0.3.3. This repository does not include that manifest, an Oak adapter, Oak tool definitions, or wallet configuration. Oak is not connected to Polypad. Oak-side tool listing and end-to-end execution through Oak are untested. Do not treat the public HTTP routes above as an Oak integration.

Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.
