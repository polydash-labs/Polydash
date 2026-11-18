'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { TokenAvatar } from '@/components/token-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CTO_FOOTER, OfficialInfo, PostDrafts } from '@/components/cto/cto-parts';
import { ErrorNote, Panel, Pill, card } from '@/app/agents/_components/ui';
import { LIMITS, SOCIAL_LABELS, TONES, emptyProfile, validateProfile, type ProfileInput, type Socials, type Tone } from '@/lib/cto/profile';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PromiseMaker } from './promise-maker';
import { BuildLinks } from './build-links';

interface Meta { signedIn: boolean; creator: string; symbol: string; name: string; imageUri: string; tokenAddress: string; agentName: string; profile: ProfileInput | null }

const area = 'w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[16px] text-white placeholder:text-white/35 focus:border-polydash-green/50 focus:outline-none sm:text-[13px]';

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Request failed.');
  return data;
}

export function CtoManage({ launchAddress }: { launchAddress: string }) {
  const launch = launchAddress.toLowerCase();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<ProfileInput>(emptyProfile());
  const [busy, setBusy] = useState<'' | 'sign' | 'save' | 'logout'>('');
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cto/${launch}/profile`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not load this launch.');
      setMeta(data as Meta);
      if (data.profile) {
        const p = data.profile;
        setForm({ tone: TONES.includes(p.tone) ? p.tone : 'friendly', socials: { ...emptyProfile().socials, ...(p.socials ?? {}) }, faqs: Array.isArray(p.faqs) ? p.faqs : [], plan: p.plan ?? '' });
      }
    } catch (e: any) {
      console.error('cto manage load failed', e);
      setLoadError(e?.message ?? 'Could not load this launch.');
    }
  }, [launch]);

  useEffect(() => { load(); }, [load]);

  const isCreator = !!address && !!meta && address.toLowerCase() === meta.creator.toLowerCase();

  const signIn = async () => {
    if (!address) return;
    setBusy('sign');
    try {
      const { nonce, message } = await postJson('/api/cto/auth/nonce', { address, launchAddress: launch });
      const signature = await signMessageAsync({ message });
      await postJson('/api/cto/auth/verify', { address, launchAddress: launch, nonce, signature });
      toast.success('Signed in as the creator');
      await load();
    } catch (e: any) {
      console.error('cto sign-in failed', e);
      const msg = e?.shortMessage ?? e?.message ?? 'Sign-in failed.';
      toast.error(/reject|denied/i.test(msg) ? 'Signature cancelled' : msg);
    } finally { setBusy(''); }
  };

  const logout = async () => {
    setBusy('logout');
    try { await postJson('/api/cto/auth/logout', { launchAddress: launch }); await load(); } catch (e: any) { toast.error(e?.message ?? 'Could not sign out.'); } finally { setBusy(''); }
  };

  const save = async () => {
    const v = validateProfile(form);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors([]);
    setBusy('save');
    try {
      const res = await fetch(`/api/cto/${launch}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v.data) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { toast.error('Your session expired. Sign in again.'); await load(); return; }
      if (!res.ok) { setErrors(data?.errors ?? [data?.error ?? 'Could not save.']); return; }
      toast.success('Official info saved');
      await load();
    } catch (e: any) {
      console.error('cto save failed', e);
      toast.error(e?.message ?? 'Could not save.');
    } finally { setBusy(''); }
  };

  const setSocial = (k: keyof Socials, v: string) => setForm((f) => ({ ...f, socials: { ...f.socials, [k]: v } }));
  const setFaq = (i: number, k: 'q' | 'a', v: string) => setForm((f) => ({ ...f, faqs: f.faqs.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));

  if (loadError) return <div className="mx-auto max-w-[900px] px-5 py-12"><ErrorNote message={loadError} /></div>;
  if (!meta) return <div className="mx-auto flex max-w-[900px] items-center gap-2 px-5 py-12 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>;

  return (
    <div className="mx-auto max-w-[900px] space-y-5 px-5 py-8 sm:py-10">
      <Link href={`/token/${launch}#cto`} className="inline-flex items-center gap-1 text-[13px] text-white/50 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back to ${meta.symbol}</Link>

      <div className="flex items-center gap-3">
        <TokenAvatar name={meta.name} symbol={meta.symbol} imageUri={meta.imageUri} size="md" />
        <div>
          <h1 className="text-[clamp(20px,4vw,26px)] font-semibold">Manage {meta.agentName}</h1>
          <p className="text-[12px] text-white/45">Creator {shortenAddress(meta.creator)}</p>
        </div>
      </div>

      <div className={cn(card, 'p-4 sm:p-5')}>
        {!isConnected ? (
          <div className="space-y-3">
            <p className="text-[13px] text-white/60">Connect the wallet that created ${meta.symbol} to edit its official info.</p>
            <ConnectButton showBalance={false} />
          </div>
        ) : !isCreator ? (
          <p className="text-[13px] text-white/60">The connected wallet ({shortenAddress(address!)}) is not the creator of ${meta.symbol}. Only {shortenAddress(meta.creator)} can edit this page.</p>
        ) : !meta.signedIn ? (
          <div className="space-y-3">
            <p className="text-[13px] text-white/60">Sign a message to prove you are the creator. This is not a transaction and costs no gas. Never share your seed phrase or private key with anyone.</p>
            <Button onClick={signIn} disabled={busy === 'sign'}>{busy === 'sign' ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Waiting for signature</> : 'Sign in as creator'}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px]"><Pill tone="green">Signed in</Pill><span className="text-white/60">Session lasts 24 hours.</span></div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/agents?agent=polyforge&stake=${meta.tokenAddress}`} className="inline-flex h-9 items-center rounded-full bg-polydash-green px-4 text-[13px] font-medium text-black hover:bg-polydash-green-light">Set up staking</Link>
              <Button variant="outline" onClick={logout} disabled={busy === 'logout'}>Sign out</Button>
            </div>
          </div>
        )}
      </div>

      {isCreator && meta.signedIn && (
        <PromiseMaker launch={launch} symbol={meta.symbol} tokenAddress={meta.tokenAddress} creator={meta.creator} />
      )}

      {isConnected && (
        <BuildLinks launch={launch} tokenAddress={meta.tokenAddress} address={address} isCreator={isCreator} />
      )}

      {isCreator && meta.signedIn && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel title="Official info" note="Shown on the token page">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[12px] text-white/50">Tone for the CTO</label>
                <div className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, tone: t as Tone }))}
                      className={cn('h-8 rounded-full border px-3 text-[12px] capitalize', form.tone === t ? 'border-polydash-green bg-polydash-green/15 text-polydash-green' : 'border-white/15 text-white/70 hover:text-white')}>{t}</button>
                  ))}
                </div>
              </div>
              {(Object.keys(SOCIAL_LABELS) as (keyof Socials)[]).map((k) => (
                <div key={k}>
                  <label className="mb-1 block text-[12px] text-white/50">{SOCIAL_LABELS[k]}</label>
                  <Input value={form.socials[k]} maxLength={LIMITS.url} onChange={(e) => setSocial(k, e.target.value)} placeholder="https://" />
                </div>
              ))}
              <div>
                <label className="mb-1 flex justify-between text-[12px] text-white/50"><span>Plan</span><span>{form.plan.length}/{LIMITS.plan}</span></label>
                <textarea value={form.plan} maxLength={LIMITS.plan} rows={5} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))} className={area} placeholder="What you are building and what comes next" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[12px] text-white/50"><span>FAQs</span><span>{form.faqs.length}/{LIMITS.faqs}</span></div>
                <div className="space-y-3">
                  {form.faqs.map((f, i) => (
                    <div key={i} className="space-y-2 rounded-xl bg-white/[0.03] p-3">
                      <Input value={f.q} maxLength={LIMITS.q} onChange={(e) => setFaq(i, 'q', e.target.value)} placeholder="Question" />
                      <textarea value={f.a} maxLength={LIMITS.a} rows={3} onChange={(e) => setFaq(i, 'a', e.target.value)} className={area} placeholder="Answer" />
                      <button type="button" onClick={() => setForm((x) => ({ ...x, faqs: x.faqs.filter((_, j) => j !== i) }))} className="text-[12px] text-[#FF8A80] hover:underline">Remove</button>
                    </div>
                  ))}
                </div>
                {form.faqs.length < LIMITS.faqs && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setForm((f) => ({ ...f, faqs: [...f.faqs, { q: '', a: '' }] }))}>Add FAQ</Button>
                )}
              </div>
              {errors.length > 0 && <ErrorNote message={errors.join(' ')} />}
              <Button onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving' : 'Save'}</Button>
            </div>
          </Panel>
          <div className="space-y-2">
            <div className="text-[12px] text-white/45">Preview</div>
            <OfficialInfo profile={form} symbol={meta.symbol} />
          </div>
          <div className="lg:col-span-2">
            <PostDrafts launch={launch} wallet={address} />
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-white/40">{CTO_FOOTER}</p>
    </div>
  );
}
