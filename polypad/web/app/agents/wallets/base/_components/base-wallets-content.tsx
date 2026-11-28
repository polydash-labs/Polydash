'use client';

// Base agent wallets — a second wallet for your agent, on Base (USDC),
// powered by Coinbase CDP Server Wallets. Plain language throughout: this
// page is for humans setting up an agent, not for crypto experts.
//
// How it works: you sign once to create the wallet and pick its limits.
// Your agent gets a key (pp_base_…) that can only spend inside those
// limits, only on Polypad's own reports, only to Polypad's fee wallet.
// The key is shown once — save it into your agent's config. If you lose
// it, the wallet cannot pay until a new key is issued (ask the team).
// Freeze stops the wallet instantly; the key cannot freeze it.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount, useSignMessage } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { shortenAddress } from '@/lib/format';
import { creationMessage, freezeMessage } from '@/lib/cdp-base/message';
import {
  AgentCard,
  AgentCardSub,
  AgentCardTitle,
  AgentStat,
  NeedsYou,
  PageHero,
  ProofChip,
  StepsRow,
} from '../../../_components/agent-cards';

const BASESCAN_ADDRESS = (a: string) => `https://basescan.org/address/${a}`;
const BASESCAN_TX = (h: string) => `https://basescan.org/tx/${h}`;

const POLYDASH_TOKEN = '0x319525528f42167eF7fC18b77b889958080568e4';
const POLYFUND_NFT = '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef';
const EXAMPLE_LAUNCH = '0x2B0b4151cA57546BD968718b1ba256b288e51CA9';

const DAILY_CAPS = [
  { cents: 10, label: '$0.10 a day' },
  { cents: 25, label: '$0.25 a day' },
  { cents: 50, label: '$0.50 a day' },
];
const PER_PAYMENT_CAPS = [
  { cents: 1, label: '$0.01 per payment' },
  { cents: 5, label: '$0.05 per payment' },
];
const EXPIRIES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
];

type WalletView = {
  address: string;
  name: string;
  ownerAddress: string;
  dailyCapUsdCents: number;
  perPaymentCapUsdCents: number;
  expiresAt: string;
  policyId: string | null;
  frozen: boolean;
  createdAt: string;
  usdcCents: number;
  spentTodayUsdCents: number;
};

type PaymentView = {
  id: number;
  product: string;
  amountUsdCents: number;
  txHash: string | null;
  status: string;
  createdAt: string;
};

const PRODUCT_LABEL: Record<string, string> = {
  'token-report': 'Token report',
  'fund-nav': 'Fund NAV snapshot',
  'cto-report': 'CTO report',
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function expiryLabel(expiresAt: string): string {
  const days = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
  return days === 0 ? 'Expired' : `expires in ${days} day${days === 1 ? '' : 's'}`;
}

function WalletCard({
  wallet,
  sessionKey,
  onSessionKey,
  onChanged,
}: {
  wallet: WalletView;
  sessionKey: string;
  onSessionKey: (key: string) => void;
  onChanged: () => void;
}) {
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [tokenAddress, setTokenAddress] = useState(POLYDASH_TOKEN);
  const [fundAddress, setFundAddress] = useState(POLYFUND_NFT);
  const [launchAddress, setLaunchAddress] = useState(EXAMPLE_LAUNCH);
  const [payments, setPayments] = useState<PaymentView[]>([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const expired = new Date(wallet.expiresAt).getTime() < Date.now();

  const loadPayments = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/wallets/base/${wallet.address}`);
      if (!res.ok) return;
      const data = await res.json();
      setPayments(data.payments ?? []);
    } catch {
      // Activity is a nice-to-have; a failed load must not break the card.
    } finally {
      setPaymentsLoaded(true);
    }
  }, [wallet.address]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  async function pay(product: 'token-report' | 'fund-nav' | 'cto-report', subject: string) {
    if (!sessionKey) {
      toast.error('Paste the wallet’s agent key (pp_base_…) above first — it is shown once when you create the wallet.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, string> = { product };
      if (product === 'token-report') body.address = subject;
      if (product === 'fund-nav') body.fund = subject;
      if (product === 'cto-report') body.launch = subject;
      const res = await fetch(`/api/agents/wallets/base/${wallet.address}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionKey}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail ?? data.error ?? 'Payment failed.');
        return;
      }
      toast.success(
        data.transaction ? `Paid. Settlement: ${data.transaction.slice(0, 10)}…` : 'Paid.',
      );
      loadPayments();
      onChanged();
    } catch {
      toast.error('Payment failed. Check the wallet’s activity before paying again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleFreeze() {
    const frozen = !wallet.frozen;
    const validUntil = Math.floor(Date.now() / 1000) + 600;
    setBusy(true);
    try {
      const signature = await signMessageAsync({ message: freezeMessage(wallet.address, frozen, validUntil) });
      const res = await fetch(`/api/agents/wallets/base/${wallet.address}/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frozen, validUntil, signature }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail ?? data.error ?? 'Could not change the freeze state.');
        return;
      }
      toast.success(frozen ? 'Wallet frozen. Your agent cannot spend until you unfreeze it.' : 'Wallet unfrozen.');
      onChanged();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (!msg.includes('rejected')) toast.error('Could not change the freeze state.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative rounded-[20px] border border-white/10 bg-[#141414] p-6 sm:p-8">
      <ProofChip big={usd(wallet.dailyCapUsdCents)} small="daily cap — the most it can ever spend" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[16px] font-bold text-white">{wallet.name}</p>
          <p className="mt-1 font-mono text-[14px] font-semibold text-white">
            <a className="text-polydash-green hover:underline" href={BASESCAN_ADDRESS(wallet.address)} target="_blank" rel="noopener noreferrer">
              {shortenAddress(wallet.address)}
            </a>
            <span className="ml-2 text-[12px] font-normal text-white/50">Base · USDC</span>
          </p>
        </div>
        {wallet.frozen ? (
          <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-[11px] font-medium text-red-300">Frozen</span>
        ) : expired ? (
          <span className="rounded-full bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">Expired</span>
        ) : (
          <span className="rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green">Active</span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <AgentStat label="USDC on Base" value={usd(wallet.usdcCents)} note={wallet.usdcCents < 5 ? 'Low — send USDC to the address above to top it up.' : undefined} />
        <AgentStat label="Spent today" value={<span>{usd(wallet.spentTodayUsdCents)} <span className="text-[14px] font-medium text-white/50">/ {usd(wallet.dailyCapUsdCents)}</span></span>} />
        <AgentStat label="Per-payment cap" value={usd(wallet.perPaymentCapUsdCents)} />
        <AgentStat label="Key expires" value={<span className="text-[18px]">{expiryLabel(wallet.expiresAt)}</span>} />
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-white/55">
        Send USDC to this address on Base to fund it. The agent key pays for Polypad reports only — token report $0.01, fund NAV $0.01, CTO report $0.05 — and only to Polypad’s fee wallet.
      </p>

      {!sessionKey && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Paste this wallet’s agent key (pp_base_…) to pay in this session"
            className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-[13px] text-white placeholder:text-white/35 focus:border-polydash-green focus:outline-none"
          />
          <Button variant="outline" size="sm" onClick={() => { onSessionKey(keyInput.trim()); setKeyInput(''); }}>
            Use key for this session
          </Button>
        </div>
      )}

      <div className="mt-5 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            aria-label="Token address for the token report"
            className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-[13px] text-white focus:border-polydash-green focus:outline-none"
          />
          <Button size="sm" disabled={busy || wallet.frozen || expired} onClick={() => pay('token-report', tokenAddress)}>
            Buy token report · $0.01
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={fundAddress}
            onChange={(e) => setFundAddress(e.target.value)}
            aria-label="Fund address for the NAV snapshot"
            className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-[13px] text-white focus:border-polydash-green focus:outline-none"
          />
          <Button size="sm" disabled={busy || wallet.frozen || expired} onClick={() => pay('fund-nav', fundAddress)}>
            Buy fund NAV · $0.01
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={launchAddress}
            onChange={(e) => setLaunchAddress(e.target.value)}
            aria-label="Launch address for the CTO report"
            className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-[13px] text-white focus:border-polydash-green focus:outline-none"
          />
          <Button size="sm" disabled={busy || wallet.frozen || expired} onClick={() => pay('cto-report', launchAddress)}>
            Buy CTO report · $0.05
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={toggleFreeze} disabled={busy}>
          {busy && <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
          {wallet.frozen ? 'Unfreeze this wallet' : 'Freeze this wallet'}
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={BASESCAN_ADDRESS(wallet.address)} target="_blank" rel="noopener noreferrer">View on BaseScan</a>
        </Button>
      </div>

      <div className="mt-6">
        <h3 className="text-[14px] font-bold text-white">Recent payments</h3>
        {!paymentsLoaded ? (
          <p className="mt-2 text-[13px] text-white/50">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="mt-2 text-[13px] text-white/50">No payments yet. Buy a report above — the settlement shows here.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-white/5 bg-[#1a1a1a] px-3 py-2 text-[13px]">
                <span className="text-white/80">
                  {PRODUCT_LABEL[p.product] ?? p.product} · {usd(p.amountUsdCents)} · {p.status}
                </span>
                {p.txHash ? (
                  <a className="font-mono text-polydash-green hover:underline" href={BASESCAN_TX(p.txHash)} target="_blank" rel="noopener noreferrer">
                    {shortenAddress(p.txHash)}
                  </a>
                ) : (
                  <span className="text-white/40">{new Date(p.createdAt).toLocaleDateString()}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function BaseWalletsContent() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [wallets, setWallets] = useState<WalletView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [dailyCap, setDailyCap] = useState(50);
  const [perPaymentCap, setPerPaymentCap] = useState(5);
  const [expiryDays, setExpiryDays] = useState(90);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ address: string; key: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (owner: string) => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/agents/wallets/base?owner=${owner}`);
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setWallets(data.wallets ?? []);
    } catch {
      setLoadError(true);
      setWallets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (address) load(address);
    else setWallets(null);
  }, [address, load]);

  async function create() {
    if (!address) return;
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error('Give the wallet a name first — for example, the agent it belongs to.');
      return;
    }
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const validUntil = Math.floor(Date.now() / 1000) + 600;
    const expiresAtIso = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
    setCreating(true);
    setCreateError(null);
    setCreatedKey(null);
    try {
      const message = creationMessage({
        ownerAddress: address,
        name: cleanName,
        dailyCapUsdCents: dailyCap,
        perPaymentCapUsdCents: perPaymentCap,
        expiresAtIso,
        validUntil,
        nonce,
      });
      const signature = await signMessageAsync({ message });
      const res = await fetch('/api/agents/wallets/base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          ownerAddress: address,
          dailyCapUsdCents: dailyCap,
          perPaymentCapUsdCents: perPaymentCap,
          expiryDays,
          validUntil,
          nonce,
          signature,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'cdp_wallet_secret_not_configured') {
          setCreateError(
            'Coinbase is not fully connected yet: the CDP wallet secret is missing. The team needs to add CDP_WALLET_SECRET to the project — the wallet cannot be created until then. Nothing was created and nothing was charged.',
          );
        } else {
          setCreateError(data.detail ?? data.error ?? 'Could not create the wallet.');
        }
        return;
      }
      if (data.agentKey) {
        setCreatedKey({ address: data.wallet.address as string, key: data.agentKey as string });
        setSessionKeys((prev) => ({ ...prev, [data.wallet.address as string]: data.agentKey as string }));
      }
      setName('');
      toast.success('Base wallet created. Save the agent key below — it is shown once.');
      load(address);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (!msg.includes('rejected')) setCreateError('Could not create the wallet. Check your connection and try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-container space-y-6 px-5 py-6 sm:px-8 sm:py-10">
      <PageHero
        crumb={<>Agents <span className="font-normal text-white/40">· Agent Wallets · Base wallet</span></>}
        title="Base Wallet"
        lede="A second wallet for your AI agent, on Base, for paying for things priced in USDC — Polypad's reports, and later, other agent services. Your agent spends inside limits you set. You can stop it in one tap."
      />

      <div className="pt-4">
        <StepsRow
          steps={[
            {
              title: 'You own it',
              text: 'The wallet lives on Base and is powered by Coinbase CDP — the keys sit in Coinbase’s secure enclave, and Polypad never sees them. You are the owner.',
            },
            {
              title: 'Your agent pays for things',
              text: 'Your agent gets a key that can only buy Polypad reports, only in USDC on Base, only up to the caps you set. The key can never raise its own limits.',
            },
            {
              title: 'You can stop it instantly',
              text: 'Freeze the wallet in one tap and it cannot spend at all — the freeze needs your signature, so the agent key cannot undo it.',
            },
          ]}
        />
      </div>

      <AgentCard label="Create a Base wallet">
        <ProofChip big="Base · USDC" small="a parallel wallet, next to your Safe wallet on Robinhood Chain" />
        <AgentCardTitle>Create a Base wallet</AgentCardTitle>
        <AgentCardSub>
          Give your agent a wallet on Base with a daily limit you set. One signature creates it — no gas, no
          crypto needed to create it. Fund it later by sending USDC to its address on Base.
        </AgentCardSub>
        {!address ? (
          <div className="mt-5">
            <NeedsYou title="Connect your wallet" text="Connect your wallet from the top of the page to create a Base wallet." />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="base-wallet-name" className="text-[13px] font-medium text-white/70">Wallet name</label>
              <input
                id="base-wallet-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="For example: scout-buys-reports"
                maxLength={40}
                className="mt-1 w-full rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[14px] text-white placeholder:text-white/35 focus:border-polydash-green focus:outline-none"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="base-daily-cap" className="text-[13px] font-medium text-white/70">Daily cap</label>
                <select
                  id="base-daily-cap"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Number(e.target.value))}
                  className="mt-1 w-full rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[14px] text-white focus:border-polydash-green focus:outline-none"
                >
                  {DAILY_CAPS.map((o) => (
                    <option key={o.cents} value={o.cents}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="base-per-payment-cap" className="text-[13px] font-medium text-white/70">Per-payment cap</label>
                <select
                  id="base-per-payment-cap"
                  value={perPaymentCap}
                  onChange={(e) => setPerPaymentCap(Number(e.target.value))}
                  className="mt-1 w-full rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[14px] text-white focus:border-polydash-green focus:outline-none"
                >
                  {PER_PAYMENT_CAPS.map((o) => (
                    <option key={o.cents} value={o.cents}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="base-expiry" className="text-[13px] font-medium text-white/70">Key expires after</label>
                <select
                  id="base-expiry"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                  className="mt-1 w-full rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[14px] text-white focus:border-polydash-green focus:outline-none"
                >
                  {EXPIRIES.map((o) => (
                    <option key={o.days} value={o.days}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Button onClick={create} disabled={creating}>
                {creating && <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                Sign &amp; create wallet
              </Button>
            </div>
            {createError && (
              <p className="rounded-[10px] border border-amber-400/20 bg-amber-400/[0.05] p-4 text-[14px] leading-relaxed text-amber-100/90">
                {createError}
              </p>
            )}
            {createdKey && (
              <div className="rounded-[10px] border border-polydash-green/30 bg-polydash-green/[0.06] p-4">
                <p className="text-[14px] font-bold text-white">Save this agent key now — it is shown once.</p>
                <p className="mt-1 text-[13px] leading-relaxed text-white/60">
                  Put it in your agent’s config as the key for wallet{' '}
                  <span className="font-mono">{shortenAddress(createdKey.address)}</span>. Anyone with this key can
                  spend up to the wallet’s caps. If you lose it, the wallet cannot pay until a new key is issued.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <code className="min-w-0 flex-1 break-all rounded-[10px] border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-[13px] text-white">
                    {createdKey.key}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(createdKey.key).catch(() => undefined);
                      toast.success('Agent key copied.');
                    }}
                  >
                    Copy key
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </AgentCard>

      {!address ? null : loading ? (
        <p className="text-[14px] text-white/50">Loading your Base wallets…</p>
      ) : loadError ? (
        <AgentCard label="Could not load your Base wallets">
          <AgentCardTitle>Could not load your Base wallets</AgentCardTitle>
          <AgentCardSub>Check your connection and reload.</AgentCardSub>
        </AgentCard>
      ) : !wallets?.length ? (
        <NeedsYou title="No Base wallets yet" text="Create your first Base wallet above. It takes one signature, and funding it is just sending USDC to its address on Base." />
      ) : (
        <>
          <div className="pt-2">
            <h2 className="text-[20px] font-bold tracking-tight sm:text-[22px]">Your Base wallets ({wallets.length})</h2>
          </div>
          <div className="space-y-6">
            {wallets.map((w) => (
              <WalletCard
                key={w.address}
                wallet={w}
                sessionKey={sessionKeys[w.address] ?? ''}
                onSessionKey={(key) => setSessionKeys((prev) => ({ ...prev, [w.address]: key }))}
                onChanged={() => address && load(address)}
              />
            ))}
          </div>
        </>
      )}

      <AgentCard label="What this wallet can and cannot do">
        <AgentCardTitle>What this wallet can and cannot do</AgentCardTitle>
        <AgentCardSub>
          Base only — this wallet cannot touch Robinhood Chain or your Safe wallets there. It pays in USDC on Base,
          only for Polypad reports, only to Polypad’s fee wallet. Two limits apply: the daily cap you set is enforced
          by Polypad before anything is signed, and Coinbase’s own rules enforce the per-payment network and
          destination. Coinbase’s payment checker also caps wallets it does not know yet at $0.05 per payment and
          $0.50 per day — that is why the caps above stop there. The keys live in Coinbase’s secure enclave;
          Polypad never sees them, and neither do you — your agent spends with its key, not with a seed phrase.
        </AgentCardSub>
        <div className="mt-5">
          <Button asChild variant="outline">
            <Link href="/agents/wallets">See your Safe wallets on Robinhood Chain</Link>
          </Button>
        </div>
      </AgentCard>
    </div>
  );
}
