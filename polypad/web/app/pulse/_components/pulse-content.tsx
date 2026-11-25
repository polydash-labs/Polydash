'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExtLink } from '@/components/trust/trust-shell';

type NumStatus = 'ok' | 'not-tracked' | 'error';

type Downloads = {
  status: NumStatus;
  week: number | null;
  month: number | null;
  version: string | null;
  note: string | null;
};

type PulsePayload = {
  checkedAt: string;
  npm: Downloads;
  pypi: Downloads;
  registry: {
    status: 'ok' | 'error';
    name: string;
    version: string | null;
    registryStatus: string | null;
    publishedAt: string | null;
    lastKnown: boolean;
    note: string | null;
  };
  agents: { status: 'ok' | 'error'; count: number | null; note: string | null };
  funds: {
    status: 'ok' | 'error';
    count: number | null;
    funds: { name: string; symbol: string; address: string }[] | null;
    note: string | null;
  };
  tvl: { status: 'ok' | 'error'; totalUsd: number | null; stakingUsd: number | null; vaultsUsd: number | null; note: string | null };
  usage: {
    status: 'ok' | 'error';
    total: number | null;
    reads: number | null;
    prepares: number | null;
    intents: number | null;
    ok: number | null;
    errors: number | null;
    rateLimited: number | null;
    last24h: number | null;
    keysActive: number | null;
    checkedAt: string;
    note: string | null;
  };
  tools: { count: number };
  x402: { id: string; name: string; priceUsd: number }[];
};

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtCheckedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">{children}</div>;
}

function SourceLine({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[12px] leading-relaxed text-white/45">{children}</p>;
}

function BigNumber({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="mt-1 text-[32px] font-semibold leading-none tracking-tight text-white">
      {value}
      {unit ? <span className="ml-2 text-[15px] font-normal text-white/55">{unit}</span> : null}
    </p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-white">{children}</h2>;
}

function DownloadCard({
  title,
  href,
  hrefLabel,
  data,
  sourceLabel,
}: {
  title: string;
  href: string;
  hrefLabel: string;
  data: Downloads;
  sourceLabel: string;
}) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[14px] font-medium text-white">{title}</p>
        <ExtLink href={href}>{hrefLabel}</ExtLink>
      </div>
      {data.status === 'ok' && data.week !== null && data.month !== null ? (
        <>
          <BigNumber value={fmtInt(data.week)} unit="last 7 days" />
          <p className="mt-2 text-[13px] text-white/65">{fmtInt(data.month)} in the last 30 days</p>
        </>
      ) : (
        <>
          <BigNumber value="—" unit={data.status === 'not-tracked' ? 'Too new for download counts yet' : 'not yet tracked'} />
          <p className="mt-2 text-[13px] leading-relaxed text-white/65">
            {data.status === 'not-tracked'
              ? 'Too new for download counts yet — check back in a few days.'
              : (data.note ?? 'Download stats are not available right now.')}
          </p>
        </>
      )}
      {data.version ? <p className="mt-2 text-[13px] text-white/65">Latest version {data.version}</p> : null}
      <SourceLine>Source: {sourceLabel}, checked {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.</SourceLine>
    </Card>
  );
}

export function PulseContent() {
  const [data, setData] = useState<PulsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  const load = useCallback(async () => {
    const id = ++runId.current;
    setBusy(true);
    setError(null);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch('/api/pulse', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PulsePayload;
      if (runId.current === id) setData(json);
    } catch {
      if (runId.current === id) setError('Could not load the numbers. Check your connection and try again — nothing here is cached from an old check.');
    } finally {
      if (runId.current === id) setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) {
    return (
      <div>
        <p className="text-[15px] leading-relaxed text-white/75">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={load} disabled={busy}>
          {busy ? 'Checking…' : 'Try again'}
        </Button>
      </div>
    );
  }

  if (!data) {
    return <p className="text-[15px] text-white/60">Checking the live sources…</p>;
  }

  const checkedLabel = fmtCheckedAt(data.checkedAt);
  const allOk =
    data.npm.status === 'ok' &&
    data.pypi.status === 'ok' &&
    data.registry.status === 'ok' &&
    !data.registry.lastKnown &&
    data.agents.status === 'ok' &&
    data.funds.status === 'ok' &&
    data.tvl.status === 'ok' &&
    data.usage.status === 'ok';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${allOk ? 'bg-[#00E676]' : 'bg-amber-400'}`}
          aria-hidden="true"
        />
        <p className="text-[15px] font-medium text-white">
          {allOk ? 'Live numbers' : 'Some numbers could not be checked — see below'}
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={busy}>
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      <p className="mt-2 text-[13px] text-white/50">
        Last checked {checkedLabel}.{' '}
        {allOk
          ? 'Every figure below is fetched live from its source when this page loads.'
          : 'Some figures below could not be checked — see the notes on each card.'}
      </p>

      {/* SDK downloads */}
      <div className="mt-8">
        <SectionTitle>SDK downloads</SectionTitle>
        <p className="mt-1 text-[13px] text-white/55">Installs of the polypad-agent SDK, from the official package stats.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <DownloadCard
            title="npm — polypad-agent"
            href="https://www.npmjs.com/package/polypad-agent"
            hrefLabel="npm ↗"
            data={data.npm}
            sourceLabel="npm registry API (api.npmjs.org)"
          />
          <DownloadCard
            title="PyPI — polypad-agent"
            href="https://pypi.org/project/polypad-agent/"
            hrefLabel="PyPI ↗"
            data={data.pypi}
            sourceLabel="PyPI download stats (pypistats.org)"
          />
        </div>
      </div>

      {/* Distribution */}
      <div className="mt-8">
        <SectionTitle>Distribution</SectionTitle>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-white">MCP Registry</p>
              <ExtLink href="https://registry.modelcontextprotocol.io/v0.1/servers?search=polypad">Registry ↗</ExtLink>
            </div>
            <BigNumber value={data.registry.registryStatus === 'active' ? 'Active' : (data.registry.registryStatus ?? 'Unknown')} />
            <p className="mt-2 text-[13px] text-white/65">
              {data.registry.name} · v{data.registry.version ?? '—'}
              {fmtDate(data.registry.publishedAt) ? ` · listed ${fmtDate(data.registry.publishedAt)}` : ''}
            </p>
            {data.registry.lastKnown ? (
              <p className="mt-2 text-[13px] leading-relaxed text-amber-300/90">{data.registry.note}</p>
            ) : (
              <SourceLine>Source: MCP Registry search API, checked {checkedLabel}.</SourceLine>
            )}
          </Card>
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-white">Agent API tools</p>
              <a href="/docs/tools" className="text-[#00E676] hover:underline">
                Tool reference ↗
              </a>
            </div>
            <BigNumber value={String(data.tools.count)} unit="tools" />
            <p className="mt-2 text-[13px] leading-relaxed text-white/65">
              Every one of them is listed in the tool reference and callable.
            </p>
            <SourceLine>Source: the live tool list served by the API itself.</SourceLine>
          </Card>
        </div>
      </div>

      {/* On-chain */}
      <div className="mt-8">
        <SectionTitle>On-chain, right now</SectionTitle>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-white">Agents registered</p>
              <a href="/agents/scores" className="text-[#00E676] hover:underline">
                Scores ↗
              </a>
            </div>
            {data.agents.status === 'ok' && data.agents.count !== null ? (
              <>
                <BigNumber value={String(data.agents.count)} />
                {data.agents.count === 0 ? (
                  <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                    No agents registered yet. The Agent Credit Score is live on-chain — the first agent to register gets the first score.
                  </p>
                ) : (
                  <p className="mt-2 text-[13px] text-white/65">Agents with an on-chain credit score.</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-white/65">{data.agents.note ?? 'Could not read the registry.'}</p>
            )}
            <SourceLine>Source: AgentRegistry contract, read live from Robinhood Chain.</SourceLine>
          </Card>
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-white">Tokenized Funds launched</p>
              <a href="/funds" className="text-[#00E676] hover:underline">
                Tokenized Funds ↗
              </a>
            </div>
            {data.funds.status === 'ok' && data.funds.count !== null ? (
              <>
                <BigNumber value={String(data.funds.count)} />
                <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                  {data.funds.funds?.map((f) => `${f.name} (${f.symbol})`).join(' · ') ?? ''}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-white/65">{data.funds.note ?? 'Could not read the live tokenized fund list.'}</p>
            )}
            <SourceLine>Source: the live tokenized fund factories, read from Robinhood Chain.</SourceLine>
          </Card>
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-white">Total value locked</p>
              <a href="/terminal" className="text-[#00E676] hover:underline">
                Terminal ↗
              </a>
            </div>
            {data.tvl.status === 'ok' && data.tvl.totalUsd !== null ? (
              <>
                <BigNumber value={fmtUsd(data.tvl.totalUsd)} />
                <p className="mt-2 text-[13px] text-white/65">
                  Staking {fmtUsd(data.tvl.stakingUsd ?? 0)} · Tokenized Fund vaults {fmtUsd(data.tvl.vaultsUsd ?? 0)}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-white/65">{data.tvl.note ?? 'Total TVL is unavailable right now.'}</p>
            )}
            <SourceLine>Source: /api/total-tvl — staking principal plus tokenized fund vaults, priced on-chain. Never CoinGecko.</SourceLine>
          </Card>
        </div>
      </div>

      {/* Platform API usage */}
      <div className="mt-8">
        <SectionTitle>Platform API usage</SectionTitle>
        <p className="mt-1 text-[13px] text-white/55">Every agent API call, summed across all keys — the platform total.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-white">API calls, all time</p>
              <a href="/agents/usage" className="text-[#00E676] hover:underline">
                Your key&apos;s usage ↗
              </a>
            </div>
            {data.usage.status === 'ok' && data.usage.total !== null ? (
              <>
                <BigNumber value={fmtInt(data.usage.total)} />
                <p className="mt-2 text-[13px] text-white/65">
                  {fmtInt(data.usage.last24h ?? 0)} in the last 24 hours · {fmtInt(data.usage.keysActive ?? 0)} Pro keys active
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-white/65">{data.usage.note ?? 'Could not read the usage totals.'}</p>
            )}
            <SourceLine>Source: platform metering (ApiKeyUsage), checked {checkedLabel}.</SourceLine>
          </Card>
          <Card>
            <p className="text-[14px] font-medium text-white">Calls by kind</p>
            {data.usage.status === 'ok' && data.usage.total !== null ? (
              <>
                <BigNumber value={fmtInt(data.usage.reads ?? 0)} unit="reads" />
                <p className="mt-2 text-[13px] text-white/65">
                  {fmtInt(data.usage.prepares ?? 0)} prepares · {fmtInt(data.usage.intents ?? 0)} intents
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-white/65">{data.usage.note ?? 'Could not read the usage totals.'}</p>
            )}
            <SourceLine>Reads are lookups; prepares build unsigned transactions for agents to sign.</SourceLine>
          </Card>
          <Card>
            <p className="text-[14px] font-medium text-white">Errors &amp; limits</p>
            {data.usage.status === 'ok' && data.usage.total !== null ? (
              <>
                <BigNumber value={fmtInt(data.usage.rateLimited ?? 0)} unit="rate-limited" />
                <p className="mt-2 text-[13px] text-white/65">{fmtInt(data.usage.errors ?? 0)} errored calls</p>
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-white/65">{data.usage.note ?? 'Could not read the usage totals.'}</p>
            )}
            <SourceLine>Rate-limited calls are logged too, so the dashboard can show 429s.</SourceLine>
          </Card>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-white/55">
          Counts Pro-keyed API calls only — free unkeyed calls aren&apos;t tied to a key and aren&apos;t metered. Per-key
          numbers are on{' '}
          <a href="/agents/usage" className="text-[#00E676] hover:underline">
            /agents/usage
          </a>
          .
        </p>
      </div>

      {/* Pay-per-call */}
      <div className="mt-8">
        <SectionTitle>Pay-per-call prices</SectionTitle>
        <Card>
          <div className="divide-y divide-white/[0.06]">
            {data.x402.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <p className="text-[14px] text-white">{p.name}</p>
                <p className="text-[14px] font-medium text-white">${p.priceUsd.toFixed(2)} per call</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-white/65">
            Paid in USDG or POLYDASH, settled on-chain in the call itself. The API itself is free — Pro is $0 while growing.
          </p>
          <SourceLine>
            Source: the published product prices (<a href="/x402" className="text-[#00E676] hover:underline">/x402</a>).
          </SourceLine>
        </Card>
      </div>

      {/* How we count */}
      <div className="mt-8">
        <SectionTitle>How we count</SectionTitle>
        <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-white/65 sm:text-sm">
          <p>
            Downloads come from the official npm and PyPI stats services.
          </p>
          <p>
            On-chain figures are read live from Robinhood Chain when this page loads. If a source does not answer, we
            say so instead of showing an old number as if it were fresh — the one exception is the registry listing,
            where a failed live check falls back to the last verified listing and says so in plain words.
          </p>
          <p>
            Contracts are unaudited (automated checks only). These numbers are a snapshot of a young project, not a
            promise — uptime and usage history start from the day this page went live. See{' '}
            <a href="/status" className="text-[#00E676] hover:underline">Status</a> and{' '}
            <a href="/changelog" className="text-[#00E676] hover:underline">Changelog</a> for what changed and when.
          </p>
        </div>
      </div>
    </div>
  );
}
