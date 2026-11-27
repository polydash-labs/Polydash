'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { formatUnits, isAddress, parseUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TERMS_VERSION } from '@/lib/agents-api/terms';
import {
  bandForScore, useAgentScoreByWallet,
} from '@/lib/agents/credit-score';
import {
  formatUsd6, usd6ForAmount, useAgentWallets, useWalletPolydashBalance, useWalletPrices, useWalletState,
  type AgentWalletRow,
} from '@/lib/agent-wallet/client';
import { AgentCard, AgentCardSub, AgentCardTitle } from '../../_components/agent-cards';
import {
  SPEND_VAULT_ADDRESS, VAULT_TOKENS, vaultTokenMeta,
  useVault, useVaultBalances, useSpendingKeys, useKeyStatus, useMyKeys,
  type VaultKeyRow,
} from '@/lib/agents/spend-vault';

type Addr = `0x${string}`;

const MCP_CONFIG = `{
  "mcpServers": {
    "polypad": {
      "url": "https://polypad.family/api/mcp"
    }
  }
}`;

function fmt(amount: bigint, decimals: number) {
  const s = formatUnits(amount, decimals);
  const [whole, frac = ''] = s.split('.');
  return frac ? `${whole}.${frac.slice(0, 4)}` : whole;
}

function expiryLabel(expiry: number) {
  const d = new Date(expiry * 1000);
  if (expiry * 1000 <= Date.now()) return `Expired ${d.toLocaleDateString()}`;
  return `Expires ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
}

function KeyCard({ row, onRevoke, canRevoke, busy }: { row: VaultKeyRow; onRevoke: () => void; canRevoke: boolean; busy: boolean }) {
  const meta = vaultTokenMeta(row.token);
  const expired = row.expiry * 1000 <= Date.now();
  return (
    <div className="rounded-xl bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[13px] text-white">
          <a className="text-polydash-green" href={getExplorerAddressUrl(row.key)} target="_blank" rel="noopener noreferrer">{shortenAddress(row.key)}</a>
          <span className="ml-2 text-white/50">· {meta?.label ?? 'Token'}</span>
        </p>
        {row.revoked ? (
          <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-[11px] font-medium text-red-300">Revoked</span>
        ) : expired ? (
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/60">Expired</span>
        ) : (
          <span className="rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green">Active</span>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-white/60">
        Per payment up to {meta ? fmt(row.perPaymentCap, meta.decimals) : '?'} {meta?.label} · up to {meta ? fmt(row.dailyCap, meta.decimals) : '?'} {meta?.label} a day
        {meta && row.spentToday > 0n && <> · spent today {fmt(row.spentToday, meta.decimals)} {meta.label}</>}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-white/45">{expiryLabel(row.expiry)}</p>
        {canRevoke && !row.revoked && (
          <Button variant="outline" size="sm" onClick={onRevoke} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Revoke key
          </Button>
        )}
      </div>
    </div>
  );
}

function IdentityStep() {
  const { address } = useAccount();
  const { data } = useAgentScoreByWallet(address);
  const band = data?.score != null ? bandForScore(data.score) : null;
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">1 · Identity — who is this agent?</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        An agent account starts with a registered identity. Registering gives your agent a number and a credit score
        (300–850) that other people can check before they trust it with their money.
      </p>
      {!address ? (
        <p className="mt-4 text-[13px] text-white/60">Connect your wallet from the top of the page to see your agent&apos;s identity.</p>
      ) : !data?.registered ? (
        <div className="mt-4">
          <p className="text-[13px] text-white/70">This wallet has no registered agent yet.</p>
          <Button asChild className="mt-3">
            <Link href="/agents/scores">Register your agent — bond 1,000 POLYDASH</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-[12px] text-white/50">Agent #{data.agentId}</p>
            {data.score != null && band ? (
              <p className="mt-1 text-[22px] font-semibold leading-none">
                {data.score} <span className={cn('ml-1 rounded-full px-2.5 py-0.5 align-middle text-[11px] font-medium', band.chip)}>{band.label}</span>
              </p>
            ) : (
              <p className="mt-1 text-[13px] text-white/60">Registered · first score posts within a day</p>
            )}
          </div>
          <Button asChild variant="outline">
            <Link href="/agents/scores">See the directory</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function AgentWalletBalanceRow({ row }: { row: AgentWalletRow }) {
  const { data: state } = useWalletState(row.safe);
  const { data: polydash } = useWalletPolydashBalance(row.safe);
  const { data: prices } = useWalletPrices();
  const ethUsd = prices?.ethUsd ?? 0;
  const polyUsd = prices?.polydashUsd ?? 0;
  const totalUsd6 =
    state && ethUsd > 0 && polyUsd > 0
      ? usd6ForAmount(state.eth, 18, ethUsd) + state.usdg + usd6ForAmount(polydash?.held ?? 0n, 18, polyUsd)
      : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] p-3">
      <div>
        <p className="font-mono text-[13px] text-white">
          <Link className="text-polydash-green hover:underline" href={`/agents/wallets/${row.safe}`}>
            {shortenAddress(row.safe)}
          </Link>
        </p>
        <p className="mt-0.5 text-[12px] text-white/50">
          Agent key <span className="font-mono">{shortenAddress(row.agentKey)}</span>
          {' · '}created in block {row.createdBlock.toString()}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[15px] font-semibold">
          {!state ? 'Loading…' : totalUsd6 === null ? 'Price unavailable' : formatUsd6(totalUsd6)}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/agents/wallets/${row.safe}`}>See checking account →</Link>
        </Button>
      </div>
    </div>
  );
}

/** Each agent wallet, with its balance and a link into its checking account. */
function AgentWalletsStep() {
  const { address } = useAccount();
  const { data: wallets, isLoading } = useAgentWallets(address);
  return (
    <AgentCard label="Your agent wallets">
      <AgentCardTitle>Your agent wallets</AgentCardTitle>
      <AgentCardSub>
        Each wallet has its own checking account — its own balance, its own money in and out. Open one to see it.
      </AgentCardSub>
      {!address ? (
        <p className="mt-4 text-[13px] text-white/60">Connect your wallet from the top of the page to see your agent wallets.</p>
      ) : isLoading ? (
        <p className="mt-4 text-[13px] text-white/50">Loading your wallets from Robinhood Chain…</p>
      ) : !wallets?.length ? (
        <p className="mt-4 text-[13px] leading-relaxed text-white/60">
          No agent wallets yet.{' '}
          <Link href="/agents/wallets/new" className="text-polydash-green hover:underline">
            Create one
          </Link>{' '}
          — it takes three steps.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {wallets.map((w) => (
            <AgentWalletBalanceRow key={w.safe} row={w} />
          ))}
        </div>
      )}
    </AgentCard>
  );
}

function MoneyStep() {
  const { address } = useAccount();
  const { data: balances, isError: balancesError, refetch: refetchBalances } = useVaultBalances(address);
  const { deposit, withdraw, connected } = useVault();
  const [tokenKey, setTokenKey] = useState<'USDG' | 'POLYDASH'>('USDG');
  const [depAmount, setDepAmount] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [busy, setBusy] = useState<'dep' | 'wd' | null>(null);
  const [error, setError] = useState('');
  const token = VAULT_TOKENS.find((t) => t.key === tokenKey)!;

  async function submit(kind: 'dep' | 'wd') {
    setError('');
    const raw = (kind === 'dep' ? depAmount : wdAmount).trim();
    let amount: bigint;
    try {
      amount = parseUnits(raw, token.decimals);
    } catch {
      setError('Enter a valid amount.');
      return;
    }
    setBusy(kind);
    try {
      const hash = kind === 'dep' ? await deposit(token.address as Addr, amount) : await withdraw(token.address as Addr, amount);
      toast.success(kind === 'dep' ? `Deposited ${raw} ${token.label} into the vault.` : `Withdrew ${raw} ${token.label} from the vault.`);
      if (kind === 'dep') setDepAmount(''); else setWdAmount('');
      void hash;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      setError(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">2 · Money — fund the vault</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        The vault holds your agent&apos;s spending money. It stays yours — deposit it, and take it back any time.
        Your agent can only spend what is in here, and only inside the limits you set in step 3.
      </p>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        The vault takes two coins. <strong className="text-white/80">USDG</strong> is a dollar coin on Robinhood
        Chain (1 USDG ≈ $1) — get it from the{' '}
        <a href="https://relay.link/onramp/robinhood" target="_blank" rel="noopener noreferrer" className="text-polydash-green hover:underline">
          Relay on-ramp
        </a>
        . <strong className="text-white/80">POLYDASH</strong> is Polypad&apos;s own token — buy it on its{' '}
        <Link href="/token/0x319525528f42167eF7fC18b77b889958080568e4" className="text-polydash-green hover:underline">
          token page
        </Link>
        . Each step also costs a small network fee (gas), paid in ETH — keep a little ETH in your wallet.
      </p>
      {!connected ? (
        <p className="mt-4 text-[13px] text-white/60">Connect your wallet from the top of the page to fund the vault.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {VAULT_TOKENS.map((t) => (
              <div key={t.key} className="rounded-xl bg-white/[0.03] p-3">
                <p className="text-[12px] text-white/50">Vault balance · {t.label}</p>
                <p className="mt-1 font-mono text-[18px] font-semibold">
                  {balancesError ? (
                    <span className="text-[13px] font-normal text-red-300">Could not load</span>
                  ) : balances ? (
                    fmt(balances[t.key] ?? 0n, t.decimals)
                  ) : (
                    '…'
                  )}{' '}
                  <span className="text-[13px] font-normal text-white/50">{t.label}</span>
                </p>
              </div>
            ))}
          </div>
          {balancesError && (
            <p className="mt-3 text-[12px] leading-relaxed text-red-300">
              Could not read the vault balances from the chain. Check your connection and{' '}
              <button type="button" onClick={() => void refetchBalances()} className="underline hover:text-white">
                try again
              </button>
              .
            </p>
          )}
          {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {VAULT_TOKENS.map((t) => (
              <Button key={t.key} variant={tokenKey === t.key ? 'default' : 'outline'} size="sm" onClick={() => setTokenKey(t.key)}>
                {t.label}
              </Button>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-muted-foreground">
                Deposit {token.label}
                <Input value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder="0.00" inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
              </label>
              <Button className="mt-2" onClick={() => submit('dep')} disabled={busy !== null || !depAmount.trim()}>
                {busy === 'dep' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy === 'dep' ? 'Waiting for your wallet…' : `Deposit ${token.label}`}
              </Button>
              <p className="mt-2 text-[12px] leading-relaxed text-white/50">
                Step 1 of 2: you approve the vault to move up to this amount of {token.label} once. Step 2: the
                deposit moves it. Approving alone moves nothing.
              </p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">
                Withdraw {token.label}
                <Input value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} placeholder="0.00" inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
              </label>
              <Button variant="outline" className="mt-2" onClick={() => submit('wd')} disabled={busy !== null || !wdAmount.trim()}>
                {busy === 'wd' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy === 'wd' ? 'Waiting for your wallet…' : `Withdraw ${token.label}`}
              </Button>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-white/50">
            When you deposit, you will see two wallet pop-ups: first Approve (lets the vault move that coin), then
            Deposit. Depositing asks for the approval first if the vault cannot already move that token, then the
            deposit itself. Each step also costs a small network fee (gas), paid in ETH.
            {SPEND_VAULT_ADDRESS && (
              <> Vault contract: <a className="font-mono text-polydash-green" href={getExplorerAddressUrl(SPEND_VAULT_ADDRESS)} target="_blank" rel="noopener noreferrer">{shortenAddress(SPEND_VAULT_ADDRESS)}</a></>
            )}
          </p>
        </>
      )}
    </section>
  );
}

const EXPIRY_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function PolicyStep() {
  const { address } = useAccount();
  const { createKey, revokeKey, connected } = useSpendingKeys();
  const { data: myKeys, isLoading: keysLoading } = useMyKeys(address);
  const [keyAddr, setKeyAddr] = useState('');
  const [tokenKey, setTokenKey] = useState<'USDG' | 'POLYDASH'>('USDG');
  const [perPayment, setPerPayment] = useState('');
  const [daily, setDaily] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [allowlist, setAllowlist] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lookup, setLookup] = useState('');
  const [lookupAddr, setLookupAddr] = useState<string | undefined>(undefined);
  const { data: lookupKey, isLoading: lookupLoading } = useKeyStatus(lookupAddr);
  const token = VAULT_TOKENS.find((t) => t.key === tokenKey)!;

  async function submitCreate() {
    setError('');
    if (!isAddress(keyAddr, { strict: false })) { setError('That key address is not valid.'); return; }
    let per: bigint;
    let day: bigint;
    try {
      per = parseUnits(perPayment.trim(), token.decimals);
      day = parseUnits(daily.trim(), token.decimals);
    } catch {
      setError('Enter valid cap amounts.');
      return;
    }
    const allow = allowlist.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    for (const a of allow) {
      if (!isAddress(a, { strict: false })) { setError(`Allowlist address is not valid: ${a}`); return; }
    }
    const expiry = Math.floor(Date.now() / 1000) + expiryDays * 86400;
    setBusy(true);
    try {
      await createKey(keyAddr.trim(), token.address as Addr, per, day, allow as Addr[], expiry);
      toast.success('Spending key created. Your agent can now spend inside these limits.');
      setKeyAddr(''); setPerPayment(''); setDaily(''); setAllowlist('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      setError(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(false);
    }
  }

  async function submitRevoke(key: string) {
    setRevoking(key);
    try {
      await revokeKey(key);
      toast.success('Spending key revoked. That agent can no longer spend from your vault.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      toast.error(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">3 · Policy — set what your agent can spend</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        A spending key is permission for one agent wallet to spend from your vault — up to a per-payment limit and a
        daily limit, in one token, until an expiry date. Leave the allowlist empty to let it pay anyone, or list the
        addresses it may pay. You can revoke a key in one transaction, any time.
      </p>
      {!connected ? (
        <p className="mt-4 text-[13px] text-white/60">Connect your wallet from the top of the page to create a spending key.</p>
      ) : (
        <>
          {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}
          <div className="mt-4 space-y-3">
            <label className="block text-xs text-muted-foreground">
              Agent wallet (the key) — the address your agent spends from
              <Input value={keyAddr} onChange={(e) => setKeyAddr(e.target.value)} placeholder="0x…" className="mt-1 max-w-md bg-secondary/50 font-mono" />
            </label>
            <div className="flex flex-wrap gap-2">
              {VAULT_TOKENS.map((t) => (
                <Button key={t.key} variant={tokenKey === t.key ? 'default' : 'outline'} size="sm" onClick={() => setTokenKey(t.key)}>
                  {t.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted-foreground">
                Per-payment limit ({token.label})
                <Input value={perPayment} onChange={(e) => setPerPayment(e.target.value)} placeholder="0.00" inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Daily limit ({token.label})
                <Input value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="0.00" inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
              </label>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Key expires after</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {EXPIRY_PRESETS.map((p) => (
                  <Button key={p.days} variant={expiryDays === p.days ? 'default' : 'outline'} size="sm" onClick={() => setExpiryDays(p.days)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <label className="block text-xs text-muted-foreground">
              Allowlist (optional) — addresses this key may pay, comma-separated. Empty means anyone.
              <Input value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="0x…, 0x… (leave empty for anyone)" className="mt-1 max-w-md bg-secondary/50 font-mono" />
            </label>
            <div>
              <Button onClick={submitCreate} disabled={busy || !keyAddr.trim() || !perPayment.trim() || !daily.trim()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {busy ? 'Waiting for your wallet…' : 'Create spending key'}
              </Button>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-[13px] font-semibold">Your keys {myKeys ? `(${myKeys.length})` : ''}</h3>
            {keysLoading && <p className="mt-2 text-[13px] text-white/50">Loading your keys from Robinhood Chain…</p>}
            {!keysLoading && myKeys?.length === 0 && (
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">No spending keys yet. Create one above and it shows here.</p>
            )}
            <div className="mt-2 space-y-2">
              {myKeys?.map((row) => (
                <KeyCard
                  key={row.key}
                  row={row}
                  canRevoke={row.owner.toLowerCase() === address?.toLowerCase()}
                  busy={revoking === row.key}
                  onRevoke={() => submitRevoke(row.key)}
                />
              ))}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-[13px] font-semibold">Check any key</h3>
            <div className="mt-2 flex max-w-md gap-2">
              <Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="0x…" className="bg-secondary/50 font-mono" />
              <Button variant="outline" onClick={() => setLookupAddr(isAddress(lookup, { strict: false }) ? lookup.trim() : undefined)} disabled={!lookup.trim()}>
                Check
              </Button>
            </div>
            {lookupAddr && lookupLoading && (
              <p className="mt-2 text-[13px] text-white/50">Checking that address on Robinhood Chain…</p>
            )}
            {lookupAddr && !lookupLoading && lookupKey === null && (
              <p className="mt-2 text-[13px] text-white/50">No spending key exists for that address.</p>
            )}
            {lookupAddr && lookupKey && (
              <div className="mt-2">
                <KeyCard
                  row={lookupKey}
                  canRevoke={lookupKey.owner.toLowerCase() === address?.toLowerCase()}
                  busy={revoking === lookupKey.key}
                  onRevoke={() => submitRevoke(lookupKey.key)}
                />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ConnectStep() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(MCP_CONFIG);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the text manually.');
    }
  }
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">4 · Connect — plug your agent in</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        No signup, no API key, no approval. Point your agent at the Polypad MCP and it can trade, launch tokens,
        join tokenized funds, and buy NFTs — signing everything in its own wallet. Spending keys from step 3 are
        what let it pay for things like pay-per-call reports without you watching every transaction.
      </p>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-white">MCP config — paste into Claude, Grok, or any MCP client</p>
          <Button variant="outline" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/80">{MCP_CONFIG}</pre>
        <p className="mt-2 text-[12px] text-white/50">Endpoint: <span className="font-mono text-polydash-green">https://polypad.family/api/mcp</span> · 25 tools · your agent signs in its own wallet</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/pricing">Pricing</Link></Button>
        <Button asChild variant="outline"><Link href="/x402">Pay-per-call marketplace</Link></Button>
        <Button asChild variant="outline"><Link href="/agents/credits">Poly credits — free credits for x402 reports</Link></Button>
        <Button asChild variant="outline"><Link href="/agents/scores">Agent Credit Scores</Link></Button>
        <Button asChild variant="outline"><Link href="/terminal">Terminal</Link></Button>
        <Button asChild variant="outline"><Link href="/docs">Docs</Link></Button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-white/50">
        Prefer Telegram? The Mini App opens Polypad inside Telegram: <a className="text-polydash-green" href="https://t.me/Aipolyagent_Bot/Polypad" target="_blank" rel="noopener noreferrer">t.me/Aipolyagent_Bot/Polypad</a>
      </p>
    </section>
  );
}

export function ApiKeysStep() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ key: string; prefix: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeInput, setRevokeInput] = useState('');
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeMsg, setRevokeMsg] = useState('');

  async function submitCreate() {
    setError('');
    setCreated(null);
    if (name.trim().length < 2 || name.trim().length > 48) { setError('Give the key a name, 2 to 48 characters.'); return; }
    if (!/^https?:\/\//i.test(url.trim())) { setError('Add an http(s) address where you can be reached — your site or profile.'); return; }
    if (!accepted) { setError('Accept the operator terms first.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/agents/v1/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentName: name.trim(), operatorUrl: url.trim(), acceptTerms: true, termsVersion: TERMS_VERSION }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        if (r.status === 500) setError('Key issuance is unavailable right now — the key store is being restored. Free access needs no key and is unaffected. Try again later.');
        else setError(String(j?.message ?? 'Could not create the key.') + (Array.isArray(j?.details) ? ` ${j.details.join(' ')}` : ''));
        return;
      }
      setCreated({ key: String(j.apiKey), prefix: String(j.prefix) });
      setName(''); setUrl(''); setAccepted(false);
    } catch {
      setError('The server did not answer. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the key manually.');
    }
  }

  async function submitRevoke(which: string) {
    const target = which.trim();
    if (!target) return;
    setRevokeMsg('');
    setRevokeBusy(true);
    try {
      const r = await fetch('/api/agents/v1/keys/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: target }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setRevokeMsg(r.status === 500
          ? 'Revocation is unavailable right now — the key store is being restored. Try again later.'
          : String(j?.message ?? 'Could not revoke the key.'));
        return;
      }
      setRevokeMsg(`Revoked ${j.prefix ?? 'the key'}. It stops working immediately.`);
      if (created && target === created.key) setCreated(null);
      setRevokeInput('');
    } catch {
      setRevokeMsg('The server did not answer. Try again in a moment.');
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">Pro keys — higher limits, $0 while growing</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        A Pro key raises your API limits to 10x the free tier — reads 1,200/min, prepares 300/min,
        prepares per wallet 120/min, intent 400/min. Same 25 tools, same 25 ETH cap per action. Free
        and $0 while growing; see <Link href="/pricing" className="text-polydash-green hover:underline">Pricing</Link>.
        An API key only identifies your calls — it never moves money. Spending from your vault is
        governed by the spending keys in step 3, which are separate.
      </p>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
        The key is shown once — store it now, it is never shown again. It does not expire. If one
        leaks, revoke it below and issue a fresh one.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-medium text-white">Key name</span>
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="my trading bot" maxLength={48} />
        </label>
        <label className="block">
          <span className="text-[13px] font-medium text-white">Operator URL</span>
          <Input className="mt-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.example" maxLength={256} />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-white/70">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-white" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>I accept the operator terms (version {TERMS_VERSION}): I sign every transaction myself, Polypad never holds my keys, and I am responsible for what my agent launches.</span>
      </label>
      {error && <p className="mt-3 text-[13px] text-white/80" role="alert">{error}</p>}
      <div className="mt-4">
        <Button onClick={submitCreate} disabled={busy}>{busy ? 'Creating…' : 'Create a Pro key'}</Button>
      </div>
      {created && (
        <div className="mt-4 rounded-xl bg-black/40 p-3">
          <p className="text-[13px] font-medium text-white">Your key ({created.prefix}…) — shown once</p>
          <pre className="mt-2 max-h-24 overflow-auto break-all rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-white/80">{created.key}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copyKey}>{copied ? 'Copied' : 'Copy the key'}</Button>
            <Button variant="outline" size="sm" onClick={() => submitRevoke(created.key)} disabled={revokeBusy}>Revoke this key</Button>
          </div>
          <p className="mt-2 text-[12px] text-white/50">Send it as the x-api-key header (or a Bearer token) with your MCP calls. See what this key has been used for at <a href="/agents/usage" className="text-[#00E676] hover:underline">/agents/usage</a>.</p>
        </div>
      )}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[13px] font-medium text-white">Revoke a key</p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/50">Paste a key to revoke it. Revocation is permanent and takes effect immediately.</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input value={revokeInput} onChange={(e) => setRevokeInput(e.target.value)} placeholder="pp_live_…" className="flex-1" />
          <Button variant="outline" onClick={() => submitRevoke(revokeInput)} disabled={revokeBusy || !revokeInput.trim()}>{revokeBusy ? 'Revoking…' : 'Revoke'}</Button>
        </div>
        {revokeMsg && <p className="mt-2 text-[13px] text-white/80">{revokeMsg}</p>}
      </div>
    </section>
  );
}

export function AgentAccountsContent() {
  const configured = !!SPEND_VAULT_ADDRESS;
  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">Agent Accounts</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
          One account for your agent: a registered identity with a credit score, money in a vault it can spend,
          limits you control, and a connection to everything Polypad does. Set it up in four steps — the rules are
          enforced by contracts on Robinhood Chain, not by a company&apos;s policy page.
        </p>
      </div>

      <BeginnerStart />
      <GlossaryBox />

      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[13px] leading-relaxed text-white/60">
        New here? The easy way in is an{' '}
        <Link href="/agents/wallets/new" className="text-polydash-green hover:underline">agent wallet</Link> — a
        Safe wallet made for your agent in three steps (name it, add money, set limits), with the
        spending keys below already wired up. Or keep setting things up by hand on this page.
      </p>

      {!configured ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[13px] leading-relaxed text-white/60">
          The spending vault is not wired up on this deployment yet. Check back soon. The free API on{' '}
          <Link href="/build" className="text-polydash-green hover:underline">/build</Link> works without this — start there — and{' '}
          <Link href="/status" className="text-polydash-green hover:underline">/status</Link> shows when it lands.
        </p>
      ) : (
        <>
          <IdentityStep />
          <AgentWalletsStep />
          <MoneyStep />
          <PolicyStep />
          <ConnectStep />
          <ApiKeysStep />
        </>
      )}

      <p className="text-[12px] leading-relaxed text-white/40">
        The Agent Credit Score and SpendVault contracts are new and have not been checked by an outside auditor
        (automated checks only), so only deposit what you can afford to lose. See them on the{' '}
        <Link href="/contracts" className="text-polydash-green hover:underline">Contracts page</Link>.{' '}
        Your agent&apos;s spending keys only move money you deposited, and you can revoke a key any time.
      </p>
    </div>
  );
}
