'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSignMessage } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorNote, Panel, Pill } from '@/app/agents/_components/ui';
import { MAX_REPOS, MAX_WALLETS, normaliseValue, type BuildAction, type BuildView } from '@/lib/buildact/shared';
import { shortenAddress } from '@/lib/format';

interface PendingWallet { value: string; nonce: string; message: string; signature: string }

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Request failed.');
  return data;
}

const area = 'w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 font-mono text-[16px] text-white placeholder:text-white/35 focus:border-polydash-green/50 focus:outline-none sm:text-[12px]';

/** Creator-only links for Build activity. Every change is an EIP-191 signature checked on the server; no transactions. */
export function BuildLinks({ launch, tokenAddress, address, isCreator }: { launch: string; tokenAddress: string; address?: string; isCreator: boolean }) {
  const { signMessageAsync } = useSignMessage();
  const [build, setBuild] = useState<BuildView | null>(null);
  const [repo, setRepo] = useState('');
  const [wallet, setWallet] = useState('');
  const [pending, setPending] = useState<PendingWallet | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/buildact/${launch}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setBuild(data.build ?? null);
    } catch (e) { console.error('build links load failed', e); }
  }, [launch]);
  useEffect(() => { load(); }, [load]);

  const fail = (e: any) => {
    console.error('build link failed', e);
    const msg = e?.shortMessage ?? e?.message ?? 'Something went wrong.';
    const text = /reject|denied/i.test(msg) ? 'Signature cancelled' : msg;
    setError(text); toast.error(text);
  };

  const run = async (action: BuildAction, raw: string) => {
    const value = normaliseValue(action, raw);
    if (!value) { setError(action.endsWith('repo') ? 'Enter a GitHub repo as owner/name or a github.com link.' : 'Enter a valid 0x wallet address.'); return; }
    setError(''); setBusy(`${action}:${value}`);
    try {
      const n = await postJson(`/api/buildact/${launch}/nonce`, { action, value });
      const signature = await signMessageAsync({ message: n.message });
      if (action === 'link_wallet') {
        setPending({ value: n.value, nonce: n.nonce, message: n.message, signature });
        toast.success('Signed. Now sign the same message with the deployer wallet.');
        return;
      }
      await postJson(`/api/buildact/${launch}`, { action, value: n.value, nonce: n.nonce, signature });
      toast.success(action === 'link_repo' ? 'Repo linked' : action === 'unlink_repo' ? 'Repo unlinked' : 'Wallet unlinked');
      if (action === 'link_repo') setRepo('');
      await load();
    } catch (e) { fail(e); } finally { setBusy(''); }
  };

  const finishWallet = async (walletSignature: string) => {
    if (!pending) return;
    setError(''); setBusy('wallet-finish');
    try {
      await postJson(`/api/buildact/${launch}`, { action: 'link_wallet', value: pending.value, nonce: pending.nonce, signature: pending.signature, walletSignature: walletSignature.trim() });
      toast.success('Deployer wallet linked');
      setPending(null); setPasted(''); setWallet('');
      await load();
    } catch (e) { fail(e); } finally { setBusy(''); }
  };

  const signAsWallet = async () => {
    if (!pending) return;
    try { await finishWallet(await signMessageAsync({ message: pending.message })); } catch (e) { fail(e); }
  };

  if (!isCreator && !pending) return null;
  const repos = build?.repos ?? [];
  const wallets = build?.wallets ?? [];
  const onWallet = !!address && !!pending && address.toLowerCase() === pending.value;
  const spin = <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />;

  return (
    <Panel title="Build activity" note="Link where you ship">
      <div className="space-y-5">
        <p className="text-[13px] leading-relaxed text-white/60">Link up to {MAX_REPOS} public GitHub repos and up to {MAX_WALLETS} extra deployer wallets. Each change is a free signature from the creator wallet; it sends no transaction. Commits, releases and contracts deployed on Robinhood Chain then appear in the token&apos;s shipping record.</p>

        <div className="space-y-2">
          <div className="flex justify-between text-[12px] text-white/55"><span>GitHub repos</span><span>{repos.length}/{MAX_REPOS}</span></div>
          {repos.map((r) => (
            <div key={r.fullName} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="truncate font-mono text-[13px] text-white/85 hover:text-white">{r.fullName}</a>
                <Pill tone={r.proof === 'confirmed' ? 'green' : 'neutral'}>{r.proof === 'confirmed' ? 'Repo confirmed' : 'Signed link'}</Pill>
              </div>
              {isCreator && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('unlink_repo', r.fullName)}>{busy === `unlink_repo:${r.fullName}` ? spin : null}Remove</Button>
              )}
            </div>
          ))}
          {isCreator && repos.length < MAX_REPOS && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo or https://github.com/owner/repo" maxLength={200} />
              <Button disabled={!!busy || !repo.trim()} onClick={() => run('link_repo', repo)}>{busy.startsWith('link_repo') ? spin : null}Link repo</Button>
            </div>
          )}
          <p className="text-[12px] leading-relaxed text-white/55">Optional: add <span className="font-mono text-white/75">polypad.json</span> to the repo root with <span className="break-all font-mono text-white/75">{`{"chainId":4663,"token":"${tokenAddress.toLowerCase()}"}`}</span> to upgrade the proof to Repo confirmed.</p>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-[12px] text-white/55"><span>Extra deployer wallets</span><span>{wallets.length}/{MAX_WALLETS}</span></div>
          {wallets.map((w) => (
            <div key={w.address} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2">
              <span className="font-mono text-[13px] text-white/85">{shortenAddress(w.address)}</span>
              {isCreator && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('unlink_wallet', w.address)}>{busy === `unlink_wallet:${w.address}` ? spin : null}Remove</Button>
              )}
            </div>
          ))}
          {!pending && isCreator && wallets.length < MAX_WALLETS && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x deployer wallet" maxLength={42} />
              <Button disabled={!!busy || !wallet.trim()} onClick={() => run('link_wallet', wallet)}>{busy.startsWith('link_wallet') ? spin : null}Sign as creator</Button>
            </div>
          )}
          {pending && (
            <div className="space-y-3 rounded-xl border border-polydash-green/25 bg-polydash-green/[0.04] p-3">
              <p className="text-[13px] text-white/70">Step 2 of 2: the wallet {shortenAddress(pending.value)} must sign the same message. Switch to it in your wallet app, or paste a signature made elsewhere. The request expires in 10 minutes.</p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!onWallet || !!busy} onClick={signAsWallet}>{busy === 'wallet-finish' ? spin : null}{onWallet ? 'Sign with deployer wallet' : `Connect ${shortenAddress(pending.value)} to sign`}</Button>
                <Button variant="outline" disabled={!!busy} onClick={() => { setPending(null); setPasted(''); }}>Cancel</Button>
              </div>
              <details className="text-[12px] text-white/55">
                <summary className="cursor-pointer hover:text-white/80">Paste a signature instead</summary>
                <div className="mt-2 space-y-2">
                  <textarea readOnly value={pending.message} rows={7} className={area} aria-label="Message to sign" />
                  <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={2} className={area} placeholder="0x signature from the deployer wallet" />
                  <Button size="sm" disabled={!!busy || !/^0x[0-9a-fA-F]{130}$/.test(pasted.trim())} onClick={() => finishWallet(pasted)}>Submit signature</Button>
                </div>
              </details>
            </div>
          )}
        </div>

        {error && <ErrorNote message={error} />}
      </div>
    </Panel>
  );
}
