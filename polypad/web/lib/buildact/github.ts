// Build activity: GitHub REST client with ETag caching (GithubCache) and a strict request budget. Server only.
// Uses `Authorization: Bearer GITHUB_TOKEN` only when that optional secret exists; otherwise unauthenticated,
// limited to 40 requests/hour from this process and paused whenever GitHub's own rate-limit headers say so.
// The token is never logged.
import { prisma } from '@/lib/db';

const API = 'https://api.github.com';
const BUDGET_PER_HOUR = 40;
const stamps: number[] = [];
let pausedUntil = 0;

export class GithubPaused extends Error {}

function token(): string | null {
  const t = process.env['GITHUB_TOKEN'];
  return t && /^[\x21-\x7e]{20,}$/.test(t) ? t : null;
}

export function hasGithubToken() { return !!token(); }

/** Requests still allowed this hour (unauthenticated budget; authenticated uses GitHub's headers only). */
export function githubBudgetLeft(): number {
  const now = Date.now();
  while (stamps.length && now - stamps[0] > 3_600_000) stamps.shift();
  if (now < pausedUntil) return 0;
  return token() ? 1000 : BUDGET_PER_HOUR - stamps.length;
}

/** Last cached body for a path (no request). */
export async function ghCacheOnly<T = any>(path: string): Promise<GhResult<T> | null> {
  const hit = await prisma.githubCache.findUnique({ where: { url: `${API}${path}` } }).catch(() => null);
  return hit ? { status: hit.status, body: (hit.status === 200 ? hit.body : null) as T, fromCache: true } : null;
}

export interface GhResult<T = any> { status: number; body: T | null; fromCache: boolean }

/**
 * GET a GitHub API path. Conditional request with the cached ETag; a 304 returns the cached body.
 * `maxAgeMs`: serve the cache without any request if it is younger (immutable data like commit details: Infinity).
 * Throws GithubPaused when the budget or GitHub's rate limit is exhausted (callers keep last good data).
 */
export async function gh<T = any>(path: string, maxAgeMs = 0): Promise<GhResult<T>> {
  const url = `${API}${path}`;
  const hit = await prisma.githubCache.findUnique({ where: { url } }).catch(() => null);
  if (hit && Date.now() - hit.fetchedAt.getTime() < maxAgeMs) return { status: hit.status, body: (hit.status === 200 ? hit.body : null) as T, fromCache: true };
  if (githubBudgetLeft() <= 0) throw new GithubPaused('GitHub budget used for this hour');
  stamps.push(Date.now());
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'PolypadBuildActivity/1.0 (+https://polypad.family)' };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (hit?.etag) headers['if-none-match'] = hit.etag;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000), cache: 'no-store' });

  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const retryAfter = Number(res.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) pausedUntil = Math.max(pausedUntil, Date.now() + retryAfter * 1000);
  if (res.headers.has('x-ratelimit-remaining') && remaining <= (t ? 50 : 10) && Number.isFinite(reset)) pausedUntil = Math.max(pausedUntil, reset * 1000);

  if (res.status === 304 && hit) {
    await prisma.githubCache.update({ where: { url }, data: { fetchedAt: new Date() } }).catch(() => null);
    return { status: hit.status, body: (hit.status === 200 ? hit.body : null) as T, fromCache: true };
  }
  if (res.status === 429 || (res.status === 403 && (remaining === 0 || res.headers.has('retry-after')))) {
    if (!(retryAfter > 0) && !(reset > 0)) pausedUntil = Math.max(pausedUntil, Date.now() + 15 * 60_000);
    throw new GithubPaused(`GitHub rate limited (${res.status})`);
  }
  if (res.status >= 500) throw new GithubPaused(`GitHub unavailable (${res.status})`);
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  if (res.status === 200 || res.status === 404 || res.status === 409) {
    // 404 = missing (repo/file); 409 = empty repo. Cached so they are not re-requested every run.
    const data = { etag: res.headers.get('etag'), body: (res.status === 200 ? body : null) ?? {}, status: res.status, fetchedAt: new Date() };
    await prisma.githubCache.upsert({ where: { url }, create: { url, ...data }, update: data }).catch(() => null);
  }
  return { status: res.status, body: res.status === 200 ? body : null, fromCache: false };
}
