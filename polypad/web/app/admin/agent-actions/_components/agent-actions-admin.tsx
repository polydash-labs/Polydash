'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from '@/components/ui/button';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';

type Row = { id: string; createdAt: string; action: string; ref: string; client: string; wallet: string | null; txHash: string | null; status: string; valueWei: string | null; fingerprint: string | null; matchedChat: boolean };
type Win = { total: number; uniqueWallets: number; byActionRef: { action: string; ref: string; count: number }[]; byStatus: Record<string, number> };

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Request failed.');
  return data;
}

export function AgentActionsAdmin() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stats, setStats] = useState<Record<string, Win> | null>(null);
  const [state, setState] = useState<'loading' | 'signin' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/agent-actions', { cache: 'no-store' });
      if (res.status === 401) { setState('signin'); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not load rows.');
      setRows(data.rows);
      setState('ready');
      const s = await fetch('/api/agent-stats', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      setStats(s?.windows ?? null);
    } catch (e: any) {
      console.error('agent actions admin load failed', e);
      setError(e?.message ?? 'Could not load rows.');
      setState('signin');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const signIn = async () => {
    if (!address) return;
    setBusy(true); setError('');
    try {
      const { nonce, message } = await postJson('/api/admin/agent-actions/nonce', { address });
      const signature = await signMessageAsync({ message });
      await postJson('/api/admin/agent-actions/verify', { address, nonce, signature });
      await load();
    } catch (e: any) {
      console.error('admin sign-in failed', e);
      const msg = e?.shortMessage ?? e?.message ?? 'Sign-in failed.';
      setError(/reject|denied/i.test(msg) ? 'Signature cancelled.' : msg);
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 px-5 py-8 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold text-white">Agent actions</h1>
        <p className="mt-1 text-[13px] text-white/50">Steps recorded by the /sign page. Admin wallet only (the owner of the Polypad launch factory on Robinhood Chain).</p>
      </div>

      {state === 'loading' && <p className="flex items-center gap-2 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading</p>}

      {state === 'signin' && (
        <div className={card}>
          <p className="text-[13px] text-white/70">Connect the admin wallet and sign a message to view the rows. Signing a message sends no transaction.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ConnectButton showBalance={false} />
            {address && <Button onClick={signIn} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in (sign a message)'}</Button>}
          </div>
          {error && <p className="mt-3 text-[13px] text-[#FF8A80]">{error}</p>}
        </div>
      )}

      {state === 'ready' && (
        <>
          {stats && (
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(stats).map(([k, w]) => (
                <div key={k} className={card}>
                  <p className="text-[11px] uppercase tracking-wide text-white/40">{k}</p>
                  <p className="mt-1 text-[13px] text-white">{w.total} steps · {w.uniqueWallets} wallets</p>
                  <p className="mt-1 text-[12px] text-white/50">{Object.entries(w.byStatus).map(([s, n]) => `${s} ${n}`).join(' · ') || 'No steps yet'}</p>
                </div>
              ))}
            </div>
          )}
          <div className={`${card} overflow-x-auto`}>
            {rows && rows.length === 0 ? <p className="text-[13px] text-white/50">No rows yet.</p> : (
              <table className="w-full min-w-[820px] text-left text-[12px]">
                <thead className="text-white/40">
                  <tr>{['Time (UTC)', 'Action', 'Ref', 'Client', 'Status', 'Wallet', 'Value (wei)', 'Matched chat', 'Tx'].map((h) => <th key={h} className="pb-2 pr-3 font-normal">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-white/80">
                  {rows?.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 font-mono">{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                      <td className="py-2 pr-3">{r.action}</td>
                      <td className="py-2 pr-3">{r.ref}</td>
                      <td className="max-w-[160px] truncate py-2 pr-3">{r.client}</td>
                      <td className="py-2 pr-3">{r.status}</td>
                      <td className="py-2 pr-3 font-mono">{r.wallet ? shortenAddress(r.wallet) : '-'}</td>
                      <td className="py-2 pr-3 font-mono">{r.valueWei ?? '-'}</td>
                      <td className="py-2 pr-3">{r.matchedChat ? 'yes' : 'no'}</td>
                      <td className="py-2 pr-3">{r.txHash ? <a href={getExplorerTxUrl(r.txHash)} target="_blank" rel="noopener noreferrer" className="font-mono text-white/60 hover:text-white">{r.txHash.slice(0, 10)}…</a> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Button variant="outline" onClick={async () => { await fetch('/api/admin/agent-actions', { method: 'DELETE' }); setRows(null); setState('signin'); }}>Sign out</Button>
        </>
      )}
    </div>
  );
}
