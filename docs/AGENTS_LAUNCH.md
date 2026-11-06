# Launching on Polypad from an agent

Polypad's current factory on Robinhood Chain (chainId 4663) is
[`0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2`](https://robinhoodchain.blockscout.com/address/0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2)
([verified source on Sourcify](https://sourcify.dev/server/v2/contract/4663/0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2)).

`createLaunch` is permissionless. There's no owner check, allowlist, backend signature or `tx.origin` check, so any wallet or contract,
including a third-party AI agent, can call it directly.

## Non-custodial

The agent signs and sends the transaction from its own wallet. Polypad never holds, asks for or receives private keys.
The calling address becomes the launch `creator`. Creator fees go to `creatorPayoutWallet`, which defaults to the caller.

## HTTP API

Operators who want Polypad to check parameters and return an unsigned transaction use the agent API instead of building the calldata themselves. `POST /api/agents/v1/simulate` runs `eth_call` and returns `unsignedTx`. The operator still signs. The reference is [AGENTS_API.md](AGENTS_API.md). An MCP server with the same tools is in [`agents/polypad-mcp`](../agents/polypad-mcp).

By default the API stores `https://polypad.family/docs#agent-launched` in `socialLinks`. The website shows an Agent-launched badge when that exact URL is on the token. The factory bytecode is unchanged. Omit it with `agentMark: false`.

The section below is the same factory call the API encodes.

## The call

```solidity
function createLaunch(LaunchParams calldata p) external payable returns (address launch, address token);

struct LaunchParams {
    string name;                 // required
    string symbol;               // required
    string imageUri;             // https or ipfs URL of the logo
    string description;
    string[] socialLinks;        // at most 10
    uint256 creatorFeeBps;       // 0..500 (0%..5%), fixed for the life of the token
    address creatorPayoutWallet; // 0 => msg.sender
    uint256 devBuyEth;           // optional first buy; msg.value must equal this
    uint256 totalSupply;         // 0 => 1,000,000,000 tokens (range 1M..1T, 18 decimals)
    uint256 virtualEthReserve;   // 0 => 1.5 ETH (range 0.01..1000 ETH)
    uint256 launchDelay;         // 0 => live now; up to 30 days of commitment window
}
```

- There's no launch fee. `msg.value` is only the optional dev buy.
- Trades pay a 0.2% platform fee plus the creator fee.
- Anti-sniper settings are applied automatically from the factory: a higher fee and a per-wallet cap for the first few minutes and blocks.
- It reverts with `InvalidParams` if any limit above is broken.
- The `LaunchCreated(launch, token, creator, ...)` event gives you the new addresses.

## Example (viem)

```ts
import { createWalletClient, http, parseEther, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import factoryAbi from '../polypad/abi/PolydashFactory.json';

const robinhood = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } } });

// The key stays in the agent operator's own environment. It is never sent to Polypad.
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: robinhood, transport: http() });

const devBuy = parseEther('0');
const hash = await wallet.writeContract({
  address: '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2',
  abi: factoryAbi,
  functionName: 'createLaunch',
  args: [{ name: 'Example', symbol: 'EXM', imageUri: 'https://example.com/logo.png', description: 'Example token',
           socialLinks: [], creatorFeeBps: 100n, creatorPayoutWallet: '0x0000000000000000000000000000000000000000',
           devBuyEth: devBuy, totalSupply: 0n, virtualEthReserve: 0n, launchDelay: 0n }],
  value: devBuy,
});
```

## Showing up on polypad.family

The site reads launches from the factory's `allLaunches()`, so a direct on-chain launch is listed with no extra step.
The website's logo upload is the only off-chain step. An agent should pass its own reachable image URL in `imageUri`.

## Operator responsibility

The agent's operator is responsible for what the agent launches: no impersonation, no trademark abuse, no misleading claims.

Not financial advice. Scans are not audits.
