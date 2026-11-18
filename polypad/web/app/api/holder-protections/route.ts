import { NextResponse } from 'next/server';
import { getAllHolderProtections } from '@/lib/holder-protections';

export const dynamic = 'force-dynamic';

/** Batch for lists: { items: { [launchLower]: { passed, allPassed, tier, token, creatorPools } } | null }. */
export async function GET() {
  const items = await getAllHolderProtections();
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
}
