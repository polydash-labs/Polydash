'use client';

// Token security report. Built ONLY from data the app already reads: the CTO report (health items, graduation),
// Holder Protections checks, creator vesting vaults, creator bonds, creator fee and the contract address.
// Anything the app has no data for is shown as "Not available". Never invent values here.

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { formatEther } from 'viem';
import type { CtoReport } from '@/lib/cto/chain';
import type { CheckId, CheckStatus } from '@/lib/holder-protections';
import type { LaunchToken } from '@/lib/token-types';
import { useHolderProtections, tierName } from '@/components/holder-protections';
import { useVaultsByToken } from '@/lib/hooks/use-vesting';
import { useBondsByToken } from '@/lib/hooks/use-bond';
import { statusLabel } from '@/lib/bond';
import { bpsToPercent, formatTokens, shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { cn } from '@/lib/utils';
import { usePendingStuck } from '@/lib/hooks/use-pending-stuck';

const NA = 'Not available';
const CHECK_LABEL: Record<CheckId, string> = {
  liquidity_locked: 'Liquidity locked',
  creator_staking_pool: 'Creator staking pool',
  security_clean: 'Security scan clean',
  creator_vesting: 'Creator tokens vesting',
  creator_bond: 'Creator bond',
};
const STATUS_TEXT: Record<CheckStatus, string> = { pass: 'Pass', pending: 'Pending', unknown: 'Unknown', fail: 'Not met' };
const STATUS_TONE: Record<CheckStatus, string> = { pass: 'text-polydash-green', pending: 'text-yellow-200', unknown: 'text-white/40', fail: 'text-white/50' };
const day = (sec: number) => (sec > 0 ? new Date(sec * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' }) : '-');

function Row({ k, children, muted }: { k: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] py-2 text-[13px] last:border-0">
      <dt className="text-white/50">{k}</dt>
      <dd className={cn('text-right', muted ? 'text-white/40' : 'text-white/85')}>{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.02] p-3.5">
      <h3 className="mb-1 text-[13px] font-semibold text-white">{title}</h3>
      <dl>{children}</dl>
    </div>
  );
}

export function TokenSecurityReport({ token, external = false }: { token: LaunchToken; external?: boolean }) {
  const launch = token.launchAddress.toLowerCase();
  // Same key and fetch as CtoSection, so the report is shared from the cache.
  const cto = useQuery<{ report: CtoReport | null; pending?: boolean }>({
    queryKey: ['cto', launch],
    queryFn: async () => {
      const res = await fetch(`/api/cto/${launch}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Same as CtoSection: a 503/500 "report not available" answer is data,
        // not an error, so this report flips to "Not available" instead of
        // "Loading…" forever. A 404 still throws.
        if (res.status === 404) throw new Error(data?.error ?? 'Could not load the CTO report.');
        const body = data && typeof data === 'object' ? data : {};
        return { ...body, report: null, pending: false };
      }
      return data;
    },
    staleTime: 30_000,
  });
  const hp = useHolderProtections(external ? null : launch);
  const vesting = useVaultsByToken(token.tokenAddress);
  const bonds = useBondsByToken(token.tokenAddress);
  const r = cto.data?.report ?? null;
  // Stuck once the report has been pending for 30s straight, or the first load
  // itself has been fetching for 30s straight — either way say "Not available"
  // instead of "Loading…" forever. (Watching only data.pending missed a hung
  // first fetch, where data is still undefined.)
  const pendingStuck = usePendingStuck(cto.isLoading || (cto.data?.pending === true && !cto.data?.report));
  const loadingText = !pendingStuck && (cto.isLoading || cto.data?.pending) ? 'Loading…' : NA;

  return (
    <section id="security-report" className="scroll-mt-20 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-polydash-green" />
        <h2 className="text-[15px] font-semibold">Security report</h2>
      </div>
      <p className="mt-1 text-[12px] text-white/45">
        Built only from live data Polypad reads on-chain. Anything we have no data for says &quot;Not available&quot;. Scans are not audits. Not financial advice.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Section title={`Health score${r ? `: ${r.health.score}/100` : ''}`}>
          {r ? r.health.items.map((i) => (
            <Row key={i.key} k={i.label} muted={i.na || (!i.ok && !i.known)}>
              {i.na ? 'Does not apply' : i.penalty && !i.ok ? `-${i.penalty} points` : i.ok ? `+${i.earned ?? i.points} of ${i.points}` : i.known ? `0 of ${i.points}` : 'Unknown'}
            </Row>
          )) : <Row k="Health score" muted>{loadingText}</Row>}
          {r && <p className="pt-2 text-[11px] text-white/40">A heuristic score, not an audit.</p>}
        </Section>

        <Section title={`Holder Protections${hp ? `: ${hp.tier ? tierName(hp.tier) : `${hp.passed} of ${hp.total} checks`}` : ''}`}>
          {hp ? hp.checks.map((c) => (
            <Row key={c.id} k={CHECK_LABEL[c.id] ?? c.id}>
              <span className={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status]}</span>
              {c.detail && <span className="block text-[11px] text-white/40">{c.detail}</span>}
            </Row>
          )) : <Row k="Checks" muted>{external ? 'Only for tokens launched on Polypad' : NA}</Row>}
        </Section>

        <Section title="Creator commitments">
          <Row k="Creator fee" muted={external}>{external ? 'Does not apply (launched outside Polypad)' : bpsToPercent(token.creatorFeeBps)}</Row>
          <Row k="Creator vesting vaults" muted={!vesting.data?.rows.length}>
            {vesting.isLoading ? 'Loading…' : vesting.data ? (vesting.data.rows.length
              ? <>{vesting.data.rows.length} vault{vesting.data.rows.length === 1 ? '' : 's'}, {formatTokens(vesting.data.total as bigint)} {token.symbol} locked<span className="block text-[11px] text-white/40">Last unlock {day(Math.max(...vesting.data.rows.map((v) => v.endTime)))}</span></>
              : 'None') : NA}
          </Row>
          <Row k="Creator bond" muted={!bonds.data?.length}>
            {bonds.isLoading ? 'Loading…' : bonds.data ? (bonds.data.length
              ? bonds.data.slice(0, 3).map((b) => (
                <span key={b.address} className="block">{statusLabel(b.status)}: {Number(formatEther(b.bondAmount)).toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH, ends {day(b.endTime)}</span>
              ))
              : 'None') : NA}
          </Row>
        </Section>

        <Section title="Contract and liquidity">
          <Row k="Token contract">
            <a href={getExplorerAddressUrl(token.tokenAddress)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-polydash-green hover:underline">
              {shortenAddress(token.tokenAddress)} <ArrowUpRight className="h-3 w-3" />
            </a>
          </Row>
          {!external && (
            <Row k="Graduation to Uniswap V4" muted={!r}>
              {!r ? loadingText : r.graduation.graduated ? (
                <>Graduated{r.graduation.event ? ` on ${day(r.graduation.event.timestamp)}` : ''}
                  {r.graduation.event?.txHash && (
                    <a href={getExplorerTxUrl(r.graduation.event.txHash)} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-polydash-green hover:underline">tx <ArrowUpRight className="h-3 w-3" /></a>
                  )}</>
              ) : `Not yet: ${r.graduation.curvePct.toFixed(1)}% of the curve (${r.graduation.ethRaised.toLocaleString('en-US', { maximumFractionDigits: 4 })} of ${r.graduation.threshold} ETH)`}
            </Row>
          )}
          <Row k="Buy / sell tax" muted>{NA}</Row>
          {!hp && <Row k="Liquidity lock" muted>{NA}</Row>}
        </Section>
      </div>
    </section>
  );
}
