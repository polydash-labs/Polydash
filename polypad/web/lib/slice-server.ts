import 'server-only';
import { createPublicClient, erc20Abi, http, parseAbiItem, parseEventLogs, type Abi } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { SLICE_DISTRIBUTOR_ABI, SLICE_ESCROW_ABI, SLICE_ROOT_POSTER } from '@/lib/sliceArtifacts';
import { EXPECTED, REWARDS_POOL, SLICE_DEPLOY_BLOCK, SLICE_DISTRIBUTOR_ADDRESS, SLICE_EPOCH_DATA_URL, SLICE_ESCROW_ADDRESS, SLICE_GUARDIAN, sliceLive, type Addr } from '@/lib/slice';

const client = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com') });
const D = SLICE_DISTRIBUTOR_ABI as unknown as Abi;
const E = SLICE_ESCROW_ABI as unknown as Abi;
const cache = new Map<string, { t: number; v: any }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.t < 60_000) return c.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
async function logs(address: Addr, abi: Abi) {
  const latest = await client.getBlockNumber();
  const out: any[] = [];
  const CH = BigInt(9_900_000);
  for (let f = SLICE_DEPLOY_BLOCK ?? BigInt(0); f <= latest; f += CH) {
    const to = f + CH - BigInt(1) > latest ? latest : f + CH - BigInt(1);
    out.push(...parseEventLogs({ abi, logs: await client.getLogs({ address, fromBlock: f, toBlock: to }) }));
  }
  return out;
}
const s = (x: any) => (typeof x === 'bigint' ? x.toString() : x);
const rd = (address: Addr, abi: Abi, functionName: string, args: any[] = []) => client.readContract({ address, abi, functionName, args } as any) as Promise<any>;
const symCache = new Map<string, string>();
async function symbolOf(token: string) {
  const k = token.toLowerCase();
  if (symCache.has(k)) return symCache.get(k)!;
  const v = await client.readContract({ address: token as Addr, abi: erc20Abi, functionName: 'symbol' }).catch(() => '');
  symCache.set(k, v);
  return v;
}
const STAKED = parseAbiItem('event Staked(address indexed user, uint256 amount)');
const WARMUP = 7 * 86400;
/** Stakes younger than 7 days, with the time each one starts to count. */
async function recentStakes(account: Addr) {
  const latest = await client.getBlockNumber();
  const head = await client.getBlock({ blockNumber: latest });
  const now = Number(head.timestamp);
  const CH = BigInt(9_900_000);
  const out: { amount: string; stakedAt: number; countsFrom: number; tx: string }[] = [];
  for (let f = SLICE_DEPLOY_BLOCK ?? BigInt(0); f <= latest; f += CH) {
    const to = f + CH - BigInt(1) > latest ? latest : f + CH - BigInt(1);
    const ls = await client.getLogs({ address: REWARDS_POOL as Addr, event: STAKED, args: { user: account }, fromBlock: f, toBlock: to });
    for (const l of ls) {
      const b = await client.getBlock({ blockNumber: l.blockNumber! });
      const t = Number(b.timestamp);
      if (t + WARMUP > now) out.push({ amount: String(l.args.amount ?? 0), stakedAt: t, countsFrom: t + WARMUP, tx: l.transactionHash! });
    }
  }
  return out;
}

export async function getSliceStatus() {
  if (!sliceLive()) return { live: false, expected: EXPECTED };
  return cached('status', async () => {
    const d = SLICE_DISTRIBUTOR_ADDRESS as Addr, e = SLICE_ESCROW_ADDRESS as Addr;
    const [epochGenesis, currentEpoch, rootEpoch, root, rootDataHash, pRoot, pEpoch, pHash, pAt, n] = await Promise.all(
      ['epochGenesis', 'currentEpoch', 'rootEpoch', 'root', 'rootDataHash', 'pendingRoot', 'pendingEpoch', 'pendingDataHash', 'pendingAt'].map((f) => rd(d, D, f)).concat([rd(e, E, 'slicesLength')]),
    );
    const evs = await logs(e, E);
    const commits = evs.filter((l) => l.eventName === 'SliceCommitted');
    const slices = await Promise.all(Array.from({ length: Number(n) }, async (_, i) => {
      const [g, rel] = await Promise.all([rd(e, E, 'getSlice', [BigInt(i)]), rd(e, E, 'releasable', [BigInt(i)])]);
      const c = commits.find((l) => Number(l.args.id) === i);
      return { id: i, token: g.token, symbol: await symbolOf(g.token), creator: g.creator, amount: s(g.amount), bps: c ? Number(c.args.bps) : null, start: Number(g.start), duration: Number(g.duration), released: s(g.released), releasable: s(rel), tx: c?.transactionHash ?? null };
    }));
    const toks = Array.from(new Set(slices.map((x) => x.token.toLowerCase()))) as Addr[];
    const tokens = await Promise.all(toks.map(async (token) => ({ token, symbol: await symbolOf(token), credited: s(await rd(d, D, 'credited', [token])), totalClaimed: s(await rd(d, D, 'totalClaimed', [token])) })));
    const dl = await logs(d, D);
    const lists = dl.filter((l) => ['RootProposed', 'RootVetoed', 'RootActivated'].includes(l.eventName)).map((l) => ({ event: l.eventName, root: l.args.root, epoch: Number(l.args.epoch), dataHash: l.args.dataHash ?? null, activatableAt: l.args.activatableAt != null ? Number(l.args.activatableAt) : null, tx: l.transactionHash }));
    const hasPending = !/^0x0+$/.test(pRoot);
    const [guardian, rootPoster] = await Promise.all([rd(d, D, 'guardian').catch(() => SLICE_GUARDIAN), rd(d, D, 'rootPoster').catch(() => SLICE_ROOT_POSTER)]);
    const weekly = await weeklySummary(root).catch((e) => { console.error('slice weekly list failed', e); return null; });
    return {
      live: true, distributor: d, escrow: e, guardian, rootPoster,
      epochGenesis: Number(epochGenesis), currentEpoch: Number(currentEpoch), rootEpoch: Number(rootEpoch), root, rootDataHash,
      pending: hasPending ? { root: pRoot, epoch: Number(pEpoch), dataHash: pHash, activatableAt: Number(pAt) } : null,
      slices, tokens, lists, weekly, updatedAt: Math.floor(Date.now() / 1000),
    };
  });
}

async function getJson(name: string) {
  try {
    const r = await fetch(`${SLICE_EPOCH_DATA_URL}${name}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch (e) { console.error(`slice ${name} fetch failed`, e); return null; }
}
/** Reads latest.json, then the epoch_<N>.json file it names. Returns null when no list is published yet. */
export async function getLatestList(): Promise<{ file: string; data: any } | null> {
  const latest: any = await getJson('latest.json');
  const file = latest && typeof latest.file === 'string' ? latest.file.split('/').pop() : null;
  if (!file || !/^epoch_\d+\.json$/.test(file)) return null;
  const data = await getJson(file);
  return data && typeof data === 'object' ? { file, data } : null;
}
const lc = (x: any) => String(x ?? '').toLowerCase();
async function weeklySummary(root: string) {
  const l = await getLatestList();
  if (!l) return null;
  const d = l.data;
  const epochs = Array.isArray(d.epochs) ? d.epochs : [];
  const syms = new Set<string>();
  epochs.forEach((e: any) => Object.keys(e?.tokens ?? {}).forEach((t) => syms.add(t)));
  const symbols: Record<string, string> = {};
  await Promise.all(Array.from(syms).map(async (t) => { symbols[t] = await symbolOf(t); }));
  return {
    file: l.file, url: `${SLICE_EPOCH_DATA_URL}${l.file}`, epoch: Number(d.epoch), root: d.root ?? null, dataHash: d.dataHash ?? null,
    rootMatches: lc(d.root) === lc(root),
    epochs: epochs.map((e: any) => ({
      epoch: Number(e.epoch), start: Number(e.start), end: Number(e.end), stakers: Number(e.stakers ?? 0),
      tokens: Object.entries(e?.tokens ?? {}).map(([token, v]: [string, any]) => ({ token, symbol: symbols[token] ?? '', pot: String(v?.pot ?? '0'), allocated: String(v?.allocated ?? '0'), carry: String(v?.carry ?? '0') })),
    })),
  };
}

export async function getSliceClaims(account: Addr) {
  const st: any = await getSliceStatus();
  if (!st.live) return { live: false, epoch: null, root: null, items: [] };
  const stakes = await recentStakes(account).catch((e) => { console.error('slice stakes failed', e); return []; });
  const l = await getLatestList();
  if (!l) return { live: true, epoch: null, root: null, items: [], recentStakes: stakes, note: 'No weekly list yet' };
  const data = l.data;
  if (lc(data.root) !== lc(st.root)) return { live: true, epoch: Number(data.epoch), root: data.root ?? null, mismatch: true, items: [], recentStakes: stakes };
  const mine = (data.proofs?.[account.toLowerCase()] ?? {}) as Record<string, { amount: string; proof: string[] }>;
  const entries = Object.entries(mine).filter(([, v]) => v && v.amount != null && Array.isArray(v.proof)).map(([token, v]) => ({ token, amount: String(v.amount), proof: v.proof }));
  const items = await Promise.all(entries.map(async (c) => {
    const claimed = BigInt(await rd(st.distributor, D, 'claimed', [account, c.token]));
    const cum = BigInt(c.amount);
    return { token: c.token, symbol: await symbolOf(c.token), cumulative: cum.toString(), claimed: claimed.toString(), claimable: (cum > claimed ? cum - claimed : BigInt(0)).toString(), proof: c.proof };
  }));
  return { live: true, epoch: Number(data.epoch), root: data.root, items, recentStakes: stakes };
}

export async function getSliceTasks() {
  const st: any = await getSliceStatus();
  if (!st.live) return { live: false, tasks: [] };
  const now = Math.floor(Date.now() / 1000);
  const tasks: any[] = [];
  const ids = st.slices.filter((x: any) => BigInt(x.releasable) > BigInt(0)).map((x: any) => x.id);
  if (ids.length) tasks.push({ type: 'slice_release', contract: st.escrow, function: 'releaseMany', ids });
  if (st.pending && now >= st.pending.activatableAt) tasks.push({ type: 'slice_activate', contract: st.distributor, function: 'activateRoot' });
  const lastEnded = st.currentEpoch - 1;
  if (!st.pending && lastEnded >= 0 && st.rootEpoch < lastEnded) tasks.push({ type: 'slice_root', epoch: lastEnded, by: SLICE_ROOT_POSTER });
  if (!st.pending && st.rootEpoch >= 0 && !/^0x0+$/.test(st.root)) tasks.push({ type: 'slice_autoclaim', epoch: st.rootEpoch, data: st.weekly?.rootMatches ? st.weekly.url : null });
  return { live: true, tasks, note: 'Read-only. No keys, no custody.', updatedAt: now };
}
