'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi';
import type { Hex } from 'viem';
import { parseSignLink, type ParsedLink } from '../_lib/link';
import { CHAIN_ID, EXPLORER, checkSteps, dataBytes, ethOf, feeLines, fingerprint, type ApiFailure, type Prepared } from '../_lib/prepared';

type Prep =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; data: Prepared; at: number }
  | { state: 'large'; message: string }
  | { state: 'error'; message: string; code?: string };

type Run =
  | { state: 'idle' }
  | { state: 'running'; step: number; hashes: string[]; note: string }
  | { state: 'sent'; hash: string; hashes: string[] }
  | { state: 'error'; message: string; hashes: string[] };

type TxStatus = { status: 'pending' | 'confirmed' | 'failed' | 'unknown' | 'timeout'; result?: string; next?: string };

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5';
const primary = 'w-full rounded-full bg-white px-5 py-3 text-[15px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'w-full rounded-full border border-white/20 px-5 py-3 text-[14px] font-medium text-white transition hover:bg-white/10 disabled:opacity-40';

function short(a: string) {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

export function SignFlow() {
  const sp = useSearchParams();
  const link: ParsedLink = useMemo(() => parseSignLink(new URLSearchParams(sp?.toString() ?? '')), [sp]);
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  const [prep, setPrep] = useState<Prep>({ state: 'idle' });
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [tx, setTx] = useState<TxStatus | null>(null);
  const [now, setNow] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // ---- AgentAction rows (viewed → connected → sent → confirmed / failed)
  const rowId = useRef<string | null>(null);
  const rowPending = useRef<Promise<void> | null>(null);
  const record = useCallback(
    async (status: string, extra: Record<string, unknown> = {}) => {
      if (!link.ok) return;
      try {
        if (rowPending.current) await rowPending.current;
        const body = rowId.current
          ? { id: rowId.current, status, ...extra }
          : { action: link.action, ref: link.ref, client: link.client ?? 'sign-page', status, fingerprint: link.chatCode ?? undefined, ...extra };
        const p = fetch('/api/agent-actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then((r) => r.json())
          .then((j) => { if (j?.ok && j.id) rowId.current = String(j.id); })
          .catch(() => {});
        rowPending.current = p;
        await p;
      } catch {
        /* counting only; never blocks the flow */
      }
    },
    [link],
  );

  const viewedOnce = useRef(false);
  useEffect(() => {
    if (link.ok && !viewedOnce.current) {
      viewedOnce.current = true;
      void record('viewed');
    }
  }, [link, record]);

  const connectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (link.ok && address && connectedFor.current !== address) {
      connectedFor.current = address;
      void record('connected', { wallet: address });
    }
  }, [link, address, record]);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // ---- Rebuild through the API with the connected wallet as `from`
  const rebuild = useCallback(
    async (withConfirm = false) => {
      if (!link.ok || !address) return;
      setPrep({ state: 'loading' });
      setRun({ state: 'idle' });
      setTx(null);
      try {
        const body = { ...link.body, from: address, ref: link.ref, ...(withConfirm ? { confirmLarge: true } : {}) };
        const res = await fetch(`/api/agents/v2/prepare/${link.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-polypad-client': 'sign-page' },
          body: JSON.stringify(body),
        });
        const j = (await res.json().catch(() => null)) as Prepared | ApiFailure | null;
        if (!j) return setPrep({ state: 'error', message: 'The Polypad API did not answer. Try again in a moment.' });
        if (j.ok !== true) {
          const code = j.error?.code ?? 'error';
          const message = String(j.error?.message ?? 'The action could not be prepared.');
          if (code === 'confirm_large_required') return setPrep({ state: 'large', message });
          return setPrep({ state: 'error', message, code });
        }
        setPrep({ state: 'ready', data: j, at: Date.now() });
      } catch {
        setPrep({ state: 'error', message: 'The Polypad API did not answer. Try again in a moment.' });
      }
    },
    [link, address],
  );

  const onChain = chainId === CHAIN_ID;
  const builtFor = useRef<string | null>(null);
  useEffect(() => {
    if (link.ok && address && onChain && builtFor.current !== address) {
      builtFor.current = address;
      setConfirmLarge(false);
      void rebuild(false);
    }
  }, [link, address, onChain, rebuild]);

  const ready = prep.state === 'ready' ? prep.data : null;
  const expiresMs = ready ? (ready.signing?.expiresInSeconds ?? 1200) * 1000 : 0;
  const expired = prep.state === 'ready' && run.state === 'idle' && now > 0 && now - prep.at > expiresMs;
  const refusal = ready && address ? checkSteps(ready, address, link.ok ? link.linkAddresses : []) : null;
  const main = ready ? ready.transactions[ready.transactions.length - 1] : null;
  const pageCode = main ? fingerprint(main) : null;
  const chatCode = link.ok ? link.chatCode : null;

  // ---- Sign: each step verbatim, in order; wait for each receipt before the next
  const sign = useCallback(async () => {
    if (!ready || !address || refusal || expired) return;
    if (chainId !== CHAIN_ID) return;
    const hashes: string[] = [];
    const steps = ready.transactions;
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i];
      setRun({ state: 'running', step: i, hashes: [...hashes], note: 'Confirm in your wallet.' });
      let hash: Hex;
      try {
        hash = await sendTransactionAsync({
          chainId: CHAIN_ID,
          to: s.to as Hex,
          data: s.data,
          value: BigInt(s.value),
          ...(s.gas ? { gas: BigInt(s.gas) } : {}),
        });
      } catch (e) {
        const msg = (e as { shortMessage?: string })?.shortMessage ?? 'The wallet did not send the transaction.';
        setRun({ state: 'error', message: `Step ${i + 1}: ${msg}`, hashes });
        return;
      }
      hashes.push(hash);
      const isMain = i === steps.length - 1;
      if (isMain) {
        void record('sent', { wallet: address, txHash: hash, valueWei: s.value });
        setRun({ state: 'sent', hash, hashes });
        return;
      }
      setRun({ state: 'running', step: i, hashes: [...hashes], note: 'Waiting for this step to confirm on Robinhood Chain…' });
      try {
        const rc = await publicClient!.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (rc.status !== 'success') {
          setRun({ state: 'error', message: `Step ${i + 1} failed on-chain. Nothing after it was sent.`, hashes });
          return;
        }
      } catch {
        setRun({ state: 'error', message: `Step ${i + 1} did not confirm within 2 minutes. Check the explorer, then open this link again.`, hashes });
        return;
      }
    }
  }, [ready, address, refusal, expired, chainId, sendTransactionAsync, publicClient, record]);

  // ---- Follow up: poll tx/status every 3 s for 2 min
  const sentHash = run.state === 'sent' ? run.hash : null;
  useEffect(() => {
    if (!sentHash) return;
    let stop = false;
    const started = Date.now();
    setTx({ status: 'pending' });
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/agents/v2/tx/status?hash=${sentHash}`, { headers: { 'x-polypad-client': 'sign-page' } });
        const j = await r.json().catch(() => null);
        if (j?.ok && (j.status === 'confirmed' || j.status === 'failed')) {
          setTx({ status: j.status, result: typeof j.result === 'string' ? j.result : undefined, next: typeof j.next === 'string' ? j.next : undefined });
          void record(j.status, { txHash: sentHash });
          return;
        }
      } catch {
        /* keep polling */
      }
      if (Date.now() - started > 120_000) {
        setTx({ status: 'timeout' });
        return;
      }
      setTimeout(tick, 3000);
    };
    const t = setTimeout(tick, 3000);
    return () => { stop = true; clearTimeout(t); };
  }, [sentHash, record]);

  const copyDone = async () => {
    if (!sentHash) return;
    try {
      await navigator.clipboard.writeText(`Done: ${sentHash}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const doSwitch = async () => {
    setSwitchError(null);
    try {
      await switchChainAsync({ chainId: CHAIN_ID });
    } catch (e) {
      setSwitchError((e as { shortMessage?: string })?.shortMessage ?? 'The wallet did not switch. Add Robinhood Chain (chain id 4663) in your wallet and try again.');
    }
  };

  // ---------------------------------------------------------------- render

  if (!link.ok) {
    return (
      <Shell>
        <div className={card} role="alert">
          <p className="text-[15px] font-semibold text-white">{link.keyMaterial ? 'Link ignored' : 'This link cannot be used'}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-white/70">{link.error}</p>
        </div>
      </Shell>
    );
  }

  const busy = run.state === 'running';

  return (
    <Shell>
      <div className={card}>
        <p className="text-[12px] uppercase tracking-wider text-white/45">Action from a chat agent</p>
        <p className="mt-1 text-[17px] font-semibold text-white">{ready ? ready.summary.headline : actionLabel(link.action)}</p>
        <p className="mt-2 text-[13px] text-white/55">
          Polypad rebuilds this action for your connected wallet and shows it here. Nothing is sent until you confirm in your wallet.
        </p>
        {link.preparedFor && address && link.preparedFor.toLowerCase() !== address.toLowerCase() && (
          <p className="mt-2 text-[13px] text-white/70">The chat prepared this for {short(link.preparedFor)}. It is rebuilt for your connected wallet {short(address)}.</p>
        )}
      </div>

      {!isConnected || !address ? (
        <div className={card}>
          <p className="text-[14px] font-medium text-white">Connect your wallet</p>
          <p className="mt-1 text-[13px] text-white/55">On a phone, pick your wallet app and this same page reopens inside it.</p>
          <div className="mt-4">
            <ConnectButton.Custom>{({ openConnectModal }) => <button type="button" className={primary} onClick={openConnectModal}>Connect wallet</button>}</ConnectButton.Custom>
          </div>
        </div>
      ) : !onChain ? (
        <div className={card}>
          <p className="text-[14px] font-medium text-white">Switch to Robinhood Chain</p>
          <p className="mt-1 text-[13px] text-white/55">This action runs on Robinhood Chain (chain id 4663). Your wallet asks to switch, or to add the network if it is missing.</p>
          <button type="button" className={`${primary} mt-4`} onClick={doSwitch} disabled={switching}>{switching ? 'Waiting for your wallet…' : 'Switch to Robinhood Chain'}</button>
          {switchError && <p className="mt-3 text-[13px] text-white/70">{switchError}</p>}
        </div>
      ) : null}

      {prep.state === 'loading' && (
        <div className={card} aria-busy="true">
          <p className="text-[14px] text-white/70">Rebuilding the action for your wallet…</p>
          <div className="mt-3 h-1 w-full overflow-hidden rounded bg-white/10"><div className="h-full w-1/3 animate-pulse bg-white/60" /></div>
        </div>
      )}

      {prep.state === 'error' && (
        <div className={card} role="alert">
          <p className="text-[15px] font-semibold text-white">Not ready to sign</p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] text-white/70">{prep.message}</p>
          <button type="button" className={`${secondary} mt-4`} onClick={() => rebuild(false)}>Try again</button>
        </div>
      )}

      {prep.state === 'large' && (
        <div className={card}>
          <p className="text-[15px] font-semibold text-white">Large amount</p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] text-white/70">{prep.message}</p>
          {amountOf(link) && <p className="mt-2 text-[14px] text-white">Amount: {amountOf(link)}</p>}
          <label className="mt-4 flex items-center gap-3 text-[14px] text-white">
            <input type="checkbox" className="h-5 w-5 accent-white" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
            I confirm this amount
          </label>
          <button type="button" className={`${primary} mt-4`} disabled={!confirmLarge} onClick={() => rebuild(true)}>Continue</button>
        </div>
      )}

      {ready && (
        <>
          <div className={card}>
            <dl className="space-y-2 text-[14px]">
              {ready.summary.youPay && <Row k="You pay" v={ready.summary.youPay} />}
              {ready.summary.youReceiveAtLeast && <Row k="You receive at least" v={ready.summary.youReceiveAtLeast} />}
              {typeof ready.summary.slippageBps === 'number' && <Row k="Slippage limit" v={`${(ready.summary.slippageBps / 100).toFixed(2)}%`} />}
            </dl>
            {feeLines(ready.summary.fees).length > 0 && (
              <div className="mt-3">
                <p className="text-[12px] uppercase tracking-wider text-white/45">Fees</p>
                <ul className="mt-1 space-y-0.5 text-[13px] text-white/70">{feeLines(ready.summary.fees).map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
            {ready.summary.lines?.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-white/75">{ready.summary.lines.map((l, i) => <li key={i}>{String(l)}</li>)}</ul>
            )}
          </div>

          <div className={`${card} border-white/25`}>
            <p className="text-[12px] uppercase tracking-wider text-white/45">Warnings and risks</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-white/85">
              {[...(ready.warnings ?? []), ...(ready.summary.risks ?? [])].map((w, i) => <li key={i}>{String(w)}</li>)}
              {!(ready.summary.risks ?? []).includes('Not audited.') && <li>Not audited.</li>}
            </ul>
          </div>

          <div className={card}>
            <p className="text-[12px] uppercase tracking-wider text-white/45">Fingerprint</p>
            <dl className="mt-2 space-y-1 text-[14px]">
              <Row k="Code from the chat" v={chatCode ?? 'Not in the link'} mono />
              <Row k="Code on this page" v={pageCode ?? '…'} mono />
            </dl>
            {chatCode && pageCode && chatCode !== pageCode && <p className="mt-2 text-[13px] font-medium text-white">This differs from what the chat showed.</p>}
            {chatCode && pageCode && chatCode === pageCode && <p className="mt-2 text-[13px] text-white/55">The codes match.</p>}
          </div>

          <div className={card}>
            <p className="text-[12px] uppercase tracking-wider text-white/45">{ready.transactions.length > 1 ? `${ready.transactions.length} wallet confirmations, in order` : '1 wallet confirmation'}</p>
            <ol className="mt-2 space-y-3">
              {ready.transactions.map((s, i) => {
                const done = run.state !== 'idle' && run.state !== 'error' ? (run.state === 'sent' || i < run.hashes.length) : run.state === 'error' && i < run.hashes.length;
                const active = run.state === 'running' && run.step === i;
                return (
                  <li key={i} className="text-[13px]">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] ${done ? 'border-white bg-white text-black' : active ? 'border-white text-white' : 'border-white/30 text-white/60'}`}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-white/85">{String(s.description)}</p>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[12px] text-white/45">Advanced</summary>
                          <dl className="mt-1 space-y-0.5 break-all font-mono text-[11px] text-white/60">
                            <div>to: {s.to}</div>
                            <div>value: {s.value} wei ({ethOf(s.value)})</div>
                            <div>chainId: {s.chainId}</div>
                            <div>data length: {dataBytes(s.data)} bytes</div>
                          </dl>
                        </details>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {refusal ? (
              <p className="mt-4 text-[14px] font-medium text-white" role="alert">{refusal}</p>
            ) : expired ? (
              <div className="mt-4">
                <p className="text-[14px] text-white">This prepared action has expired. Rebuild it to see current amounts.</p>
                <button type="button" className={`${secondary} mt-3`} onClick={() => rebuild(confirmLarge)}>Rebuild</button>
              </div>
            ) : run.state === 'idle' || run.state === 'error' ? (
              <div className="mt-4 space-y-3">
                {run.state === 'error' && <p className="text-[13px] text-white/80" role="alert">{run.message}</p>}
                <button type="button" className={primary} onClick={sign} disabled={!onChain || busy}>Sign in wallet</button>
                {run.state === 'error' && <button type="button" className={secondary} onClick={() => rebuild(confirmLarge)}>Rebuild</button>}
              </div>
            ) : run.state === 'running' ? (
              <p className="mt-4 text-[14px] text-white/80">Step {run.step + 1} of {ready.transactions.length}: {run.note}</p>
            ) : null}
          </div>
        </>
      )}

      {run.state === 'sent' && (
        <div className={card}>
          <p className="text-[12px] uppercase tracking-wider text-white/45">Result</p>
          <p className="mt-2 text-[15px] font-semibold text-white">
            {tx?.status === 'confirmed' ? 'Confirmed' : tx?.status === 'failed' ? 'Failed' : tx?.status === 'timeout' ? 'Still waiting' : 'Sent. Waiting for Robinhood Chain…'}
          </p>
          {tx?.result && <p className="mt-1 text-[14px] text-white/75">{tx.result}</p>}
          {tx?.status === 'timeout' && <p className="mt-1 text-[14px] text-white/75">No result after 2 minutes. Check the explorer, or ask the chat for the status.</p>}
          {tx?.next && <p className="mt-1 break-all text-[13px] text-white/60">{tx.next}</p>}
          <p className="mt-2 break-all font-mono text-[12px] text-white/60">{run.hash}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <a className={`${secondary} text-center`} href={`${EXPLORER}/tx/${run.hash}`} target="_blank" rel="noopener noreferrer">View on explorer</a>
            <button type="button" className={primary} onClick={copyDone}>{copied ? 'Copied' : 'Copy a message for the chat'}</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-8 sm:py-12">
      <h1 className="text-[22px] font-bold tracking-tight text-white">Sign with your wallet</h1>
      {children}
      <p className="text-center text-[12px] text-white/40">Polypad never asks for a private key or seed phrase. Not audited.</p>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-white/55">{k}</dt>
      <dd className={`text-right text-white ${mono ? 'font-mono' : ''}`}>{v}</dd>
    </div>
  );
}

function actionLabel(a: string): string {
  const m: Record<string, string> = {
    buy: 'Buy a token',
    sell: 'Sell a token',
    'nft-buy': 'Buy an NFT',
    'nft-mint': 'Mint an NFT',
    'fund-create': 'Create a Tokenized Fund',
    'fund-mint': 'Invest in a Tokenized Fund',
    'fund-redeem': 'Exit a Tokenized Fund',
    'token-launch': 'Launch a token',
  };
  return m[a] ?? 'Action';
}

function amountOf(link: ParsedLink): string | null {
  if (!link.ok) return null;
  const w = link.body.amountWei;
  return typeof w === 'string' ? ethOf(w) : null;
}
