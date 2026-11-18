// Bevor AI contract review (server only). One small step per call, results cached in BevorAudit.
// Flow: explorer scan (token contract, then launch contract) → analysis → run pipeline → poll → count findings.
import { BevorClient } from '@bevorai/sdk';
import type { BevorAudit } from '@prisma/client';
import { prisma } from '@/lib/db';
import { BEVOR_CHAIN_ID, bevorItem, type BevorAuditView } from './shared';

const POLL_MS = 2 * 60_000; // re-check a running audit at most every 2 min
const RETRY_MS = 24 * 60 * 60_000; // unsupported / failed: try again after 24h
const MAX_ATTEMPTS = 5;
const RUN_TIMEOUT_MS = 3 * 60 * 60_000; // a run still processing after 3h counts as failed
const BREAKER_MS = 10 * 60_000;
const ACTIVE = new Set(['queued', 'processing', 'reconciling']);

let client: BevorClient | null = null;
let breakerUntil = 0;
let chain: Promise<unknown> = Promise.resolve(); // one Bevor step at a time, app-wide

function getClient(): BevorClient | null {
  const apiKey = process.env.BEVOR_API_KEY, userId = process.env.BEVOR_USER_ID;
  if (!apiKey || !userId) return null;
  client ??= new BevorClient({ apiKey, defaultHeaders: { 'bevor-user-id': userId } } as ConstructorParameters<typeof BevorClient>[0]);
  return client;
}

const isUnsupported = (e: any) => e?.code === 'code.unsupported' || e?.constructor?.name === 'CodeUnsupportedError';
const lc = (a: string) => a.toLowerCase();

export function toView(r: BevorAudit | null): BevorAuditView | null {
  if (!r) return null;
  return {
    status: r.status as BevorAuditView['status'], target: r.target, critical: r.critical, high: r.high, medium: r.medium, low: r.low,
    nFindings: r.nFindings, completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export async function getBevorAudit(launch: string): Promise<BevorAuditView | null> {
  return toView(await prisma.bevorAudit.findUnique({ where: { launchAddress: lc(launch) } }).catch(() => null));
}

export async function bevorHealthItem(launch: string) {
  return bevorItem(await getBevorAudit(launch));
}

function due(r: BevorAudit | null): boolean {
  if (!r) return true;
  const age = Date.now() - r.checkedAt.getTime();
  if (r.status === 'done') return false; // deployed code doesn't change
  if (r.status === 'running' || r.status === 'pending') return age >= POLL_MS;
  return r.attempts < MAX_ATTEMPTS && age >= RETRY_MS; // unsupported / failed
}

/** Advance one launch's audit by one step if it is due. Never throws. */
export function auditLaunch(launch: string, tokenAddress?: string | null): Promise<void> {
  const p = chain.then(() => step(lc(launch), tokenAddress ? lc(tokenAddress) : null)).catch((e) => console.error('bevor audit failed', launch, e?.message));
  chain = p;
  return p;
}

/** Called from CTO sync: polls running audits and starts at most `maxNew` new ones per run. */
export async function auditAllLaunches(maxNew = 3) {
  if (!getClient() || Date.now() < breakerUntil) return;
  const [rows, audits] = await Promise.all([
    prisma.tokenCTO.findMany({ select: { launchAddress: true, tokenAddress: true }, orderBy: { createdAt: 'desc' } }),
    prisma.bevorAudit.findMany(),
  ]);
  const byLaunch = new Map(audits.map((a) => [a.launchAddress, a]));
  let started = 0;
  for (const r of rows) {
    const a = byLaunch.get(r.launchAddress) ?? null;
    if (!due(a)) continue;
    if (!a || a.status !== 'running') { if (started >= maxNew) continue; started++; }
    await auditLaunch(r.launchAddress, r.tokenAddress);
  }
}

async function step(launch: string, token: string | null) {
  const c = getClient();
  if (!c || Date.now() < breakerUntil) return;
  const row = await prisma.bevorAudit.findUnique({ where: { launchAddress: launch } });
  if (!due(row)) return;
  try {
    if (row?.status === 'running' && row.analysisId) await poll(c, row);
    else await start(c, launch, token ?? (await prisma.tokenCTO.findUnique({ where: { launchAddress: launch }, select: { tokenAddress: true } }))?.tokenAddress ?? null, row);
  } catch (e: any) {
    breakerUntil = Date.now() + BREAKER_MS;
    const msg = String(e?.message ?? e).slice(0, 300);
    await prisma.bevorAudit.upsert({
      where: { launchAddress: launch },
      create: { launchAddress: launch, status: 'failed', error: msg, attempts: 1 },
      update: row?.status === 'running' ? { checkedAt: new Date(), error: msg } : { status: 'failed', error: msg, checkedAt: new Date(), attempts: { increment: 1 } },
    });
    throw e;
  }
}

async function start(c: BevorClient, launch: string, token: string | null, row: BevorAudit | null) {
  const targets = Array.from(new Set([token, launch].filter(Boolean) as string[]));
  let code: { id: string; target: string } | null = null;
  for (const address of targets) {
    try {
      const v = await c.codes.createScan({ address, chain_id: BEVOR_CHAIN_ID });
      if (v.status === 'failed') continue;
      code = { id: v.id, target: address };
      break;
    } catch (e) {
      if (!isUnsupported(e)) throw e;
    }
  }
  const now = new Date();
  const attempts = (row?.attempts ?? 0) + 1;
  if (!code) {
    const data = { status: 'unsupported', target: null, error: 'Contract source is not verified on the explorer.', checkedAt: now, attempts };
    await prisma.bevorAudit.upsert({ where: { launchAddress: launch }, create: { launchAddress: launch, ...data }, update: data });
    return;
  }
  const created = await c.analyses.createRoot({ code_id: code.id, on_collision: 'force', name: `polypad ${launch}` });
  if (!created.is_created) throw new Error('Bevor did not create an analysis.');
  const analysisId = created.analysis.id;
  await c.analyses.run(analysisId, { mode: 'first_party' } as never);
  const data = { status: 'running', target: code.target, codeId: code.id, analysisId, error: null, checkedAt: now, startedAt: now, attempts, critical: 0, high: 0, medium: 0, low: 0, nFindings: 0, completedAt: null };
  await prisma.bevorAudit.upsert({ where: { launchAddress: launch }, create: { launchAddress: launch, ...data }, update: data });
}

async function poll(c: BevorClient, row: BevorAudit) {
  const id = row.analysisId!;
  const [a, eps] = await Promise.all([c.analyses.get(id), c.analyses.entrypoints(id)]);
  const statuses = eps.results.map((e) => e.pipeline_status);
  const active = a.version.has_pipeline_processing || statuses.some((s) => ACTIVE.has(s));
  const started = statuses.some((s) => s === 'success' || s === 'failed');
  const now = new Date();
  if (active || !started) {
    // Not started yet (queue lag) or still processing; give up after RUN_TIMEOUT_MS.
    const timedOut = now.getTime() - (row.startedAt ?? row.createdAt).getTime() > RUN_TIMEOUT_MS;
    await prisma.bevorAudit.update({ where: { launchAddress: row.launchAddress }, data: timedOut ? { status: 'failed', error: 'Audit did not finish in time.', checkedAt: now } : { checkedAt: now } });
    return;
  }
  const f = await c.analyses.listFindings(id);
  const n = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const x of f.results) if (x.level in n) n[x.level as keyof typeof n]++;
  await prisma.bevorAudit.update({
    where: { launchAddress: row.launchAddress },
    data: { status: 'done', ...n, nFindings: f.results.length, pipelineFailed: a.version.has_pipeline_failed, error: null, checkedAt: now, completedAt: now },
  });
}
