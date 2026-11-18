import { NextResponse } from 'next/server';
import { getHolderProtections } from '@/lib/holder-protections';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hp = /^0x[0-9a-fA-F]{40}$/.test(token) ? await getHolderProtections(token) : null;
  if (!hp) return NextResponse.json({ error: 'not_polypad_launch' }, { status: 404 });
  return NextResponse.json(hp, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
}
