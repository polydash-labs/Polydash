// Build activity: anti-gaming filters and the score formula. Pure (no I/O). Price and volume are never inputs.
import { BUILD_POINTS, type BuildMetrics, type BuildStatus } from './shared';

const DAY = 86_400_000;

export interface RawCommit {
  repo: string; sha: string; message: string; author: string; isBot: boolean; at: number; parents: number; url: string;
  /** Fork repos: false when the commit is inherited from the parent (not ahead of it). */
  ahead: boolean;
  /** Sampled diff (from the commit detail): total changed lines and file paths. */
  stats?: { total: number; files: string[] } | null;
}
export interface CommitVerdict extends RawCommit { counted: boolean; reason: string | null }

const TRIVIAL = /^(wip|update|updates|updated|fix|fixes|test|tests|testing|commit|changes|change|minor|typo|tmp|temp|asdf|aaa+|x+|\.+|-+|ok|done|save|stuff|misc|cleanup|init|initial commit|first commit|update readme(\.md)?|readme|update \S+\.md)$/i;
const DOC_OR_LOCK = /(^|\/)(docs?\/.*|readme[^/]*|license[^/]*|changelog[^/]*|contributing[^/]*|.*\.(md|mdx|txt|rst)|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|cargo\.lock|poetry\.lock|go\.sum|composer\.lock|gemfile\.lock)$/i;
const BOT = /\[bot\]$|(^|[-_])bot$|^dependabot|^renovate|^github-actions|^actions-user/i;

export function isBotAuthor(login: string, type?: string | null) { return type === 'Bot' || BOT.test(login); }

/**
 * Rules (in order): merges, bot authors, trivial messages, inherited fork commits, sampled diffs under 3 lines or
 * touching only docs/lockfiles; then at most 10 commits per author per day; more than 30 in one hour collapse to one batch.
 */
export function filterCommits(commits: RawCommit[]): CommitVerdict[] {
  const sorted = [...commits].sort((a, b) => a.at - b.at);
  const out: CommitVerdict[] = sorted.map((c) => {
    const msg = c.message.split('\n')[0].trim();
    let reason: string | null = null;
    if (c.parents > 1 || /^merge (pull request|branch|remote-tracking)/i.test(msg)) reason = 'Merge commit';
    else if (c.isBot || isBotAuthor(c.author)) reason = 'Bot author';
    else if (msg.length < 4 || TRIVIAL.test(msg)) reason = 'Trivial message';
    else if (!c.ahead) reason = 'Inherited from the parent repo (fork)';
    else if (c.stats && c.stats.total < 3) reason = 'Change under 3 lines';
    else if (c.stats && c.stats.files.length > 0 && c.stats.files.every((f) => DOC_OR_LOCK.test(f))) reason = 'Docs or lockfile only';
    return { ...c, counted: !reason, reason };
  });
  const perAuthorDay = new Map<string, number>();
  for (const c of out) {
    if (!c.counted) continue;
    const k = `${c.author.toLowerCase()}:${new Date(c.at).toISOString().slice(0, 10)}`;
    const n = (perAuthorDay.get(k) ?? 0) + 1;
    perAuthorDay.set(k, n);
    if (n > 10) { c.counted = false; c.reason = 'Over 10 commits by one author that day'; }
  }
  const perHour = new Map<string, CommitVerdict[]>();
  for (const c of out) {
    if (!c.counted) continue;
    const k = `${c.repo}:${Math.floor(c.at / 3_600_000)}`;
    perHour.set(k, [...(perHour.get(k) ?? []), c]);
  }
  for (const list of Array.from(perHour.values())) {
    if (list.length <= 30) continue;
    list.slice(1).forEach((c) => { c.counted = false; c.reason = 'Part of a burst over 30 commits in one hour (counted once)'; });
  }
  return out;
}

export interface ScoreInput {
  now: number;
  hasRepo: boolean;
  anyConfirmed: boolean;
  /** A linked repo was created more than 24 h after launch and is under 30 days old. */
  youngPostLaunchRepo: boolean;
  /** Counted commits from non-archived repos. */
  commits: { at: number; author: string }[];
  releases: number[]; // timestamps (releases, or tags when a repo has no releases)
  contracts: { at: number; verified: boolean }[]; // counted deployments
}

function decay(daysSince: number | null): number {
  if (daysSince == null) return 0;
  if (daysSince <= 14) return 1;
  if (daysSince <= 60) return 1 - 0.5 * ((daysSince - 14) / 46);
  if (daysSince <= 120) return 0.5 - 0.3 * ((daysSince - 60) / 60);
  if (daysSince <= 180) return 0.2 - 0.2 * ((daysSince - 120) / 60);
  return 0;
}

/**
 * Build = recent code 0–6 + releases 0–3 + on-chain deploys 0–4 (incl. +1 verified) + contributors 0–2 (max 15),
 * times inactivity decay. Caps: no repo → on-chain part only; signature-only repos max 10; confirmed max 15;
 * repo created after launch and under 30 days old max 8. Never negative.
 */
export function scoreBuild(i: ScoreInput): { earned: number; status: BuildStatus; metrics: BuildMetrics } {
  const since = (d: number) => i.now - d * DAY;
  const c7 = i.commits.filter((c) => c.at >= since(7)).length;
  const c30 = i.commits.filter((c) => c.at >= since(30)).length;
  const c90 = i.commits.filter((c) => c.at >= since(90));
  const contributors = new Set(c90.map((c) => c.author.toLowerCase())).size;
  const rel90 = i.releases.filter((t) => t >= since(90)).length;
  const recentContracts = i.contracts.filter((c) => c.at >= since(180));
  const verified = i.contracts.filter((c) => c.verified).length;

  const code = !i.hasRepo ? 0 : c30 >= 20 ? 6 : c30 >= 10 ? 5 : c30 >= 5 ? 4 : c30 >= 2 ? 3 : c30 >= 1 ? 2 : 0;
  const releases = !i.hasRepo ? 0 : Math.min(3, rel90);
  const n = recentContracts.length;
  const onchain = Math.min(4, (n >= 3 ? 3 : n >= 1 ? 2 : 0) + (recentContracts.some((c) => c.verified) ? 1 : 0));
  const contrib = !i.hasRepo ? 0 : contributors >= 3 ? 2 : contributors >= 2 ? 1 : 0;

  const lastCommit = i.commits.length ? Math.max(...i.commits.map((c) => c.at)) : null;
  const shipTimes = [...(lastCommit ? [lastCommit] : []), ...i.releases, ...i.contracts.map((c) => c.at)];
  const lastShip = shipTimes.length ? Math.max(...shipTimes) : null;
  const daysSince = lastShip == null ? null : (i.now - lastShip) / DAY;
  const d = decay(daysSince);
  const cap = !i.hasRepo ? BUILD_POINTS : i.youngPostLaunchRepo ? 8 : i.anyConfirmed ? 15 : 10;
  const raw = code + releases + onchain + contrib;
  const earned = Math.max(0, Math.min(cap, BUILD_POINTS, raw * d));
  const status: BuildStatus = lastShip == null ? 'none' : daysSince! <= 14 ? 'shipping' : daysSince! <= 60 ? 'slowing' : 'quiet';
  const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString());
  return {
    earned: Math.round(earned * 10) / 10,
    status,
    metrics: {
      lastCommitAt: iso(lastCommit), lastShipAt: iso(lastShip), commits7: c7, commits30: c30, contributors,
      contracts: i.contracts.length, contractsVerified: verified, releases90: rel90,
      parts: { code, releases, onchain, contributors: contrib, decay: Math.round(d * 100) / 100, cap, raw },
    },
  };
}
