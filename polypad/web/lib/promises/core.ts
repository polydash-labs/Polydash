// Pure Promise Ledger evaluator: decides a promise's status from decoded logs. No DB, no RPC of its own;
// chain reads come in through `ctx` so they can be mocked in tests. Any thrown error means "leave unchanged".
import { deadlineFor, type PromiseParams, type PromiseStatus } from './presets';

export interface TransferEv { from: string; to: string; value: bigint; block: number; logIndex: number; tx: string }
export interface SoldEv { seller: string; block: number; logIndex: number; tx: string }
export interface PayoutEv { kind: 'initiated' | 'changed'; newWallet: string; block: number; logIndex: number; tx: string }
export interface PoolEv { pool: string; creator: string; stakeToken: string; rewardToken: string; rewardAmount: bigint; block: number; logIndex: number; tx: string }
export interface EvalLogs { transfers: TransferEv[]; sells: SoldEv[]; payouts: PayoutEv[]; pools: PoolEv[] }

export interface EvalPromise {
  id: number; kind: string; params: PromiseParams; creator: string; tokenAddress: string;
  endsAt: number; baselineBalance: string; status: PromiseStatus; lastCheckedBlock: number; progress: string;
}

export interface EvalCtx {
  /** Last block covered by `logs` (fully scanned) and its timestamp. */
  toBlock: number; toTs: number;
  symbol: string;
  gradTs: number | null;
  isExempt: (a: string) => boolean;
  isRouter: (a: string) => boolean;
  isContract: (a: string) => Promise<boolean>;
  blockTs: (n: number) => Promise<number>;
  /** Combined token balance of `wallets` at the end of `block`. */
  balanceAt: (wallets: string[], block: number) => Promise<bigint>;
}

export interface EvalAlert { type: 'promise_kept' | 'promise_broken' | 'promise_review'; message: string; tx: string | null; key: string }
export interface EvalResult { status: PromiseStatus; evidenceTx: string | null; evidenceNote: string | null; progress: string; alerts: EvalAlert[] }

const order = (a: { block: number; logIndex: number }, b: { block: number; logIndex: number }) => a.block - b.block || a.logIndex - b.logIndex;
const WEI = BigInt('1000000000000000000');

export function walletsOf(p: Pick<EvalPromise, 'creator' | 'params'>) {
  return new Set([p.creator.toLowerCase(), ...(p.params.wallets ?? []).map((w) => w.toLowerCase())]);
}

export async function evaluatePromise(p: EvalPromise, logs: EvalLogs, ctx: EvalCtx): Promise<EvalResult> {
  const res: EvalResult = { status: p.status, evidenceTx: null, evidenceNote: null, progress: p.progress, alerts: [] };
  if (p.status === 'kept' || p.status === 'broken') return res;
  const wallets = walletsOf(p);
  const fresh = <T extends { block: number }>(arr: T[]) => arr.filter((l) => l.block > p.lastCheckedBlock && l.block <= ctx.toBlock);
  const deadline = deadlineFor(p.kind, p.params, p.endsAt, ctx.gradTs);
  const inWindow = async (block: number) => deadline == null || (await ctx.blockTs(block)) <= deadline;
  const sym = `$${ctx.symbol}`;
  const brk = (tx: string | null, note: string) => {
    res.status = 'broken'; res.evidenceTx = tx; res.evidenceNote = note;
    res.alerts.push({ type: 'promise_broken', message: `Promise broken: ${note}`, tx, key: `${p.id}:broken` });
    return res;
  };
  const keep = (tx: string | null, note: string) => {
    res.status = 'kept'; res.evidenceTx = tx; res.evidenceNote = note;
    res.alerts.push({ type: 'promise_kept', message: `Promise kept: ${note}`, tx, key: `${p.id}:kept` });
    return res;
  };
  const review = (tx: string, note: string) => {
    if (res.status === 'active') {
      res.status = 'needs_review'; res.evidenceTx = tx; res.evidenceNote = note;
    }
    res.alerts.push({ type: 'promise_review', message: `Unverified movement: ${note}`, tx, key: `${p.id}:review:${tx}` });
  };
  const ended = deadline != null && ctx.toTs >= deadline;

  switch (p.kind) {
    case 'no_sell': {
      type Ev = ({ t: 's' } & SoldEv) | ({ t: 'x' } & TransferEv);
      const evs: Ev[] = [
        ...fresh(logs.sells).filter((s) => wallets.has(s.seller)).map((s) => ({ t: 's' as const, ...s })),
        ...fresh(logs.transfers).filter((x) => wallets.has(x.from)).map((x) => ({ t: 'x' as const, ...x })),
      ].sort(order);
      for (const e of evs) {
        if (!(await inWindow(e.block))) continue;
        if (e.t === 's') return brk(e.tx, `the creator sold ${sym} on the bonding curve.`);
        if (wallets.has(e.to) || ctx.isExempt(e.to)) continue;
        if (ctx.isRouter(e.to)) return brk(e.tx, `the creator sent ${sym} to a trading contract.`);
        if (await ctx.isContract(e.to)) review(e.tx, `the creator moved ${sym} to an unrecognized contract.`);
      }
      if (ended && res.status === 'active') return keep(null, `no creator sales of ${sym} during the promise window.`);
      return res;
    }
    case 'hold': {
      const floor = (BigInt(p.baselineBalance || '0') * BigInt(p.params.pct ?? 100)) / BigInt(100);
      const outs = fresh(logs.transfers).filter((x) => wallets.has(x.from) && !wallets.has(x.to) && !ctx.isExempt(x.to)).sort(order);
      const checked = new Set<number>();
      for (const x of outs) {
        if (checked.has(x.block) || !(await inWindow(x.block))) continue;
        checked.add(x.block);
        const bal = await ctx.balanceAt(Array.from(wallets), x.block);
        if (bal < floor) return brk(x.tx, `creator ${sym} balance fell below ${p.params.pct}% of the amount held when the promise was made.`);
      }
      if (ended && res.status === 'active') return keep(null, `the creator kept at least ${p.params.pct}% of their ${sym} until the end date.`);
      return res;
    }
    case 'staking_live': {
      const token = p.tokenAddress.toLowerCase();
      for (const e of fresh(logs.pools).filter((e) => e.stakeToken === token && wallets.has(e.creator)).sort(order)) {
        if (await inWindow(e.block)) return keep(e.tx, `a ${sym} staking pool was created before the deadline.`);
      }
      if (ended) return brk(null, `no ${sym} staking pool was created by the deadline.`);
      return res;
    }
    case 'staking_rewards': {
      const token = p.tokenAddress.toLowerCase();
      const target = BigInt(p.params.amount ?? '0') * WEI;
      let sum = BigInt(p.progress || '0');
      for (const e of fresh(logs.pools).filter((e) => e.rewardToken === token && wallets.has(e.creator)).sort(order)) {
        if (!(await inWindow(e.block))) continue;
        sum += e.rewardAmount;
        res.progress = sum.toString();
        if (sum >= target) return keep(e.tx, `at least ${Number(p.params.amount).toLocaleString('en-US')} ${sym} were put into staking rewards before the deadline.`);
      }
      if (ended) return brk(null, `staking rewards stayed below ${Number(p.params.amount).toLocaleString('en-US')} ${sym} by the deadline.`);
      return res;
    }
    case 'payout_fixed': {
      for (const e of fresh(logs.payouts).sort(order)) {
        if (!(await inWindow(e.block))) continue;
        if (e.kind === 'changed') return brk(e.tx, `the creator payout wallet changed before the end date.`);
        res.alerts.push({ type: 'promise_review', message: `Payout wallet change pending for ${sym}.`, tx: e.tx, key: `${p.id}:payout-pending:${e.tx}` });
      }
      if (ended && res.status === 'active') return keep(null, `the creator payout wallet did not change until the end date.`);
      return res;
    }
  }
  return res;
}
