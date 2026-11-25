'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useSignMessage } from 'wagmi';
import BeginnerStart from '@/components/beginner-start';
import GlossaryBox from '@/components/glossary-box';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STARTER_CENTS = 2500; // $25 starter balance (see lib/credits/config.ts)
const REPORT_CENTS = 1; // token report and fund NAV: $0.01 each
const CTO_CENTS = 5; // CTO report: $0.05 each

type BalanceData = {
  subject: string;
  balanceCents: number;
  availableCents: number;
  balanceUsd: string;
  expiresAt: string | null;
  expired: boolean;
  subjectType: string;
  key?: { prefix: string; agentName: string; revoked: boolean };
};

type TopupQuote = {
  asset: string;
  amount: string;
  recipient: string;
  usdValue: number;
  estimatedCents: number;
  priceUsd: number;
  validUntil: string;
  estimate: boolean;
};

const TOPUP_RECIPIENT = '0x9a21c75aC263cC43125E70200636f6397f8776d0';

type HistoryRow = {
  kind: string;
  amountCents: number;
  balanceAfterCents: number;
  productId: string | null;
  reason: string | null;
  createdAt: string;
};

type OverviewData = {
  totalOutstandingLiabilityCents: number;
  totalOutstandingLiabilityUsd: number;
  liveAccounts: number;
  recentLedger: { subject: string; kind: string; amountCents: number; reason: string | null; createdAt: string }[];
};

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return 'No expiry set';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function shortAddr(a: string) {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function kindLabel(kind: string) {
  switch (kind) {
    case 'grant':
      return 'Granted';
    case 'topup':
      return 'Top-up';
    case 'spend':
      return 'Spent';
    case 'starter':
      return 'Starter credits';
    case 'match':
      return 'Matched top-up';
    case 'revoke':
      return 'Revoked';
    case 'expire':
      return 'Expired';
    case 'transfer':
      return 'Moved to Pro key';
    default:
      return kind;
  }
}

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <h2 className="text-[17px] font-semibold text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function CreditsContent({ isAdmin }: { isAdmin: boolean }) {
  const { address: connectedWallet, isConnected } = useAccount();
  const { signMessageAsync, isPending: signing } = useSignMessage();

  // Balance lookup
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [walletInput, setWalletInput] = useState('');
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState('');

  // Claim form
  const [claimWallet, setClaimWallet] = useState('');
  const [claimKey, setClaimKey] = useState('');
  const [whatBuilding, setWhatBuilding] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimStep, setClaimStep] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimResult, setClaimResult] = useState<{ balanceCents: number; expiresAt: string | null } | null>(null);

  // Link-key form
  const [linkKey, setLinkKey] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkStep, setLinkStep] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkResult, setLinkResult] = useState<{ movedCents: number; balanceAfterCents: number } | null>(null);

  // Buy credits (top-up)
  const [topupAsset, setTopupAsset] = useState<'ETH' | 'POLYDASH'>('ETH');
  const [topupAmount, setTopupAmount] = useState('');
  const [quote, setQuote] = useState<TopupQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [copiedRecipient, setCopiedRecipient] = useState(false);
  const [topupTxHash, setTopupTxHash] = useState('');
  const [topupKey, setTopupKey] = useState('');
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupStep, setTopupStep] = useState('');
  const [topupError, setTopupError] = useState('');
  const [topupResult, setTopupResult] = useState<{ amountCents: number; matchedCents: number; balanceAfterCents: number; txHash: string; asset: string } | null>(null);

  // Admin
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [grantSubject, setGrantSubject] = useState('');
  const [grantDollars, setGrantDollars] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [grantKind, setGrantKind] = useState<'grant' | 'topup'>('grant');
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState('');
  const [grantResult, setGrantResult] = useState<number | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

  // Prefill the claim wallet from the connected wallet.
  useEffect(() => {
    if (connectedWallet && !claimWallet) setClaimWallet(connectedWallet);
  }, [connectedWallet, claimWallet]);

  /** Ask for a nonce, sign its message, return { nonce, signature }. */
  async function signForPurpose(
    wallet: string,
    purpose: 'claim' | 'link-key' | 'topup',
    setStep: (s: string) => void,
  ): Promise<{ nonce: string; signature: string }> {
    setStep('Asking for a message to sign…');
    const nRes = await fetch('/api/credits/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet, purpose }),
    });
    const nBody = (await nRes.json().catch(() => null)) as { nonce?: string; message?: string; error?: string } | null;
    if (!nRes.ok || !nBody?.nonce || !nBody?.message) {
      throw new Error(typeof nBody?.error === 'string' ? nBody.error : 'Could not start the sign-in. Try again.');
    }
    setStep('Waiting for your wallet — sign the message to prove this wallet is yours…');
    let signature: string;
    try {
      signature = await signMessageAsync({ message: nBody.message });
    } catch {
      throw new Error('Signing was cancelled. Nothing was claimed or moved.');
    }
    return { nonce: nBody.nonce, signature };
  }

  async function loadOverview() {
    try {
      const res = await fetch('/api/admin/credits/overview');
      const body = (await res.json().catch(() => null)) as OverviewData | null;
      if (!res.ok) {
        setOverviewError('Could not load the admin overview.');
        return;
      }
      setOverview(body);
    } catch {
      setOverviewError('Could not reach the server.');
    }
  }

  async function sweepExpired() {
    setSweepBusy(true);
    setSweepResult(null);
    try {
      const res = await fetch('/api/admin/credits/overview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sweep-expired' }),
      });
      const body = (await res.json().catch(() => null)) as { swept?: number; centsExpired?: number; error?: string } | null;
      if (!res.ok) {
        setOverviewError(typeof body?.error === 'string' ? body.error : 'Could not sweep expired accounts.');
        return;
      }
      setSweepResult(`Swept ${body?.swept ?? 0} expired accounts (${usd(body?.centsExpired ?? 0)} expired).`);
      void loadOverview();
    } catch {
      setOverviewError('Could not reach the server.');
    } finally {
      setSweepBusy(false);
    }
  }

  async function checkBalance() {
    const key = keyInput.trim();
    const wallet = walletInput.trim();
    if (!key && !wallet) {
      setBalanceError('Paste your Pro key or enter your wallet address — one of the two.');
      return;
    }
    if (key && !key.startsWith('pp_live_')) {
      setBalanceError('That does not look like a Pro key — it starts with pp_live_.');
      return;
    }
    if (!key && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      setBalanceError('That wallet address does not look right — it should start with 0x and be 42 characters long.');
      return;
    }
    setBalanceBusy(true);
    setBalanceError('');
    setHistoryError('');
    try {
      const qs = key ? `key=${encodeURIComponent(key)}` : `wallet=${encodeURIComponent(wallet)}`;
      const [bRes, hRes] = await Promise.all([
        fetch(`/api/credits/balance?${qs}`),
        fetch(`/api/credits/history?${qs}`),
      ]);
      const bBody = (await bRes.json().catch(() => null)) as (BalanceData & { error?: string }) | null;
      if (!bRes.ok || !bBody || typeof bBody.balanceCents !== 'number') {
        setBalanceError(typeof bBody?.error === 'string' ? bBody.error : 'Could not load your balance. Check the key or address and try again.');
        setBalance(null);
      } else {
        setBalance(bBody);
      }
      const hBody = (await hRes.json().catch(() => null)) as { rows?: HistoryRow[]; entries?: HistoryRow[] } | null;
      const rows = hBody?.entries ?? hBody?.rows;
      if (hRes.ok && rows) setHistory(rows);
      else setHistoryError('History could not be loaded right now.');
    } catch {
      setBalanceError('Could not reach the server. Check your connection and try again.');
      setBalance(null);
    } finally {
      setBalanceBusy(false);
    }
  }

  async function claim() {
    const wallet = (isConnected && connectedWallet ? connectedWallet : claimWallet.trim());
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      setClaimError('Connect your wallet above, or enter your wallet address — it should start with 0x and be 42 characters long.');
      return;
    }
    if (!whatBuilding.trim()) {
      setClaimError('Tell us what you are building — one short sentence is enough.');
      return;
    }
    const key = claimKey.trim();
    if (key && !key.startsWith('pp_live_')) {
      setClaimError('That does not look like a Pro key — it starts with pp_live_.');
      return;
    }
    setClaimBusy(true);
    setClaimStep('');
    setClaimError('');
    setClaimResult(null);
    try {
      const { nonce, signature } = await signForPurpose(wallet, 'claim', setClaimStep);
      setClaimStep('Claiming your starter credits…');
      const res = await fetch('/api/credits/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet, key: key || undefined, whatBuilding: whatBuilding.trim(), signature, nonce }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reason?: string;
        amountCents?: number;
        balanceCents?: number;
        expiresAt?: string | null;
      } | null;
      if (!res.ok || !body?.ok) {
        if (res.status === 409 || body?.reason === 'already_claimed') {
          setClaimError('This wallet already claimed its starter credits. One $25 starter balance per wallet — check your balance above instead.');
        } else {
          setClaimError(typeof body?.reason === 'string' ? body.reason : 'Could not claim your credits. Check the details and try again.');
        }
        return;
      }
      setClaimResult({ balanceCents: body.balanceCents ?? body.amountCents ?? STARTER_CENTS, expiresAt: body.expiresAt ?? null });
    } catch (e: unknown) {
      setClaimError(e instanceof Error ? e.message : 'Could not claim your credits. Try again.');
    } finally {
      setClaimBusy(false);
      setClaimStep('');
    }
  }

  // Live top-up quote: re-price when the asset or amount changes.
  useEffect(() => {
    const amount = topupAmount.trim();
    if (!amount) {
      setQuote(null);
      setQuoteError('');
      setQuoteBusy(false);
      return;
    }
    if (!/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) {
      setQuote(null);
      setQuoteError('Enter an amount as a positive number, e.g. 0.01.');
      setQuoteBusy(false);
      return;
    }
    let cancelled = false;
    setQuoteBusy(true);
    setQuoteError('');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/credits/topup/quote?asset=${topupAsset}&amount=${encodeURIComponent(amount)}`);
          const body = (await res.json().catch(() => null)) as (TopupQuote & { error?: string }) | null;
          if (cancelled) return;
          if (!res.ok || !body || typeof body.estimatedCents !== 'number') {
            setQuote(null);
            setQuoteError(typeof body?.error === 'string' ? body.error : 'Could not price this right now. Try again in a moment.');
          } else {
            setQuote(body);
          }
        } catch {
          if (!cancelled) {
            setQuote(null);
            setQuoteError('Could not reach the server. Check your connection and try again.');
          }
        } finally {
          if (!cancelled) setQuoteBusy(false);
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [topupAsset, topupAmount]);

  async function submitTopup() {
    const wallet = connectedWallet;
    if (!isConnected || !wallet) {
      setTopupError('Connect your wallet above first — the payment must come from the wallet you connect.');
      return;
    }
    const txHash = topupTxHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      setTopupError('That does not look like a transaction hash — it should start with 0x and be 66 characters long.');
      return;
    }
    const key = topupKey.trim();
    if (key && !key.startsWith('pp_live_')) {
      setTopupError('That does not look like a Pro key — it starts with pp_live_.');
      return;
    }
    setTopupBusy(true);
    setTopupStep('');
    setTopupError('');
    setTopupResult(null);
    try {
      const { nonce, signature } = await signForPurpose(wallet, 'topup', setTopupStep);
      setTopupStep('Checking your payment on-chain…');
      const res = await fetch('/api/credits/topup/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash, asset: topupAsset, wallet, key: key || undefined, nonce, signature }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reason?: string;
        amountCents?: number;
        matchedCents?: number;
        balanceAfterCents?: number;
      } | null;
      if (!res.ok || !body?.ok) {
        setTopupError(typeof body?.reason === 'string' ? body.reason : 'Could not confirm this payment. Check the details and try again.');
        return;
      }
      setTopupResult({
        amountCents: body.amountCents ?? 0,
        matchedCents: body.matchedCents ?? 0,
        balanceAfterCents: body.balanceAfterCents ?? 0,
        txHash,
        asset: topupAsset,
      });
      // Refresh the balance shown above, if one was looked up.
      if (keyInput.trim() || walletInput.trim()) void checkBalance();
    } catch (e: unknown) {
      setTopupError(e instanceof Error ? e.message : 'Could not confirm this payment. Try again.');
    } finally {
      setTopupBusy(false);
      setTopupStep('');
    }
  }

  async function submitLinkKey() {
    const wallet = (isConnected && connectedWallet ? connectedWallet : claimWallet.trim());
    const key = linkKey.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      setLinkError('Connect the wallet that holds the credits first.');
      return;
    }
    if (!key.startsWith('pp_live_')) {
      setLinkError('Paste your Pro key — it starts with pp_live_.');
      return;
    }
    setLinkBusy(true);
    setLinkStep('');
    setLinkError('');
    setLinkResult(null);
    try {
      const { nonce, signature } = await signForPurpose(wallet, 'link-key', setLinkStep);
      setLinkStep('Moving your balance…');
      const res = await fetch('/api/credits/link-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet, key, nonce, signature }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; movedCents?: number; balanceAfterCents?: number } | null;
      if (!res.ok || !body?.ok) {
        setLinkError(typeof body?.reason === 'string' ? body.reason : 'Could not move the balance. Check the wallet and key and try again.');
        return;
      }
      setLinkResult({ movedCents: body.movedCents ?? 0, balanceAfterCents: body.balanceAfterCents ?? 0 });
    } catch (e: unknown) {
      setLinkError(e instanceof Error ? e.message : 'Could not move the balance. Try again.');
    } finally {
      setLinkBusy(false);
      setLinkStep('');
    }
  }

  async function grant() {
    const subject = grantSubject.trim();
    const dollars = Number(grantDollars);
    if (!subject) {
      setGrantError('Enter who gets the credits — a wallet address (0x…) or a key subject.');
      return;
    }
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setGrantError('Enter an amount in dollars, more than $0.');
      return;
    }
    if (!grantReason.trim()) {
      setGrantError('Add a short reason — it is saved with the grant.');
      return;
    }
    setGrantBusy(true);
    setGrantError('');
    setGrantResult(null);
    try {
      const res = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject, amountCents: Math.round(dollars * 100), reason: grantReason.trim(), kind: grantKind }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; balanceAfterCents?: number; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setGrantError(typeof body?.error === 'string' ? body.error : 'Could not grant the credits.');
        return;
      }
      setGrantResult(body.balanceAfterCents ?? 0);
      void loadOverview();
    } catch {
      setGrantError('Could not reach the server.');
    } finally {
      setGrantBusy(false);
    }
  }

  const buysAt1c = balance ? Math.floor(balance.availableCents / REPORT_CENTS) : 0;
  const buysCto = balance ? Math.floor(balance.availableCents / CTO_CENTS) : 0;

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      {/* Hero — big white fun card. Free $25 starter front and center. */}
      <div className="overflow-hidden rounded-3xl bg-white p-6 text-black shadow-2xl sm:p-8">
        <p className="text-[12px] font-bold tracking-widest text-neutral-500 uppercase">✦ Poly credits</p>
        <p className="mt-2 text-4xl leading-none font-extrabold tracking-tight sm:text-6xl">
          Get your free <span className="text-[#00a651]">$25</span> today!!
        </p>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-neutral-600">
          Free starter credits for pay-per-call agent tools — a token report, a fund NAV check, or
          a CTO report. That&apos;s 2,500 token reports or 500 CTO reports, free. No crypto needed.
          One $25 starter per wallet, good for 6 months.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href="#claim-credits"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#00E676] px-6 py-3.5 text-[15px] font-bold text-black shadow-lg transition-colors hover:bg-[#00d166]"
          >
            Claim your free $25 →
          </a>
          <a
            href="/x402"
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-neutral-100"
          >
            See what credits buy →
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-semibold text-neutral-700">100 credits = $1</span>
          <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-semibold text-neutral-700">$0.01 per token report</span>
          <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-semibold text-neutral-700">$0.05 per CTO report</span>
          <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-semibold text-neutral-700">Not a token — nothing in MetaMask</span>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-neutral-500">
          Credits are not money: they have no cash value and cannot be cashed out or transferred
          to another person.
        </p>
      </div>

      {/* How it works — 3 big step cards */}
      <div>
        <h2 className="text-lg font-semibold text-white sm:text-xl">How it works</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-3xl font-extrabold text-[#00E676]">1</p>
            <p className="mt-2 text-[15px] font-semibold text-white">Connect your wallet</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              Connect the wallet you want the credits on. Signing proves it&apos;s yours — it moves
              nothing and costs nothing.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-3xl font-extrabold text-[#00E676]">2</p>
            <p className="mt-2 text-[15px] font-semibold text-white">Claim $25 free</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              Say one line about what you&apos;re building and sign. Your $25 in credits lands right
              away and lasts 6 months.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-3xl font-extrabold text-[#00E676]">3</p>
            <p className="mt-2 text-[15px] font-semibold text-white">Spend on agent tools</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              Every pay-per-call report takes its price from your credits first — $0.01 for a token
              report or fund NAV, $0.05 for a CTO report.
            </p>
          </div>
        </div>
      </div>

      <BeginnerStart compact />

      {/* Connect wallet */}
      <Section title="Connect your wallet">
        <p className="text-[13px] leading-relaxed text-white/60">
          Claiming credits and moving them onto a Pro key both need your wallet — you sign a short
          message to prove the wallet is yours. Signing moves nothing and costs nothing.
        </p>
        <div className="mt-3">
          <ConnectButton chainStatus="none" showBalance={false} />
        </div>
        {isConnected && connectedWallet && (
          <p className="mt-2 text-[13px] text-white/70">
            Connected: <span className="font-mono text-[12px]">{shortAddr(connectedWallet)}</span>
          </p>
        )}
      </Section>

      {/* Balance lookup */}
      <Section title="Your balance">
        <p className="text-[13px] leading-relaxed text-white/60">
          Paste your Pro key (a Pro key is the <span className="font-mono text-[12px]">pp_live_…</span> key
          from <Link href="/agents/accounts" className="text-[#00E676] hover:underline">/agents/accounts</Link> that
          identifies your agent) or enter your wallet address (your wallet is your crypto account —
          its address starts with 0x). Your key is sent once to look it up and is never stored on
          this page or shown back to you.
        </p>
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[13px] font-medium text-white">Pro key</span>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="pp_live_…"
                className="flex-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button variant="outline" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</Button>
            </div>
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-white">Or wallet address</span>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                placeholder="0x…"
                className="flex-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              {isConnected && connectedWallet && (
                <Button variant="outline" onClick={() => setWalletInput(connectedWallet)}>Use my connected wallet</Button>
              )}
            </div>
          </label>
          <div>
            <Button onClick={checkBalance} disabled={balanceBusy || (!keyInput.trim() && !walletInput.trim())}>
              {balanceBusy ? 'Checking…' : 'Show my balance'}
            </Button>
          </div>
        </div>
        {balanceError && <p className="mt-3 text-[13px] text-white/80" role="alert">{balanceError}</p>}
        {!balance && !balanceError && (
          <div className="mt-4 rounded-2xl border border-dashed border-white/15 p-4 text-center">
            <p className="text-[14px] font-medium text-white">No balance shown yet</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              {isConnected && connectedWallet
                ? 'Tap “Use my connected wallet”, then “Show my balance” — or claim your free $25 below.'
                : 'Connect your wallet above, or paste a Pro key or wallet address, to see a balance.'}
            </p>
          </div>
        )}
        {balance && (
          <div className="mt-4 overflow-hidden rounded-3xl bg-white p-5 text-black shadow-xl sm:p-6">
            <p className="text-[12px] font-bold tracking-widest text-neutral-500 uppercase">Your Poly credits</p>
            <p className="mt-1 text-5xl font-extrabold tracking-tight sm:text-6xl">{usd(balance.balanceCents)}</p>
            {balance.key?.revoked && (
              <p className="mt-1 text-[13px] text-neutral-700">This Pro key is revoked — history only, it can no longer spend.</p>
            )}
            <p className="mt-1 text-[13px] text-neutral-600">
              {balance.expired
                ? 'These credits have expired.'
                : balance.expiresAt
                  ? `Expires ${fmtDate(balance.expiresAt)} — use them before then, or they disappear.`
                  : 'No expiry set.'}
            </p>
            {!balance.expired && balance.availableCents > 0 && (
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-700">
                That buys about <span className="font-bold text-black">{buysAt1c.toLocaleString()} token reports or fund NAV checks</span> at
                $0.01 each, or about <span className="font-bold text-black">{buysCto.toLocaleString()} CTO reports</span> at
                $0.05 each. <Link href="/x402" className="font-semibold text-[#00a651] hover:underline">See pay-per-call →</Link>
              </p>
            )}
            {balance.balanceCents === 0 && !balance.expired && (
              <p className="mt-2 text-[13px] text-neutral-600">
                No credits yet — claim your $25 starter balance below.
              </p>
            )}
          </div>
        )}

        {/* Transaction history */}
        {balance && (
          <div className="mt-4">
            <h3 className="text-[13px] font-semibold text-white">Your history</h3>
            {historyError && <p className="mt-1 text-[12px] text-white/50">{historyError}</p>}
            {history && history.length === 0 && (
              <p className="mt-1 text-[13px] text-white/60">Nothing yet — grants and spending will show up here.</p>
            )}
            {history && history.length > 0 && (
              <ul className="mt-2 divide-y divide-white/5">
                {history.map((row, i) => (
                  <li key={`${row.createdAt}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[13px]">
                    <span className="text-white/80">
                      {kindLabel(row.kind)}
                      {row.productId ? <span className="ml-1 font-mono text-[12px] text-white/50">{row.productId}</span> : null}
                      {row.reason ? <span className="ml-1 text-white/50">· {row.reason}</span> : null}
                    </span>
                    <span className="text-white/50">
                      <span className={row.amountCents < 0 ? 'text-white/80' : 'text-[#00E676]'}>
                        {row.amountCents > 0 ? '+' : ''}{usd(row.amountCents)}
                      </span>
                      {' · '}
                      {new Date(row.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {' · balance '}
                      {usd(row.balanceAfterCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      {/* Claim form */}
      <Section title="Claim your $25 starter credits" id="claim-credits">
        <p className="text-[13px] leading-relaxed text-white/60">
          One starter balance per wallet, $25, good for 6 months from the day you claim it. It is
          approved on the spot — no waiting, no email. Your wallet will ask you to sign a short
          message to prove the wallet is yours — signing moves nothing and costs nothing. If your
          wallet already claimed, we will tell you instead of giving it twice.
        </p>
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[13px] font-medium text-white">Wallet address</span>
            <Input
              value={isConnected && connectedWallet ? connectedWallet : claimWallet}
              onChange={(e) => setClaimWallet(e.target.value)}
              placeholder="0x… — connect your wallet above to fill this in"
              className="mt-1 font-mono"
              autoComplete="off"
              spellCheck={false}
              disabled={isConnected && !!connectedWallet}
            />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-white">Pro key (optional)</span>
            <Input
              type="password"
              value={claimKey}
              onChange={(e) => setClaimKey(e.target.value)}
              placeholder="pp_live_… — links the credits to your key as well"
              className="mt-1 font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-white">What are you building?</span>
            <Input
              value={whatBuilding}
              onChange={(e) => setWhatBuilding(e.target.value)}
              placeholder="e.g. An agent that checks token prices every morning"
              className="mt-1"
              autoComplete="off"
              maxLength={500}
            />
          </label>
          <div>
            {!isConnected ? (
              <div className="flex flex-wrap items-center gap-3">
                <ConnectButton chainStatus="none" showBalance={false} />
                <span className="text-[12px] text-white/50">Connect your wallet to claim.</span>
              </div>
            ) : (
              <Button size="lg" className="h-12 rounded-full px-6 text-[15px] font-bold" onClick={claim} disabled={claimBusy || signing}>{claimBusy || signing ? 'Waiting…' : 'Sign & claim $25 in credits'}</Button>
            )}
          </div>
          {claimStep && <p className="text-[13px] text-white/60" role="status">{claimStep}</p>}
        </div>
        {claimError && <p className="mt-3 text-[13px] text-white/80" role="alert">{claimError}</p>}
        {claimResult && (
          <p className="mt-3 rounded-xl bg-[#00E676]/10 p-3 text-[13px] leading-relaxed text-white" role="status">
            Done — your balance is now {usd(claimResult.balanceCents)} in Poly credits
            {claimResult.expiresAt ? `, good until ${fmtDate(claimResult.expiresAt)}` : ''}. Try a
            token report or a fund NAV check — it costs $0.01.
          </p>
        )}
      </Section>

      {/* Link key */}
      <Section title="Move a wallet balance onto a Pro key">
        <p className="text-[13px] leading-relaxed text-white/60">
          Claimed credits on your wallet but want your agent&apos;s Pro key to spend them? Move the
          whole wallet balance onto the key. After the move, the wallet balance is $0 and the key
          holds the credits — this is one-way, the credits cannot be moved back. Your wallet will
          ask you to sign a short message to prove the wallet is yours.
        </p>
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[13px] font-medium text-white">Pro key (where the credits go)</span>
            <Input
              type="password"
              value={linkKey}
              onChange={(e) => setLinkKey(e.target.value)}
              placeholder="pp_live_…"
              className="mt-1 font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div>
            {!isConnected ? (
              <div className="flex flex-wrap items-center gap-3">
                <ConnectButton chainStatus="none" showBalance={false} />
                <span className="text-[12px] text-white/50">Connect the wallet that holds the credits to move them.</span>
              </div>
            ) : (
              <Button variant="outline" onClick={submitLinkKey} disabled={linkBusy || signing}>
                {linkBusy || signing ? 'Waiting…' : `Sign & move ${connectedWallet ? shortAddr(connectedWallet) : 'wallet'} balance to key`}
              </Button>
            )}
          </div>
          {linkStep && <p className="text-[13px] text-white/60" role="status">{linkStep}</p>}
        </div>
        {linkError && <p className="mt-3 text-[13px] text-white/80" role="alert">{linkError}</p>}
        {linkResult && (
          <p className="mt-3 rounded-xl bg-[#00E676]/10 p-3 text-[13px] text-white" role="status">
            Moved {usd(linkResult.movedCents)} onto your Pro key — it now holds {usd(linkResult.balanceAfterCents)}. Your wallet balance is now $0.
          </p>
        )}
      </Section>

      {/* Buy credits */}
      <Section title="Buy credits">
        <div id="buy-credits" className="scroll-mt-6">
          <p className="text-[13px] leading-relaxed text-white/60">
            Out of starter credits? Buy more with ETH or POLYDASH — crypto you already hold. 100
            credits = $1. You send the payment yourself, then paste the transaction hash (the long
            0x… code your wallet shows after you send) and sign a message to prove the wallet that
            paid is yours. We check the payment on-chain before the credits land.
          </p>
          <ol className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-white/70">
            <li>
              <span className="font-semibold text-white">1. Send ETH or POLYDASH</span> to the
              address below, from your connected wallet.
            </li>
            <li>
              <span className="font-semibold text-white">2. Paste the transaction hash</span> from
              that payment below.
            </li>
            <li>
              <span className="font-semibold text-white">3. Sign to prove it is yours, then submit.</span>{' '}
              Your wallet will ask you to sign a short message — signing moves nothing and costs
              nothing. The credits land once we confirm the payment.
            </li>
          </ol>

          <div className="mt-4 space-y-2">
            <div>
              <span className="text-[13px] font-medium text-white">Pay with</span>
              <div className="mt-1 flex gap-2" role="group" aria-label="Asset to pay with">
                {(['ETH', 'POLYDASH'] as const).map((a) => (
                  <Button
                    key={a}
                    type="button"
                    variant={topupAsset === a ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={topupAsset === a}
                    onClick={() => setTopupAsset(a)}
                  >
                    {a}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-white/50">
                {topupAsset === 'ETH'
                  ? 'ETH is the money used on Robinhood Chain.'
                  : 'POLYDASH is Polypad’s own token.'}
              </p>
            </div>

            <label className="block">
              <span className="text-[13px] font-medium text-white">Amount to send ({topupAsset})</span>
              <Input
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder={topupAsset === 'ETH' ? '0.01' : '1000'}
                inputMode="decimal"
                className="mt-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            {quoteBusy && <p className="text-[13px] text-white/60" role="status">Getting a price…</p>}
            {quoteError && <p className="text-[13px] text-white/80" role="alert">{quoteError}</p>}
            {!quoteBusy && !quoteError && !quote && topupAmount.trim() === '' && (
              <p className="text-[13px] text-white/50">Enter an amount to see what it is worth in credits.</p>
            )}
            {quote && (
              <div className="rounded-xl bg-white/[0.03] p-4">
                <p className="text-[12px] font-medium tracking-wide text-white/50 uppercase">Estimated credits</p>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {quote.estimatedCents.toLocaleString()} credits · {usd(quote.estimatedCents)}
                </p>
                <p className="mt-1 text-[13px] text-white/60">
                  {quote.amount} {quote.asset} is worth about ${typeof quote.usdValue === 'number' ? quote.usdValue.toFixed(2) : quote.usdValue} right
                  now (1 {quote.asset} ≈ ${typeof quote.priceUsd === 'number' ? quote.priceUsd.toFixed(2) : quote.priceUsd}).
                </p>
                <p className="mt-1 text-[12px] text-white/50">
                  This is an estimate — the exact amount is set when we confirm your payment.
                </p>
              </div>
            )}

            <div>
              <span className="text-[13px] font-medium text-white">Send to this address</span>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <Input value={TOPUP_RECIPIENT} readOnly className="flex-1 font-mono text-[12px]" aria-label="Address to send the payment to" />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(TOPUP_RECIPIENT).then(() => {
                      setCopiedRecipient(true);
                      setTimeout(() => setCopiedRecipient(false), 2000);
                    }).catch(() => setCopiedRecipient(false));
                  }}
                >
                  {copiedRecipient ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-white/50">
                This is the Polypad fee wallet. Send only {topupAsset} on Robinhood Chain to this
                address — anything else, or a payment to a different address, buys no credits. You
                also need a little extra ETH for the network fee (gas).
              </p>
            </div>

            <label className="block">
              <span className="text-[13px] font-medium text-white">Transaction hash</span>
              <Input
                value={topupTxHash}
                onChange={(e) => setTopupTxHash(e.target.value)}
                placeholder="0x… — the hash from the payment you just sent"
                className="mt-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label className="block">
              <span className="text-[13px] font-medium text-white">Pro key (optional)</span>
              <Input
                type="password"
                value={topupKey}
                onChange={(e) => setTopupKey(e.target.value)}
                placeholder="pp_live_… — credits land on this key instead of your wallet"
                className="mt-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="mt-1 block text-[12px] leading-relaxed text-white/50">
                Leave this blank and the credits land on your wallet. Your key is sent once to
                credit it and is never stored on this page or shown back to you.
              </span>
            </label>

            <div>
              {!isConnected ? (
                <div className="flex flex-wrap items-center gap-3">
                  <ConnectButton chainStatus="none" showBalance={false} />
                  <span className="text-[12px] text-white/50">Connect your wallet to buy credits.</span>
                </div>
              ) : (
                <Button onClick={submitTopup} disabled={topupBusy || signing || !topupTxHash.trim()}>
                  {topupBusy || signing ? 'Waiting…' : 'Sign & confirm my payment'}
                </Button>
              )}
            </div>
            {topupStep && <p className="text-[13px] text-white/60" role="status">{topupStep}</p>}
          </div>
          {topupError && <p className="mt-3 text-[13px] text-white/80" role="alert">{topupError}</p>}
          {topupResult && (
            <div className="mt-3 rounded-xl bg-[#00E676]/10 p-3 text-[13px] leading-relaxed text-white" role="status">
              <p>
                Done — we credited {usd(topupResult.amountCents)} in Poly credits for your {topupResult.asset} payment.
                Your new balance is {usd(topupResult.balanceAfterCents)}.
              </p>
              {topupResult.matchedCents > 0 && (
                <p className="mt-1">That includes {usd(topupResult.matchedCents)} matched on top.</p>
              )}
              <p className="mt-1 text-white/70">
                A payment buys credits once — submitting the same transaction again will tell you it
                was already credited.
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* Where to use them */}
      <p className="text-[13px] leading-relaxed text-white/60">
        Questions? <Link href="/x402" className="font-medium text-[#00E676] hover:underline">Pay-per-call marketplace</Link> ·{' '}
        <Link href="/agents/accounts" className="font-medium text-[#00E676] hover:underline">Get a Pro key</Link> ·{' '}
        <Link href="/agents/usage" className="font-medium text-[#00E676] hover:underline">Check your API usage</Link>
      </p>

      <GlossaryBox
        terms={[
          { term: 'Top-up', def: 'Paying ETH or POLYDASH to buy more Poly credits. 100 credits = $1. The payment is checked on-chain before the credits land.' },
          { term: 'Poly credits', def: 'Free credits from Polypad that pay for pay-per-call reports. 100 credits = $1. They have no cash value and cannot be cashed out.' },
          { term: 'Pro API key', def: 'A key starting with pp_live_ that identifies your agent to Polypad. It buys higher API limits. You get one free from /agents/accounts — it is shown once, so save it.' },
          { term: 'Token report', def: 'A one-page report on a token: price, liquidity, holders, and risks. Costs $0.01 per report, paid with Poly credits or on-chain.' },
          { term: 'CTO report', def: 'A report on a token launch: the launch details plus a plain-English check of the contract and the team. Costs $0.05 per report.' },
          { term: 'NAV', def: 'The value of one Tokenized Fund share right now — the fund’s total value divided by the number of shares. A fund NAV check costs $0.01.' },
          { term: 'Expiry', def: 'The date your credits stop working. Starter credits expire 6 months after you claim them. Unused credits after expiry are gone.' },
          { term: 'Starter balance', def: 'The free $25 in Poly credits every new wallet can claim once. It lasts 6 months from the day you claim it.' },
          { term: 'Pay-per-call', def: 'Paying a small fixed price for one report at a time — $0.01 for a token report or fund NAV, $0.05 for a CTO report — instead of a monthly subscription.' },
        ]}
      />

      {/* Admin-only section */}
      {isAdmin && (
        <section className="rounded-2xl border border-amber-400/40 bg-amber-400/[0.05] p-4 sm:p-5">
          <h2 className="text-[15px] font-medium text-white">Admin — Poly credits</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-white/50">
            Only visible to the Polypad admin. Grant credits and see what Polypad owes in
            outstanding credits.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadOverview}>Load outstanding total</Button>
            <Button variant="outline" size="sm" onClick={sweepExpired} disabled={sweepBusy}>{sweepBusy ? 'Sweeping…' : 'Sweep expired accounts'}</Button>
          </div>
          {overviewError && <p className="mt-2 text-[13px] text-white/80" role="alert">{overviewError}</p>}
          {sweepResult && <p className="mt-2 text-[13px] text-white" role="status">{sweepResult}</p>}
          {overview && (
            <div className="mt-3 rounded-xl bg-white/[0.03] p-4">
              <p className="text-[12px] font-medium tracking-wide text-white/50 uppercase">Outstanding liability</p>
              <p className="mt-1 text-2xl font-semibold text-white">{usd(overview.totalOutstandingLiabilityCents)}</p>
              <p className="mt-1 text-[13px] text-white/60">
                {overview.liveAccounts.toLocaleString()} accounts hold credits.
              </p>
              {overview.recentLedger.length > 0 && (
                <ul className="mt-3 divide-y divide-white/5 text-[12px]">
                  {overview.recentLedger.map((row, i) => (
                    <li key={`${row.createdAt}-${i}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span className="font-mono text-white/70">{row.subject}</span>
                      <span className="text-white/50">
                        {kindLabel(row.kind)} {row.amountCents > 0 ? '+' : ''}{usd(row.amountCents)}
                        {row.reason ? ` · ${row.reason}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mt-4 space-y-2">
            <label className="block">
              <span className="text-[13px] font-medium text-white">Who gets credits — wallet address (0x…) or key subject</span>
              <Input value={grantSubject} onChange={(e) => setGrantSubject(e.target.value)} placeholder="0x… or key:…" className="mt-1 font-mono" autoComplete="off" spellCheck={false} />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="block flex-1">
                <span className="text-[13px] font-medium text-white">Amount ($)</span>
                <Input value={grantDollars} onChange={(e) => setGrantDollars(e.target.value)} placeholder="25" inputMode="decimal" className="mt-1 font-mono" />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium text-white">Type</span>
                <select
                  value={grantKind}
                  onChange={(e) => setGrantKind(e.target.value as 'grant' | 'topup')}
                  className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white"
                >
                  <option value="grant">Grant</option>
                  <option value="topup">Top-up (match path)</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-[13px] font-medium text-white">Reason (saved with the grant)</span>
              <Input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="e.g. Goodwill for a launch partner" className="mt-1" />
            </label>
            <div>
              <Button onClick={grant} disabled={grantBusy}>{grantBusy ? 'Granting…' : 'Grant credits'}</Button>
            </div>
          </div>
          {grantError && <p className="mt-3 text-[13px] text-white/80" role="alert">{grantError}</p>}
          {grantResult !== null && (
            <p className="mt-3 text-[13px] text-white" role="status">
              Granted. New balance: {usd(grantResult)}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
