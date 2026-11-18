import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { securityScan } from '@/lib/agents/tools';
import { getHolderProtections } from '@/lib/holder-protections';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!isAddress(address, { strict: false })) {
    return NextResponse.json({ error: 'Enter a valid 0x address.' }, { status: 400 });
  }
  try {
    const [report, holderProtections] = await Promise.all([securityScan(address), getHolderProtections(address).catch(() => null)]);
    return NextResponse.json({ ...report, holderProtections }, { headers: { 'Cache-Control': 'public, max-age=30' } });
  } catch (e: any) {
    console.error('security scan failed', e?.message);
    return NextResponse.json({ error: 'Security check failed. Try again shortly.' }, { status: 502 });
  }
}
