import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureCto, getCachedReport, isExternalRow, snapshotFor, syncCto } from '@/lib/cto/chain';
import { listPromises } from '@/lib/promises/summary';
import { evaluateLaunchPromises } from '@/lib/promises/evaluate';
import { getXray, scanLaunchXray } from '@/lib/xray/scan';
import { auditLaunch } from '@/lib/bevor/audit';
import { refreshBuild } from '@/lib/buildact/refresh';
import { getBuildView } from '@/lib/buildact/view';

export const dynamic = 'force-dynamic';

/** Hard ceiling for the whole handler — Vercel Hobby kills the function at 10s, so answer before then. */
const HANDLER_TIMEOUT_MS = 9_000;
/** How long to wait for a first report build inside one request. */
const REPORT_WAIT_MS = 7_000;

export async function GET(_req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  try {
    return await Promise.race([
      buildCtoResponse(launchAddress),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('CTO report timed out')), HANDLER_TIMEOUT_MS),
      ),
    ]);
  } catch (e: any) {
    console.error('cto report failed', launchAddress, e?.message);
    const timedOut = e?.message === 'CTO report timed out';
    return NextResponse.json(
      {
        error: timedOut
          ? 'The CTO report is taking too long to build right now. Please try again shortly.'
          : 'Could not build the CTO report right now. Try again shortly.',
        report: null,
        pending: false,
      },
      { status: timedOut ? 503 : 500 },
    );
  }
}

async function buildCtoResponse(launchAddress: string) {
  try {
    const row = await ensureCto(launchAddress);
    if (!row) return NextResponse.json({ error: 'Launch not found.' }, { status: 404 });
    syncCto().catch((e) => console.error('cto sync failed', e?.message));
    const external = isExternalRow(row);
    // Listed tokens: no launch contract, so X-ray (launch fairness) and the launch-contract review don't run.
    if (external) refreshBuild(row).catch(() => null);
    else evaluateLaunchPromises(row.launchAddress)
      .catch((e) => console.error('promise eval failed', e?.message))
      .finally(() => scanLaunchXray(row.launchAddress).catch((e) => console.error('xray scan failed', e?.message)))
      .finally(() => refreshBuild(row).catch(() => null))
      .finally(() => auditLaunch(row.launchAddress, row.tokenAddress));
    // Cached report returns instantly (refreshed in the background); the first build waits at most ~7s.
    const { report, refreshing } = await getCachedReport(row, REPORT_WAIT_MS);
    const [snapshots, alerts, profile, promises, xray, build] = await Promise.all([
      report ? snapshotFor(row, report) : Promise.resolve(null),
      prisma.cTOAlert.findMany({ where: { launchAddress: row.launchAddress }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.cTOProfile.findUnique({ where: { launchAddress: row.launchAddress } }),
      listPromises(row.launchAddress, row.symbol, report?.graduation?.event?.timestamp ?? null).catch(() => []),
      getXray(row.launchAddress),
      getBuildView(row.launchAddress).catch(() => null),
    ]);
    return NextResponse.json({
      report,
      external,
      pending: !report,
      refreshing,
      snapshots,
      promises,
      xray,
      build,
      alerts: alerts.map((a) => ({ id: a.id, type: a.type, message: a.message, txHash: a.txHash, createdAt: a.createdAt.toISOString() })),
      profile: profile ? { tone: profile.tone, socials: profile.socials, faqs: profile.faqs, plan: profile.plan, updatedAt: profile.updatedAt.toISOString() } : null,
    });
  } catch (e: any) {
    console.error('cto report failed', launchAddress, e?.message);
    return NextResponse.json({ error: 'Could not build the CTO report right now. Try again shortly.' }, { status: 500 });
  }
}
