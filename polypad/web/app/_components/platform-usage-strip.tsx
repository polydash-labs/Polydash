'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type UsageTotals = {
  status: 'ok' | 'error';
  total: number | null;
  pro: number | null;
  free: number | null;
  mlo: number | null;
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

type PulsePayload = {
  checkedAt: string;
  agents: { status: 'ok' | 'error'; count: number | null; note: string | null };
  funds: { status: 'ok' | 'error'; count: number | null };
  tvl: { status: 'ok' | 'error'; totalUsd: number | null };
  usage: UsageTotals;
};

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Platform usage + stats strip for the homepage (which is the explore page).
 * Same live payload as /pulse — one source of truth. Numbers load after the
 * page paints; a failed check shows "unavailable", never a stale number.
 * Every API call is counted — Pro-keyed and free — and the strip says the
 * split in plain words, including commercial clients' share.
 */
export function PlatformUsageStrip() {
  const [data, setData] = useState<PulsePayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    fetch('/api/pulse', { signal: ctrl.signal, cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PulsePayload>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  const usageOk = data?.usage.status === 'ok' && data.usage.total !== null;
  const agentsOk = data?.agents.status === 'ok' && data.agents.count !== null;
  const fundsOk = data?.funds.status === 'ok' && data.funds.count !== null;
  const tvlOk = data?.tvl.status === 'ok' && data.tvl.totalUsd !== null;

  return (
    <section className="mx-auto max-w-container px-5 pt-6 sm:px-8" aria-label="Platform usage">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-polydash-green">Platform usage — live</p>
          <Link href="/pulse" className="text-[13px] font-medium text-polydash-green hover:text-polydash-green-light">
            See all numbers on Pulse ↗
          </Link>
        </div>
        {failed || !data ? (
          <p className="mt-3 text-[13px] text-white/55">
            {failed ? 'Platform stats are unavailable right now — check Pulse for the latest.' : 'Checking the live sources…'}
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-[28px] font-semibold leading-none tracking-tight text-white">
                  {usageOk ? fmtInt(data.usage.total!) : '—'}
                </p>
                <p className="mt-1.5 text-[13px] text-white/60">API calls, all time</p>
              </div>
              <div>
                <p className="text-[28px] font-semibold leading-none tracking-tight text-white">
                  {agentsOk ? fmtInt(data.agents.count!) : '—'}
                </p>
                <p className="mt-1.5 text-[13px] text-white/60">Agents registered</p>
              </div>
              <div>
                <p className="text-[28px] font-semibold leading-none tracking-tight text-white">
                  {fundsOk ? fmtInt(data.funds.count!) : '—'}
                </p>
                <p className="mt-1.5 text-[13px] text-white/60">Tokenized Funds launched</p>
              </div>
              <div>
                <p className="text-[28px] font-semibold leading-none tracking-tight text-white">
                  {tvlOk ? fmtUsd(data.tvl.totalUsd!) : '—'}
                </p>
                <p className="mt-1.5 text-[13px] text-white/60">Total value locked</p>
              </div>
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-white/45">
              {usageOk
                ? `${fmtInt(data.usage.last24h ?? 0)} calls in the last 24 hours · ${fmtInt(data.usage.reads ?? 0)} reads · ${fmtInt(data.usage.prepares ?? 0)} prepares · ${fmtInt(data.usage.pro ?? 0)} Pro-keyed · ${fmtInt(data.usage.free ?? 0)} free${(data.usage.mlo ?? 0) > 0 ? ` · ${fmtInt(data.usage.mlo!)} from commercial clients` : ''} · ${fmtInt(data.usage.keysActive ?? 0)} Pro keys active. `
                : ''}
              Counts every API call — Pro-keyed and free. Free calls count too: that&apos;s the product working, no key needed.
              Agents, funds and TVL are read live from Robinhood Chain. See{' '}
              <Link href="/agents/usage" className="text-polydash-green hover:underline">
                your key&apos;s usage
              </Link>{' '}
              for per-key numbers.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
