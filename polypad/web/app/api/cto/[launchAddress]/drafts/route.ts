import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { ensureCto, getReport } from '@/lib/cto/chain';
import { cookieName, readSession } from '@/lib/cto/session';
import { buildDrafts } from '@/lib/cto/posts';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';

export const dynamic = 'force-dynamic';

/** Post drafts are creator-only: requires the signed creator session cookie for this launch. */
export async function GET(req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  try {
    const row = await ensureCto(launchAddress);
    if (!row) return NextResponse.json({ error: 'Launch not found.' }, { status: 404 });
    const jar = await cookies();
    const addr = readSession(jar.get(cookieName(row.launchAddress))?.value, row.launchAddress);
    if (!addr) return NextResponse.json({ error: 'Only the token creator can generate posts. Sign in on the Manage page first.' }, { status: 401 });
    const wallet = (new URL(req.url).searchParams.get('address') ?? '').toLowerCase();
    if (addr !== row.creator || (wallet && wallet !== addr)) return NextResponse.json({ error: 'Only the token creator can generate posts.' }, { status: 403 });

    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const url = `${host ? `${proto}://${host}` : new URL(req.url).origin}/token/${row.launchAddress}`;
    const r = await getReport(row);
    const drafts = buildDrafts({
      symbol: r.cto.symbol, name: r.cto.name, url,
      curvePct: r.graduation.curvePct, ethRaised: r.graduation.ethRaised, threshold: r.graduation.threshold,
      holders: r.holders.count, top10Pct: r.holders.top10Pct, health: r.health.score, graduated: r.graduation.graduated,
      day: new Date(r.generatedAt).toISOString().slice(0, 10),
      grad: r.graduation.event, pools: r.stakingPools, explorerAddress: getExplorerAddressUrl,
    });
    return NextResponse.json({ drafts, url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    console.error('cto drafts failed', launchAddress, e?.message);
    return NextResponse.json({ error: 'Could not build post drafts right now.' }, { status: 500 });
  }
}
