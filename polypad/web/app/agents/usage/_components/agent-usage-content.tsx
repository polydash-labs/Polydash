'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type UsageData = {
  key: { prefix: string; agentName: string; createdAt: string; revoked: boolean };
  periodDays: number;
  truncated: boolean;
  totals: { calls: number; reads: number; prepares: number; intents: number; rateLimited: number; errors: number };
  byDay: { day: string; calls: number; reads: number; prepares: number }[];
  byTool: { tool: string; calls: number; reads: number; prepares: number }[];
  lastMinute: { reads: number; prepares: number; intents: number };
  limits: { read: number; prepare: number; perWalletPrepare: number; intent: number };
  launchesPrepared: number;
};

function shortDay(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-4">
      <p className="text-[12px] font-medium tracking-wide text-white/50 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-white/50">{hint}</p>
    </div>
  );
}

function LimitBar({ label, used, limit, hint }: { label: string; used: number; limit: number; hint: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-white">{label}</p>
        <p className="font-mono text-[13px] text-white/70">{used.toLocaleString()} / {limit.toLocaleString()} per minute</p>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[#00E676]" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <p className="mt-1 text-[12px] text-white/50">{hint}</p>
    </div>
  );
}

export function AgentUsageContent() {
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<UsageData | null>(null);

  async function load() {
    const raw = keyInput.trim();
    if (!raw.startsWith('pp_live_')) {
      setError('That does not look like a Pro key — it starts with pp_live_.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/agents/v1/keys/usage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: raw }),
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(typeof body?.message === 'string' ? body.message : 'Could not load usage for this key.');
        setData(null);
        return;
      }
      setData(body as unknown as UsageData);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  const maxDay = data ? Math.max(1, ...data.byDay.slice(-14).map((d) => d.calls)) : 1;

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">Your API usage</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/70">
          See what your Pro key has been used for: how many calls it made, which tools it called,
          and how close you are to your per-minute limits. Paste your key below — it is sent once
          to look up your usage, and it is never stored on this page or shown back to you.
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <label className="block">
          <span className="text-[13px] font-medium text-white">Pro API key</span>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <Input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="pp_live_…"
              className="flex-1 font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</Button>
              <Button onClick={load} disabled={busy || !keyInput.trim()}>{busy ? 'Loading…' : 'Show my usage'}</Button>
            </div>
          </div>
        </label>
        {error && <p className="mt-3 text-[13px] text-white/80" role="alert">{error}</p>}
        <p className="mt-2 text-[12px] leading-relaxed text-white/50">
          No Pro key yet? <Link href="/agents/accounts" className="text-[#00E676] hover:underline">Get one from /agents/accounts</Link> — it is free while growing, shown once, and you can revoke it any time.
          {' '}Trying pay-per-call reports? <Link href="/agents/credits" className="text-[#00E676] hover:underline">Poly credits — free credits for x402 reports</Link> cover your first $25.
        </p>
      </section>

      {data && (
        <>
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-medium text-white">
                Key {data.key.prefix}… · {data.key.agentName}
              </p>
              {data.key.revoked ? (
                <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-[11px] font-medium text-red-300">Revoked — history only, this key no longer works</span>
              ) : (
                <span className="rounded-full bg-[#00E676]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#00E676]">Active</span>
              )}
            </div>
            <p className="mt-1 text-[12px] text-white/50">
              Created {new Date(data.key.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · Showing the last {data.periodDays} days.
              {data.truncated ? ' This key made more calls than fit in one view, so the oldest days are cut off.' : ''}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Total calls" value={data.totals.calls.toLocaleString()} hint={`Last ${data.periodDays} days`} />
            <Stat label="Reads" value={data.totals.reads.toLocaleString()} hint="Looking things up — prices, funds, tokens" />
            <Stat label="Prepares" value={data.totals.prepares.toLocaleString()} hint="Unsigned transactions built for signing" />
            <Stat label="Plain requests" value={data.totals.intents.toLocaleString()} hint="“Do this for me” requests, in plain words" />
            <Stat label="Rate-limited" value={data.totals.rateLimited.toLocaleString()} hint="Calls refused for going over the per-minute limit" />
            <Stat label="Errors" value={data.totals.errors.toLocaleString()} hint="Calls that failed for another reason" />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
            <h2 className="text-[15px] font-medium text-white">Right now — this minute</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-white/50">
              Your calls in the last 60 seconds against your Pro limits. Limits reset every minute.
              Token launches prepared with this key: <span className="text-white/80">{data.launchesPrepared.toLocaleString()}</span>
            </p>
            <div className="mt-4 space-y-4">
              <LimitBar label="Reads" used={data.lastMinute.reads} limit={data.limits.read} hint="Looking things up." />
              <LimitBar label="Prepares" used={data.lastMinute.prepares} limit={data.limits.prepare} hint="Building unsigned transactions. Each wallet is also limited to 120 prepares per minute." />
              <LimitBar label="Plain requests" used={data.lastMinute.intents} limit={data.limits.intent} hint="“Do this for me” requests." />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
            <h2 className="text-[15px] font-medium text-white">Calls per day — last 14 days</h2>
            {data.totals.calls === 0 ? (
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                No calls in the last {data.periodDays} days. Send your key as the x-api-key header with an MCP call or a v2 API call and it will show up here.
              </p>
            ) : (
              <div className="mt-4 flex items-end gap-1.5" role="img" aria-label="Calls per day for the last 14 days">
                {data.byDay.slice(-14).map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-[11px] font-medium text-white/70">{d.calls > 0 ? d.calls.toLocaleString() : ''}</span>
                    <div className="w-full rounded-sm bg-[#00E676]/80" style={{ height: `${Math.max(3, Math.round((d.calls / maxDay) * 96))}px` }} title={`${shortDay(d.day)}: ${d.calls} calls`} />
                    <span className="text-[10px] text-white/40">{shortDay(d.day)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
            <h2 className="text-[15px] font-medium text-white">Most used tools</h2>
            {data.byTool.length === 0 ? (
              <p className="mt-2 text-[13px] text-white/60">Nothing yet — calls will appear here once this key is used.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="py-2 pr-3 font-medium">Tool</th>
                      <th className="py-2 pr-3 font-medium">Calls</th>
                      <th className="py-2 pr-3 font-medium">Reads</th>
                      <th className="py-2 font-medium">Prepares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byTool.map((t) => (
                      <tr key={t.tool} className="border-b border-white/5 last:border-0">
                        <td className="py-2 pr-3 font-mono text-[12px] text-white">{t.tool}</td>
                        <td className="py-2 pr-3 text-white/80">{t.calls.toLocaleString()}</td>
                        <td className="py-2 pr-3 text-white/80">{t.reads.toLocaleString()}</td>
                        <td className="py-2 text-white/80">{t.prepares.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
            <h2 className="text-[15px] font-medium text-white">Pay-per-call purchases</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              Deep reports (token report $0.01, Tokenized Fund NAV $0.01, CTO report $0.05) can be
              paid with <Link href="/agents/credits" className="text-[#00E676] hover:underline">Poly credits</Link> from
              your Pro key — claim $25 free and see your credits balance there. Or buy them in the
              call itself with your wallet: on-chain purchases are not linked to an API key, so they
              do not show up in this usage. <Link href="/x402" className="text-[#00E676] hover:underline">See pay-per-call →</Link>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
