import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// In-memory per-IP rate limit (same shape as the audit request route):
// 1 request per 10 seconds, 20 per UTC day. A signup is cheap to fake, so
// the limit is the first line of defence against list-bombing.
const GAP_MS = 10_000;
const DAILY_LIMIT = 20;
const hits = new Map<string, { last: number; day: string; count: number }>();
function checkLimit(ip: string): { reply: string; retryAfter: number } | null {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const cur = hits.get(ip);
  const entry = cur && cur.day === day ? cur : { last: 0, day, count: 0 };
  if (now - entry.last < GAP_MS) {
    return { reply: 'Please wait a few seconds before trying again.', retryAfter: Math.ceil((GAP_MS - (now - entry.last)) / 1000) };
  }
  if (entry.count >= DAILY_LIMIT) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return { reply: "You've reached today's limit. Try again tomorrow.", retryAfter: Math.ceil((midnight - now) / 1000) };
  }
  entry.last = now;
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.day !== day) hits.delete(k);
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/newsletter/subscribe — join the Polypad updates list. Stores the
 * email in Neon (NewsletterSubscriber). An email already on the list is a
 * success, not an error — the caller just sees "you're subscribed."
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

  const raw = (body as Record<string, unknown>).email;
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  try {
    const row = await prisma.newsletterSubscriber.upsert({
      where: { email },
      update: { unsubscribedAt: null },
      create: { email, source: 'explore' },
    });
    return NextResponse.json({ ok: true, id: row.id, createdAt: row.createdAt }, { status: 201 });
  } catch (e: unknown) {
    console.error('newsletter subscribe failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not save your email. Please try again shortly.' }, { status: 500 });
  }
}
