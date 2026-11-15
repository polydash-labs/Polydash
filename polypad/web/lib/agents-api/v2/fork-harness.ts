/**
 * Test harness: starts an anvil fork of Robinhood Chain (chain id 4663) from FORK_RPC, and gives tests
 * helpers to fund wallets and execute prepared transactions the way a wallet would. Test-only code.
 * FORK_RPC is read from the environment and is never logged.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChain } from '../../chain';
import { makeCtx, type Ctx } from './core';

export type Fork = { url: string; ctx: Ctx; client: PublicClient; rpc: (method: string, params?: unknown[]) => Promise<any>; stop: () => void };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

export function anvilBin(): string {
  return process.env.ANVIL_BIN || 'anvil';
}

export async function startFork(): Promise<Fork> {
  const upstream = process.env.FORK_RPC;
  if (!upstream) throw new Error('FORK_RPC is not set');
  const port = await freePort();
  const child: ChildProcess = spawn(anvilBin(), ['--fork-url', upstream, '--chain-id', '4663', '--port', String(port), '--silent', '--no-rate-limit', '--retries', '5', '--fork-retry-backoff', '500'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const rpc = async (method: string, params: unknown[] = []) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  };
  for (let i = 0; i < 60; i += 1) {
    try { await rpc('eth_blockNumber'); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
    if (i === 59) { child.kill(); throw new Error('anvil did not start'); }
  }
  const client = createPublicClient({ chain: robinhoodChain, transport: http(url), batch: { multicall: true } }) as PublicClient;
  const ctx = makeCtx(client, { limits: unlimited() });
  return { url, ctx, client, rpc, stop: () => child.kill() };
}

function unlimited() {
  const open = { allow: () => true };
  return { read: open, prepare: open, perWalletPrepare: open, intent: open };
}

export async function fund(f: Fork, addr: string, eth: number) {
  await f.rpc('anvil_setBalance', [addr, '0x' + (BigInt(Math.round(eth * 1e6)) * 10n ** 12n).toString(16)]);
}

export type PreparedTx = { to: string; data: string; value: string; gas?: string; from: string; chainId: number };

/** Execute one prepared transaction like a wallet would. Returns the hash and receipt status. */
export async function sendTx(f: Fork, tx: PreparedTx) {
  await f.rpc('anvil_impersonateAccount', [tx.from]);
  const hash = (await f.rpc('eth_sendTransaction', [{ from: tx.from, to: tx.to, data: tx.data, value: '0x' + BigInt(tx.value).toString(16), gas: '0x' + (BigInt(tx.gas ?? '1500000') * 2n).toString(16) }])) as `0x${string}`;
  const receipt = await f.client.waitForTransactionReceipt({ hash, timeout: 30_000, pollingInterval: 200 });
  return { hash, receipt, ok: receipt.status === 'success' };
}

/** Execute every step of a prepared response in order. Returns the hash of the main (last) step. */
export async function runAll(f: Fork, prepared: { transactions: PreparedTx[] }) {
  let last: Awaited<ReturnType<typeof sendTx>> | undefined;
  for (const tx of prepared.transactions) {
    last = await sendTx(f, tx);
    if (!last.ok) throw new Error(`step to ${tx.to} reverted`);
  }
  return last!;
}
