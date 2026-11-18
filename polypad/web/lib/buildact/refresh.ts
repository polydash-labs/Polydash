// Build activity refresh: GitHub + explorer collection, filters, score, timeline and alerts. Server only.
// Runs only in the background (CTO sync and the CTO GET background chain after X-ray). Pages read the cache.
// Throttled per token (6 h unauthenticated, 1 h with GITHUB_TOKEN); never calls Swarms; read-only on-chain.
import crypto from 'crypto';
import type { TokenCTO } from '@prisma/client';
import { prisma } from '@/lib/db';
import { addAlerts, FACTORIES } from '@/lib/cto/chain';
import { getFactoryAddresses } from '@/lib/contracts/addresses';
import { STATIC_KNOWN } from '@/lib/xray/config';
import { explorerList, explorerV2 } from '@/lib/xray/blockscout';
import { STAKING_FACTORY_V2, listPoolAddresses, cached } from '@/lib/agents/tools';
import { gh, ghCacheOnly, hasGithubToken, githubBudgetLeft, GithubPaused, type GhResult } from './github';
import { filterCommits, isBotAuthor, scoreBuild, type RawCommit } from './score';
import { BUILD_CHAIN_ID, EXPLORER, type BuildFlag, type BuildStatus } from './shared';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ALERT_BUCKET_MS = 6 * HOUR;
const MAX_SC_LOOKUPS = 15;
const SAMPLE_PER_REPO = 3;
const lc = (a: unknown) => String(a ?? '').toLowerCase();
const interval = () => (hasGithubToken() ? HOUR : 6 * HOUR);

export const FLAG_TEXT: Record<string, Omit<BuildFlag, 'id'>> = {
  repo_after_launch: { label: 'Repo created after launch', detail: 'A linked repo was created more than 24 hours after the token launched.' },
  archived: { label: 'Archived repo', detail: 'Archived repos stay on the timeline but earn no new points.' },
  fork: { label: 'Fork', detail: 'Only commits ahead of the parent repo count.' },
  repo_missing: { label: 'Repo not found', detail: 'A linked repo is private, renamed or deleted.' },
  deploy_spam: { label: 'Repeated deploys', detail: 'Identical contract bytecode deployed many times counts once.' },
  partial: { label: 'Partial data', detail: 'GitHub or the explorer limited requests. Showing the last good data.' },
};
const flag = (id: string): BuildFlag => ({ id, ...FLAG_TEXT[id] });

interface ShipRow { kind: string; title: string; url: string; at: Date; filtered: boolean; reason: string | null; dedupeKey: string }

// ---------- GitHub ----------
interface RepoMeta { fullName: string; url: string; archived: boolean; fork: boolean; createdAt: string | null; missing: boolean; confirmed: boolean }

async function getOr(path: string, maxAge: number, state: { partial: boolean }): Promise<GhResult | null> {
  try { return await gh(path, maxAge); } catch (e) {
    state.partial = true;
    if (!(e instanceof GithubPaused)) console.error('build github request failed', path.split('?')[0], (e as Error)?.message);
    return ghCacheOnly(path);
  }
}

function decodeConfirm(body: any, token: string, launch: string): boolean {
  try {
    const txt = Buffer.from(String(body?.content ?? ''), 'base64').toString('utf8');
    const j = JSON.parse(txt);
    const t = lc(j?.token);
    return Number(j?.chainId) === BUILD_CHAIN_ID && (t === token || t === launch);
  } catch { return false; }
}

async function collectRepo(repo: string, row: TokenCTO, state: { partial: boolean }) {
  const meta: RepoMeta = { fullName: repo, url: `https://github.com/${repo}`, archived: false, fork: false, createdAt: null, missing: false, confirmed: false };
  const r = await getOr(`/repos/${repo}`, 0, state);
  if (!r) return { meta, commits: [] as RawCommit[], releases: [] as ShipRow[], releaseTimes: [] as number[] };
  if (r.status === 404 || !r.body) { meta.missing = r.status === 404; return { meta, commits: [], releases: [], releaseTimes: [] }; }
  const b = r.body;
  Object.assign(meta, { fullName: b.full_name ?? repo, url: b.html_url ?? meta.url, archived: !!b.archived, fork: !!b.fork, createdAt: b.created_at ?? null });
  const full = meta.fullName;
  const since = new Date(Math.floor((Date.now() - 90 * DAY) / DAY) * DAY).toISOString(); // day-stable URL keeps the ETag useful

  const c = await getOr(`/repos/${full}/commits?since=${since}&per_page=100`, 0, state);
  const list: any[] = Array.isArray(c?.body) ? c!.body : [];

  // Forks: only commits ahead of the parent count.
  let ahead: Set<string> | null = null;
  if (meta.fork && b.parent?.full_name) {
    const p = b.parent;
    const cmp = await getOr(`/repos/${p.full_name}/compare/${p.owner?.login}:${p.default_branch}...${b.owner?.login}:${b.default_branch}`, 6 * HOUR, state);
    ahead = new Set(((cmp?.body?.commits as any[]) ?? []).map((x) => x.sha));
  }

  const commits: RawCommit[] = list.map((x) => ({
    repo: full, sha: x.sha, message: String(x.commit?.message ?? ''),
    author: x.author?.login ?? x.commit?.author?.email ?? x.commit?.author?.name ?? 'unknown',
    isBot: isBotAuthor(x.author?.login ?? x.commit?.author?.name ?? '', x.author?.type),
    at: new Date(x.commit?.author?.date ?? x.commit?.committer?.date ?? 0).getTime(), parents: (x.parents ?? []).length,
    url: x.html_url ?? `https://github.com/${full}/commit/${x.sha}`, ahead: ahead ? ahead.has(x.sha) : true, stats: null,
  })).filter((x) => x.at > 0);

  // Sampled diffs: newest few commits that look countable. Commit details are immutable, so cached forever.
  const candidates = commits.filter((x) => x.parents <= 1 && !x.isBot && x.ahead).sort((a, z) => z.at - a.at);
  let sampled = 0;
  for (const x of candidates) {
    const cachedHit = await ghCacheOnly(`/repos/${full}/commits/${x.sha}`);
    let d = cachedHit;
    if (!d && sampled < SAMPLE_PER_REPO && githubBudgetLeft() > 6) { sampled++; d = await getOr(`/repos/${full}/commits/${x.sha}`, Infinity, state); }
    if (d?.body) x.stats = { total: Number(d.body.stats?.total ?? 0), files: ((d.body.files as any[]) ?? []).map((f) => String(f.filename ?? '')) };
    if (!d && sampled >= SAMPLE_PER_REPO) break;
  }

  const rel = await getOr(`/repos/${full}/releases?per_page=20`, 0, state);
  const releases: ShipRow[] = [];
  for (const x of (Array.isArray(rel?.body) ? rel!.body : []) as any[]) {
    if (x.draft) continue;
    const at = new Date(x.published_at ?? x.created_at ?? 0);
    if (!at.getTime()) continue;
    releases.push({ kind: 'release', title: `${full}: release ${String(x.name || x.tag_name).slice(0, 80)}`, url: x.html_url, at, filtered: false, reason: null, dedupeKey: `${row.launchAddress}:release:${full}:${x.id}` });
  }
  if (!releases.length) {
    // Tags only when a repo has no releases. Dated via the tag's commit (immutable, cached forever), top 2.
    const tags = await getOr(`/repos/${full}/tags?per_page=20`, 6 * HOUR, state);
    for (const t of ((Array.isArray(tags?.body) ? tags!.body : []) as any[]).slice(0, 2)) {
      const d = await getOr(`/repos/${full}/commits/${t.commit?.sha}`, Infinity, state);
      const at = new Date(d?.body?.commit?.committer?.date ?? 0);
      if (!at.getTime()) continue;
      releases.push({ kind: 'tag', title: `${full}: tag ${String(t.name).slice(0, 80)}`, url: `https://github.com/${full}/releases/tag/${encodeURIComponent(t.name)}`, at, filtered: false, reason: null, dedupeKey: `${row.launchAddress}:tag:${full}:${t.name}` });
    }
  }
  await getOr(`/repos/${full}/contributors?per_page=30`, DAY, state); // cached for display/reference; score uses filtered commit authors
  const conf = await getOr(`/repos/${full}/contents/polypad.json`, 6 * HOUR, state);
  meta.confirmed = conf?.status === 200 && decodeConfirm(conf.body, row.tokenAddress, row.launchAddress);
  return { meta, commits, releases, releaseTimes: releases.map((x) => x.at.getTime()) };
}

// ---------- explorer ----------
async function exclusions(row: TokenCTO): Promise<Set<string>> {
  const [pools, others] = await Promise.all([
    cached('build:pools', () => listPoolAddresses(), 10 * 60_000).catch(() => []),
    prisma.tokenCTO.findMany({ select: { launchAddress: true, tokenAddress: true } }).catch(() => []),
  ]);
  return new Set([
    row.tokenAddress, row.launchAddress, ...FACTORIES, ...getFactoryAddresses(), ...STATIC_KNOWN, STAKING_FACTORY_V2,
    ...pools.map((p) => p.address), ...others.flatMap((o) => [o.launchAddress, o.tokenAddress]),
  ].map(lc));
}

interface ContractRow { address: string; at: number; tx: string; deployer: string }
const PLATFORM_NAME = /^(Polydash|Polypad)\w*(Factory|Pool|Hook|Vault|Launch|Router)$/i;

async function collectChain(row: TokenCTO, wallets: string[], state: { partial: boolean }) {
  const skip = await exclusions(row);
  const found = new Map<string, ContractRow>();
  let ok = false;
  for (const w of wallets) {
    try {
      const common = { module: 'account', address: w, sort: 'desc', page: '1', offset: '100' };
      const [normal, internal] = await Promise.all([explorerList({ ...common, action: 'txlist' }), explorerList({ ...common, action: 'txlistinternal' })]);
      for (const t of normal) {
        const a = lc(t.contractAddress);
        if (a && !lc(t.to) && lc(t.from) === w && String(t.isError ?? '0') === '0') found.set(a, { address: a, at: Number(t.timeStamp) * 1000, tx: lc(t.hash), deployer: w });
      }
      for (const t of internal) {
        const a = lc(t.contractAddress);
        if (a && /^create/i.test(String(t.type ?? '')) && String(t.isError ?? '0') === '0' && !found.has(a)) found.set(a, { address: a, at: Number(t.timeStamp) * 1000, tx: lc(t.transactionHash ?? t.hash), deployer: w });
      }
      ok = true;
    } catch (e) { state.partial = true; console.error('build explorer list failed', (e as Error)?.message); break; }
  }
  const contracts = Array.from(found.values()).filter((c) => !skip.has(c.address) && c.at > 0).sort((a, b) => a.at - b.at);
  // Verified status + bytecode hash (identical-bytecode spam). Cached in GithubCache under an explorer: key.
  let lookups = 0;
  const info = new Map<string, { v: boolean; h: string | null; name: string | null }>();
  for (const c of contracts.slice(-40)) {
    const key = `explorer:sc:${c.address}`;
    const hit = await prisma.githubCache.findUnique({ where: { url: key } }).catch(() => null);
    const body = hit?.body as any;
    const fresh = hit && (body?.v || Date.now() - hit.fetchedAt.getTime() < DAY);
    if (fresh) { info.set(c.address, body); continue; }
    if (lookups >= MAX_SC_LOOKUPS) { if (body) info.set(c.address, body); continue; }
    lookups++;
    try {
      const sc = await explorerV2(`/smart-contracts/${c.address}`);
      const bc = String(sc?.deployed_bytecode ?? '');
      const v = { v: !!sc?.is_verified, h: bc.length > 2 ? crypto.createHash('sha256').update(bc).digest('hex').slice(0, 16) : null, name: sc?.name ? String(sc.name).slice(0, 60) : null };
      info.set(c.address, v);
      await prisma.githubCache.upsert({ where: { url: key }, create: { url: key, body: v, status: 200 }, update: { body: v, status: 200, fetchedAt: new Date() } }).catch(() => null);
    } catch { state.partial = true; if (body) info.set(c.address, body); break; }
  }
  const byHash = new Map<string, number>();
  for (const c of contracts) { const h = info.get(c.address)?.h; if (h) byHash.set(h, (byHash.get(h) ?? 0) + 1); }
  const seen = new Set<string>();
  let spam = false;
  const ships: ShipRow[] = [];
  const counted: { at: number; verified: boolean }[] = [];
  for (const c of contracts) {
    const i = info.get(c.address);
    if (i?.name && PLATFORM_NAME.test(i.name)) continue; // platform contracts (e.g. Polydash staking factories) never count
    let reason: string | null = null;
    if (i?.h && (byHash.get(i.h) ?? 0) >= 3) { if (seen.has(i.h)) { reason = 'Repeated identical bytecode'; spam = true; } else seen.add(i.h); }
    const label = i?.name ? `${i.name} ` : '';
    ships.push({ kind: 'contract', title: `Contract deployed: ${label}${c.address.slice(0, 6)}…${c.address.slice(-4)}${i?.v ? ' (verified)' : ''}`, url: `${EXPLORER}/address/${c.address}`, at: new Date(c.at), filtered: !!reason, reason, dedupeKey: `${row.launchAddress}:contract:${c.address}` });
    if (!reason) counted.push({ at: c.at, verified: !!i?.v });
  }
  return { ok, ships, counted, spam };
}

// ---------- HEY Research Lab (display only, never scored) ----------
async function heyLookup(token: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(`https://heyresearch.xyz/api/v1/builder?chain=${BUILD_CHAIN_ID}&token=${token}`, { signal: AbortSignal.timeout(3_000), cache: 'no-store', headers: { accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    const j: any = await res.json();
    if (j?.error) return null;
    const url = j?.project?.url ?? j?.url ?? j?.project_url ?? j?.scan_url ?? null;
    return typeof url === 'string' && /^https:\/\/([a-z0-9-]+\.)*heyresearch\.xyz\//i.test(url) ? url : null;
  } catch { return undefined; } // fail silently, keep the previous value
}

// ---------- refresh ----------
const inflight = new Map<string, Promise<void>>();

export function refreshBuild(row: TokenCTO, force = false): Promise<void> {
  const key = row.launchAddress;
  const running = inflight.get(key);
  if (running) return running;
  const p = runRefresh(row, force).catch((e) => console.error('build refresh failed', key, e?.message)).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function runRefresh(row: TokenCTO, force: boolean) {
  const launch = row.launchAddress;
  const prev = await prisma.buildActivity.findUnique({ where: { launchAddress: launch } });
  if (!force && prev && !prev.pending && Date.now() - (prev.lastChainAt?.getTime() ?? 0) < interval()) return;
  const links = await prisma.buildLink.findMany({ where: { launchAddress: launch, active: true }, orderBy: { createdAt: 'asc' } });
  const repos = links.filter((l) => l.kind === 'repo').map((l) => l.value);
  const wallets = Array.from(new Set([row.creator, ...links.filter((l) => l.kind === 'wallet').map((l) => l.value)].map(lc)));
  const state = { partial: false };

  // GitHub (skipped entirely when no repo is linked)
  const launchedAt = row.createdAt.getTime();
  const metas: RepoMeta[] = [];
  let commitsRaw: RawCommit[] = [];
  const releaseShips: ShipRow[] = [];
  const scoredReleases: number[] = [];
  const archivedRepos = new Set<string>();
  for (const r of repos) {
    const out = await collectRepo(r, row, state);
    metas.push(out.meta);
    commitsRaw = commitsRaw.concat(out.commits);
    releaseShips.push(...out.releases);
    if (out.meta.archived) archivedRepos.add(out.meta.fullName); else scoredReleases.push(...out.releaseTimes);
  }
  const verdicts = filterCommits(commitsRaw);
  const chain = await collectChain(row, wallets, state);

  // Proof upgrades (polypad.json); never downgrades on a failed/partial read.
  const repoLinks = links.filter((l) => l.kind === 'repo');
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    const l = repoLinks[i];
    const proof = m.confirmed ? 'confirmed' : 'signature';
    if (l && l.proof !== proof && (m.confirmed || !state.partial)) await prisma.buildLink.update({ where: { id: l.id }, data: { proof } }).catch(() => null);
  }
  const anyConfirmed = metas.some((m) => m.confirmed);
  const young = metas.some((m) => m.createdAt && new Date(m.createdAt).getTime() > launchedAt + DAY && Date.now() - new Date(m.createdAt).getTime() < 30 * DAY);
  const counted = verdicts.filter((v) => v.counted && !archivedRepos.has(v.repo));
  const scored = scoreBuild({
    now: Date.now(), hasRepo: metas.some((m) => !m.missing), anyConfirmed, youngPostLaunchRepo: young,
    commits: counted.map((v) => ({ at: v.at, author: v.author })), releases: scoredReleases, contracts: chain.counted,
  });

  const flags: BuildFlag[] = [];
  if (metas.some((m) => m.createdAt && new Date(m.createdAt).getTime() > launchedAt + DAY)) flags.push(flag('repo_after_launch'));
  if (archivedRepos.size) flags.push(flag('archived'));
  if (metas.some((m) => m.fork)) flags.push(flag('fork'));
  if (metas.some((m) => m.missing)) flags.push(flag('repo_missing'));
  if (chain.spam) flags.push(flag('deploy_spam'));
  if (state.partial) flags.push(flag('partial'));

  // Timeline rows
  const commitShips: ShipRow[] = verdicts.map((v) => ({
    kind: 'commit', title: `${v.repo}: ${v.message.split('\n')[0].trim().slice(0, 90) || '(no message)'}`, url: v.url, at: new Date(v.at),
    filtered: !v.counted, reason: v.reason ?? (archivedRepos.has(v.repo) ? 'Archived repo (shown, not scored)' : null), dedupeKey: `${launch}:commit:${v.repo}:${v.sha}`,
  }));
  const all = [...commitShips, ...releaseShips, ...chain.ships];
  const existing = new Map((await prisma.buildShip.findMany({ where: { launchAddress: launch, kind: { in: ['commit', 'release', 'tag', 'contract'] } }, select: { dedupeKey: true, filtered: true, reason: true } })).map((s) => [s.dedupeKey, s]));
  const fresh = all.filter((s) => !existing.has(s.dedupeKey));
  if (fresh.length) await prisma.buildShip.createMany({ data: fresh.map((s) => ({ ...s, launchAddress: launch, title: s.title.slice(0, 200), url: s.url.slice(0, 500) })), skipDuplicates: true });
  for (const s of all) {
    const e = existing.get(s.dedupeKey);
    if (e && (e.filtered !== s.filtered || e.reason !== s.reason)) await prisma.buildShip.update({ where: { dedupeKey: s.dedupeKey }, data: { filtered: s.filtered, reason: s.reason } }).catch(() => null);
  }

  // HEY Research Lab (6 h cache, display only)
  let heyUrl = prev?.heyUrl ?? null;
  let heyCheckedAt = prev?.heyCheckedAt ?? null;
  if (!heyCheckedAt || Date.now() - heyCheckedAt.getTime() > 6 * HOUR) {
    const h = await heyLookup(row.tokenAddress);
    if (h !== undefined) { heyUrl = h; heyCheckedAt = new Date(); }
  }

  // Nothing could be read on the first run: stay pending (neutral) and retry later.
  const nothing = !chain.ok && (repos.length === 0 || metas.every((m) => !m.createdAt && !m.missing));
  const keepPrev = nothing && prev && !prev.pending;
  const status: BuildStatus = nothing && !keepPrev ? 'pending' : (keepPrev ? (prev!.status as BuildStatus) : scored.status);
  const repoMeta = Object.fromEntries(metas.map((m, i) => [lc(repos[i]), { fullName: m.fullName, url: m.url, archived: m.archived, fork: m.fork, createdAt: m.createdAt, missing: m.missing }]));
  const data = keepPrev
    ? { partial: true, flags: [...((prev!.flags as any[]) ?? []).filter((f) => f.id !== 'partial'), flag('partial')] as any, lastChainAt: new Date(), heyUrl, heyCheckedAt }
    : {
      status, earned: nothing ? 7 : scored.earned, pending: nothing, partial: state.partial,
      metrics: { ...scored.metrics, repoMeta } as any, flags: flags as any,
      lastGithubAt: repos.length ? new Date() : prev?.lastGithubAt ?? null, lastChainAt: new Date(), heyUrl, heyCheckedAt,
    };
  await prisma.buildActivity.upsert({ where: { launchAddress: launch }, create: { metrics: {}, ...data, launchAddress: launch }, update: data });

  // Alerts: max 1 per type per token per 6 h, only after the first completed refresh.
  if (prev && !prev.pending && !keepPrev) {
    const bucket = Math.floor(Date.now() / ALERT_BUCKET_MS);
    const alerts: Parameters<typeof addAlerts>[0] = [];
    const rel = fresh.find((s) => (s.kind === 'release' || s.kind === 'tag') && s.at.getTime() > Date.now() - 7 * DAY);
    if (rel) alerts.push({ launchAddress: launch, type: 'build_release', message: `$${row.symbol} build: ${rel.title}`, dedupeKey: `build_release:${launch}:${bucket}` });
    const con = fresh.find((s) => s.kind === 'contract' && !s.filtered && s.at.getTime() > Date.now() - 7 * DAY);
    if (con) alerts.push({ launchAddress: launch, type: 'build_contract', message: `$${row.symbol} build: ${con.title}`, dedupeKey: `build_contract:${launch}:${bucket}` });
    if (status === 'quiet' && (prev.status === 'shipping' || prev.status === 'slowing')) alerts.push({ launchAddress: launch, type: 'build_quiet', message: `$${row.symbol} build activity went quiet (no ships in 60+ days).`, dedupeKey: `build_quiet:${launch}:${bucket}` });
    await addAlerts(alerts).catch(() => null);
  }
}

/** CTO sync step: refresh up to `max` due launches (never-refreshed first, then oldest). */
export async function refreshAllBuilds(max = 2) {
  const rows = await prisma.tokenCTO.findMany({ select: { launchAddress: true } });
  const acts = await prisma.buildActivity.findMany({ select: { launchAddress: true, lastChainAt: true, pending: true } });
  const at = new Map(acts.map((a) => [a.launchAddress, a]));
  const due = rows
    .map((r) => ({ r, a: at.get(r.launchAddress) }))
    .filter(({ a }) => !a || a.pending || Date.now() - (a.lastChainAt?.getTime() ?? 0) >= interval())
    .sort((x, y) => (x.a?.lastChainAt?.getTime() ?? 0) - (y.a?.lastChainAt?.getTime() ?? 0))
    .slice(0, max);
  for (const { r } of due) {
    const row = await prisma.tokenCTO.findUnique({ where: { launchAddress: r.launchAddress } });
    if (row) await refreshBuild(row);
  }
}
