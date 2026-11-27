import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/db';
import { PARTNERSHIP_TYPE_OPTIONS, PARTNER_EMAIL } from '@/lib/partnerships/data';

export const dynamic = 'force-dynamic';

// In-memory per-IP rate limit (same shape as the demo-request route):
// 1 request per 10 seconds, 20 per UTC day.
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
 * POST /api/partnerships/inquiry — partnership inquiry from /build/partnerships.
 * Always stores the inquiry in Neon (PartnerInquiry). Then tries to email it
 * to jon@dasheco.xyz via Zoho SMTP (password from ZOHO_SMTP_PASSWORD). If
 * the secret is not set, the submission still succeeds and the response
 * carries emailPending: true — the inquiry is never lost.
 */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Partnership inquiries are not configured yet.' }, { status: 503 });
  }

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
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const name = str(b.name, 120);
  const company = str(b.company, 200);
  const email = str(b.email, 200).toLowerCase();
  const website = str(b.website, 300);
  const type = str(b.type, 40);
  const message = str(b.message, 5000);

  if (!name) return NextResponse.json({ error: 'Please tell us your name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid work email address.' }, { status: 400 });
  if (!(PARTNERSHIP_TYPE_OPTIONS as readonly string[]).includes(type)) {
    return NextResponse.json({ error: 'Pick a partnership type.' }, { status: 400 });
  }
  if (!message || message.length < 10) {
    return NextResponse.json({ error: 'Tell us a little about your project (at least a sentence).' }, { status: 400 });
  }

  let row;
  try {
    row = await prisma.partnerInquiry.create({
      data: { name, company: company || null, email, website: website || null, type, message },
    });
  } catch (e: unknown) {
    console.error('partner inquiry save failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not save your inquiry. Please try again shortly.' }, { status: 500 });
  }

  // Email the submission to Jon. ZOHO_SMTP_PASSWORD is not set in any
  // environment yet — when it lands, this sends without any code change.
  const smtpPassword = process.env.ZOHO_SMTP_PASSWORD;
  if (!smtpPassword) {
    return NextResponse.json({ ok: true, id: row.id, emailPending: true }, { status: 201 });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: { user: 'jon@dasheco.xyz', pass: smtpPassword },
    });
    await transporter.sendMail({
      from: 'jon@dasheco.xyz',
      to: PARTNER_EMAIL,
      replyTo: email,
      subject: `New partnership inquiry: ${company || name} (${type})`,
      text: [
        `New partnership inquiry from polypad.family/build/partnerships`,
        ``,
        `Name: ${name}`,
        `Company / project: ${company || '—'}`,
        `Email: ${email}`,
        `Website: ${website || '—'}`,
        `Partnership type: ${type}`,
        ``,
        `Message:`,
        message,
      ].join('\n'),
    });
    await prisma.partnerInquiry.update({ where: { id: row.id }, data: { emailSent: true } });
    return NextResponse.json({ ok: true, id: row.id, emailPending: false }, { status: 201 });
  } catch (e: unknown) {
    // Never lose the submission because email failed: it is stored in Neon.
    console.error('partner inquiry email failed', (e as Error)?.message);
    return NextResponse.json({ ok: true, id: row.id, emailPending: true }, { status: 201 });
  }
}
