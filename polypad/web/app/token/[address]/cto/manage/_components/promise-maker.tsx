'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorNote, Panel } from '@/app/agents/_components/ui';
import { PromisesCard } from '@/components/cto/promises-card';
import { xIntent } from '@/lib/cto/posts';
import {
  DAYS, HOLD_PCTS, KINDS, MAX_LINKED, PRESET_TITLES, PROMISE_CONFIRM, canonicalJson, endsAtFor, fmtUtcDate, promiseTypedData, sentence, validateParams,
  type PromiseKind, type PromiseView,
} from '@/lib/promises/presets';
import { cn } from '@/lib/utils';

const CHAIN_ID = 4663;
const DAY = 86_400;

const HINT: Record<PromiseKind, string> = {
  no_sell: 'No sells or swaps of your tokens for a set time.',
  hold: 'Keep a share of your current balance until a date.',
  staking_live: 'Open a staking pool for holders by a deadline.',
  staking_rewards: 'Fund staking rewards with your tokens by a date.',
  payout_fixed: 'Keep your creator payout wallet unchanged.',
};

const sel = 'h-9 rounded-full border border-white/15 bg-white/[0.03] px-3 text-[16px] text-white focus:border-polydash-green/50 focus:outline-none sm:text-[13px]';

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Request failed.');
  return data;
}

export function PromiseMaker({ launch, symbol, tokenAddress, creator }: { launch: string; symbol: string; tokenAddress: string; creator: string }) {
  const { chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [kind, setKind] = useState<PromiseKind | null>(null);
  const [days, setDays] = useState<number>(DAYS.no_sell[0]);
  const [pct, setPct] = useState<number>(HOLD_PCTS[1]);
  const [mode, setMode] = useState<'grad' | 'date'>('grad');
  const [amount, setAmount] = useState('');
  const [showWallets, setShowWallets] = useState(false);
  const [wallets, setWallets] = useState<string[]>(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [list, setList] = useState<PromiseView[]>([]);
  const [now, setNow] = useState<number | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/promises/${launch}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setList(data.promises ?? []);
    } catch (e) { console.error('promises load failed', e); }
  }, [launch]);

  useEffect(() => { loadList(); setNow(Math.floor(Date.now() / 1000)); }, [loadList]);

  const pick = (k: PromiseKind) => {
    setKind(k); setError('');
    setDays(k === 'no_sell' ? DAYS.no_sell[0] : k === 'staking_live' && mode === 'grad' ? DAYS.grad[0] : DAYS.long[0]);
  };
  const daysList: readonly number[] = kind === 'no_sell' ? DAYS.no_sell : kind === 'staking_live' && mode === 'grad' ? DAYS.grad : DAYS.long;
  const raw = { days, pct: kind === 'hold' ? pct : undefined, mode: kind === 'staking_live' ? mode : undefined, amount: kind === 'staking_rewards' ? amount.trim() : undefined, wallets: wallets.filter((w) => w.trim()) };
  const preview = kind && now ? sentence(kind, { ...raw, wallets: [] }, symbol, endsAtFor(kind, { ...raw, wallets: [] }, now)) : '';

  const publish = async () => {
    if (!kind) return;
    const v = validateParams(kind, raw, [creator, launch, tokenAddress]);
    if (!v.ok) { setError(v.error); return; }
    setError('');
    setBusy(true);
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
      const { nonce, startsAt } = await postJson(`/api/promises/${launch}/nonce`);
      const endsAt = endsAtFor(kind, v.params, startsAt);
      const td = promiseTypedData({ launch, token: tokenAddress, kind, params: canonicalJson(v.params), startsAt, endsAt, nonce, chainId: CHAIN_ID });
      const signature = await signTypedDataAsync(td);
      const { promise } = await postJson(`/api/promises/${launch}`, { kind, params: v.params, startsAt, endsAt, nonce, signature });
      const url = `${window.location.origin}/token/${launch}`;
      const text = `I made a public promise for $${symbol} on Polypad: ${promise.sentence} Tracked on-chain by $${symbol} CTO.`;
      toast.success('Promise published', { description: promise.sentence, duration: 12_000, action: { label: 'Post on X', onClick: () => window.open(xIntent(text, url), '_blank', 'noopener,noreferrer') } });
      setKind(null); setAmount('');
      await loadList();
    } catch (e: any) {
      console.error('promise publish failed', e);
      const msg = e?.shortMessage ?? e?.message ?? 'Could not publish the promise.';
      if (/reject|denied/i.test(msg)) toast.error('Signature cancelled'); else setError(msg);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <Panel title="Make a promise" note="Free signature, no gas">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => pick(k)}
              className={cn('rounded-xl border p-3 text-left transition-colors', kind === k ? 'border-polydash-green bg-polydash-green/10' : 'border-white/10 bg-white/[0.02] hover:border-white/25')}>
              <div className={cn('text-[13px] font-medium', kind === k ? 'text-polydash-green' : 'text-white')}>{PRESET_TITLES[k]}</div>
              <div className="mt-0.5 text-[12px] text-white/50">{HINT[k]}</div>
            </button>
          ))}
        </div>

        {kind && (
          <div className="mt-4 space-y-4 rounded-xl bg-white/[0.03] p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              {kind === 'hold' && (
                <label className="flex items-center gap-2 text-[12px] text-white/50">Keep at least
                  <select className={sel} value={pct} onChange={(e) => setPct(Number(e.target.value))}>{HOLD_PCTS.map((p) => <option key={p} value={p}>{p}%</option>)}</select>
                </label>
              )}
              {kind === 'staking_live' && (
                <div className="flex gap-1">
                  {(['grad', 'date'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => { setMode(m); setDays(m === 'grad' ? DAYS.grad[0] : DAYS.long[0]); }}
                      className={cn('h-8 rounded-full border px-3 text-[12px]', mode === m ? 'border-polydash-green bg-polydash-green/15 text-polydash-green' : 'border-white/15 text-white/70 hover:text-white')}>
                      {m === 'grad' ? 'After graduation' : 'By a date'}
                    </button>
                  ))}
                </div>
              )}
              {kind === 'staking_rewards' && (
                <label className="flex items-center gap-2 text-[12px] text-white/50">Tokens
                  <Input value={amount} inputMode="numeric" onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 13))} placeholder="1000000" className="h-9 w-40" />
                </label>
              )}
              <label className="flex items-center gap-2 text-[12px] text-white/50">
                {kind === 'no_sell' ? 'For' : kind === 'staking_live' && mode === 'grad' ? 'Graduation +' : 'Until'}
                <select className={sel} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {daysList.map((d) => (
                    <option key={d} value={d}>{kind === 'no_sell' || (kind === 'staking_live' && mode === 'grad') ? `${d} days` : now ? `${fmtUtcDate(now + d * DAY)} (${d} days)` : `${d} days`}</option>
                  ))}
                </select>
              </label>
            </div>

            {preview && <p className="rounded-lg border border-white/10 bg-black/30 p-3 text-[14px] text-white">{preview}</p>}

            <div>
              <button type="button" onClick={() => setShowWallets((v) => !v)} className="text-[12px] text-white/55 hover:text-white" aria-expanded={showWallets}>
                {showWallets ? 'Hide' : 'Add'} my other wallets (optional)
              </button>
              {showWallets && (
                <div className="mt-2 space-y-2">
                  <p className="text-[12px] text-white/45">Up to {MAX_LINKED}. Transfers between your wallets are not treated as movement. Their sells count as yours.</p>
                  {wallets.map((w, i) => (
                    <Input key={i} value={w} onChange={(e) => setWallets((ws) => ws.map((x, j) => (j === i ? e.target.value.trim() : x)))} placeholder="0x..." className="font-mono" />
                  ))}
                </div>
              )}
            </div>

            <p className="text-[12px] text-white/55">{PROMISE_CONFIRM}</p>
            {error && <ErrorNote message={error} />}
            <Button onClick={publish} disabled={busy}>{busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Waiting for signature</> : 'Sign & publish'}</Button>
          </div>
        )}
      </Panel>

      {list.length > 0 && <PromisesCard promises={list} title="Your promises" />}
    </div>
  );
}
