import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { syncCto } from '@/lib/cto/chain';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!isAddress(address, { strict: false })) return NextResponse.json({ error: 'Enter a valid 0x address.' }, { status: 400 });
  try {
    await Promise.race([
      syncCto().catch((e) => console.error('cto sync failed', e?.message)),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    const rows = await prisma.tokenCTO.findMany({ where: { creator: address.toLowerCase() }, orderBy: { createdAt: 'desc' }, take: 100 });
    return NextResponse.json({
      tokens: rows.map((r) => ({ launchAddress: r.launchAddress, tokenAddress: r.tokenAddress, symbol: r.symbol, name: r.name, imageUri: r.imageUri, agentName: r.agentName })),
    });
  } catch (e: any) {
    console.error('cto by-creator failed', e?.message);
    return NextResponse.json({ error: 'Could not load your tokens right now.' }, { status: 500 });
  }
}
