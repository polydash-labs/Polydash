'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatUnits, isAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRegisterAgent, REGISTRATION_STAKE } from '@/lib/agents/credit-score';
import { useSpendingKeys } from '@/lib/agents/spend-vault';
import { erc20Abi } from '@/lib/staking/shared';
import { robinhoodChain } from '@/lib/chain';
import {
  buildConnectCommand, buildMcpConfig, explorerAddress, isFactoryLive, presetToPolicy,
  useCreateWallet, useSafeOwnerCall, useWalletScore,
  POLYDASH_TOKEN_ADDRESS, WALLET_PRESETS, ZERO_ADDRESS,
  type Addr, type WalletPreset,
} from '@/lib/agent-wallet/client';
import { ApiKeysStep } from '../../accounts/_components/agent-accounts-content';
import { HonestLimitsBox } from '../../wallets/_components/honest-limits';

// One flow, one thing per screen. Every step says what happens and what it
// costs before you sign anything.
//
// Reuse map (nothing here re-implements chain logic):
//   Step 1 Connect — RainbowKit <ConnectButton />, the same wallet dialog the
//     site header uses.
//   Step 2 Create — the wizard's factory flow: useCreateWallet +
//     presetToPolicy + WALLET_PRESETS from lib/agent-wallet/client.ts, and
//     the wizard's agent-key pattern (key made in the browser, shown once).
//   Step 3 Register — useRegisterAgent + REGISTRATION_STAKE from
//     lib/agents/credit-score.ts (the same hook the wizard calls).
//   Step 4 Tools — buildMcpConfig + buildConnectCommand from
//     lib/agent-wallet/client.ts; Pro keys via ApiKeysStep, the exact
//     component from app/agents/accounts; the $25 Poly credits starter
//     claims on /agents/credits (that page's claim flow, linked, not copied).
//   Step 5 Done — useWalletScore for the score, and the Stop button is the
//     wizard / wallet-detail stop: useSafeOwnerCall().setFrozen +
//     useSpendingKeys().revokeKey (freeze the wallet + revoke the vault key).

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS = ['1 · Connect', '2 · Create', '3 · Register', '4 · Tools', '5 · Done'];

// The one line that matters most on this page — in plain words.
const RUNS_ON_YOUR_MACHINE =
  'Your agent runs on your own computer — Polypad gives it a wallet and tools, but we don’t run it for you.';

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {STEP_LABELS.map((l, i) => (
        <li
          key={l}
          className={cn(
            'rounded-full px-3 py-1.5 text-[12px] font-medium',
            step === i + 1 ? 'bg-polydash-green text-black' : step > i + 1 ? 'bg-polydash-green/15 text-polydash-green' : 'bg-white/[0.05] text-white/50',
          )}
        >
          {l}
        </li>
      ))}
    </ol>
  );
}

/** The connected wallet's POLYDASH balance — same read as the wizard's
 * usePolydashBalance (the wizard's hook is local to that file). */
function usePolydashBalance(owner: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!owner && isAddress(owner, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'polydash-balance', owner?.toLowerCase()],
    enabled: !!client && valid,
    queryFn: async () => {
      if (!client || !valid) return 0n;
      return (await client.readContract({
        address: POLYDASH_TOKEN_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [owner as Addr],
      })) as bigint;
    },
  });
}

export function CreateContent() {
  const { address, chainId } = useAccount();
  const [step, setStep] = useState<Step>(1);

  // Step 2 state. The agent key lives in page state ONLY — never sent to the
  // server, never stored in localStorage, never logged (same rule as the wizard).
  const [name, setName] = useState('');
  const [backupKey, setBackupKey] = useState('');
  const [agentKey, setAgentKey] = useState<`0x${string}` | null>(null);
  const [agentKeyAddress, setAgentKeyAddress] = useState<Addr | null>(null);
  const [savedKey, setSavedKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [walletAddress, setWalletAddress] = useState<Addr | null>(null);
  const [deployTx, setDeployTx] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState<WalletPreset['key']>('medium');
  const [agentId, setAgentId] = useState<number | null>(null);
  const [skippedRegister, setSkippedRegister] = useState(false);
  const [busy, setBusy] = useState<'deploy' | 'register' | 'stop' | null>(null);
  const [error, setError] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [stopped, setStopped] = useState(false);

  const { createWallet } = useCreateWallet();
  const { register } = useRegisterAgent();
  const { setFrozen } = useSafeOwnerCall();
  const { revokeKey } = useSpendingKeys();
  const { data: polydashBalance } = usePolydashBalance(address);
  const { data: walletScore } = useWalletScore(walletAddress ?? undefined);

  const preset = WALLET_PRESETS.find((p) => p.key === presetKey)!;
  const policy = presetToPolicy(preset);
  const wrongChain = !!address && !!chainId && chainId !== robinhoodChain.id;
  const hasPolydash = (polydashBalance ?? 0n) >= REGISTRATION_STAKE;
  const mcpConfig = walletAddress && agentKeyAddress ? buildMcpConfig(walletAddress, agentKeyAddress) : '';
  const connectBundle = walletAddress && agentKeyAddress && agentKey
    ? [
        'POLYPAD AGENT — connect your agent',
        '',
        `Wallet: ${walletAddress}`,
        `Agent key address: ${agentKeyAddress}`,
        '',
        'MCP config (paste into Claude, Grok, or any MCP client):',
        mcpConfig,
        '',
        'Or run one command in your terminal:',
        buildConnectCommand(),
        '',
        'Your agent key (shown once — paste it into your agent, nowhere else):',
        agentKey,
      ].join('\n')
    : '';

  function generateKey() {
    const pk = generatePrivateKey();
    setAgentKey(pk);
    setAgentKeyAddress(privateKeyToAccount(pk).address);
    setSavedKey(false);
    setKeyCopied(false);
  }

  function downloadKeyBackup() {
    if (!agentKey || !agentKeyAddress) return;
    const text = [
      'POLYPAD AGENT — AGENT KEY (keep this secret)',
      '',
      `Agent name: ${name || '(unnamed)'}`,
      `Wallet: ${walletAddress ?? '(not deployed yet)'}`,
      `Agent key address: ${agentKeyAddress}`,
      '',
      'This key is the ONLY copy. Polypad never sees it and cannot recover it.',
      'If you lose it, the wallet and its money are safe — but you must give',
      'the agent a new key from the wallet page.',
      '',
      `Private key: ${agentKey}`,
      '',
      'Never paste this into a website, chat, or email. Only into your agent.',
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polypad-agent-key-${(name || 'agent').replace(/[^a-z0-9-_]/gi, '-').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(text: string, done: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      done(true);
      setTimeout(() => done(false), 2500);
    } catch {
      toast.error('Could not copy — select the text manually.');
    }
  }

  async function deploy() {
    setError('');
    if (!address) { setError('Connect your wallet first.'); return; }
    if (!agentKey || !agentKeyAddress) { setError('Generate the agent key first.'); return; }
    if (!savedKey) { setError('Save the agent key first — tick “I’ve saved it”.'); return; }
    if (!name.trim()) { setError('Give your agent a name first.'); return; }
    if (!isAddress(backupKey, { strict: false })) { setError('That backup address is not valid.'); return; }
    if (!isFactoryLive) { setError('The wallet factory is not live yet — creation opens once it is.'); return; }
    setBusy('deploy');
    try {
      const { safe, txHash } = await createWallet(address, backupKey as Addr, agentKeyAddress, policy);
      setWalletAddress(safe);
      setDeployTx(txHash);
      toast.success('Wallet created. Your agent now has an address.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      setError(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(null);
    }
  }

  async function registerScore() {
    setError('');
    if (!walletAddress) return;
    if (!hasPolydash) {
      setError('You hold less than 1,000 POLYDASH, so registration has to wait — see below.');
      return;
    }
    setBusy('register');
    try {
      const id = await register(name.trim() || `Agent ${shortenAddress(walletAddress)}`, walletAddress, ZERO_ADDRESS);
      setAgentId(id);
      toast.success(`Registered as agent #${id}. Its credit score posts within a day.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      setError(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(null);
    }
  }

  async function stopEverything() {
    setError('');
    if (!walletAddress || !agentKeyAddress) return;
    setBusy('stop');
    try {
      // Same stop as the wizard and the wallet detail page: freeze the
      // wallet on-chain, then revoke the vault spending key.
      await setFrozen(walletAddress, true);
      try { await revokeKey(agentKeyAddress); } catch { /* vault key may not exist yet */ }
      setStopped(true);
      toast.success('Stopped. Wallet frozen and vault key revoked.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      setError(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">Create your agent</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
          Five steps, about five minutes. Your agent gets its own wallet on Robinhood Chain, a credit
          score other people can check, and the tools to use Polypad — with spending limits you set.
        </p>
        <p className="mt-3 max-w-2xl rounded-2xl border border-polydash-green/30 bg-polydash-green/[0.06] p-4 text-[13px] leading-relaxed text-white/85">
          {RUNS_ON_YOUR_MACHINE}
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-white/50">
          Built on the live v1 agent wallet (Safe v1.3.0 + session-key module). Each step costs a few
          cents of network fees (gas), paid in ETH — the only other cost on this page is the 1,000
          POLYDASH bond in step 3, which comes back to you if you unregister.
        </p>
      </div>

      <BeginnerStart />
      <GlossaryBox
        terms={[
          { term: 'Agent', def: 'A program that does jobs for you on its own — here, one that uses Polypad: it can trade, launch tokens, and join funds, inside limits you set.' },
          { term: 'Agent wallet', def: 'A wallet that belongs to your agent, not to you directly. You own it and set its limits; the agent spends from it with its own key.' },
          { term: 'Bond', def: 'A deposit you lock up to prove you are serious. It is not a fee and not insurance — you get it back when you unregister.' },
          { term: 'MCP config', def: 'A small settings file that tells your agent how to reach Polypad. You copy it, paste it into your agent, and it can use Polypad’s tools.' },
          { term: 'Pro key', def: 'A free key that raises how many Polypad calls your agent can make (10x the free limits). It never moves money — it only identifies your calls.' },
          { term: 'Poly credits', def: 'Free $25 of starter credit that pays for pay-per-call reports (token reports, fund prices) so your agent can try them without holding crypto.' },
        ]}
      />

      <Stepper step={step} />

      {!isFactoryLive && (
        <p className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-[13px] leading-relaxed text-amber-100/90">
          The wallet contracts are being wired up — everything below is ready, and wallet creation
          opens once the factory is live. You can still connect and look through the steps; the
          Create button stays off until then. Nothing here pretends a wallet was created.
        </p>
      )}

      {error && <p className="rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-4 text-[13px] text-red-300" role="alert">{error}</p>}

      {step === 1 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 1 · Connect your wallet</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            Connect the wallet you own things with — the same one you use on Polypad. This is how
            Polypad knows the agent is yours. Connecting is free and changes nothing: no money moves.
          </p>
          <div className="mt-4">
            <ConnectButton />
          </div>
          {wrongChain && (
            <p className="mt-3 text-[13px] leading-relaxed text-amber-200/90">
              You are on the wrong network. Tap your wallet button (top right) and switch to
              Robinhood Chain — that is free and takes one tap.
            </p>
          )}
          {address && !wrongChain && (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-white">
              <Check className="h-4 w-4 text-polydash-green" />
              Connected as <span className="font-mono">{shortenAddress(address)}</span> on Robinhood Chain.
            </p>
          )}
          <div className="mt-5">
            <Button onClick={() => setStep(2)} disabled={!address || wrongChain}>
              Continue — create the wallet
            </Button>
            {!address && <span className="ml-3 text-[12px] text-white/50">Connect your wallet first.</span>}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 2 · Create — name it and make its wallet</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            Pick a name for your agent. Then we make its key — a secret password only your agent
            uses — and create its wallet. One click creates the wallet: you stay the owner, your
            backup key can recover it after a 2-day wait, and the agent key switches on inside the
            limits below. What it costs: a few cents of ETH for gas, nothing else.
          </p>

          <label className="mt-4 block max-w-md text-xs text-muted-foreground">
            Agent name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quant Trader" maxLength={48} className="mt-1 bg-secondary/50" />
          </label>
          <label className="mt-3 block max-w-md text-xs text-muted-foreground">
            Backup key — a spare wallet address (a hardware wallet, or a second wallet). Only used
            to recover the wallet if you lose your owner key, after a 2-day wait.
            <Input value={backupKey} onChange={(e) => setBackupKey(e.target.value)} placeholder="0x…" className="mt-1 bg-secondary/50 font-mono" />
          </label>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-white/50">
            Use a different address from your connected wallet, and keep it somewhere safe and offline.
            Never use an address someone else controls.
          </p>

          <div className="mt-5 border-t border-white/10 pt-4">
            <h3 className="text-[13px] font-semibold">The agent key — made in your browser, shown once</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/60">
              This key is made on your device and never leaves it. Polypad never sees it, never stores
              it, and cannot get it back. If you close this page without saving it, the key is gone —
              the wallet and its money stay safe, but you must give the agent a new key later.
            </p>
            {!agentKey ? (
              <Button className="mt-3" onClick={generateKey} disabled={!address}>
                Generate the agent key
              </Button>
            ) : (
              <div className="mt-3 rounded-xl bg-black/40 p-3">
                <p className="text-[12px] text-white/50">Agent key address (public — this is what the wallet knows)</p>
                <p className="mt-1 font-mono text-[14px] text-white">{agentKeyAddress}</p>
                <p className="mt-3 text-[12px] text-white/50">Private key — shown once. Save it now.</p>
                <pre className="mt-1 max-h-24 overflow-auto break-all rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-amber-200">{agentKey}</pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={downloadKeyBackup}>
                    <Download className="mr-2 h-3.5 w-3.5" />Download backup
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copyText(agentKey, setKeyCopied)}>
                    <Copy className="mr-2 h-3.5 w-3.5" />{keyCopied ? 'Copied' : 'Copy the key'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={generateKey}>Make a new key instead</Button>
                </div>
                <label className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-white/80">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-white" checked={savedKey} onChange={(e) => setSavedKey(e.target.checked)} />
                  <span>I&apos;ve saved it — I have the key stored somewhere safe, and I know Polypad cannot recover it.</span>
                </label>
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <h3 className="text-[13px] font-semibold">How much may it spend?</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/60">
              Pick a size. The key expires after 90 days either way, and you can change the limits
              later from the wallet page. The agent key can never raise its own limits.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {WALLET_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPresetKey(p.key)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    presetKey === p.key ? 'border-polydash-green bg-polydash-green/[0.07]' : 'border-white/10 bg-white/[0.02] hover:border-white/25',
                  )}
                >
                  <p className="text-[14px] font-semibold text-white">{p.label}</p>
                  <p className="mt-1 font-mono text-[13px] text-white/80">${p.perPaymentUsdg} / payment · ${p.dailyUsdg} / day</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/55">{p.blurb}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <Button onClick={deploy} disabled={busy !== null || !agentKey || !savedKey || !name.trim() || !isFactoryLive}>
              {busy === 'deploy' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy === 'deploy' ? 'Creating — waiting for your wallet…' : 'Create the wallet'}
            </Button>
            {!isFactoryLive && (
              <p className="mt-2 text-[12px] text-amber-200/90">Create is off until the factory is live. Key, name, and limits above still work.</p>
            )}
            {walletAddress && (
              <div className="mt-4 rounded-xl bg-polydash-green/[0.07] p-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-white">
                  <Check className="h-4 w-4 text-polydash-green" />Wallet created
                </p>
                <p className="mt-1 font-mono text-[13px] text-white/80">
                  <a className="text-polydash-green hover:underline" href={explorerAddress(walletAddress)} target="_blank" rel="noopener noreferrer">{walletAddress}</a>
                </p>
                {deployTx && (
                  <p className="mt-1 text-[12px] text-white/50">
                    Creation transaction: <a className="text-polydash-green hover:underline" href={getExplorerTxUrl(deployTx)} target="_blank" rel="noopener noreferrer">{shortenAddress(deployTx)}</a>
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)} disabled={!walletAddress && isFactoryLive}>
              Continue — register it
            </Button>
            {!walletAddress && isFactoryLive && <span className="self-center text-[12px] text-white/50">Create the wallet first.</span>}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 3 · Register — give it a credit score</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            Registration gives your agent a number and a credit score (300–850) that other people can
            check before they trust it with money. The score is built only from what the agent does
            on-chain — its first score posts within a day.
          </p>
          <div className="mt-4 rounded-xl bg-white/[0.03] p-3">
            <p className="text-[13px] font-medium text-white">What it costs — before you sign anything</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-white/70">
              <li>
                A <strong className="text-white">1,000 POLYDASH bond</strong> (about $0.0003). A bond
                is a deposit, not a fee: it sits locked while your agent is registered, and{' '}
                <strong className="text-white">you get it all back if you unregister</strong>. It stops
                spam — it is not insurance, and it does not pay anyone back if something goes wrong.
              </li>
              <li>A few cents of ETH for gas. You will see two wallet pop-ups: first Approve (lets the registry hold the bond once), then Register. Approving alone moves nothing.</li>
            </ul>
            <p className="mt-2 text-[13px] text-white/70">
              Your POLYDASH balance: {polydashBalance != null ? `${formatUnits(polydashBalance, 18)} POLYDASH` : '…'}
              {polydashBalance != null && !hasPolydash && ' — you need 1,000 to register.'}
            </p>
          </div>
          {!hasPolydash ? (
            <p className="mt-3 text-[13px] leading-relaxed text-amber-200/90">
              You hold less than 1,000 POLYDASH, so registration has to wait. Buy POLYDASH on its{' '}
              <Link href="/token/0x319525528f42167eF7fC18b77b889958080568e4" className="text-polydash-green hover:underline">token page</Link>{' '}
              (you need 1,000), then come back here — or skip this step for now and register later
              from the wallet page.
            </p>
          ) : agentId ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-white">
              <Check className="h-4 w-4 text-polydash-green" />Registered as agent #{agentId} — first score posts within a day.
            </p>
          ) : (
            <Button className="mt-3" onClick={registerScore} disabled={busy !== null}>
              {busy === 'register' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy === 'register' ? 'Waiting for your wallet…' : 'Register — bond 1,000 POLYDASH'}
            </Button>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            <Button
              onClick={() => setStep(4)}
              disabled={!agentId && !skippedRegister && hasPolydash}
              variant={agentId || skippedRegister ? 'default' : 'outline'}
            >
              Continue — connect its tools
            </Button>
            {!agentId && !skippedRegister && (
              <Button variant="ghost" onClick={() => { setSkippedRegister(true); setStep(4); }}>
                Skip for now — register later
              </Button>
            )}
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 4 · Tools — plug your agent in</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            {RUNS_ON_YOUR_MACHINE} What you do here is copy settings into your agent, on your
            computer. Nothing on this step costs anything.
          </p>

          <div className="mt-5 border-t border-white/10 pt-4">
            <h3 className="text-[13px] font-semibold">Connect it to Polypad</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/60">
              One click copies everything your agent needs: the settings file, the wallet address, and
              the agent key. Or run one command in your terminal and let the installer do it.
            </p>
            {walletAddress && agentKeyAddress ? (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => copyText(connectBundle, setCopiedAll)}>
                    {copiedAll ? 'Copied — paste it into your agent' : 'Copy everything the agent needs'}
                  </Button>
                  <Button variant="outline" onClick={() => copyText(mcpConfig, setCopiedConfig)}>
                    {copiedConfig ? 'Copied' : 'Copy settings file only'}
                  </Button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{mcpConfig}</pre>
                <p className="mt-3 text-[13px] text-white/70">
                  Or in your terminal:{' '}
                  <code className="rounded bg-white/10 px-2 py-0.5 font-mono text-[12px]">{buildConnectCommand()}</code>{' '}
                  <Button variant="outline" size="sm" className="ml-1" onClick={() => copyText(buildConnectCommand(), setCopiedCommand)}>
                    {copiedCommand ? 'Copied' : 'Copy'}
                  </Button>
                </p>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-white/60">
                The connection details appear here once the wallet is created in step 2.
              </p>
            )}
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <ApiKeysStep />
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <h3 className="text-[13px] font-semibold">$25 Poly credits starter — free reports to try</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/60">
              Poly credits pay for pay-per-call reports — a token report costs $0.01, a fund price
              $0.01, a CTO report $0.05 — so your agent can try them without holding crypto. Every
              new wallet gets a $25 starter balance, free, one per wallet.
            </p>
            <Button asChild className="mt-3">
              <Link href="/agents/credits">Claim your $25 starter credits</Link>
            </Button>
            <p className="mt-2 text-[12px] leading-relaxed text-white/50">
              Claiming takes one free signature in your wallet (no money moves). If this wallet
              already claimed its starter, the credits page shows your balance instead.
            </p>
          </div>

          <div className="mt-5 flex gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
            <Button onClick={() => setStep(5)}>Done — show my agent&apos;s card</Button>
          </div>
        </section>
      )}

      {step === 5 && walletAddress && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 5 · Done — your agent&apos;s card</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            {name ? <><strong className="text-white">{name}</strong> is ready. </> : 'Your agent is ready. '}
            {RUNS_ON_YOUR_MACHINE}
          </p>
          <div className="mt-4 rounded-xl bg-white/[0.03] p-3">
            <p className="text-[12px] text-white/50">Wallet</p>
            <p className="font-mono text-[14px] text-white">
              <a className="text-polydash-green hover:underline" href={explorerAddress(walletAddress)} target="_blank" rel="noopener noreferrer">{walletAddress}</a>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-white/45">Credit score</p>
                <p className="mt-0.5 text-[14px] font-semibold">
                  {walletScore?.score ?? (agentId ? 'Registered · score coming soon' : 'Not registered')}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-white/45">Agent number</p>
                <p className="mt-0.5 text-[14px] font-semibold">{agentId ? `#${agentId}` : '—'}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/45">Per payment</p>
                <p className="mt-0.5 text-[14px] font-semibold">${preset.perPaymentUsdg}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/45">Per day</p>
                <p className="mt-0.5 text-[14px] font-semibold">${preset.dailyUsdg}</p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-[13px] leading-relaxed text-white/70">
              <p className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-polydash-green" />Wallet created</p>
              <p className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-polydash-green" />
                {agentId ? `Registered for a credit score (agent #${agentId})` : 'Not registered yet — register any time from the wallet page'}
              </p>
              <p className="flex items-center gap-2">
                {copiedAll || copiedConfig ? <Check className="h-4 w-4 shrink-0 text-polydash-green" /> : <span className="flex h-4 w-4 shrink-0 items-center justify-center text-white/40">○</span>}
                {copiedAll || copiedConfig ? 'Tools copied — paste them into your agent' : 'Tools not copied yet — go back to step 4 and copy them'}
              </p>
              <p className="flex items-center gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-white/40">○</span>
                Pro key and $25 starter credits: make them in step 4 if you have not yet
              </p>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-white/60">
            What this wallet can do, inside the limits above: launch tokens, create a tokenized
            fund, create staking, mint NFTs, trade, and any normal wallet activity. Anything
            bigger needs you to approve it.
          </p>
          <div className="mt-4">
            <Button variant="destructive" onClick={stopEverything} disabled={busy !== null || stopped}>
              {busy === 'stop' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {stopped ? 'Stopped — wallet frozen' : 'Stop — freeze wallet + revoke vault key'}
            </Button>
            <span className="ml-3 text-[12px] text-white/50">One tap, any time. You can unfreeze it from the wallet page.</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={`/agents/wallets/${walletAddress}`}>Open the wallet page</Link></Button>
            <Button asChild variant="outline"><Link href="/agents/wallets">See your fleet</Link></Button>
            <Button asChild variant="outline"><Link href="/agents/scores">See the scores directory</Link></Button>
          </div>
          <div className="mt-5">
            <Button variant="outline" onClick={() => setStep(4)}>Back to tools</Button>
          </div>
        </section>
      )}

      <HonestLimitsBox />
    </div>
  );
}
