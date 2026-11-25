// Data for token link previews (page metadata + OG image). Reads only caches; never blocks long.
import { prisma } from '@/lib/db';
import { getCachedReport } from '@/lib/cto/chain';
import { getLaunchSnapshot } from '@/lib/launches-server';
import { formatUsd } from '@/lib/format';
import { PHASE, type LaunchToken } from '@/lib/token-types';

const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Health score from the cached CTO report, if one exists. Does not build a report. */
export async function cachedHealth(launch: string): Promise<number | null> {
  const row = await prisma.tokenCTO.findUnique({ where: { launchAddress: launch.toLowerCase() } }).catch(() => null);
  if (!row) return null;
  const { report } = await getCachedReport(row, 0);
  return report?.health?.score ?? null;
}

export async function getTokenPreview(address: string, waitMs = 3_000): Promise<{ token: LaunchToken | null; health: number | null }> {
  const token = await getLaunchSnapshot(address, waitMs);
  if (!token) return { token: null, health: null };
  const health = await within(cachedHealth(token.launchAddress), 1_500);
  return { token, health };
}

export function statusText(t: LaunchToken): string {
  if (t.graduated || t.phase === PHASE.Graduated) return 'Graduated';
  if (t.phase === PHASE.Pending) return 'Commitments open';
  if (t.phase === PHASE.Processing) return 'Processing';
  return `Bonding curve ${(t.curveProgress ?? 0).toFixed(1)}%`;
}

export function previewDescription(t: LaunchToken, health: number | null): string {
  const parts = [statusText(t)];
  if (t.marketCapUsd > 0) parts.push(`Market cap ${formatUsd(t.marketCapUsd)}`);
  if (health != null) parts.push(`Health ${health}/100`);
  return `${parts.join(' · ')}. ${t.name} ($${t.symbol}) on Polypad, Robinhood Chain.`;
}
