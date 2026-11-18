'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { formatUnits, isAddress, parseUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  bandForScore, useAgentScoreByWallet,
} from '@/lib/agents/credit-score';
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

function MoneyStep() {
  const { address } = useAccount();
  const { data: balances } = useVaultBalances(address);
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
      {!connected ? (
        <p className="mt-4 text-[13px] text-white/60">Connect your wallet from the top of the page to fund the vault.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {VAULT_TOKENS.map((t) => (
              <div key={t.key} className="rounded-xl bg-white/[0.03] p-3">
                <p className="text-[12px] text-white/50">Vault balance · {t.label}</p>
                <p className="mt-1 font-mono text-[18px] font-semibold">
                  {balances ? fmt(balances[t.key] ?? 0n, t.decimals) : '…'} <span className="text-[13px] font-normal text-white/50">{t.label}</span>
                </p>
              </div>
            ))}
          </div>
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
            Depositing asks for one approval first if the vault cannot already move that token, then the deposit itself.
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
  const { data: lookupKey } = useKeyStatus(lookupAddr);
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
            {lookupAddr && lookupKey === null && (
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
        <p className="mt-2 text-[12px] text-white/50">Endpoint: <span className="font-mono text-polydash-green">https://polypad.family/api/mcp</span> · 21 tools · your agent signs in its own wallet</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/x402">Pay-per-call marketplace</Link></Button>
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

      {!configured ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[13px] text-white/60">
          The spending vault is not wired up on this deployment yet. Check back soon.
        </p>
      ) : (
        <>
          <IdentityStep />
          <MoneyStep />
          <PolicyStep />
          <ConnectStep />
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
