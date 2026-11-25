// Unit tests for Bundle & Sniper X-ray (pure core + explorer failure path). Run: yarn tsx --require dotenv/config scripts/test-xray.ts
import { detect, verdict, clusterState, xrayAlerts, type DetectInput, type Funding, type BuyEv } from '../lib/xray/core';
import { getFundingMany } from '../lib/xray/blockscout';
import { applyPromiseHealth, fairnessItem } from '../lib/promises/summary';
import type { CtoReport } from '../lib/cto/chain';

let failed = 0;
const ok = (cond: unknown, name: string, extra?: unknown) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}`, extra ?? ''); }
};

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const T0 = 1000, T0TS = 1_700_000_000, SPB = 2;
const CREATOR = A(0xc0);
const buy = (buyer: string, block: number, eth = 0.1, tx?: string, logIndex = 0): BuyEv => ({ buyer, block, tx: tx ?? `0xtx${buyer.slice(-4)}${block}`, logIndex, tokens: 1e6, eth });
const base = (p: Partial<DetectInput>): DetectInput => ({
  t0: T0, t0Ts: T0TS, secPerBlock: SPB, capBlocks: 0, creatorWallets: [CREATOR], supply: 1e9,
  buys: [], committers: [], sniperTaxed: [], known: [], funding: {}, c2: [], ignoreFunder: () => false, ...p,
});
const fund = (funder: string, at: number, tx = `0xf${funder.slice(-4)}${at}`): Funding => ({ firstFunder: funder, fundingTx: tx, fundedAt: at, txs: [{ h: tx, f: funder, t: '', v: 0.5, ts: at }], truncated: false });

async function main() {
  // 1. Same-block buyers → bundle
  {
    const r = detect(base({ buys: [buy(A(1), T0 + 5), buy(A(2), T0 + 5), buy(A(3), T0 + 5)] }));
    const c = r.clusters[0];
    ok(r.clusters.length === 1 && c.type === 'bundle' && c.wallets.length === 3 && c.rules.includes('B1'), 'same-block buyers → bundle', r.clusters);
    ok(/same block/.test(c?.reason ?? ''), 'same-block reason text', c?.reason);
  }
  // 2. Common funder 2 minutes before buy → bundle with that reason
  {
    const F = A(0xf1), b1 = T0 + 100, b2 = T0 + 110;
    const ts = (b: number) => T0TS + (b - T0) * SPB;
    const r = detect(base({
      buys: [buy(A(11), b1), buy(A(12), b2)],
      funding: { [A(11)]: fund(F, ts(b1) - 120), [A(12)]: fund(F, ts(b2) - 120) },
    }));
    const c = r.clusters[0];
    ok(c?.type === 'bundle' && c.rules.includes('B2'), 'common funder → bundle (B2)', r.clusters);
    ok(/funded by the same address 2 minutes before buying/.test(c?.reason ?? ''), 'reason: "funded by the same address 2 minutes before buying"', c?.reason);
  }
  // 3. Commit-window participant → not a sniper
  {
    const r = detect(base({ buys: [buy(A(21), T0)], committers: [A(21)] }));
    ok(r.clusters.length === 0, 'committer buying at T0 → not flagged', r.clusters);
    const r2 = detect(base({ buys: [buy(A(22), T0)] }));
    ok(r2.clusters.length === 1 && r2.clusters[0].type === 'sniper', 'control: non-committer at T0 → sniper', r2.clusters);
  }
  // 4. Dev buy (creator wallet) → creator slice, not a sniper
  {
    const r = detect(base({ buys: [buy(CREATOR, T0)] }));
    ok(r.clusters.length === 0, 'creator dev buy at T0 → not a sniper (shown as Creator dev buy slice)', r.clusters);
  }
  // 5. Creator-funded wallet → creator-linked
  {
    const b = T0 + 20, ts = T0TS + 20 * SPB;
    const r = detect(base({ buys: [buy(A(31), b)], funding: { [A(31)]: fund(CREATOR, ts - 600) } }));
    const c = r.clusters[0];
    ok(c?.type === 'creator' && c.rules.includes('C1'), 'creator-funded wallet → creator-linked (C1)', r.clusters);
    ok(/funded by the token's creator/.test(c?.reason ?? ''), 'creator-linked reason text', c?.reason);
  }
  // 6. Explorer error → partial, never Clean
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('<html>challenge</html>', { status: 403 })) as typeof fetch;
    const wallets = [A(0xabc001), A(0xabc002)];
    const funding = await getFundingMany(wallets);
    globalThis.fetch = realFetch;
    ok(funding[wallets[0]] === 'pending' && funding[wallets[1]] === 'pending', 'explorer error → funding marked pending', funding);
    const r = detect(base({ buys: [buy(wallets[0], T0 + 120), buy(wallets[1], T0 + 150)], funding }));
    ok(r.pending.length === 2, 'detect reports pending wallets', r.pending);
    const v = verdict([], r.pending.length > 0);
    ok(v.level === 'partial', 'no clusters + pending funding → level partial (not clean)', v);
    const v2 = verdict([], false);
    ok(v2.level === 'clean', 'control: no clusters, no pending → clean', v2);
  }
  // 7. Flagged cluster sells 30% in 1h → xray_dump alert
  {
    const st = clusterState([A(41), A(42)], {
      [A(41)]: { received: 100, sold: 15, held: 35, sold1h: 15, sold24h: 15, lastSellTx: '0xsell1' },
      [A(42)]: { received: 100, sold: 15, held: 35, sold1h: 15, sold24h: 15, lastSellTx: '0xsell2' },
    }, 1000);
    ok(Math.abs(st.sold1hPct - 30) < 0.01 && st.dumping, 'cluster state: 30% sold in last hour → dumping', st);
    const alerts = xrayAlerts({
      launch: '0xlaunch', symbol: 'MOON', now: Date.now(), prevLevel: 'some', level: 'some', knownClusterIds: ['bundle:x'], frozenBefore: true,
      clusters: [{ id: 'bundle:x', type: 'bundle', confidence: 2, walletCount: 2, sold1hPct: st.sold1hPct, sold24hPct: st.sold24hPct, lastSellTx: st.lastSellTx }],
    });
    const d = alerts.find((a) => a.type === 'xray_dump');
    ok(!!d && d.message === 'Flagged early wallets sold 30.0% of their $MOON in the last hour.' && d.txHash === '0xsell2', 'xray_dump alert with message + tx link', alerts);
    const again = xrayAlerts({
      launch: '0xlaunch', symbol: 'MOON', now: Date.now(), prevLevel: 'some', level: 'some', knownClusterIds: ['bundle:x'], frozenBefore: true,
      clusters: [{ id: 'bundle:x', type: 'bundle', confidence: 2, walletCount: 2, sold1hPct: 30, sold24hPct: 30, lastSellTx: '0xsell2' }],
    });
    ok(again.find((a) => a.type === 'xray_dump')?.dedupeKey === d?.dedupeKey, 'same cluster within 6h → same dedupe key (max 1 alert)');
  }
  // 8. Health score max is exactly 100
  {
    const items = ['verified', 'owner', 'flags', 'top10', 'curve', 'activity'].map((key) => ({ key, label: key, points: 1, ok: true, known: true }));
    const report = { health: { score: 0, items }, cto: { launchAddress: '0x' } } as unknown as CtoReport;
    const audit = { status: 'done' as const, target: '0x', critical: 0, high: 0, medium: 0, low: 2, nFindings: 2, completedAt: null };
    const best = applyPromiseHealth(report, { total: 1, kept: 1, broken: 0, active: 0, review: 0 }, { level: 'clean', dumping: false }, audit);
    const max = best.health.items.reduce((s, i) => s + i.points, 0);
    ok(max === 100 && best.health.score === 100, 'health: weights sum to 100 and perfect token scores 100', { max, score: best.health.score });
    const dump = applyPromiseHealth(report, { total: 1, kept: 1, broken: 0, active: 0, review: 0 }, { level: 'heavy', dumping: true }, audit);
    const med = applyPromiseHealth(report, { total: 1, kept: 1, broken: 0, active: 0, review: 0 }, { level: 'clean', dumping: false }, { ...audit, medium: 2 });
    const high = applyPromiseHealth(report, { total: 1, kept: 1, broken: 0, active: 0, review: 0 }, { level: 'clean', dumping: false }, { ...audit, high: 1 });
    const unsup = applyPromiseHealth(report, { total: 1, kept: 1, broken: 0, active: 0, review: 0 }, { level: 'clean', dumping: false }, { ...audit, status: 'unsupported' });
    ok(med.health.score === 95 && high.health.score === 90 && unsup.health.score === 90, 'bevor: medium only 5/10, high 0, unsupported 0', [med.health.score, high.health.score, unsup.health.score]);
    ok(dump.health.score === 100 - 20 + 4 - 5, 'health: heavy + dumping → 4 points and −5', dump.health.score);
    ok(fairnessItem({ level: 'some', dumping: false }).earned === 12 && fairnessItem(null).earned === 10 && fairnessItem({ level: 'partial', dumping: false }).earned === 10, 'fairness points: some 12, scanning 10, partial 10');
    const broken = applyPromiseHealth(report, { total: 1, kept: 0, broken: 1, active: 0, review: 0 }, { level: 'clean', dumping: false }, audit);
    ok(broken.health.score === 100 - 10 - 15, 'health: broken promise still −15 (Promise Ledger unchanged)', broken.health.score);
  }
  console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll X-ray tests passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
