// /api/pulse — aggregates Polypad's public numbers from their live sources.
//
// Every figure comes from a live fetch or an on-chain read at request time.
// Nothing here is hardcoded except the *last-known* registry state, which is
// only used when the live registry check fails and is always labelled as such.
// A failed source returns status 'error' (or 'not-tracked' when the source
// itself says the package isn't indexed yet) — never a guessed number.
import { NextResponse } from 'next/server';
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { defaultCtx } from '@/lib/agents-api/v2/core';
import { allFunds } from '@/lib/agents-api/v2/funds';
import { TOOLS } from '@/lib/agents-api/v2/tools';
import { X402_PRODUCTS } from '@/lib/x402/constants';
import { getTotalTvl } from '@/lib/total-tvl';
import { getUsageTotals, type UsageTotals } from '@/lib/usage-totals';
import { getAgentRegistryAddress } from '@/lib/contracts/addresses';
import { AgentRegistryABI } from '@/lib/contracts/agent-credit-score-abi';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60_000;

const REGISTRY_ADDRESS_FALLBACK = '0x514e352A12F3DB3d4cA649dD328776390e1725eF' as Address;
// Last verified live (Nov 18, 2026) — used ONLY when the live registry check
// fails, and always flagged lastKnown in the response.
const REGISTRY_LAST_KNOWN = {
  name: 'family.polypad/polypad',
  version: '2.0.0',
  registryStatus: 'active',
  publishedAt: '2026-11-18T20:42:46.70222Z',
  verifiedAt: '2026-11-18',
};

const rpcClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodChain.rpcUrls.default.http[0], { timeout: 10_000 }),
}) as PublicClient;

async function fetchJson(url: string, ms: number): Promise<{ ok: boolean; status: number; json: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const json: unknown = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

type NumStatus = 'ok' | 'not-tracked' | 'error';

type Downloads = {
  status: NumStatus;
  week: number | null;
  month: number | null;
  version: string | null;
  note: string | null;
};

async function npmDownloads(): Promise<Downloads> {
  try {
    const [week, month, meta] = await Promise.all([
      fetchJson('https://api.npmjs.org/downloads/point/last-week/polypad-agent', FETCH_TIMEOUT_MS),
      fetchJson('https://api.npmjs.org/downloads/point/last-month/polypad-agent', FETCH_TIMEOUT_MS),
      fetchJson('https://registry.npmjs.org/polypad-agent', FETCH_TIMEOUT_MS),
    ]);
    const version =
      meta.ok && meta.json && typeof meta.json === 'object'
        ? ((meta.json as { 'dist-tags'?: { latest?: string } })['dist-tags']?.latest ?? null)
        : null;
    const notFound = (r: { ok: boolean; json: unknown }) =>
      !r.ok && r.json && typeof r.json === 'object' && (r.json as { error?: string }).error?.includes('not found');
    if (notFound(week) || notFound(month)) {
      return {
        status: 'not-tracked',
        week: null,
        month: null,
        version,
        note: "npm's download stats have not picked this package up yet (published Nov 18, 2026). The package itself is live on npm — the stats endpoint just has no data for it yet.",
      };
    }
    if (!week.ok || !month.ok) {
      return { status: 'error', week: null, month: null, version, note: "npm's download API did not answer." };
    }
    const w = week.json as { downloads?: number };
    const m = month.json as { downloads?: number };
    if (typeof w.downloads !== 'number' || typeof m.downloads !== 'number') {
      return { status: 'error', week: null, month: null, version, note: "npm's download API answered in an unexpected format." };
    }
    return { status: 'ok', week: w.downloads, month: m.downloads, version, note: null };
  } catch {
    return { status: 'error', week: null, month: null, version: null, note: "Could not reach npm." };
  }
}

async function pypiDownloads(): Promise<Downloads> {
  try {
    const [recent, meta] = await Promise.all([
      fetchJson('https://pypistats.org/api/packages/polypad-agent/recent', FETCH_TIMEOUT_MS),
      fetchJson('https://pypi.org/pypi/polypad-agent/json', FETCH_TIMEOUT_MS),
    ]);
    const version =
      meta.ok && meta.json && typeof meta.json === 'object'
        ? ((meta.json as { info?: { version?: string } }).info?.version ?? null)
        : null;
    if (recent.status === 404) {
      return {
        status: 'not-tracked',
        week: null,
        month: null,
        version,
        note: 'PyPI download stats have not indexed this package yet (published Nov 18, 2026). The package itself is live on PyPI — the stats service just has no data for it yet.',
      };
    }
    if (!recent.ok) {
      return { status: 'error', week: null, month: null, version, note: 'The PyPI download-stats service did not answer.' };
    }
    const data = (recent.json as { data?: { last_week?: number; last_month?: number } }).data;
    if (!data || typeof data.last_week !== 'number' || typeof data.last_month !== 'number') {
      return { status: 'error', week: null, month: null, version, note: 'The PyPI download-stats service answered in an unexpected format.' };
    }
    return { status: 'ok', week: data.last_week, month: data.last_month, version, note: null };
  } catch {
    return { status: 'error', week: null, month: null, version: null, note: 'Could not reach PyPI download stats.' };
  }
}

type Registry = {
  status: 'ok' | 'error';
  name: string;
  version: string | null;
  registryStatus: string | null;
  publishedAt: string | null;
  lastKnown: boolean;
  note: string | null;
};

async function registryStatus(): Promise<Registry> {
  try {
    const r = await fetchJson('https://registry.modelcontextprotocol.io/v0.1/servers?search=polypad', FETCH_TIMEOUT_MS);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const servers = (r.json as { servers?: { server?: Record<string, unknown>; _meta?: Record<string, unknown> }[] }).servers ?? [];
    const hit = servers.find((s) => s.server?.name === 'family.polypad/polypad');
    if (!hit?.server) throw new Error('listing not found in search results');
    const official = (hit._meta?.['io.modelcontextprotocol.registry/official'] ?? {}) as { status?: string; publishedAt?: string };
    return {
      status: 'ok',
      name: 'family.polypad/polypad',
      version: typeof hit.server.version === 'string' ? hit.server.version : null,
      registryStatus: official.status ?? null,
      publishedAt: official.publishedAt ?? null,
      lastKnown: false,
      note: null,
    };
  } catch {
    return {
      status: 'error',
      name: REGISTRY_LAST_KNOWN.name,
      version: REGISTRY_LAST_KNOWN.version,
      registryStatus: REGISTRY_LAST_KNOWN.registryStatus,
      publishedAt: REGISTRY_LAST_KNOWN.publishedAt,
      lastKnown: true,
      note: `Live registry check failed — showing the last verified listing (checked ${REGISTRY_LAST_KNOWN.verifiedAt}).`,
    };
  }
}

async function agentCount(): Promise<{ status: 'ok' | 'error'; count: number | null; note: string | null }> {
  try {
    const address = getAgentRegistryAddress() ?? REGISTRY_ADDRESS_FALLBACK;
    const count = Number(
      await rpcClient.readContract({ address, abi: AgentRegistryABI, functionName: 'agentCount' }),
    );
    return { status: 'ok', count, note: null };
  } catch {
    return { status: 'error', count: null, note: 'Could not read the AgentRegistry contract.' };
  }
}

async function fundCount(): Promise<{
  status: 'ok' | 'error';
  count: number | null;
  funds: { name: string; symbol: string; address: string }[] | null;
  note: string | null;
}> {
  try {
    const funds = await allFunds(defaultCtx());
    return {
      status: 'ok',
      count: funds.length,
      funds: funds.map((f) => ({ name: f.name, symbol: f.symbol, address: f.address })),
      note: null,
    };
  } catch {
    return { status: 'error', count: null, funds: null, note: 'Could not read the live fund list.' };
  }
}

async function tvl(): Promise<{
  status: 'ok' | 'error';
  totalUsd: number | null;
  stakingUsd: number | null;
  vaultsUsd: number | null;
  note: string | null;
}> {
  try {
    const t = await getTotalTvl();
    if (!t) return { status: 'error', totalUsd: null, stakingUsd: null, vaultsUsd: null, note: 'Total TVL is unavailable right now.' };
    return { status: 'ok', totalUsd: t.totalUsd, stakingUsd: t.stakingUsd, vaultsUsd: t.vaultsUsd, note: null };
  } catch {
    return { status: 'error', totalUsd: null, stakingUsd: null, vaultsUsd: null, note: 'Could not price total TVL.' };
  }
}

type PulsePayload = {
  checkedAt: string;
  npm: Downloads;
  pypi: Downloads;
  registry: Registry;
  agents: { status: 'ok' | 'error'; count: number | null; note: string | null };
  funds: { status: 'ok' | 'error'; count: number | null; funds: { name: string; symbol: string; address: string }[] | null; note: string | null };
  tvl: { status: 'ok' | 'error'; totalUsd: number | null; stakingUsd: number | null; vaultsUsd: number | null; note: string | null };
  usage: UsageTotals;
  tools: { count: number };
  x402: { id: string; name: string; priceUsd: number }[];
};

let cache: { at: number; value: PulsePayload } | null = null;

async function compute(): Promise<PulsePayload> {
  const [npm, pypi, registry, agents, funds, tvlResult, usage] = await Promise.all([
    npmDownloads(),
    pypiDownloads(),
    registryStatus(),
    agentCount(),
    fundCount(),
    tvl(),
    getUsageTotals(),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    npm,
    pypi,
    registry,
    agents,
    funds,
    tvl: tvlResult,
    usage,
    tools: { count: TOOLS.length },
    x402: X402_PRODUCTS.map((p) => ({ id: p.id, name: p.name, priceUsd: p.priceUsd })),
  };
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.value);
  }
  const value = await compute();
  cache = { at: Date.now(), value };
  return NextResponse.json(value);
}
