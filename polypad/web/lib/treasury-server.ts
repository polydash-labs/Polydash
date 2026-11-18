// Server-side treasury rules reads (public RPC, read-only). 30 s in-memory cache per token.
import { createPublicClient, erc20Abi, http, parseEventLogs, type Abi, type Address, type Hex, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { TREASURY_FACTORY_ABI, TREASURY_RULES_ABI } from '@/lib/treasuryArtifacts';
import { decodeChange, isZero, rulesToJson, treasuryFactory, type DecodedChange, type RulesJson } from '@/lib/treasury';
import { getPayoutDestination, type PayoutDestinationKind } from '@/lib/payoutDestination';

const client = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 10_000 }) }) as PublicClient;
const FACTORY_ABI = TREASURY_FACTORY_ABI as unknown as Abi;
const VAULT_ABI = TREASURY_RULES_ABI as unknown as Abi;
const START_BLOCK = BigInt(85_000_000);
const LOG_CHUNK = BigInt(9_000_000);
const TTL = 30_000;
const ok = <T,>(r: any): T | undefined => (r?.status === 'success' ? (r.result as T) : undefined);
const s = (v: any) => (typeof v === 'bigint' ? v.toString() : v == null ? '0' : String(v));

export type TreasuryHistoryItem = { event: string; block: string; tx: Hex; logIndex: number; args: Record<string, unknown> };
export type TreasuryData = {
  live: true; token: Address; vault: Address | null; owner?: Address; launch?: Address; paused?: boolean; timelockDelay?: number;
  balances?: { eth: string; token: string; reserved: string; available: string };
  rules?: RulesJson; remainingToday?: string; nextBuybackAt?: number; lastBuybackAt?: number; lastPoolAt?: number;
  executors?: Address[]; openExecution?: boolean;
  pendingChanges?: { id: number; kind: number; eta: number; data: Hex; decoded: DecodedChange }[];
  rounds?: { id: number; root: Hex; total: string; claimed: string; deadline: number; closed: boolean }[];
  pools?: { address: Address; endTime: number | null }[];
  totals?: { ethSpent: string; tokensBought: string; tokensBurned: string };
  history?: TreasuryHistoryItem[]; createdBlock?: string; updatedAt: string;
  // Added by /api/treasury/[token] from lib/payoutDestination.ts.
  payoutDestination?: PayoutDestinationKind | null; payoutWallet?: Address;
  pendingPayoutWallet?: { address: Address; executeAt: number; isVault: boolean } | null;
  feeRouting?: { destination: PayoutDestinationKind; claimableWei: string; launch: Address; creator: Address; payoutWallet: Address } | null;
};

const cache = new Map<string, { at: number; data: TreasuryData }>();
const createdBlocks = new Map<string, bigint>();

const POOL_END_ABI = [{ type: 'function', name: 'endTime', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as const;

async function chunkedLogs(address: Address, from: bigint, args?: { event: any; args: any }) {
  const latest = await client.getBlockNumber();
  const out: any[] = [];
  for (let a = from; a <= latest; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - BigInt(1) > latest ? latest : a + LOG_CHUNK - BigInt(1);
    const logs = args ? await client.getLogs({ address, event: args.event, args: args.args, fromBlock: a, toBlock: b }) : await client.getLogs({ address, fromBlock: a, toBlock: b });
    out.push(...logs);
  }
  return out;
}

async function creationBlock(factory: Address, token: Address): Promise<bigint> {
  const key = token.toLowerCase();
  const hit = createdBlocks.get(key);
  if (hit) return hit;
  const ev = (TREASURY_FACTORY_ABI as readonly any[]).find((x) => x.type === 'event' && x.name === 'RulesCreated');
  try {
    const logs = await chunkedLogs(factory, START_BLOCK, { event: ev, args: { token } });
    if (logs[0]?.blockNumber) {
      createdBlocks.set(key, logs[0].blockNumber);
      return logs[0].blockNumber;
    }
  } catch (e) {
    console.error('treasury creation block lookup failed', e);
  }
  return START_BLOCK;
}

export async function getTreasury(token: Address): Promise<TreasuryData> {
  const factory = treasuryFactory();
  if (!factory) throw new Error('not_live');
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const vault = (await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'rulesOf', args: [token] })) as Address;
  if (isZero(vault)) {
    const data: TreasuryData = { live: true, token, vault: null, updatedAt: new Date().toISOString() };
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  const v = { address: vault, abi: VAULT_ABI } as const;
  const names = ['owner', 'launch', 'paused', 'timelockDelay', 'reservedTokens', 'availableTokens', 'rules', 'remainingToday', 'nextBuybackAt',
    'lastBuybackAt', 'lastPoolAt', 'executors', 'changesCount', 'roundsCount', 'pools', 'totalEthSpent', 'totalTokensBought', 'totalTokensBurned'] as const;
  const res = await client.multicall({ contracts: names.map((functionName) => ({ ...v, functionName })) as any, allowFailure: true });
  const r: Record<string, any> = {};
  names.forEach((n, i) => (r[n] = ok(res[i])));
  const [ethBal, tokBal] = await Promise.all([
    client.getBalance({ address: vault }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [vault] }).catch(() => BigInt(0)),
  ]);

  const changesCount = Number(r.changesCount ?? 0);
  const roundsCount = Number(r.roundsCount ?? 0);
  const poolsList = ((r.pools as Address[]) ?? []).map((p) => p.toLowerCase() as Address);
  const [changesRes, roundsRes, endsRes] = await Promise.all([
    changesCount ? client.multicall({ contracts: Array.from({ length: changesCount }, (_, i) => ({ ...v, functionName: 'getChange', args: [BigInt(i)] })) as any, allowFailure: true }) : Promise.resolve([]),
    roundsCount ? client.multicall({ contracts: Array.from({ length: roundsCount }, (_, i) => ({ ...v, functionName: 'getRound', args: [BigInt(i)] })) as any, allowFailure: true }) : Promise.resolve([]),
    poolsList.length ? client.multicall({ contracts: poolsList.map((p) => ({ address: p, abi: POOL_END_ABI, functionName: 'endTime' })) as any, allowFailure: true }) : Promise.resolve([]),
  ]);

  const pendingChanges: NonNullable<TreasuryData['pendingChanges']> = [];
  (changesRes as any[]).forEach((c, id) => {
    const ch = ok<any>(c);
    if (!ch || ch.done) return;
    const kind = Number(ch.kind);
    pendingChanges.push({ id, kind, eta: Number(ch.eta), data: ch.data, decoded: decodeChange(kind, ch.data) });
  });
  const rounds = (roundsRes as any[]).map((x, id) => {
    const rd = ok<any>(x);
    return { id, root: rd?.root ?? '0x', total: s(rd?.total), claimed: s(rd?.claimed), deadline: Number(rd?.deadline ?? 0), closed: !!rd?.closed };
  });
  const pools = poolsList.map((address, i) => {
    const e = ok<bigint>((endsRes as any[])[i]);
    return { address, endTime: e != null ? Number(e) : null };
  });

  let history: TreasuryHistoryItem[] = [];
  let created: bigint | undefined;
  try {
    created = await creationBlock(factory, token);
    const logs = await chunkedLogs(vault, created);
    const parsed = parseEventLogs({ abi: VAULT_ABI, logs, strict: false }) as any[];
    history = parsed
      .filter((l) => l.eventName && l.eventName !== 'EIP712DomainChanged')
      .map((l) => ({
        event: l.eventName as string, block: s(l.blockNumber), tx: l.transactionHash as Hex, logIndex: Number(l.logIndex ?? 0),
        args: Object.fromEntries(Object.entries(l.args ?? {}).map(([k, val]) => [k, typeof val === 'bigint' ? val.toString() : k === 'rules' ? rulesToJson(val) : val])),
      }))
      .sort((a, b) => (BigInt(b.block) === BigInt(a.block) ? b.logIndex - a.logIndex : BigInt(b.block) > BigInt(a.block) ? 1 : -1))
      .slice(0, 100);
  } catch (e) {
    console.error('treasury history failed', e);
  }

  const rules = r.rules ? rulesToJson(r.rules) : undefined;
  const data: TreasuryData = {
    live: true, token, vault: vault.toLowerCase() as Address, owner: r.owner, launch: r.launch, paused: !!r.paused, timelockDelay: Number(r.timelockDelay ?? 0),
    balances: { eth: s(ethBal), token: s(tokBal), reserved: s(r.reservedTokens), available: s(r.availableTokens) },
    rules, remainingToday: s(r.remainingToday), nextBuybackAt: Number(r.nextBuybackAt ?? 0), lastBuybackAt: Number(r.lastBuybackAt ?? 0), lastPoolAt: Number(r.lastPoolAt ?? 0),
    executors: ((r.executors as Address[]) ?? []).map((e) => e.toLowerCase() as Address), openExecution: !!rules?.openExecution,
    pendingChanges, rounds, pools,
    totals: { ethSpent: s(r.totalEthSpent), tokensBought: s(r.totalTokensBought), tokensBurned: s(r.totalTokensBurned) },
    history, createdBlock: created?.toString(), updatedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** Read-only discovery list for agents. */
export async function listTreasuryTasks() {
  const factory = treasuryFactory();
  if (!factory) throw new Error('not_live');
  const count = Number(await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'rulesCount' }));
  const n = Math.min(count, 200);
  const vaultsRes = n ? await client.multicall({ contracts: Array.from({ length: n }, (_, i) => ({ address: factory, abi: FACTORY_ABI, functionName: 'allRules', args: [BigInt(i)] })) as any, allowFailure: true }) : [];
  const vaults = (vaultsRes as any[]).map((x) => ok<Address>(x)).filter(Boolean) as Address[];
  const fields = ['token', 'rules', 'executors', 'remainingToday', 'nextBuybackAt', 'availableTokens', 'paused', 'lastPoolAt'] as const;
  const res = vaults.length ? await client.multicall({ contracts: vaults.flatMap((address) => fields.map((functionName) => ({ address, abi: VAULT_ABI, functionName }))) as any, allowFailure: true }) : [];
  const tokens = vaults.map((_, i) => (ok<string>((res as any[])[i * fields.length]) ?? '').toLowerCase());
  const dests = await Promise.all(tokens.map((tk) => (tk ? getPayoutDestination(tk).catch((e) => { console.error('payout destination failed', tk, e); return null; }) : Promise.resolve(null))));
  const now = Math.floor(Date.now() / 1000);
  return vaults.map((vault, i) => {
    const g = (k: number) => ok<any>((res as any[])[i * fields.length + k]);
    const d = dests[i];
    const claimable = d ? BigInt(d.claimableWei) : BigInt(0);
    const tasks: { type: 'claim_fees_to_treasury' | 'execute_payout_change'; target: string; call: string; anyoneCanCall: true }[] = [];
    if (d?.destination === 'treasury_vault' && claimable > BigInt(0)) {
      tasks.push({ type: 'claim_fees_to_treasury', target: d.launch.toLowerCase(), call: 'claimCreatorFees()', anyoneCanCall: true });
    }
    if (d?.pending?.pendingIsVault && now >= d.pending.executeAt) {
      tasks.push({ type: 'execute_payout_change', target: d.launch.toLowerCase(), call: 'executePayoutWalletChange()', anyoneCanCall: true });
    }
    const rules = g(1);
    const available = (g(5) as bigint | undefined) ?? BigInt(0);
    const maxPool = (rules?.maxPoolReward as bigint | undefined) ?? BigInt(0);
    return {
      token: (g(0) as string | undefined)?.toLowerCase() ?? null,
      vault: vault.toLowerCase(),
      paused: !!g(6),
      openExecution: !!rules?.openExecution,
      executors: ((g(2) as string[]) ?? []).map((e) => e.toLowerCase()),
      remainingToday: s(g(3)),
      nextBuybackAt: Number(g(4) ?? 0),
      availableTokens: s(available),
      availablePoolBudget: s(maxPool === BigInt(0) ? BigInt(0) : available < maxPool ? available : maxPool),
      nextPoolAt: rules ? Number(g(7) ?? 0) + Number(rules.poolMinInterval ?? 0) : null,
      launch: d?.launch.toLowerCase() ?? null,
      payoutDestination: d?.destination ?? null,
      claimableFeesWei: d ? d.claimableWei : null,
      pendingPayoutWallet: d?.pending ? { address: d.pending.newWallet.toLowerCase(), executeAt: d.pending.executeAt, isVault: d.pending.pendingIsVault } : null,
      tasks,
    };
  });
}
