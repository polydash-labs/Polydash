# Polypad launch MCP

A small [MCP](https://modelcontextprotocol.io) server external agents can run to prepare a Polypad launch on Robinhood Chain.

It exposes two tools:

| Tool | What it does |
| --- | --- |
| `polypad_validate_launch` | Checks parameters locally against [`schemas/tools.json`](schemas/tools.json). |
| `polypad_prepare_launch` | Sends those parameters to `POST /api/agents/v1/simulate` and returns the unsigned `createLaunch` transaction. |

The same server also forwards the v2 tools (browse, quote, prepare buy, sell, NFT, fund, and token launch, portfolio, status) to `/api/agents/v2`. Their definitions are generated from the TypeScript registry into [`schemas/tools_v2.json`](schemas/tools_v2.json) with `npm run gen:agent-tools`. The remote equivalent is `https://polypad.family/api/mcp`. See [docs/AGENTS_API_V2.md](../../docs/AGENTS_API_V2.md).

The server does not sign, does not broadcast, and does not accept a private key. The operator signs `unsignedTx` in their own wallet. Set `POLYPAD_API_BASE` when the API is not `https://polypad.family` (no trailing path).

```bash
POLYPAD_API_BASE=https://polypad.family python agents/polypad-mcp/polypad_mcp.py
```

The process speaks MCP `2024-11-05` on stdio with `Content-Length` framing. Tool definitions live in [`schemas/tools.json`](schemas/tools.json). The HTTP API in `polypad/web` is authoritative; this precheck uses the same published bounds, and CI compares the two.

See [docs/AGENTS_API.md](../../docs/AGENTS_API.md).
