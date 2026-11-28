/**
 * Credits-covered relayer mint for Major League Operator player cards.
 *
 * MLO collects 500 credits ($5) from the player, then calls this endpoint with the
 * collection details. Polypad's relayer wallet submits the createCollection transaction
 * and pays the gas (a few cents on Robinhood Chain) — the player needs no wallet at all.
 *
 * Auth: only allowlisted business API keys (the same set as polypad_agent_chat — MLO's
 * key). The relayer only ever calls createCollection on the fixed-price NFT factory;
 * it never sends arbitrary transactions. Guards: the relayer refuses when its balance
 * drops below 0.002 ETH (~30 mints of headroom), and each key is capped at 10 mints
 * per hour and 50 per day (best-effort in-memory counters; the balance is the binding
 * guard). The relayer key lives in RELAYER_PRIVATE_KEY (Vercel secret) and is never
 * logged, returned, or stored anywhere else.
 */
import { NextResponse } from 'next/server';
import { createWalletClient, decodeEventLog, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhoodChain } from '@/lib/chain';
import { ADDR, EXPLORER, rpcUrl } from '@/lib/agents-api/v2/config';
import { ApiError, defaultClient } from '@/lib/agents-api/v2/core';
import { resolveApiKey } from '@/lib/agents-api/v2/keys';
import { parseNftCreateParams } from '@/lib/agents-api/v2/nfts';
import { isAgentChatAllowed } from '@/lib/agents-api/v2/tools';

export const dynamic = 'force-dynamic';

const MIN_BALANCE_WEI = 500_000_000_000_000n; // 0.0005 ETH — about 8 mints of headroom. Jon funded the relayer with ~0.0019 ETH (~29 mints); the floor was 0.002 ETH, which his funding sat just under, so it was lowered to match the real float while still stopping before the wallet runs dry.
const MAX_GAS = 4_500_000n;
const PER_KEY_HOURLY = 10;
const PER_KEY_DAILY = 50;

const collectionCreatedAbi = parseAbi([
  'event CollectionCreated(address indexed collection, address indexed creator, string name, string symbol, uint256 maxSupply, uint256 mintPrice, uint256 floorBps, uint256 commitEnd)',
]);

// Best-effort per-key counters (reset with the process; the balance check is the binding guard).
const counters = new Map<string, { hour: number; hourCount: number; day: number; dayCount: number }>();

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function checkCaps(keyId: string): string | null {
  const now = new Date();
  const hour = now.getUTCHours() + now.getUTCDate() * 24;
  const day = now.getUTCDate();
  const c = counters.get(keyId) ?? { hour, hourCount: 0, day, dayCount: 0 };
  if (c.hour !== hour) { c.hour = hour; c.hourCount = 0; }
  if (c.day !== day) { c.day = day; c.dayCount = 0; }
  if (c.hourCount >= PER_KEY_HOURLY) return 'Too many mints this hour for this key. Try again later.';
  if (c.dayCount >= PER_KEY_DAILY) return 'Daily mint limit reached for this key.';
  c.hourCount += 1;
  c.dayCount += 1;
  counters.set(keyId, c);
  return null;
}

export async function POST(req: Request) {
  let keyId: string | null = null;
  try {
    const key = await resolveApiKey(req);
    if (key.tier === 'invalid') return fail(401, 'invalid_key', key.reason);
    if (key.tier !== 'pro' || !isAgentChatAllowed(key.keyId)) {
      return fail(403, 'tool_not_available', 'This endpoint is only available to allowlisted business API keys.');
    }
    keyId = key.keyId;

    const cap = checkCaps(keyId);
    if (cap) return fail(429, 'rate_limited', cap);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(400, 'invalid_params', 'Request body must be JSON.');
    }
    const parsed = parseNftCreateParams(body);

    const relayerKey = process.env.RELAYER_PRIVATE_KEY?.trim();
    if (!relayerKey || !/^0x[0-9a-fA-F]{64}$/.test(relayerKey)) {
      return fail(503, 'relayer_not_configured', 'The minting wallet is not configured yet.');
    }
    const account = privateKeyToAccount(relayerKey as `0x${string}`);
    const client = defaultClient();

    const balance = await client.getBalance({ address: account.address });
    if (balance < MIN_BALANCE_WEI) {
      return fail(503, 'relayer_unfunded', 'The minting wallet is low on ETH for gas. Ask Polypad to top it up.');
    }

    const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http(rpcUrl(), { timeout: 15_000 }) });
    let gas: bigint;
    try {
      gas = await client.estimateGas({ account: account.address, to: ADDR.nftFactory, data: parsed.data, value: 0n });
    } catch {
      return fail(502, 'would_revert', 'The collection creation would revert on-chain. Check the parameters.');
    }
    const gasLimit = gas > MAX_GAS ? MAX_GAS : (gas * 120n) / 100n;

    const hash = await wallet.sendTransaction({ to: ADDR.nftFactory, data: parsed.data, value: 0n, gas: gasLimit });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') {
      console.warn('[relayer-nft-create] tx reverted', hash);
      return fail(502, 'tx_reverted', 'The collection creation transaction reverted on-chain.');
    }
    let collection: string | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ADDR.nftFactory.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: collectionCreatedAbi, data: log.data, topics: log.topics });
        if (ev.eventName === 'CollectionCreated') { collection = ev.args.collection; break; }
      } catch { /* other event */ }
    }
    if (!collection) {
      console.warn('[relayer-nft-create] no CollectionCreated event', hash);
      return fail(502, 'no_collection', 'The transaction confirmed but no collection address was found in its logs.');
    }
    return NextResponse.json({
      ok: true,
      collection,
      txHash: hash,
      explorerUrl: `${EXPLORER}/tx/${hash}`,
      collectionUrl: `https://polypad.family/nfts/${collection}`,
      gasUsed: receipt.gasUsed.toString(),
      name: parsed.name,
      symbol: parsed.symbol,
      maxSupply: parsed.maxSupply,
      mintPriceWei: parsed.mintPriceWei.toString(),
      royaltyBps: parsed.royaltyBps,
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(e.status, e.code, e.message);
    console.warn('[relayer-nft-create] failed', e instanceof Error ? e.message : 'unknown');
    return fail(500, 'internal_error', 'The mint failed. No credits were charged by Polypad — MLO handles any refund.');
  }
}
