// Promise Ledger read helpers (DB only, no RPC): views, counts and the health-score factor. Server only.
import type { CreatorPromise } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { CtoReport, HealthItem } from '@/lib/cto/chain';
import { bevorItem, type BevorAuditView } from '@/lib/bevor/shared';
import { getBevorAudit } from '@/lib/bevor/audit';
import { buildItem, type BuildScoreView } from '@/lib/buildact/shared';
import { getBuildScore } from '@/lib/buildact/view';
import { getExternalToken } from '@/lib/listed-tokens';
import { getSourceVerified, type SourceVerified } from '@/lib/source-verified';
import { deadlineFor, sentence, type PromiseParams, type PromiseStatus, type PromiseSummary, type PromiseView } from './presets';

export function summarize(rows: { status: string }[]): PromiseSummary {
  const s: PromiseSummary = { total: rows.length, kept: 0, broken: 0, active: 0, review: 0 };
  for (const r of rows) {
    if (r.status === 'kept') s.kept++;
    else if (r.status === 'broken') s.broken++;
    else if (r.status === 'needs_review') s.review++;
    else s.active++;
  }
  return s;
}

export async function promiseSummary(launch: string): Promise<PromiseSummary> {
  const rows = await prisma.creatorPromise.findMany({ where: { launchAddress: launch.toLowerCase() }, select: { status: true } });
  return summarize(rows);
}

/** Graduation timestamp from the cached CTO report (no RPC). */
export async function gradTsFromCache(launch: string): Promise<number | null> {
  const hit = await prisma.cTOReportCache.findUnique({ where: { launchAddress: launch.toLowerCase() }, select: { report: true } }).catch(() => null);
  const ts = (hit?.report as any)?.graduation?.event?.timestamp;
  return typeof ts === 'number' && ts > 0 ? ts : null;
}

export function toView(p: CreatorPromise, symbol: string, gradTs: number | null): PromiseView {
  const params = p.params as unknown as PromiseParams;
  return {
    id: p.id, kind: p.kind, params, sentence: sentence(p.kind, params, symbol, p.endsAt),
    startsAt: p.startsAt, endsAt: p.endsAt, deadline: deadlineFor(p.kind, params, p.endsAt, gradTs),
    status: p.status as PromiseStatus, statusAt: p.statusAt?.toISOString() ?? null,
    evidenceTx: p.evidenceTx, evidenceNote: p.evidenceNote, createdAt: p.createdAt.toISOString(),
    signer: p.creator, signature: p.signature, typedData: p.typedData, tokenAddress: p.tokenAddress,
  };
}

export async function listPromises(launch: string, symbol: string, gradTs?: number | null): Promise<PromiseView[]> {
  const rows = await prisma.creatorPromise.findMany({ where: { launchAddress: launch.toLowerCase() }, orderBy: { createdAt: 'desc' } });
  if (!rows.length) return [];
  const g = gradTs === undefined ? await gradTsFromCache(launch) : gradTs;
  return rows.map((r) => toView(r, symbol, g));
}

// Health weights (max 100). Old → new after adding "Launch fairness" (Bundle & Sniper X-ray):
//   verified 14 → 15, owner 14 → 10, flags 19 → 10 (owner + flags = Security/ownership 20),
//   top10 19 → 15, curve 14 → 10, activity 15 → 10, promises 5 → 10, fairness (new) 20.
// Penalties: a broken promise −15; flagged wallets dumping now −5 (score floor 0).
// Bevor AI review (live Oct 30 2026): verified 15 → 10, top10 15 → 10, bevor (new) 10.
// Build activity (Oct 31 2026, owner-approved categories totaling 100):
//   Verification 20 → 12 (verified 10 → 6, bevor 10 → 6), Ownership/security 20 → 18 (owner 10 → 9, flags 10 → 9),
//   Holders top10 10 → 12, Curve 10 → 8, Activity 10 → 8, Promises 10 → 10, Launch fairness 20 → 17
//   (clean 20 → 17, some 12 → 10, heavy 4 → 3, pending 10 → 8), Build activity (new) 15 (pending = neutral 7).
const BASE_POINTS: Record<string, number> = { verified: 6, owner: 9, flags: 9, top10: 12, curve: 8, activity: 8 };
const HIDDEN_ITEMS = new Set<string>();
export const PROMISE_POINTS = 10;
export const BROKEN_PENALTY = 15;
export const FAIRNESS_POINTS = 17;
export const DUMPING_PENALTY = 5;
const FAIRNESS_BY_LEVEL: Record<string, number> = { clean: 17, some: 10, heavy: 3 };
const FAIRNESS_PENDING = 8;
const FAIRNESS_LABEL: Record<string, string> = { clean: 'clean', some: 'some early buyers flagged', heavy: 'heavy bundling flagged', partial: 'partial scan', scanning: 'scan pending', waiting: 'trading not open yet' };

export interface FairnessInput { level: string; dumping: boolean }

export function fairnessItem(x: FairnessInput | null): HealthItem {
  const level = x?.level ?? 'scanning';
  const earned = FAIRNESS_BY_LEVEL[level] ?? FAIRNESS_PENDING; // scanning / waiting / partial
  const dumping = !!x?.dumping;
  return {
    key: 'fairness', label: `Launch fairness (X-ray: ${FAIRNESS_LABEL[level] ?? level}${dumping ? ', flagged wallets selling now' : ''})`,
    points: FAIRNESS_POINTS, ok: earned > 0, known: level in FAIRNESS_BY_LEVEL, earned, ...(dumping ? { penalty: DUMPING_PENALTY } : {}),
  };
}

/** Listed (non-factory) tokens: these factors don't apply and are left out of the max (100 - 8 - 17 = 75). */
export const EXTERNAL_NA_KEYS = ['curve', 'launch_fairness'] as const;

export function applyPromiseHealth(report: CtoReport, s: PromiseSummary, x: FairnessInput | null = null, audit: BevorAuditView | null = null, build: BuildScoreView | null = null, external = false): CtoReport {
  if (external) return applyExternalHealth(applyPromiseHealth(report, s, x, audit, build));
  // Items in HIDDEN_ITEMS are left out and the score is rescaled to /100.
  const base = report.health.items.filter((i) => i.key !== 'promises' && i.key !== 'fairness' && i.key !== 'bevor' && i.key !== 'build' && !HIDDEN_ITEMS.has(i.key)).map((i) => ({ ...i, points: BASE_POINTS[i.key] ?? i.points }));
  const broken = s.broken > 0;
  const item: HealthItem = broken
    ? { key: 'promises', label: 'Creator promises (a promise was broken)', points: PROMISE_POINTS, ok: false, known: true, penalty: BROKEN_PENALTY }
    : { key: 'promises', label: 'Creator promises made, none broken', points: PROMISE_POINTS, ok: s.total > 0, known: true };
  const fair = fairnessItem(x);
  const vIdx = base.findIndex((i) => i.key === 'verified');
  const withAudit = HIDDEN_ITEMS.has('bevor') ? base : [...base.slice(0, vIdx + 1), bevorItem(audit), ...base.slice(vIdx + 1)];
  const items = [...withAudit, item, fair, ...(HIDDEN_ITEMS.has('build') ? [] : [buildItem(build)])];
  const raw = items.reduce((sum, i) => sum + (i.ok ? (i.earned ?? i.points) : 0), 0) - (broken ? BROKEN_PENALTY : 0) - (fair.penalty ?? 0);
  const max = items.reduce((sum, i) => sum + i.points, 0) || 100;
  return { ...report, health: { score: Math.max(0, Math.min(100, Math.round((raw * 100) / max))), items } };
}

/** Marks Curve and Launch fairness N/A and rescales: score = round(earned / applicableMax * 100). */
function applyExternalHealth(report: CtoReport): CtoReport {
  const items = report.health.items.map((i): HealthItem => (i.key === 'curve' || i.key === 'fairness'
    ? { key: i.key, label: i.key === 'curve' ? 'Curve progress or graduated (N/A)' : 'Launch fairness (N/A)', points: i.points, ok: false, known: false, na: true }
    : i));
  const penalty = items.reduce((sum, i) => sum + (i.key === 'promises' && i.penalty && !i.ok ? i.penalty : 0), 0);
  const rawEarned = items.reduce((sum, i) => sum + (!i.na && i.ok ? (i.earned ?? i.points) : 0), 0) - penalty;
  const applicableMax = items.reduce((sum, i) => sum + (i.na ? 0 : i.points), 0) || 75;
  const score = Math.max(0, Math.min(100, Math.round((rawEarned / applicableMax) * 100)));
  return { ...report, health: { score, items, rawEarned, applicableMax, notApplicable: [...EXTERNAL_NA_KEYS] } };
}

export async function fairnessFor(launch: string): Promise<FairnessInput | null> {
  const r = await prisma.xrayResult.findUnique({ where: { launchAddress: launch.toLowerCase() }, select: { level: true, stats: true } }).catch(() => null);
  return r ? { level: r.level, dumping: !!(r.stats as any)?.dumping } : null;
}

/** Same rule as the Holder Protections security check: verified on Sourcify OR Blockscout (token or launch). Points unchanged. */
export function applySourceVerified(report: CtoReport, sv: SourceVerified | null): CtoReport {
  if (!sv) return report;
  const items = report.health.items.map((i): HealthItem => {
    if (i.key !== 'verified') return i;
    const ok = sv.verified;
    const known = sv.known ? true : i.known;
    return { ...i, label: 'Source verified', ok: sv.known ? ok : i.ok, known, ...(sv.url ? { href: sv.url } : {}) };
  });
  return { ...report, health: { ...report.health, items } };
}

export async function withPromiseHealth(report: CtoReport): Promise<CtoReport> {
  const [s, x, a, b, sv] = await Promise.all([
    promiseSummary(report.cto.launchAddress).catch(() => null), fairnessFor(report.cto.launchAddress), getBevorAudit(report.cto.launchAddress),
    getBuildScore(report.cto.launchAddress).catch(() => null),
    getSourceVerified([report.cto.tokenAddress, report.cto.launchAddress]).catch(() => null),
  ]);
  return applyPromiseHealth(applySourceVerified(report, sv), s ?? { total: 0, kept: 0, broken: 0, active: 0, review: 0 }, x, a, b, !!getExternalToken(report.cto.launchAddress));
}

// Badge counts for every launch: one grouped query, cached for 30s in memory.
let countsCache: { at: number; data: Record<string, PromiseSummary> } | null = null;
export async function allPromiseCounts(): Promise<Record<string, PromiseSummary>> {
  if (countsCache && Date.now() - countsCache.at < 30_000) return countsCache.data;
  const groups = await prisma.creatorPromise.groupBy({ by: ['launchAddress', 'status'], _count: { _all: true } });
  const data: Record<string, PromiseSummary> = {};
  for (const g of groups) {
    const s = (data[g.launchAddress] ??= { total: 0, kept: 0, broken: 0, active: 0, review: 0 });
    const n = g._count._all;
    s.total += n;
    if (g.status === 'kept') s.kept += n; else if (g.status === 'broken') s.broken += n; else if (g.status === 'needs_review') s.review += n; else s.active += n;
  }
  countsCache = { at: Date.now(), data };
  return data;
}
export function invalidatePromiseCounts() { countsCache = null; }
