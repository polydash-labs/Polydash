import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// In-memory per-IP rate limit for submissions (same shape as the agent chat
// route): 1 request per 30 seconds, 5 per UTC day. The queue is public, so
// spam costs Warden's review time — the limit is the first line of defence.
const GAP_MS = 30_000;
const DAILY_LIMIT = 5;
const hits = new Map<string, { last: number; day: string; count: number }>();
function checkLimit(ip: string): { reply: string; retryAfter: number } | null {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const cur = hits.get(ip);
  const entry = cur && cur.day === day ? cur : { last: 0, day, count: 0 };
  if (now - entry.last < GAP_MS) {
    return { reply: 'Please wait a few seconds before sending another request.', retryAfter: Math.ceil((GAP_MS - (now - entry.last)) / 1000) };
  }
  if (entry.count >= DAILY_LIMIT) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return { reply: "You've reached today's limit of 5 audit requests. Try again tomorrow.", retryAfter: Math.ceil((midnight - now) / 1000) };
  }
  entry.last = now;
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.day !== day) hits.delete(k);
  return null;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const clean = (v: string) => v.trim();
const COMMIT_RE = /^[0-9a-f]{40}$/i;

interface AuditRequestData {
  projectName: string;
  repoUrl: string;
  commitHash: string;
  contractsInScope: string;
  chain: string;
  deployedAddresses: string;
  description: string;
  contact: string;
}

function validate(body: Record<string, unknown>): { ok: true; data: AuditRequestData } | { ok: false; error: string } {
  const projectName = isStr(body.projectName) ? clean(body.projectName) : '';
  if (projectName.length < 2 || projectName.length > 80) return { ok: false, error: 'Project name must be 2–80 characters.' };

  const repoUrl = isStr(body.repoUrl) ? clean(body.repoUrl) : '';
  if (repoUrl.length > 500) return { ok: false, error: 'Repo link is too long.' };
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return { ok: false, error: 'Repo link must be a full URL, starting with https://.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Repo link must be a full URL, starting with https://.' };
  }

  const commitHash = isStr(body.commitHash) ? clean(body.commitHash) : '';
  if (!COMMIT_RE.test(commitHash)) {
    return { ok: false, error: 'Commit must be the full 40-character commit hash to review.' };
  }

  const contractsInScope = isStr(body.contractsInScope) ? clean(body.contractsInScope) : '';
  if (contractsInScope.length < 3 || contractsInScope.length > 2000) {
    return { ok: false, error: 'List the contracts in scope (file paths, one per line is fine).' };
  }

  const chainRaw = isStr(body.chain) ? clean(body.chain) : '';
  const chain = chainRaw === '' ? 'Robinhood Chain' : chainRaw;
  if (chain.length > 60) return { ok: false, error: 'Chain name is too long.' };

  const deployedAddresses = isStr(body.deployedAddresses) ? clean(body.deployedAddresses) : '';
  if (deployedAddresses.length > 1000) return { ok: false, error: 'Deployed addresses are too long.' };

  const description = isStr(body.description) ? clean(body.description) : '';
  if (description.length < 20 || description.length > 2000) {
    return { ok: false, error: 'Tell us what the contracts do in plain words (at least 20 characters).' };
  }

  const contact = isStr(body.contact) ? clean(body.contact) : '';
  if (contact.length < 3 || contact.length > 200 || /[\r\n]/.test(contact)) {
    return { ok: false, error: 'Leave a way to reach you for the fix round — an email or a Telegram handle.' };
  }

  return {
    ok: true,
    data: {
      projectName,
      repoUrl,
      commitHash: commitHash.toLowerCase(),
      contractsInScope,
      chain,
      deployedAddresses,
      description,
      contact,
    },
  };
}

/**
 * POST /api/audits/request — submit a Warden audit request. The request is
 * stored in the queue in arrival order; Warden reviews the oldest queued
 * request first. No email involved anywhere in the flow.
 */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const block = checkLimit(ip);
  if (block) {
    return NextResponse.json({ error: block.reply }, { status: 429, headers: { 'Retry-After': String(block.retryAfter) } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send the request as JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Send the request as JSON.' }, { status: 400 });
  }

  const checked = validate(body as Record<string, unknown>);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  try {
    const row = await prisma.wardenAuditRequest.create({ data: checked.data });
    return NextResponse.json(
      { ok: true, id: row.id, status: row.status, createdAt: row.createdAt },
      { status: 201 },
    );
  } catch (e: unknown) {
    console.error('audit request create failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not save the request. Please try again shortly.' }, { status: 500 });
  }
}
