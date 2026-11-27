import { NextResponse } from 'next/server';
import { prisma, withTimeout } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audits — public queue of Warden audit requests, oldest first.
 * That order IS the review order: Warden reviews the oldest queued request
 * first. Contact details are never returned — they are for the fix round only.
 */
export async function GET() {
  // 4s read budget (not the 800ms house default): a cold Neon compute takes
  // seconds to wake from scale-to-zero, and a first-visit 503 on the public
  // queue is worse than a slower first paint. Still well inside the 10s
  // Vercel Hobby function budget.
  const rows = await withTimeout(
    prisma.wardenAuditRequest.findMany({
      select: {
        id: true,
        projectName: true,
        repoUrl: true,
        commitHash: true,
        contractsInScope: true,
        chain: true,
        deployedAddresses: true,
        description: true,
        status: true,
        verdict: true,
        reportUrl: true,
        createdAt: true,
        reviewedAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    4000,
  );
  if (rows === null) {
    return NextResponse.json({ error: 'Could not load the queue right now.' }, { status: 503 });
  }
  return NextResponse.json({ requests: rows }, { headers: { 'cache-control': 'no-store' } });
}
