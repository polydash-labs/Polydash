import { evaluatePromise, type EvalCtx, type EvalLogs, type EvalPromise } from '../lib/promises/core';

const CREATOR = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const ROUTER = '0x3333333333333333333333333333333333333333';
const POOL = '0x4444444444444444444444444444444444444444';
const UNKNOWN = '0x5555555555555555555555555555555555555555';
const NOW = 1_800_000_000;

const base = (kind: string, extra: Partial<EvalPromise> = {}): EvalPromise => ({
  id: 1, kind, params: { days: 7, wallets: [] }, creator: CREATOR, tokenAddress: TOKEN,
  endsAt: NOW + 7 * 86400, baselineBalance: '1000', status: 'active', lastCheckedBlock: 100, progress: '0', ...extra,
});
const ctx = (over: Partial<EvalCtx> = {}): EvalCtx => ({
  toBlock: 200, toTs: NOW + 3600, symbol: 'MOON', gradTs: null,
  isExempt: (a) => a === POOL, isRouter: (a) => a === ROUTER,
  isContract: async (a) => a === UNKNOWN || a === POOL || a === ROUTER,
  blockTs: async () => NOW + 60, balanceAt: async () => BigInt(1000), ...over,
});
const empty: EvalLogs = { transfers: [], sells: [], payouts: [], pools: [] };

let fail = 0;
const check = (name: string, ok: boolean, info: unknown) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : JSON.stringify(info)); if (!ok) fail++; };

(async () => {
  // 1. sell -> broken
  let r = await evaluatePromise(base('no_sell'), { ...empty, sells: [{ seller: CREATOR, block: 150, logIndex: 0, tx: '0xsell' }] }, ctx());
  check('sell on bonding curve -> broken', r.status === 'broken' && r.evidenceTx === '0xsell' && r.alerts[0]?.type === 'promise_broken', r);

  r = await evaluatePromise(base('no_sell'), { ...empty, transfers: [{ from: CREATOR, to: ROUTER, value: BigInt(5), block: 150, logIndex: 0, tx: '0xswap' }] }, ctx());
  check('transfer to trading contract -> broken', r.status === 'broken' && r.evidenceTx === '0xswap', r);

  // 2. staking deposit -> not broken
  r = await evaluatePromise(base('no_sell'), { ...empty, transfers: [{ from: CREATOR, to: POOL, value: BigInt(5), block: 150, logIndex: 0, tx: '0xstake' }] }, ctx());
  check('staking deposit -> stays active', r.status === 'active' && r.alerts.length === 0, r);

  // 3. unknown contract -> needs_review
  r = await evaluatePromise(base('no_sell'), { ...empty, transfers: [{ from: CREATOR, to: UNKNOWN, value: BigInt(5), block: 150, logIndex: 0, tx: '0xunk' }] }, ctx());
  check('transfer to unknown contract -> needs_review', r.status === 'needs_review' && r.alerts[0]?.type === 'promise_review' && r.evidenceTx === '0xunk', r);

  // 4. RPC error -> rejects (runner leaves status unchanged)
  let threw = false;
  try {
    await evaluatePromise(base('no_sell'), { ...empty, transfers: [{ from: CREATOR, to: UNKNOWN, value: BigInt(5), block: 150, logIndex: 0, tx: '0xunk' }] }, ctx({ isContract: async () => { throw new Error('rpc down'); } }));
  } catch { threw = true; }
  check('RPC error -> evaluation rejects, no status change', threw, null);

  // Extra: deadline passed with no sells -> kept; old logs (<= lastCheckedBlock) ignored
  r = await evaluatePromise(base('no_sell'), { ...empty, sells: [{ seller: CREATOR, block: 90, logIndex: 0, tx: '0xold' }] }, ctx({ toTs: NOW + 8 * 86400 }));
  check('no sells by deadline -> kept (old logs ignored)', r.status === 'kept', r);

  // Extra: hold below floor -> broken
  r = await evaluatePromise(base('hold', { params: { days: 30, pct: 90, wallets: [] } }), { ...empty, transfers: [{ from: CREATOR, to: UNKNOWN, value: BigInt(200), block: 150, logIndex: 0, tx: '0xout' }] }, ctx({ balanceAt: async () => BigInt(800) }));
  check('hold balance below 90% -> broken', r.status === 'broken', r);

  // Extra: staking_live pool created -> kept; grad mode before graduation -> active
  r = await evaluatePromise(base('staking_live', { params: { days: 30, mode: 'date', wallets: [] } }), { ...empty, pools: [{ pool: POOL, creator: CREATOR, stakeToken: TOKEN, rewardToken: TOKEN, rewardAmount: BigInt(1), block: 150, logIndex: 0, tx: '0xpool' }] }, ctx());
  check('staking pool created -> kept', r.status === 'kept' && r.evidenceTx === '0xpool', r);
  r = await evaluatePromise(base('staking_live', { endsAt: 0, params: { days: 7, mode: 'grad', wallets: [] } }), empty, ctx({ toTs: NOW + 400 * 86400 }));
  check('graduation mode before graduation -> active', r.status === 'active', r);

  // Extra: payout change -> broken; initiated only -> alert, stays active
  r = await evaluatePromise(base('payout_fixed'), { ...empty, payouts: [{ kind: 'initiated', newWallet: UNKNOWN, block: 150, logIndex: 0, tx: '0xinit' }] }, ctx());
  check('payout change initiated -> pending alert, active', r.status === 'active' && r.alerts.length === 1, r);
  r = await evaluatePromise(base('payout_fixed'), { ...empty, payouts: [{ kind: 'changed', newWallet: UNKNOWN, block: 150, logIndex: 0, tx: '0xchg' }] }, ctx());
  check('payout wallet changed -> broken', r.status === 'broken', r);

  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
