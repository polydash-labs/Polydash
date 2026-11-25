import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { ensureCto } from '@/lib/cto/chain';
import { cookieName, readSession } from '@/lib/cto/session';
import { validateProfile } from '@/lib/cto/profile';

export const dynamic = 'force-dynamic';

async function creatorSession(launchAddress: string) {
  const row = await ensureCto(launchAddress);
  if (!row) return { row: null, signedIn: false };
  const jar = await cookies();
  const addr = readSession(jar.get(cookieName(row.launchAddress))?.value, row.launchAddress);
  return { row, signedIn: !!addr && addr === row.creator };
}

export async function GET(_req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  try {
    const { row, signedIn } = await creatorSession(launchAddress);
    if (!row) return NextResponse.json({ error: 'Launch not found.' }, { status: 404 });
    const p = await prisma.cTOProfile.findUnique({ where: { launchAddress: row.launchAddress } });
    return NextResponse.json({
      signedIn, creator: row.creator, symbol: row.symbol, name: row.name, imageUri: row.imageUri, tokenAddress: row.tokenAddress, agentName: row.agentName,
      profile: p ? { tone: p.tone, socials: p.socials, faqs: p.faqs, plan: p.plan, updatedAt: p.updatedAt.toISOString() } : null,
    });
  } catch (e: any) {
    console.error('cto profile read failed', e?.message);
    return NextResponse.json({ error: 'Could not load the profile.' }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  try {
    const { row, signedIn } = await creatorSession(launchAddress);
    if (!row) return NextResponse.json({ error: 'Launch not found.' }, { status: 404 });
    if (!signedIn) return NextResponse.json({ error: 'Sign in as the creator first.' }, { status: 401 });
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
    const v = validateProfile(body);
    if (!v.ok) return NextResponse.json({ error: v.errors.join(' '), errors: v.errors }, { status: 400 });
    const data = { tone: v.data.tone, socials: v.data.socials as any, faqs: v.data.faqs as any, plan: v.data.plan };
    const p = await prisma.cTOProfile.upsert({ where: { launchAddress: row.launchAddress }, create: { launchAddress: row.launchAddress, ...data }, update: data });
    await prisma.cTOAlert.create({ data: { launchAddress: row.launchAddress, type: 'profile', message: `The creator updated the official $${row.symbol} info.`, dedupeKey: `${row.launchAddress}:profile:${Date.now()}` } });
    return NextResponse.json({ ok: true, profile: { tone: p.tone, socials: p.socials, faqs: p.faqs, plan: p.plan, updatedAt: p.updatedAt.toISOString() } });
  } catch (e: any) {
    console.error('cto profile write failed', e?.message);
    return NextResponse.json({ error: 'Could not save the profile.' }, { status: 500 });
  }
}
