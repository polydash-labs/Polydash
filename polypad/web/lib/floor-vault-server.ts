// Server-side token floor vault reads (public RPC, read-only). 30 s in-memory cache per collection.
import { createPublicClient, http, parseEventLogs, type Abi, type Address, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { TOKEN_FLOOR_COLLECTION_ABI, TOKEN_FLOOR_FACTORY_ABI } from '@/lib/floorVaultArtifacts';
import { floorFactory, floorStep, isAddr } from '@/lib/floorVault';

const client = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 10_000 }) }) as PublicClient;
const FACTORY_ABI = TOKEN_FLOOR_FACTORY_ABI as unknown as Abi;
const COLLECTION_ABI = TOKEN_FLOOR_COLLECTION_ABI as unknown as Abi;
const START_BLOCK = BigInt(85_000_000);
const LOG_CHUNK = BigInt(9_000_000);
const TTL = 30_000;
const HISTORY_EVENTS = ['TokenBought', 'Redeemed', 'PriceObserved', 'TokenShareEnded'] as const;
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);
const s = (v: any) => (typeof v === 'bigint' ? v.toString() : v == null ? '0' : String(v));
const big = (x: any) => (typeof x === 'bigint' ? x : BigInt(0));
const num = (x: any) => (typeof x === 'bigint' || typeof x === 'number' ? Number(x) : 0);

export type FloorHistoryItem = { type: string; blockNumber: string; txHash: string; logIndex: number } & Record<string, string | number>;
export type FloorVaultData = {
  live: true; collection: Address; token: Address; launch: Address; graduated: boolean; ethFloor: string; pendingEth: string; tokenReserve: string;
  perNft: { eth: string; token: string }; tokenShareBps: number; maxSlippageBps: number; maxBuyEth: string; obsTime: number; lastBuyTime: number;
  nextStep: 'record_price' | 'buy' | 'wait' | 'none'; nextStepAt: number | null; tokenShareActive: boolean; history: FloorHistoryItem[]; updatedAt: string;
};

const cache = new Map<string, { at: number; data: FloorVaultData | null }>();

export class FloorInputError extends Error {}

const FIELDS = ['token', 'launch', 'graduated', 'ethFloor', 'pendingEth', 'tokenReserve', 'redeemValuePerNft', 'tokenShareBps', 'maxSlippageBps', 'maxBuyEth', 'obsTime', 'lastBuyTime', 'tokenShareActive'] as const;

async function readState(c: Address) {
  const res = await client.multicall({ allowFailure: true, contracts: FIELDS.map((functionName) => ({ address: c, abi: COLLECTION_ABI, functionName })) as any });
  const d: Record<string, any> = {};
  FIELDS.forEach((f, i) => { d[f] = ok(res[i]); });
  const per = (d.redeemValuePerNft ?? []) as readonly bigint[];
  const state = {
    token: d.token as Address, launch: d.launch as Address, graduated: !!d.graduated, ethFloor: big(d.ethFloor), pendingEth: big(d.pendingEth),
    tokenReserve: big(d.tokenReserve), perEth: big(per[0]), perToken: big(per[1]), tokenShareBps: num(d.tokenShareBps), maxSlippageBps: num(d.maxSlippageBps),
    maxBuyEth: big(d.maxBuyEth), obsTime: num(d.obsTime), lastBuyTime: num(d.lastBuyTime), tokenShareActive: !!d.tokenShareActive,
  };
  const now = Math.floor(Date.now() / 1000);
  const step = floorStep({ graduated: state.graduated, tokenShareActive: state.tokenShareActive, pendingEth: state.pendingEth, obsTime: state.obsTime, lastBuyTime: state.lastBuyTime }, now);
  return { ...state, step };
}

async function readHistory(c: Address): Promise<FloorHistoryItem[]> {
  const latest = await client.getBlockNumber();
  const raw: any[] = [];
  for (let a = START_BLOCK; a <= latest; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - BigInt(1) > latest ? latest : a + LOG_CHUNK - BigInt(1);
    raw.push(...(await client.getLogs({ address: c, fromBlock: a, toBlock: b })));
  }
  const parsed = parseEventLogs({ abi: COLLECTION_ABI, logs: raw, strict: false }) as any[];
  return parsed
    .filter((l) => (HISTORY_EVENTS as readonly string[]).includes(l.eventName))
    .map((l) => {
      const args: Record<string, string> = {};
      for (const [k, v] of Object.entries(l.args ?? {})) args[k] = s(v);
      return { type: l.eventName, blockNumber: s(l.blockNumber), txHash: l.transactionHash, logIndex: Number(l.logIndex ?? 0), ...args };
    })
    .sort((x, y) => (BigInt(y.blockNumber) === BigInt(x.blockNumber) ? y.logIndex - x.logIndex : BigInt(y.blockNumber) > BigInt(x.blockNumber) ? 1 : -1))
    .slice(0, 100);
}

/** null = not a collection from the token floor factory. */
export async function getFloorVault(collection: string): Promise<FloorVaultData | null> {
  const factory = floorFactory();
  if (!factory) throw new Error('not live');
  if (!isAddr(collection)) throw new FloorInputError('invalid_address');
  const c = collection.toLowerCase() as Address;
  const hit = cache.get(c);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const isCollection = await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'isCollection', args: [c] });
  if (!isCollection) {
    cache.set(c, { at: Date.now(), data: null });
    return null;
  }
  const [st, history] = await Promise.all([
    readState(c),
    readHistory(c).catch((e) => { console.error('floor vault history failed', c, e); return [] as FloorHistoryItem[]; }),
  ]);
  const data: FloorVaultData = {
    live: true, collection: c, token: st.token, launch: st.launch, graduated: st.graduated,
    ethFloor: s(st.ethFloor), pendingEth: s(st.pendingEth), tokenReserve: s(st.tokenReserve), perNft: { eth: s(st.perEth), token: s(st.perToken) },
    tokenShareBps: st.tokenShareBps, maxSlippageBps: st.maxSlippageBps, maxBuyEth: s(st.maxBuyEth), obsTime: st.obsTime, lastBuyTime: st.lastBuyTime,
    nextStep: st.step.step, nextStepAt: st.step.at, tokenShareActive: st.tokenShareActive, history, updatedAt: new Date().toISOString(),
  };
  cache.set(c, { at: Date.now(), data });
  return data;
}

export type FloorTask = {
  taskType: 'floor_vault_buy'; collection: Address; token: Address; pendingEth: string; maxBuyEth: string;
  step: 'record_price' | 'buy'; call: 'observePrice()' | 'buyToken()'; earliestAt: number;
};

/** Collections where graduated && pendingEth > 0, with the next step and its earliest time. */
export async function listFloorTasks(): Promise<FloorTask[]> {
  const factory = floorFactory();
  if (!factory) return [];
  const n = Number(await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'collectionsLength' }));
  if (!n) return [];
  const res = await client.multicall({
    allowFailure: true,
    contracts: Array.from({ length: n }, (_, i) => ({ address: factory, abi: FACTORY_ABI, functionName: 'allCollections', args: [BigInt(i)] })) as any,
  });
  const addrs = res.map((r) => ok<Address>(r)).filter((a): a is Address => isAddr(a));
  const tasks: FloorTask[] = [];
  for (const c of addrs) {
    try {
      const st = await readState(c);
      if (!st.graduated || st.pendingEth <= BigInt(0) || !st.tokenShareActive) continue;
      const step = st.step.step === 'wait' ? st.step.upcoming : st.step.step;
      if (step !== 'record_price' && step !== 'buy') continue;
      tasks.push({
        taskType: 'floor_vault_buy', collection: c, token: st.token, pendingEth: s(st.pendingEth), maxBuyEth: s(st.maxBuyEth),
        step, call: step === 'buy' ? 'buyToken()' : 'observePrice()', earliestAt: st.step.at ?? Math.floor(Date.now() / 1000),
      });
    } catch (e) {
      console.error('floor vault task read failed', c, e);
    }
  }
  return tasks.sort((a, b) => a.earliestAt - b.earliestAt);
}
