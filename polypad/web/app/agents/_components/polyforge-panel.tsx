'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { robinhoodChain } from '@/lib/chain';
import { getAgent } from '@/lib/agents/prompts';
import type { Intent } from '@/lib/agents/tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TokenAvatar } from '@/components/token-avatar';
import { PostDrafts } from '@/components/cto/cto-parts';
import { AgentChat } from './agent-chat';
import { ErrorNote, Loading, Panel } from './ui';
import { ReviewSign } from './review-sign';
import { defaultPool, parseForgeReply, validatePool, type PoolForm, type TxPlan } from './forge';
import { cn } from '@/lib/utils';

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[12px] text-white/60">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-white/35">{hint}</span>}
    </label>
  );
}

const areaCls = 'w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[16px] text-white placeholder:text-white/35 focus:border-polydash-green/50 focus:outline-none sm:text-[13px]';

interface MyToken { launchAddress: string; tokenAddress: string; symbol: string; name: string; imageUri: string; agentName: string }
type Tool = 'pool' | 'post' | 'cto';
const TOOLS: [Tool, string][] = [['pool', 'Staking pool builder'], ['post', 'Draft milestone post'], ['cto', "Open my token's CTO"]];

const CreateNote = () => (
  <p className="rounded-2xl bg-white/[0.06] px-3.5 py-2 text-[13px] text-white/85">
    To launch a new token, use the <Link href="/create" className="text-polydash-green hover:underline">Create page</Link>.
  </p>
);

function useMyTokens(account?: string) {
  const [tokens, setTokens] = useState<MyToken[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!account) { setTokens(null); return; }
    let live = true;
    setTokens(null); setError('');
    fetch(`/api/cto/by-creator?address=${account}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error ?? 'Could not load your tokens.'); return d.tokens as MyToken[]; })
      .then((t) => { if (live) setTokens(t); })
      .catch((e) => { console.error('my tokens failed', e); if (live) setError(e?.message ?? 'Could not load your tokens.'); });
    return () => { live = false; };
  }, [account]);
  return { tokens, error };
}

function MyTokensList({ tokens, error, connected, render }: { tokens: MyToken[] | null; error: string; connected: boolean; render: (t: MyToken) => ReactNode }) {
  if (!connected) return <p className="text-[13px] text-white/50">Connect your wallet to see tokens you created.</p>;
  if (error) return <ErrorNote message={error} />;
  if (!tokens) return <Loading label="Finding tokens you created" />;
  if (tokens.length === 0) return <p className="text-[13px] text-white/50">No tokens created by this wallet yet. <Link href="/create" className="text-polydash-green hover:underline">Create one</Link>.</p>;
  return <ul className="space-y-2">{tokens.map((t) => <li key={t.launchAddress}>{render(t)}</li>)}</ul>;
}

function TokenRow({ t, children }: { t: MyToken; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <TokenAvatar name={t.name} symbol={t.symbol} imageUri={t.imageUri} size="sm" />
        <div className="min-w-0"><div className="truncate text-[13px] font-medium">{t.name}</div><div className="text-[12px] text-white/45">${t.symbol}</div></div>
      </div>
      {children}
    </div>
  );
}

function DraftPost({ t, wallet }: { t: MyToken; wallet?: string }) {
  return <PostDrafts launch={t.launchAddress} wallet={wallet} title={`Post drafts for $${t.symbol}`} />;
}

export function PolyForgePanel({ initialStakeToken }: { initialStakeToken?: string }) {
  const { address: account, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [tool, setTool] = useState<Tool>('pool');
  const [pool, setPool] = useState<PoolForm>(() => (initialStakeToken ? { ...defaultPool, stakeToken: initialStakeToken } : defaultPool));
  const [errors, setErrors] = useState<string[]>([]);
  const [plan, setPlan] = useState<TxPlan | null>(null);
  const [planKey, setPlanKey] = useState(0);
  const [building, setBuilding] = useState(false);
  const [postFor, setPostFor] = useState<MyToken | null>(null);
  const { tokens, error: tokensError } = useMyTokens(account);
  const wrongChain = isConnected && chainId !== robinhoodChain.id;

  const setP = (k: keyof PoolForm, v: string) => { setPool((p) => ({ ...p, [k]: v })); setPlan(null); };

  const review = async () => {
    setBuilding(true);
    setPlan(null);
    try {
      const r = await validatePool(pool, account);
      setErrors(r.errors);
      if (r.plan) { setPlan(r.plan); setPlanKey((k) => k + 1); }
    } catch (e: any) {
      setErrors([e?.message ?? 'Could not build the transaction.']);
    } finally {
      setBuilding(false);
    }
  };

  const resolve = (intent: Intent): ReactNode => {
    if (intent.tool === 'forgePool') { setTool('pool'); setPlan(null); return <p className="rounded-2xl bg-white/[0.06] px-3.5 py-2 text-[13px] text-white/85">Opened the staking pool form above. Fill it in, then press Review.</p>; }
    if (intent.tool === 'forgeLaunch') return <CreateNote />;
    return null;
  };

  const onReply = (text: string): ReactNode | null => {
    const parsed = parseForgeReply(text);
    if (!parsed) return null;
    if (parsed.type === 'launch') return <CreateNote />;
    const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
    setTool('pool');
    setPool((p) => ({ ...p, ...clean(parsed.form) }));
    setPlan(null);
    setErrors([]);
    return <p className="rounded-2xl bg-white/[0.06] px-3.5 py-2 text-[13px] text-white/85">Filled the staking pool form above. Check every field, then press Review.</p>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
        <p className="text-[13px] text-white/70">PolyForge is for growing a token after launch.</p>
        <Link href="/create" className="inline-flex h-8 items-center rounded-full bg-white px-3.5 text-[13px] font-medium text-black hover:bg-white/90">Launching a new token? Use Create</Link>
      </div>

      <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4')}>
        <div className="text-[13px] text-white/70">
          {!isConnected ? 'Connect your wallet to build and sign transactions.' : wrongChain ? 'Your wallet is on another network.' : 'Wallet connected on Robinhood Chain.'}
        </div>
        {!isConnected ? <ConnectButton chainStatus="none" showBalance={false} /> : wrongChain ? (
          <Button size="sm" disabled={switching} onClick={() => switchChain({ chainId: robinhoodChain.id })}>{switching ? 'Switching' : 'Switch to Robinhood Chain'}</Button>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 text-[14px] font-semibold">Post-launch tools</h3>
        <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1 sm:rounded-full">
          {TOOLS.map(([k, l]) => (
            <button key={k} onClick={() => { setTool(k); setErrors([]); }} className={cn('h-8 rounded-full px-3.5 text-[13px] transition-colors', tool === k ? 'bg-white text-black' : 'text-white/60 hover:text-white')}>{l}</button>
          ))}
        </div>
      </div>

      {tool === 'post' && (
        <Panel title="Draft milestone post" note="From your token's CTO data">
          <MyTokensList tokens={tokens} error={tokensError} connected={isConnected} render={(t) => (
            <TokenRow t={t}><Button size="sm" variant={postFor?.launchAddress === t.launchAddress ? 'default' : 'outline'} onClick={() => setPostFor(t)}>Draft posts</Button></TokenRow>
          )} />
          {postFor && <div className="mt-4"><DraftPost key={`${postFor.launchAddress}:${account ?? ''}`} t={postFor} wallet={account} /></div>}
        </Panel>
      )}

      {tool === 'cto' && (
        <Panel title="Open my token's CTO" note="Tokens created by the connected wallet">
          <MyTokensList tokens={tokens} error={tokensError} connected={isConnected} render={(t) => (
            <TokenRow t={t}><Link href={`/token/${t.launchAddress}#cto`} className="inline-flex h-8 items-center rounded-full bg-polydash-green px-3.5 text-[13px] font-medium text-black hover:bg-polydash-green-light">Open {t.agentName}</Link></TokenRow>
          )} />
        </Panel>
      )}

      {tool === 'pool' && (
        <>
        <Panel title="Create staking pool" note="createPool on the staking factory">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stake token *"><Input value={pool.stakeToken} onChange={(e) => setP('stakeToken', e.target.value)} placeholder="0x…" className="font-mono" /></Field>
            <Field label="Reward token" hint="Defaults to the stake token"><Input value={pool.rewardToken} onChange={(e) => setP('rewardToken', e.target.value)} placeholder="Same as stake token" className="font-mono" /></Field>
            <Field label="Reward amount (tokens) *" hint="Deposited from your wallet into the pool"><Input inputMode="decimal" value={pool.rewardAmount} onChange={(e) => setP('rewardAmount', e.target.value)} /></Field>
            <Field label="Start time" hint="Empty = now. At most 365 days ahead"><Input type="datetime-local" value={pool.startTime} onChange={(e) => setP('startTime', e.target.value)} /></Field>
            <Field label="Duration (days)" hint="1 to 3650"><Input inputMode="decimal" value={pool.durationDays} onChange={(e) => setP('durationDays', e.target.value)} /></Field>
            <Field label="Max total stake (tokens)" hint="0 = no cap"><Input inputMode="decimal" value={pool.maxTotalStake} onChange={(e) => setP('maxTotalStake', e.target.value)} /></Field>
            <Field label="Claim fee (bps)" hint="100 to 500. Fee on reward claims, split with the platform per the contract"><Input inputMode="numeric" value={pool.claimFeeBps} onChange={(e) => setP('claimFeeBps', e.target.value)} /></Field>
            <Field label={`Pool name * (${pool.name.length}/64)`}><Input value={pool.name} maxLength={64} onChange={(e) => setP('name', e.target.value)} /></Field>
            <Field label={`Description (${pool.description.length}/280)`} className="sm:col-span-2">
              <textarea value={pool.description} onChange={(e) => setP('description', e.target.value)} rows={2} maxLength={280} className={areaCls} />
            </Field>
          </div>
        </Panel>

          {errors.length > 0 && <ErrorNote message={errors.join(' ')} />}
          {!plan && (
            <Button onClick={review} disabled={building}>
              {building ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking</> : 'Review'}
            </Button>
          )}
          {plan && <ReviewSign key={planKey} plan={plan} onClose={() => setPlan(null)} />}
        </>
      )}

      <AgentChat agent="polyforge" hint={getAgent('polyforge')!.chatHint} resolve={resolve} onReply={onReply} />
    </div>
  );
}
