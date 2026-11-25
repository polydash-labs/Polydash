'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatUnits, isAddress, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRegisterAgent, REGISTRATION_STAKE } from '@/lib/agents/credit-score';
import { useVault } from '@/lib/agents/spend-vault';
import { useSpendingKeys } from '@/lib/agents/spend-vault';
import {
  buildConnectCommand, buildMcpConfig, explorerAddress, isFactoryLive, isFactoryV2Live, presetToPolicy,
  useCreateWallet, useCreateWalletV2, useSafeOwnerCall, useWalletScore,
  DAILY_CAP_MIN_USD, DAILY_CAP_MAX_USD, dailyCapValidUsd,
  FUNDING_AMOUNTS, RELAY_ONRAMP_URL, WALLET_PRESETS, ZERO_ADDRESS,
  type Addr, type WalletPolicy, type WalletPreset,
} from '@/lib/agent-wallet/client';
import { POLYDASH_TOKEN_ADDRESS, USDG_TOKEN_ADDRESS } from '@/lib/agent-wallet/client';
import { erc20Abi } from '@/lib/staking/shared';
import { robinhoodChain } from '@/lib/chain';
import { HonestLimitsBox } from '../../_components/honest-limits';

type Step = 1 | 2 | 3;

function Stepper({ step }: { step: Step }) {
  const labels = ['1 · Name it', '2 · Add money', '3 · Limits & plug in'];
  return (
    <ol className="flex flex-wrap gap-2">
      {labels.map((l, i) => (
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

function useUsdgBalance(owner: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!owner && isAddress(owner, { strict: false });
  return useQuery({
    queryKey: ['agent-wallets', 'usdg-balance', owner?.toLowerCase()],
    enabled: !!client && valid,
    queryFn: async () => {
      if (!client || !valid) return 0n;
      return (await client.readContract({
        address: USDG_TOKEN_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [owner as Addr],
      })) as bigint;
    },
  });
}

export function WizardContent() {
  const { address } = useAccount();
  const [step, setStep] = useState<Step>(1);

  // Step 1 state. The agent key lives in page state ONLY — never sent to the
  // server, never stored in localStorage, never logged.
  const [name, setName] = useState('');
  const [backupKey, setBackupKey] = useState('');
  const [agentKey, setAgentKey] = useState<`0x${string}` | null>(null);
  const [agentKeyAddress, setAgentKeyAddress] = useState<Addr | null>(null);
  const [savedKey, setSavedKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [walletAddress, setWalletAddress] = useState<Addr | null>(null);
  const [deployTx, setDeployTx] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'deploy' | 'register' | 'fund' | 'stop' | null>(null);
  const [error, setError] = useState('');

  // Step 2 state.
  const [fundAmount, setFundAmount] = useState<number>(25);
  const [funded, setFunded] = useState(false);

  // Step 3 state.
  const [presetKey, setPresetKey] = useState<WalletPreset['key']>('medium');
  // v2 only: the daily limit is a free pick, $1–$5,000 (Jon's decision 3).
  // There is no per-payment or weekly cap in v2 — the daily limit is the
  // only bound (decision 5). Default $10/day matches the old Medium preset.
  const [dailyCapUsd, setDailyCapUsd] = useState('10');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Chain picker: Robinhood Chain is live; Base deploys once its paymaster
  // + factory are funded (see the v2 design doc). Base is shown disabled
  // until then — picking it must not silently deploy on Hood.
  const [chain, setChain] = useState<'hood' | 'base'>('hood');

  const { createWalletV2 } = useCreateWalletV2();
  const [perPayment, setPerPayment] = useState('');
  const [daily, setDaily] = useState('');
  const [weekly, setWeekly] = useState('');
  const [startHour, setStartHour] = useState('0');
  const [endHour, setEndHour] = useState('0');
  const [allowlist, setAllowlist] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [stopped, setStopped] = useState(false);

  const { createWallet } = useCreateWallet();
  const { register } = useRegisterAgent();
  const { deposit } = useVault();
  const { revokeKey } = useSpendingKeys();
  const { setFrozen } = useSafeOwnerCall();
  const { data: polydashBalance } = usePolydashBalance(address);
  const { data: usdgBalance } = useUsdgBalance(address);
  const { data: walletScore } = useWalletScore(walletAddress ?? undefined);

  const preset = WALLET_PRESETS.find((p) => p.key === presetKey)!;
  const policy: WalletPolicy = (() => {
    const base = presetToPolicy(preset);
    if (!showAdvanced) return base;
    const num = (s: string, fallback: bigint) => {
      try { return s.trim() ? parseUnits(s.trim(), 6) : fallback; } catch { return fallback; }
    };
    const allow = allowlist.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    return {
      ...base,
      perPaymentCapUsdg: num(perPayment, base.perPaymentCapUsdg),
      dailyCapUsdg: num(daily, base.dailyCapUsdg),
      weeklyCapUsdg: num(weekly, base.weeklyCapUsdg),
      startHour: Math.min(23, Math.max(0, Number(startHour) || 0)),
      endHour: Math.min(23, Math.max(0, Number(endHour) || 0)),
      allowedTargets: allow.length && allow.every((a) => isAddress(a, { strict: false })) ? (allow as Addr[]) : base.allowedTargets,
    };
  })();

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
      'POLYPAD AGENT WALLET — AGENT KEY (keep this secret)',
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
    if (!isAddress(backupKey, { strict: false })) { setError('That backup address is not valid.'); return; }
    if (!isFactoryLive && !isFactoryV2Live) { setError('The wallet factory is not live yet — deployment opens once it is.'); return; }
    if (isFactoryV2Live && chain === 'base') { setError('Base is not live yet — the Base factory and paymaster deploy once they are funded. Robinhood Chain works now.'); return; }
    if (isFactoryV2Live && !dailyCapValidUsd(Number(dailyCapUsd))) { setError(`Pick a daily limit between $${DAILY_CAP_MIN_USD} and $${DAILY_CAP_MAX_USD}.`); return; }
    setBusy('deploy');
    try {
      // v2 when the v2 factory is live (daily-cap-only module + ERC-8004
      // identity at creation + 4337 path); v1 otherwise. The v1 factory
      // stays the fallback so older wallets keep deploying identically.
      const { safe, txHash } = isFactoryV2Live
        ? await createWalletV2(address, backupKey as Addr, agentKeyAddress, Number(dailyCapUsd), policy.allowedTargets)
        : await createWallet(address, backupKey as Addr, agentKeyAddress, policy);
      setWalletAddress(safe);
      setDeployTx(txHash);
      toast.success('Wallet deployed. Your agent now has an address.');
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
    if ((polydashBalance ?? 0n) < REGISTRATION_STAKE) {
      setError('You hold no POLYDASH to pay the 1,000 POLYDASH bond — see below.');
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

  async function fund() {
    setError('');
    if (!address) { setError('Connect your wallet first.'); return; }
    if ((usdgBalance ?? 0n) < parseUnits(String(fundAmount), 6)) {
      setError(`You hold less than $${fundAmount} USDG. Get USDG from the Relay on-ramp first, or pick a smaller amount.`);
      return;
    }
    setBusy('fund');
    try {
      await deposit(USDG_TOKEN_ADDRESS, parseUnits(String(fundAmount), 6));
      setFunded(true);
      toast.success(`$${fundAmount} USDG is in the vault for your agent.`);
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

  const hasPolydash = (polydashBalance ?? 0n) >= REGISTRATION_STAKE;
  const mcpConfig = walletAddress && agentKeyAddress ? buildMcpConfig(walletAddress, agentKeyAddress) : '';
  const connectBundle = walletAddress && agentKeyAddress && agentKey
    ? [
        'POLYPAD AGENT WALLET — connect your agent',
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

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">Create an agent wallet</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
          Three steps, about two minutes. Your agent gets its own wallet on Robinhood Chain, with
          limits you set. Each step costs a few cents of network fees (gas), paid in ETH.
        </p>
      </div>
      <Stepper step={step} />

      {!isFactoryLive && !isFactoryV2Live && (
        <p className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-[13px] leading-relaxed text-amber-100/90">
          The wallet contracts are being deployed — everything below is ready, and wallet creation
          opens once the factory is live. You can still generate and save a key, pick limits, and
          copy the connection details now; the Deploy button stays off until the factory exists.
          Nothing here pretends a wallet was deployed.
        </p>
      )}

      {error && <p className="rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-4 text-[13px] text-red-300" role="alert">{error}</p>}

      {step === 1 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 1 · Name it</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            Pick a name for your agent. Then we make its key — a secret password only your agent
            uses — and deploy its wallet. One click deploys the wallet: the factory builds the Safe,
            sets you as the owner, sets your backup key, and switches on the agent key.
            {isFactoryV2Live && ' It also gives the wallet its own on-chain identity, so other agents and apps can check who it is.'}
          </p>

          {isFactoryV2Live && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted-foreground">
                Chain — where the wallet lives
                <span className="mt-1 flex gap-2">
                  <button type="button" onClick={() => setChain('hood')} className={cn('rounded-lg border px-3 py-2 text-[13px] font-medium', chain === 'hood' ? 'border-polydash-green bg-polydash-green/[0.07] text-white' : 'border-white/10 bg-white/[0.02] text-white/60')}>
                    Robinhood Chain
                  </button>
                  <button type="button" disabled title="Base deploys once its factory and paymaster are funded" className="cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[13px] font-medium text-white/35">
                    Base — coming soon
                  </button>
                </span>
              </label>
              <label className="block max-w-md text-xs text-muted-foreground">
                Daily spending limit (USDG) — any amount ${DAILY_CAP_MIN_USD}–${DAILY_CAP_MAX_USD}. This is the only limit: one payment can be up to the full daily amount, and anything over it fails on-chain. You can change it later from the wallet page.
                <Input value={dailyCapUsd} onChange={(e) => setDailyCapUsd(e.target.value)} placeholder="10" inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
              </label>
            </div>
          )}

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
            <Button onClick={deploy} disabled={busy !== null || !agentKey || !savedKey || !name.trim() || (!isFactoryLive && !isFactoryV2Live)}>
              {busy === 'deploy' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy === 'deploy' ? 'Deploying — waiting for your wallet…' : 'Deploy the wallet'}
            </Button>
            {!isFactoryLive && !isFactoryV2Live && (
              <p className="mt-2 text-[12px] text-amber-200/90">Deploy is off until the factory is live. Key, name, and limits below still work.</p>
            )}
            {walletAddress && (
              <div className="mt-4 rounded-xl bg-polydash-green/[0.07] p-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-white">
                  <Check className="h-4 w-4 text-polydash-green" />Wallet deployed
                </p>
                <p className="mt-1 font-mono text-[13px] text-white/80">
                  <a className="text-polydash-green hover:underline" href={explorerAddress(walletAddress)} target="_blank" rel="noopener noreferrer">{walletAddress}</a>
                </p>
                {deployTx && (
                  <p className="mt-1 text-[12px] text-white/50">
                    Deploy transaction: <a className="text-polydash-green hover:underline" href={getExplorerTxUrl(deployTx)} target="_blank" rel="noopener noreferrer">{shortenAddress(deployTx)}</a>
                  </p>
                )}
              </div>
            )}
          </div>

          {walletAddress && (
            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="text-[13px] font-semibold">Register it for a credit score (optional, recommended)</h3>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/60">
                Registration gives your agent a number and a credit score (300–850) that others can check
                before trusting it. Your wallet pays the 1,000 POLYDASH bond — about $0.0003, a spam
                deterrent, not insurance. The bond comes back to the wallet if you unregister.
              </p>
              {!hasPolydash ? (
                <p className="mt-3 text-[13px] leading-relaxed text-amber-200/90">
                  You hold no POLYDASH, so registration has to wait. Buy POLYDASH on its{' '}
                  <Link href="/token/0x319525528f42167eF7fC18b77b889958080568e4" className="text-polydash-green hover:underline">token page</Link>{' '}
                  (you need 1,000), then come back here.
                </p>
              ) : agentId ? (
                <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-white">
                  <Check className="h-4 w-4 text-polydash-green" />Registered as agent #{agentId} — first score posts within a day.
                </p>
              ) : (
                <Button variant="outline" className="mt-3" onClick={registerScore} disabled={busy !== null}>
                  {busy === 'register' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Register for a credit score — bond 1,000 POLYDASH
                </Button>
              )}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} disabled={!walletAddress && (isFactoryLive || isFactoryV2Live)}>
              Continue to step 2
            </Button>
            {!walletAddress && (isFactoryLive || isFactoryV2Live) && <span className="self-center text-[12px] text-white/50">Deploy the wallet first.</span>}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 2 · Add money</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            Pick an amount — it lands in the SpendVault as USDG (a dollar coin, 1 USDG ≈ $1), where
            your agent can spend it inside the limits you set in step 3. This is still your money.
            Take it back any time. One button does the approve + deposit behind the scenes.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {FUNDING_AMOUNTS.map((a) => (
              <Button key={a} variant={fundAmount === a ? 'default' : 'outline'} onClick={() => setFundAmount(a)}>
                ${a}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-white/60">
            Your USDG balance: {usdgBalance != null ? `$${formatUnits(usdgBalance, 6)}` : '…'}
          </p>
          {funded ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-white">
              <Check className="h-4 w-4 text-polydash-green" />${fundAmount} USDG is in the vault.
            </p>
          ) : (
            <Button className="mt-3" onClick={fund} disabled={busy !== null}>
              {busy === 'fund' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy === 'fund' ? 'Waiting for your wallet…' : `Deposit $${fundAmount} USDG`}
            </Button>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-white/50">
            You will see two wallet pop-ups: first Approve (lets the vault move that USDG once), then
            Deposit. Approving alone moves nothing. Each step also costs a small network fee (gas), paid in ETH.
          </p>
          <div className="mt-4 rounded-xl bg-white/[0.03] p-3">
            <p className="text-[13px] font-medium text-white">No ETH for gas?</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              Get ETH on Robinhood Chain with a card — it lands in your wallet, ready to pay gas.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <a href={RELAY_ONRAMP_URL} target="_blank" rel="noopener noreferrer">Get ETH — Relay on-ramp</a>
            </Button>
          </div>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)}>Continue to step 3</Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold">Step 3 · Set limits and plug it in</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
            {isFactoryV2Live ? (
              <>Your daily limit is ${dailyCapUsd} a day, set in step 1. One payment can be up to
              the full daily amount, and anything over it fails on-chain — there is no separate
              per-payment or weekly cap, and no approval step for big moves. The key expires after
              90 days either way, and you can change the limit later from the wallet page.</>
            ) : (
              <>Pick how much your agent may spend. Small, Medium, or Large — the key expires after 90
              days either way, and you can change the limits later from the wallet page. The agent key
              can never raise its own limits.</>
            )}
          </p>
          {isFactoryV2Live ? (
            <div className="mt-4 rounded-xl border border-polydash-green/30 bg-polydash-green/[0.07] p-3">
              <p className="text-[14px] font-semibold text-white">Daily limit: ${dailyCapUsd} USDG a day</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/60">
                One payment can be up to the full ${dailyCapUsd}. Anything over the daily limit fails
                on-chain — it does not wait for your approval, and it does not go through. You can
                freeze the wallet or change the limit any time from the wallet page.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
          )}

          <button type="button" className="mt-3 text-[13px] text-polydash-green hover:underline" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide advanced settings' : 'Advanced settings — exact numbers, allowlist, working hours'}
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-3 rounded-xl bg-white/[0.02] p-3">
              <div className={cn('grid gap-3', isFactoryV2Live ? 'sm:grid-cols-1' : 'sm:grid-cols-3')}>
                {!isFactoryV2Live && (
                  <label className="block text-xs text-muted-foreground">
                    Per-payment cap (USDG)
                    <Input value={perPayment} onChange={(e) => setPerPayment(e.target.value)} placeholder={preset.perPaymentUsdg} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
                  </label>
                )}
                <label className="block text-xs text-muted-foreground">
                  Daily cap (USDG)
                  <Input value={daily} onChange={(e) => setDaily(e.target.value)} placeholder={isFactoryV2Live ? dailyCapUsd : preset.dailyUsdg} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
                </label>
                {!isFactoryV2Live && (
                  <label className="block text-xs text-muted-foreground">
                    Weekly cap (USDG)
                    <Input value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder={preset.weeklyUsdg} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
                  </label>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-muted-foreground">
                  Works from (hour, UTC, 0–23 — 0 means no window)
                  <Input value={startHour} onChange={(e) => setStartHour(e.target.value)} placeholder="0" inputMode="numeric" className="mt-1 bg-secondary/50 font-mono" />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Works until (hour, UTC, 0–23)
                  <Input value={endHour} onChange={(e) => setEndHour(e.target.value)} placeholder="0" inputMode="numeric" className="mt-1 bg-secondary/50 font-mono" />
                </label>
              </div>
              <label className="block text-xs text-muted-foreground">
                Per-target allowlist (optional) — addresses the agent may pay, comma-separated. Leave empty to use Polypad&apos;s contracts.
                <Input value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="0x…, 0x…" className="mt-1 bg-secondary/50 font-mono" />
              </label>
              <p className="text-[12px] leading-relaxed text-white/50">
                {isFactoryV2Live ? (
                  <>Daily limit: ${dailyCapUsd} a day · key expires {new Date(policy.expiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.</>
                ) : (
                  <>Chosen limits: up to ${formatUnits(policy.perPaymentCapUsdg, 6)} per payment · ${formatUnits(policy.dailyCapUsdg, 6)} a day · ${formatUnits(policy.weeklyCapUsdg, 6)} a week · key expires {new Date(policy.expiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.</>
                )}
                {' '}Limits are set on-chain when the wallet deploys (step 1) — changing them later is one owner transaction from the wallet page.
              </p>
            </div>
          )}

          <div className="mt-5 border-t border-white/10 pt-4">
            <h3 className="text-[13px] font-semibold">Plug your agent in</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/60">
              One click copies everything your agent needs: the MCP config, the wallet address, and
              the agent key. Or run one command in your terminal and let the installer do it.
            </p>
            {walletAddress && agentKeyAddress ? (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => copyText(connectBundle, setCopiedAll)}>
                    {copiedAll ? 'Copied — paste it into your agent' : 'Copy everything the agent needs'}
                  </Button>
                  <Button variant="outline" onClick={() => copyText(mcpConfig, setCopiedConfig)}>
                    {copiedConfig ? 'Copied' : 'Copy MCP config only'}
                  </Button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{mcpConfig}</pre>
                <p className="mt-3 text-[13px] text-white/70">
                  Or in your terminal: <code className="rounded bg-white/10 px-2 py-0.5 font-mono text-[12px]">{buildConnectCommand()}</code>
                </p>
                <p className="mt-1 text-[12px] text-white/50">
                  For higher API limits, add a Pro key (free while growing) — make one at{' '}
                  <Link href="/agents/accounts" className="text-polydash-green hover:underline">Agent Accounts</Link> and send it as the x-api-key header.
                </p>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-white/60">
                The connection details appear here once the wallet is deployed in step 1.
              </p>
            )}
          </div>

          {walletAddress && (
            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="text-[13px] font-semibold">Done — your agent&apos;s card</h3>
              <div className="mt-3 rounded-xl bg-white/[0.03] p-3">
                <p className="text-[13px] text-white/60">Wallet</p>
                <p className="font-mono text-[14px] text-white">
                  <a className="text-polydash-green hover:underline" href={explorerAddress(walletAddress)} target="_blank" rel="noopener noreferrer">{walletAddress}</a>
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><p className="text-[11px] text-white/45">Credit score</p><p className="mt-0.5 text-[14px] font-semibold">{walletScore?.score ?? (agentId ? 'Registered · score coming soon' : 'Not registered')}</p></div>
                  <div><p className="text-[11px] text-white/45">Vault balance</p><p className="mt-0.5 text-[14px] font-semibold">${funded ? fundAmount : 0} USDG</p></div>
                  {isFactoryV2Live ? (
                    <div><p className="text-[11px] text-white/45">Daily limit</p><p className="mt-0.5 text-[14px] font-semibold">${dailyCapUsd}</p></div>
                  ) : (
                    <>
                      <div><p className="text-[11px] text-white/45">Per payment</p><p className="mt-0.5 text-[14px] font-semibold">${preset.perPaymentUsdg}</p></div>
                      <div><p className="text-[11px] text-white/45">Per day</p><p className="mt-0.5 text-[14px] font-semibold">${preset.dailyUsdg}</p></div>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-white/60">
                What this wallet can do, inside the limits above: launch tokens, create a tokenized
                fund, create staking, mint NFTs, trade, and any normal wallet activity.
                {isFactoryV2Live
                  ? ' Anything within the daily limit just moves — there is no approval step, and anything over the limit fails on-chain.'
                  : ' Anything bigger needs you to approve it.'}
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
              </div>
            </div>
          )}

          <div className="mt-5">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
          </div>
        </section>
      )}

      <HonestLimitsBox />
    </div>
  );
}
