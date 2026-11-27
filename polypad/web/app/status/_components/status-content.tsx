'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type CheckState = 'checking' | 'ok' | 'slow' | 'unknown' | 'down';

type Check = {
  id: string;
  name: string;
  what: string;
  state: CheckState;
  detail: string;
};

const MCP_URL = 'https://polypad.family/api/mcp';
const X402_URL = 'https://polypad.family/api/x402/supported';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const TIMEOUT_MS = 8000;

function Dot({ state }: { state: CheckState }) {
  const color =
    state === 'ok' ? 'bg-[#00E676]' : state === 'slow' || state === 'unknown' ? 'bg-amber-400' : state === 'down' ? 'bg-red-500' : 'bg-white/40 animate-pulse';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />;
}

function stateLabel(state: CheckState): string {
  switch (state) {
    case 'checking': return 'Checking…';
    case 'ok': return 'Up';
    case 'slow': return 'Up, but slow';
    case 'unknown': return 'Could not check';
    case 'down': return 'Down';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function StatusContent() {
  const [checks, setChecks] = useState<Check[]>([
    { id: 'mcp', name: 'Agent API (MCP)', what: 'The MCP endpoint answers an initialize handshake.', state: 'checking', detail: '' },
    { id: 'x402', name: 'Pay-per-call (x402)', what: 'The facilitator lists its supported payment kinds.', state: 'checking', detail: '' },
    { id: 'rpc', name: 'Robinhood Chain RPC', what: 'The chain answers for the latest block number.', state: 'checking', detail: '' },
  ]);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  const runChecks = useCallback(async () => {
    const id = ++runId.current;
    setBusy(true);
    setChecks((prev) => prev.map((c) => ({ ...c, state: 'checking' as CheckState, detail: '' })));

    const setCheck = (checkId: string, state: CheckState, detail: string) => {
      if (runId.current !== id) return;
      setChecks((prev) => prev.map((c) => (c.id === checkId ? { ...c, state, detail } : c)));
    };

    // 1. MCP initialize handshake.
    try {
      const start = performance.now();
      const res = await fetchWithTimeout(
        MCP_URL,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'polypad-status', version: '1.0.0' } } }),
        },
        TIMEOUT_MS,
      );
      const ms = Math.round(performance.now() - start);
      const json = (await res.json().catch(() => null)) as { result?: { serverInfo?: { version?: string } } } | null;
      const version = json?.result?.serverInfo?.version;
      if (res.ok && version) {
        setCheck('mcp', ms > 5000 ? 'slow' : 'ok', `Answered in ${ms} ms · server v${version}`);
      } else {
        setCheck('mcp', 'down', `HTTP ${res.status} — no server info in the reply.`);
      }
    } catch {
      setCheck('mcp', 'down', 'No answer within 8 seconds. The endpoint may be down, or your connection is.');
    }

    // 2. x402 facilitator.
    try {
      const start = performance.now();
      const res = await fetchWithTimeout(X402_URL, { method: 'GET' }, TIMEOUT_MS);
      const ms = Math.round(performance.now() - start);
      const json = (await res.json().catch(() => null)) as { kinds?: unknown[] } | null;
      if (res.ok && Array.isArray(json?.kinds) && json.kinds.length > 0) {
        setCheck('x402', ms > 5000 ? 'slow' : 'ok', `Answered in ${ms} ms · ${json.kinds.length} payment kinds listed`);
      } else {
        setCheck('x402', 'down', `HTTP ${res.status} — no payment kinds in the reply.`);
      }
    } catch {
      setCheck('x402', 'down', 'No answer within 8 seconds.');
    }

    // 3. Robinhood Chain RPC.
    try {
      const start = performance.now();
      const res = await fetchWithTimeout(
        RPC_URL,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        },
        TIMEOUT_MS,
      );
      const ms = Math.round(performance.now() - start);
      const json = (await res.json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
      if (res.ok && typeof json?.result === 'string') {
        setCheck('rpc', ms > 5000 ? 'slow' : 'ok', `Answered in ${ms} ms · block ${parseInt(json.result, 16).toLocaleString('en-US')}`);
      } else if (json?.error) {
        setCheck('rpc', 'down', `The chain answered with an error: ${json.error.message ?? 'unknown error'}.`);
      } else {
        setCheck('rpc', 'down', `HTTP ${res.status} — no block number in the reply.`);
      }
    } catch {
      setCheck('rpc', 'unknown', 'This check runs in your browser and the chain RPC did not answer it — it may block browser requests. It does not mean the chain is down; check the explorer if you need certainty.');
    }

    if (runId.current === id) {
      setLastChecked(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  const anyDown = checks.some((c) => c.state === 'down');
  const anySlow = checks.some((c) => c.state === 'slow' || c.state === 'unknown');
  const anyChecking = checks.some((c) => c.state === 'checking');
  const overall = anyDown ? 'Something is down' : anyChecking ? 'Checking…' : anySlow ? 'Up, with a caveat' : 'All systems normal';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Dot state={anyDown ? 'down' : anySlow ? 'slow' : anyChecking ? 'checking' : 'ok'} />
        <p className="text-[15px] font-medium text-white">{overall}</p>
        <Button variant="outline" size="sm" onClick={runChecks} disabled={busy}>
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      {lastChecked && <p className="mt-2 text-[13px] text-white/50">Last checked {lastChecked} · these checks run live in your browser against the public endpoints.</p>}

      <div className="mt-6 space-y-4">
        {checks.map((c) => (
          <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Dot state={c.state} />
              <p className="text-[14px] font-medium text-white">{c.name}</p>
              <span className="text-[13px] text-white/50">— {stateLabel(c.state)}</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">{c.what}</p>
            {c.detail && <p className="mt-1 text-[13px] leading-relaxed text-white/70">{c.detail}</p>}
          </div>
        ))}
      </div>

      <p className="mt-6 text-[13px] leading-relaxed text-white/50">
        Best effort — no SLA yet. These are live checks, not a promise: uptime is measured from the day this page
        went live, and no availability guarantee is offered until there are 30 days of data behind it. If the API is
        down, the fastest place to say so is the <a href="/security" className="text-[#00E676] hover:underline">security page</a> contact.
        Contracts are unaudited.
      </p>
    </div>
  );
}
