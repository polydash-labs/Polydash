'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { CtoReport } from '@/lib/cto/chain';
import type { LaunchToken } from '@/lib/token-types';
import { xIntent } from '@/lib/cto/posts';
import { TokenAvatar } from '@/components/token-avatar';
import { CTO_FOOTER, type CtoProfileView } from '@/components/cto/cto-parts';
import { ErrorNote, KV, Panel, Pill, TokenCard, TxLink, fmtDate, num } from '@/app/agents/_components/ui';
import { CtoHolders } from './cto-holders';
import { CtoTools } from './cto-tools';
import { StakingCard } from './staking-card';
import { PromisesCard } from '@/components/cto/promises-card';
import { Tip, XrayCard, type XrayView } from '@/components/cto/xray-card';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import type { PromiseView } from '@/lib/promises/presets';
import { cn } from '@/lib/utils';
import { BuildCard } from '@/components/cto/build-card';
import { buildLine, type BuildView } from '@/lib/buildact/shared';
import { StakingRow } from '@/components/staking-badge';
import { HpChecklist } from '@/components/holder-protections';
import { usePendingStuck } from '@/lib/hooks/use-pending-stuck';

export const EXTERNAL_NOTE = "Listed token. Launched before the Polypad factory, so bonding-curve and launch-fairness data don't apply.";

type Snap = { day: string; holders: number; top10Pct: number; curvePct: number; ethRaised: number; graduated: boolean; healthScore: number; xrayLevel?: string | null; xraySniperPct?: number | null; xrayBundles?: number | null } | null;
interface CtoData {
  report: CtoReport | null;
  pending?: boolean;
  snapshots: { today: Snap; yesterday: Snap } | null;
  alerts: { id: string; type: string; message: string; txHash: string | null; createdAt: string }[];
  profile: CtoProfileView | null;
  promises?: PromiseView[];
  xray?: XrayView | null;
  build?: BuildView | null;
  external?: boolean;
}

const ALERT_LABEL: Record<string, string> = { milestone: 'Curve', graduation: 'Graduation', whale: 'Whale', staking: 'Staking', profile: 'Creator', commit: 'Commit', promise_kept: 'Promise kept', promise_broken: 'Promise broken', promise_review: 'Promise review', xray_dump: 'X-ray: selling', xray_new_cluster: 'X-ray: new flag', xray_level_change: 'X-ray' };
const alertTone = (t: string) => (t === 'promise_broken' || t === 'xray_dump' ? 'red' : t === 'promise_review' || t === 'whale' || t === 'xray_new_cluster' ? 'yellow' : t === 'graduation' || t === 'milestone' || t === 'promise_kept' ? 'green' : 'neutral') as 'red' | 'yellow' | 'green' | 'neutral';

/** Graduation ETA in friendly units: hours, days, weeks, months, or "1+ year" past 365 days. */
function friendlyEta(hours: number): string {
  const d = hours / 24;
  if (d > 365) return '1+ year at current pace';
  if (hours < 48) return `~${Math.round(hours)} hours`;
  if (d < 14) return `~${Math.round(d)} days`;
  if (d < 60) return `~${Math.round(d / 7)} weeks`;
  const m = Math.round(d / 30.44);
  return m >= 12 ? '~12 months' : `~${m} months`;
}

export function CtoSection({ token, external = false }: { token: LaunchToken; external?: boolean }) {
  const launch = token.launchAddress.toLowerCase();
  const ref = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  const stuckRef = useRef(false);
  const q = useQuery<CtoData>({
    queryKey: ['cto', launch],
    queryFn: async () => {
      const res = await fetch(`/api/cto/${launch}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API answers 503/500 JSON when the report can't be built (e.g. the
        // database is unreachable). Treat that as data — report null, not
        // pending — so the UI shows the "not available" panel instead of an
        // error note or endless skeletons. A 404 still throws: the launch is
        // genuinely unknown. A non-JSON error page normalises the same way.
        if (res.status === 404) throw new Error(data?.error ?? 'Could not load the CTO report.');
        const body = data && typeof data === 'object' ? data : {};
        return { ...body, report: null, pending: false } as CtoData;
      }
      return data as CtoData;
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d?.pending) return 60_000;
      // A build stuck for 30s+ polls slowly instead of every 3s — it is not going to finish on its own.
      return stuckRef.current ? 60_000 : 3_000;
    },
    staleTime: 30_000,
  });
  // True once the report has been pending for 30s straight: the build is stuck, so say so instead of spinning forever.
  const pendingStuck = usePendingStuck(q.data?.pending === true && !q.data?.report);
  stuckRef.current = pendingStuck;
  // True once the first load itself has been fetching for 30s straight (a hung
  // request): show the unavailable panel instead of skeletons that never end.
  const loadStuck = usePendingStuck(q.isLoading);

  useEffect(() => {
    if (scrolled.current || typeof window === 'undefined' || window.location.hash !== '#cto') return;
    if (q.data || q.isError) { scrolled.current = true; ref.current?.scrollIntoView({ block: 'start' }); }
  }, [q.data, q.isError]);

  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/token/${launch}` : `/token/${launch}`;

  return (
    <section id="cto" ref={ref} className="scroll-mt-20 space-y-4 sm:space-y-5">
      <div className={cn('rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <TokenAvatar name={token.name} symbol={token.symbol} imageUri={token.imageUri} size="md" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold">${token.symbol} CTO</h2>
                {q.data?.profile && <Pill tone="green">Creator verified</Pill>}
              </div>
              <p className="text-[12px] text-white/55">{external ? 'Listed token' : 'Assigned at launch'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {q.data?.report && (
              <>
                <a href={xIntent(`$${token.symbol} CTO report: health ${q.data.report.health.score}/100 (heuristic, not an audit), ${q.data.report.holders.count} holders${external || q.data.external ? '' : q.data.report.graduation.graduated ? ', graduated' : `, curve ${q.data.report.graduation.curvePct.toFixed(1)}%`}.`, pageUrl)}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-1 rounded-full bg-polydash-green px-3 sm:h-8 text-[12px] font-medium text-black hover:bg-polydash-green-light">
                  Share report <ArrowUpRight className="h-3 w-3" />
                </a>
                <a href={`/api/cto/${launch}/og`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-1 rounded-full border border-white/15 px-3 sm:h-8 text-[12px] text-white/80 hover:border-white/30 hover:text-white">
                  Report image <ArrowUpRight className="h-3 w-3" />
                </a>
              </>
            )}
            <Link href={`/token/${launch}/cto/manage`} className="inline-flex h-10 items-center rounded-full border border-white/15 px-3 sm:h-8 text-[12px] text-white/80 hover:border-white/30 hover:text-white">
              Manage (creator)
            </Link>
          </div>
        </div>
      </div>

      {external && (
        <p className="rounded-2xl bg-white/[0.03] p-4 text-[13px] text-white/65">{EXTERNAL_NOTE} Scans are not audits.</p>
      )}

      <StakingCard token={token} />

      <Panel title="Staking status">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-white/65">Staking</span>
          <StakingRow token={token.tokenAddress} />
        </div>
      </Panel>

      {q.isError && !q.data && <ErrorNote message={(q.error as Error)?.message ?? 'Could not load the CTO report.'} />}

      {q.isLoading && !loadStuck && <CtoSkeleton external={external} />}
      {q.isLoading && loadStuck && <ReportUnavailable onRetry={() => q.refetch()} />}
      {q.data && <CtoBody data={q.data} pageUrl={pageUrl} token={token} external={external || !!q.data.external} stuck={pendingStuck} onRetry={() => q.refetch()} />}

      <p className="text-center text-[11px] text-white/40">{CTO_FOOTER}</p>
    </section>
  );
}

/** Shown when the report could not be built — plain language, never a spinner that never ends. */
function ReportUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <p className="text-[14px] font-medium text-white">CTO report not available right now</p>
      <p className="mt-1 text-[13px] leading-relaxed text-white/55">
        We could not build this token&apos;s report from on-chain data. Please try again shortly.
      </p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-3 inline-flex h-9 items-center rounded-full bg-white/10 px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/20">
          Try again
        </button>
      ) : null}
    </div>
  );
}

function SkeletonPanel({ title, lines = 4, className }: { title: string; lines?: number; className?: string }) {
  return (
    <Panel title={title} className={className} note={<span className="inline-flex items-center gap-1.5 text-[11px] text-white/40"><Loader2 className="h-3 w-3 animate-spin" /> Computing</span>}>
      <div className="animate-pulse space-y-2.5" aria-hidden>
        <div className="h-7 w-20 rounded-md bg-white/[0.06]" />
        {Array.from({ length: lines }, (_, i) => <div key={i} className="h-3.5 rounded bg-white/[0.06]" style={{ width: `${90 - i * 12}%` }} />)}
      </div>
    </Panel>
  );
}

const REPORT_SECTIONS = ['Health score', 'Graduation tracker', 'Holders', 'Daily report card', 'Token'];

/** Mirrors CtoBody's layout and approximate card heights so the page doesn't jump when the report arrives. */
function CtoSkeleton({ external = false }: { external?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
      <SkeletonPanel title="Promises" lines={2} className="min-h-[160px] lg:col-span-2" />
      <SkeletonPanel title="Health score" lines={9} className={cn('min-h-[450px]', external && 'lg:col-span-2')} />
      {!external && <SkeletonPanel title="Graduation tracker" lines={4} className="min-h-[450px]" />}
      <SkeletonPanel title="Holders" lines={8} className="min-h-[420px] lg:col-span-2" />
      {!external && <SkeletonPanel title="Bundle & sniper X-ray" lines={6} className="min-h-[380px] lg:col-span-2" />}
      <SkeletonPanel title="Build activity" lines={5} className="min-h-[320px] lg:col-span-2" />
      <SkeletonPanel title="Daily report card" lines={6} className="min-h-[340px]" />
      <SkeletonPanel title="Token" lines={6} className="min-h-[340px]" />
    </div>
  );
}

function CtoBody({ data, pageUrl, token, external, stuck, onRetry }: { data: CtoData; pageUrl: string; token: LaunchToken; external: boolean; stuck?: boolean; onRetry?: () => void }) {
  const r = data.report;
  if (!r) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <PromisesCard promises={data.promises ?? []} className="lg:col-span-2" />
        {data.pending && !stuck ? (
          REPORT_SECTIONS.filter((t) => !external || t !== 'Graduation tracker').map((t) => <SkeletonPanel key={t} title={t} />)
        ) : (
          <div className="lg:col-span-2"><ReportUnavailable onRetry={onRetry} /></div>
        )}
        {/* X-ray with no scan data shows an endless "scanning…" skeleton: only
            render it while the report is actually building, not when it is
            unavailable. */}
        {!external && data.pending && <XrayCard xray={data.xray} symbol={token.symbol} />}
        <div id="cto-build" className="scroll-mt-20 lg:col-span-2"><BuildCard build={data.build} /></div>
        <div className="lg:col-span-2">
          <CtoTools tokenAddress={token.tokenAddress} ctoName={`$${token.symbol} CTO`} />
        </div>
      </div>
    );
  }
  const g = r.graduation;
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
      <PromisesCard promises={data.promises ?? []} className="lg:col-span-2" />

      <Panel title="Health score" note="Heuristic, not an audit." className={external ? 'lg:col-span-2' : undefined}>
        <div className="mb-3 flex items-baseline gap-1">
          <span className="font-mono text-[32px] font-semibold">{r.health.score}</span>
          <span className="text-[13px] text-white/40">/100</span>
        </div>
        <ul className="space-y-1.5 text-[13px]">
          {r.health.items.map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-1.5">
              <span className="inline-flex items-center gap-1.5 text-white/65">
                {i.label}
                {i.key === 'verified' && (
                  <Tip label="How to verify" text={<>Counts as verified when the token or launch contract source is verified on Sourcify or Blockscout.{' '}
                    <a href={i.href ?? `${getExplorerAddressUrl(token.tokenAddress)}?tab=contract`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-polydash-green hover:underline">View on explorer <ArrowUpRight className="h-3 w-3" /></a></>} />
                )}
                {i.key === 'build' && (
                  <Tip label="About build activity" text="Shipping record from linked GitHub repos and contracts the creator deployed on Robinhood Chain. Up to 15 points; neutral 7 while checking. Price and volume are never used. It shows what was shipped, not whether it carries risk." />
                )}
                {i.key === 'bevor' && (
                  <Tip label="About this check" text="Bevor AI runs an automated security review of the contract's verified source on Robinhood Chain. No critical, high or medium issues earns 6 points, medium issues only earns 3, and critical or high issues earn 0. Contracts without verified source can't be reviewed. An automated review is not a full manual audit." />
                )}
              </span>
              {i.na ? (
                <span className="font-mono text-white/40">N/A</span>
              ) : i.penalty && !i.ok ? (
                <span className="font-mono text-[#FF8A80]">-{i.penalty}</span>
              ) : (
                <span className={cn('font-mono', i.ok ? 'text-polydash-green' : 'text-white/40')}>
                  {i.ok ? `+${i.earned ?? i.points}` : i.known ? '0' : 'n/a'}{i.ok && i.penalty ? <span className="text-[#FF8A80]"> -{i.penalty}</span> : null} / {i.points}
                </span>
              )}
            </li>
          ))}
        </ul>
        {r.health.applicableMax ? (
          <p className="mt-3 text-[12px] text-white/55">Scored on 6 of 8 factors ({r.health.applicableMax} points), scaled to 100.</p>
        ) : null}
      </Panel>

      {!external && <Panel title="Graduation tracker" note={g.graduated ? <Pill tone="green">Graduated</Pill> : `${g.curvePct.toFixed(1)}%`}>
        {g.graduated ? (
          g.event ? (
            <>
              <p className="mb-3 text-[13px] text-polydash-green">Liquidity added to Uniswap V4</p>
              <KV rows={[
                ['ETH added', `${num(g.event.ethAdded)} ETH`],
                ['Tokens added', `${num(g.event.tokensAdded)} ${r.cto.symbol}`],
                ['Tokens burned', `${num(g.event.tokensBurned)} ${r.cto.symbol}`],
                ['Pool ID', <span key="p" className="font-mono" title={g.event.poolId}>{g.event.poolId.slice(0, 10)}…{g.event.poolId.slice(-6)}</span>],
                ['Date', fmtDate(g.event.timestamp)],
                ['Transaction', <TxLink key="t" hash={g.event.txHash} />],
              ]} />
            </>
          ) : <p className="text-[13px] text-white/60">Liquidity added to Uniswap V4. Graduation details could not be read right now.</p>
        ) : (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-polydash-green" style={{ width: `${Math.min(100, Math.max(g.curvePct, g.curvePct > 0 ? 1 : 0))}%` }} />
            </div>
            <KV rows={[
              ['ETH raised', `${g.ethRaised > 0 && g.ethRaised < 0.0001 ? '<0.0001' : num(g.ethRaised)} of ${num(g.threshold)} ETH`],
              ['Net ETH in, last 24h', `${num(g.pace24h)} ETH`],
              ['ETA at the current pace', g.etaHours == null ? 'n/a (no net inflow in 24h)' : g.etaHours < 1 ? 'under 1 hour' : friendlyEta(g.etaHours)],
            ]} />
            <p className="mt-2 text-[11px] text-white/40">Estimate only, based on the last 24h. Not a guarantee.</p>
          </>
        )}
      </Panel>}

      <CtoHolders r={r} />

      {!external && (
        <div className="lg:col-span-2">
          <HpChecklist launch={token.launchAddress} tokenAddress={token.tokenAddress} creator={token.creator} name={token.name} />
        </div>
      )}

      {/* Security check card hidden for now (user request) */}
      {!external && (
        <div className="lg:col-span-2">
          <XrayCard xray={data.xray} symbol={r.cto.symbol} />
        </div>
      )}

      <div id="cto-build" className="scroll-mt-20 lg:col-span-2">
        <BuildCard build={data.build} />
      </div>

      <DailyCard snaps={data.snapshots ?? { today: null, yesterday: null }} promises={data.promises ?? []} health={r.health.score} build={data.build ?? null} external={external} />
      {r.analysis && <TokenCard t={r.analysis} />}

      <div className="lg:col-span-2">
        <CtoTools tokenAddress={token.tokenAddress} ctoName={r.cto.agentName} />
      </div>
    </div>
  );
}

// Hidden from the token page for now (user request); kept for when it returns.
export function AlertsPanel({ alerts }: { alerts: CtoData['alerts'] }) {
  return (
      <Panel title="Alerts" note="Curve milestones, graduation, whale moves, staking, creator updates, promises, X-ray">
        {alerts.length === 0 ? <p className="text-[13px] text-white/50">No alerts yet.</p> : (
          <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {alerts.map((a) => (
              <li key={a.id} className="rounded-xl bg-white/[0.03] p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Pill tone={alertTone(a.type)}>{ALERT_LABEL[a.type] ?? a.type}</Pill>
                  <span className="text-[11px] text-white/40">{fmtDate(Math.floor(new Date(a.createdAt).getTime() / 1000))}</span>
                </div>
                <p className="mt-1.5 break-words text-white/80">{a.message}</p>
                {a.txHash && <div className="mt-1 text-[12px]"><TxLink hash={a.txHash} /></div>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
  );
}
const FAIR_LABEL: Record<string, string> = { clean: 'Clean', some: 'Some early buyers', heavy: 'Heavy bundling', partial: 'Partial scan', waiting: 'Waiting', scanning: 'Scanning' };
function fairnessText(t: NonNullable<Snap>, y: Snap) {
  if (!t.xrayLevel) return 'n/a';
  const label = FAIR_LABEL[t.xrayLevel] ?? 'Scanning';
  const sp = t.xraySniperPct ?? 0, n = t.xrayBundles ?? 0;
  let s = `${label} · snipers ${sp.toFixed(1)}% · ${n} bundle${n === 1 ? '' : 's'}`;
  if (y?.xraySniperPct != null && t.xraySniperPct != null) {
    const d = t.xraySniperPct - y.xraySniperPct;
    if (Math.abs(d) >= 0.05) s += ` (${d > 0 ? '+' : ''}${d.toFixed(1)} vs yesterday)`;
  }
  return s;
}


function DailyCard({ snaps, promises, health, build, external }: { snaps: NonNullable<CtoData['snapshots']>; promises: PromiseView[]; health: number; build: BuildView | null; external: boolean }) {
  // Today's health is always the live score shown in the Health panel (single source of truth).
  const t = snaps.today && { ...snaps.today, healthScore: health }, y = snaps.yesterday;
  const pc = { kept: 0, active: 0, broken: 0, review: 0 };
  for (const p of promises) { if (p.status === 'kept') pc.kept++; else if (p.status === 'broken') pc.broken++; else if (p.status === 'needs_review') pc.review++; else pc.active++; }
  const rows: [string, (s: NonNullable<Snap>) => number, (v: number) => string][] = [
    ['Holders', (s) => s.holders, (v) => v.toLocaleString('en-US')],
    ['Top-10 share', (s) => s.top10Pct, (v) => `${v.toFixed(1)}%`],
    ['Curve', (s) => (s.graduated ? 100 : s.curvePct), (v) => `${v.toFixed(1)}%`],
    ['Health', (s) => s.healthScore, (v) => `${v}/100`],
  ];
  if (external) rows.splice(2, 1);
  return (
    <Panel title="Daily report card" note={t ? `${t.day} (UTC) vs previous day` : undefined}>
      {!t ? <p className="text-[13px] text-white/50">No snapshot yet.</p> : (
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-white/40">
            <tr><th className="py-1.5 font-medium">Metric</th><th className="py-1.5 text-right font-medium">Today</th><th className="py-1.5 text-right font-medium">Yesterday</th><th className="py-1.5 text-right font-medium">Change</th></tr>
          </thead>
          <tbody>
            {rows.map(([label, get, f]) => {
              const a = get(t), b = y ? get(y) : null;
              const d = b == null ? null : a - b;
              return (
                <tr key={label} className="border-t border-white/[0.06]">
                  <td className="py-1.5 text-white/60">{label}</td>
                  <td className="py-1.5 text-right font-mono">{f(a)}</td>
                  <td className="py-1.5 text-right font-mono text-white/60">{b == null ? 'n/a' : f(b)}</td>
                  <td className={cn('py-1.5 text-right font-mono', d == null || d === 0 ? 'text-white/40' : 'text-white/80')}>{d == null ? 'n/a' : `${d > 0 ? '+' : ''}${Number.isInteger(d) ? d : d.toFixed(1)}`}</td>
                </tr>
              );
            })}
            {!external && <tr className="border-t border-white/[0.06]">
              <td className="py-1.5 text-white/60">Launch fairness</td>
              <td colSpan={3} className={cn('py-1.5 text-right font-mono', t.xrayLevel === 'heavy' ? 'text-[#FF8A80]' : t.xrayLevel === 'some' ? 'text-yellow-300' : 'text-white/80')}>
                {fairnessText(t, y)}
              </td>
            </tr>}
            <tr className="border-t border-white/[0.06]">
              <td className="py-1.5 text-white/60">Promises</td>
              <td colSpan={3} className={cn('py-1.5 text-right font-mono', pc.broken > 0 ? 'text-[#FF8A80]' : 'text-white/80')}>
                {promises.length === 0 ? 'none' : `${pc.kept} kept · ${pc.active} active${pc.review ? ` · ${pc.review} review` : ''}${pc.broken ? ` · ${pc.broken} broken` : ''}`}
              </td>
            </tr>
            <tr className="border-t border-white/[0.06]">
              <td className="py-1.5 text-white/60">Build activity</td>
              <td colSpan={3} className="py-1.5 text-right font-mono text-white/80">{buildLine(build)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[11px] text-white/40">Stored on the first view each UTC day.</p>
    </Panel>
  );
}
