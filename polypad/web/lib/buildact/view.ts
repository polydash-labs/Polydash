// Build activity read side: DB cache only (no GitHub or explorer requests). Server only.
import { prisma } from '@/lib/db';
import type { BuildFlag, BuildMetrics, BuildScoreView, BuildStatus, BuildView, ShipKind, ShipView } from './shared';

const toShip = (s: { kind: string; title: string; url: string; at: Date; filtered: boolean; reason: string | null }): ShipView =>
  ({ kind: s.kind as ShipKind, title: s.title, url: s.url, at: s.at.toISOString(), filtered: s.filtered, reason: s.reason });

export async function getBuildView(launch: string, opts: { ships?: number } = {}): Promise<BuildView> {
  const a = launch.toLowerCase();
  const take = opts.ships ?? 20;
  const [act, links, ships, filtered, filteredCount] = await Promise.all([
    prisma.buildActivity.findUnique({ where: { launchAddress: a } }),
    prisma.buildLink.findMany({ where: { launchAddress: a, active: true }, orderBy: { createdAt: 'asc' } }),
    prisma.buildShip.findMany({ where: { launchAddress: a, filtered: false }, orderBy: { at: 'desc' }, take }),
    prisma.buildShip.findMany({ where: { launchAddress: a, filtered: true }, orderBy: { at: 'desc' }, take: 30 }),
    prisma.buildShip.count({ where: { launchAddress: a, filtered: true } }),
  ]);
  const m = (act?.metrics ?? null) as (BuildMetrics & { repoMeta?: Record<string, any> }) | null;
  const meta = m?.repoMeta ?? {};
  return {
    status: (act?.status ?? 'pending') as BuildStatus,
    earned: act?.earned ?? 7,
    pending: act ? act.pending : true,
    partial: act?.partial ?? false,
    updatedAt: act?.lastChainAt?.toISOString() ?? null,
    metrics: m && typeof m.commits7 === 'number' ? { lastCommitAt: m.lastCommitAt, lastShipAt: m.lastShipAt, commits7: m.commits7, commits30: m.commits30, contributors: m.contributors, contracts: m.contracts, contractsVerified: m.contractsVerified, releases90: m.releases90, parts: m.parts } : null,
    flags: ((act?.flags as unknown as BuildFlag[]) ?? []).filter((f) => f && f.id),
    repos: links.filter((l) => l.kind === 'repo').map((l) => {
      const r = meta[l.value.toLowerCase()];
      return { fullName: r?.fullName ?? l.value, url: r?.url ?? `https://github.com/${l.value}`, proof: l.proof === 'confirmed' ? 'confirmed' : 'signature', archived: !!r?.archived, fork: !!r?.fork, createdAt: r?.createdAt ?? null, linkedAt: l.createdAt.toISOString() };
    }),
    wallets: links.filter((l) => l.kind === 'wallet').map((l) => ({ address: l.value, linkedAt: l.createdAt.toISOString() })),
    ships: ships.map(toShip),
    filtered: filtered.map(toShip),
    filteredCount,
    heyUrl: act?.heyUrl ?? null,
  };
}

/** Health-score input: one row read. */
export async function getBuildScore(launch: string): Promise<BuildScoreView | null> {
  const act = await prisma.buildActivity.findUnique({ where: { launchAddress: launch.toLowerCase() }, select: { pending: true, earned: true, status: true, metrics: true } });
  if (!act) return null;
  const m = act.metrics as any;
  return { pending: act.pending, earned: act.earned, status: act.status as BuildStatus, metrics: m && typeof m.commits7 === 'number' ? m : null };
}

/** Cached build facts for a token or launch address (DB only). Null when not a known launch. */
export async function buildFactsForAddress(addr: string): Promise<string | null> {
  const a = addr.toLowerCase();
  const row = await prisma.tokenCTO.findFirst({ where: { OR: [{ launchAddress: a }, { tokenAddress: a }] }, select: { launchAddress: true } });
  return row ? buildFactsForChat(row.launchAddress) : null;
}

/** Short cached facts for PolyCTO chat (no network). */
export async function buildFactsForChat(launch: string): Promise<string | null> {
  const v = await getBuildView(launch, { ships: 5 }).catch(() => null);
  if (!v) return null;
  if (v.pending) return 'Build activity: still being checked (no data yet).';
  const m = v.metrics;
  const lines = [
    `Build activity status: ${v.status === 'none' ? 'No record' : v.status} (score ${Math.round(v.earned)}/15).`,
    m ? `Last commit: ${m.lastCommitAt ?? 'none'}; last ship: ${m.lastShipAt ?? 'none'}; commits 7d/30d: ${m.commits7}/${m.commits30}; contributors (90d): ${m.contributors}; contracts deployed: ${m.contracts} (${m.contractsVerified} verified); releases (90d): ${m.releases90}.` : '',
    `Linked repos: ${v.repos.map((r) => `${r.fullName} (${r.proof === 'confirmed' ? 'repo confirmed' : 'signature'})`).join(', ') || 'none'}.`,
    v.flags.length ? `Flags: ${v.flags.map((f) => f.label).join('; ')}.` : '',
    v.ships.length ? `Last ships: ${v.ships.map((s) => `${s.at.slice(0, 10)} ${s.title} (${s.url})`).join(' | ')}` : 'No ships recorded.',
    'Build activity is based on public GitHub and on-chain data and shows what was shipped, not whether it is safe.',
  ];
  return lines.filter(Boolean).join('\n');
}
