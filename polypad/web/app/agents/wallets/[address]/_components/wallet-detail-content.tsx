'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient, useSendTransaction } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatUnits, getAddress, isAddress, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSpendingKeys } from '@/lib/agents/spend-vault';
import { robinhoodChain } from '@/lib/chain';
import {
  buildReceipt, explorerAddress, explorerTx, formatEthShort, getGasBudget, isFactoryLive,
  isGasLow, setGasBudget, useSafeOwnerCall, usdg,
  // v2 (Nov 21, 2026): daily-cap-only module + ERC-8004 identity + 4337 path.
  isFactoryV2Live, useSafeOwnerCallV2,
  useWalletIdentity, useWalletServerState,
  type Addr, type VerifiableReceipt, type WalletActivityItem, type WalletPolicy, type WalletPolicyV2,
} from '@/lib/agent-wallet/client';
import { HonestLimitsBox } from '../../_components/honest-limits';
import { AgentCard, AgentCardSub, AgentCardTitle, AgentStat, NeedsYou, OwnerAgentSplit, PageHero, StepsRow } from '../../../_components/agent-cards';
import { CheckingAccount } from './checking-account';

interface ApprovalRow {
  id: string;
  wallet: string;
  owner: string;
  title: string;
  description: string;
  to: string;
  value: string;
  data: string;
  status: string;
  requestedBy: string;
  createdAt: string;
  decisionTxHash: string | null;
}

function useApprovals(safe: string | undefined) {
  return useQuery({
    queryKey: ['agent-wallets', 'approvals', safe?.toLowerCase()],
    enabled: !!safe && isAddress(safe, { strict: false }),
    refetchInterval: 30_000,
    queryFn: async (): Promise<ApprovalRow[]> => {
      const r = await fetch(`/api/agents/wallets/approvals?wallet=${safe}`);
      if (!r.ok) return [];
      const j = await r.json().catch(() => null);
      return Array.isArray(j?.approvals) ? (j.approvals as ApprovalRow[]) : [];
    },
  });
}

function ReceiptCard({ receipt }: { receipt: VerifiableReceipt }) {
  const rows: [string, string][] = [
    ['Identity — who acted', receipt.identity],
    ['Authority — what allowed it', receipt.authority],
    ['Approval — how it was approved', receipt.approval],
    ['Settlement — on-chain proof', `${receipt.settlement.status === 'success' ? 'Confirmed' : 'Reverted'} · block ${receipt.settlement.blockNumber.toString()}`],
  ];

  return (
    <div className="mt-2 rounded-xl bg-black/40 p-3">
      {rows.map(([k, v]) => (
        <p key={k} className="mt-1 text-[12px] leading-relaxed text-white/70 first:mt-0">
          <span className="font-medium text-white">{k}:</span> {v}
        </p>
      ))}
      <p className="mt-2 text-[12px]">
        <a className="font-mono text-polydash-green hover:underline" href={explorerTx(receipt.settlement.txHash)} target="_blank" rel="noopener noreferrer">
          {shortenAddress(receipt.settlement.txHash)} ↗
        </a>
      </p>
    </div>
  );
}

function ActivityRow({ item, policyText }: { item: WalletActivityItem; policyText: string }) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [receipt, setReceipt] = useState<VerifiableReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function showReceipt() {
    if (receipt) { setOpen((v) => !v); return; }
    if (!client) return;
    setLoading(true);
    try {
      const r = await buildReceipt(client, item, policyText);
      setReceipt(r);
      setOpen(true);
    } catch {
      toast.error('Could not read the receipt from the chain.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] leading-relaxed text-white/80">{item.label}</p>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">block {item.blockNumber.toString()}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <a className="font-mono text-[12px] text-polydash-green hover:underline" href={explorerTx(item.txHash)} target="_blank" rel="noopener noreferrer">
          {shortenAddress(item.txHash)} ↗
        </a>
        <button type="button" className="text-[12px] text-polydash-green hover:underline" onClick={showReceipt} disabled={loading}>
          {loading ? 'Reading receipt…' : open ? 'Hide receipt' : 'Show verifiable receipt'}
        </button>
      </div>
      {open && receipt && <ReceiptCard receipt={receipt} />}
    </div>
  );
}

/** Type guard: a v1 policy carries per-payment + weekly caps; a v2 policy
 * has neither (daily cap only). */
function isV1Policy(p: WalletPolicy | WalletPolicyV2 | null | undefined): p is WalletPolicy {
  return !!p && 'perPaymentCapUsdg' in p;
}

export function WalletDetailContent({ safe: safeProp }: { safe: string }) {
  const { address } = useAccount();
  const valid = isAddress(safeProp, { strict: false });
  // Normalize once to the EIP-55 checksum: the URL casing may not be
  // canonical (a link or bookmark can carry any casing), and viem rejects
  // non-checksummed addresses in every readContract/write call — which made
  // the whole page error on a wrongly-cased URL. getAddress throws on
  // invalid input, so only call it when the address is valid; every
  // downstream use (hooks, owner calls, explorer links) takes this value.
  const safe = valid ? getAddress(safeProp) : safeProp;
  // All chain reads come from the server route now (Nov 23, 2026): the
  // browser's path to the official RPC fails, so the balance, policy, and
  // stake reads errored out or stuck on "…" for visitors. Identity and the
  // approval queue stay client-side (out of scope for this fix).
  const { data: serverState, isLoading: serverLoading, isError: serverError, refetch: refetchServerState } = useWalletServerState(valid ? safe : undefined);
  const isV2 = serverState?.version === 'v2';
  const walletState = serverState?.walletState;
  const walletStateLoading = serverLoading && !serverState;
  const walletStateError = serverError && !serverState;
  const retryWalletState = () => { void refetchServerState(); };
  const score = serverState?.score;
  // The v1 module stores no "current key" getter — the key comes from the
  // WalletCreated / KeyRotated events. The v2 module stores it on-chain
  // (agentKeyOf). The server returns whichever applies.
  const agentKey = serverState?.agentKey;
  const policy = serverState?.policy;
  const fromBlock = serverState?.createdBlock;
  const activity = serverState?.activity;
  const activityLoading = serverLoading && !serverState;
  const polydash = serverState?.polydash;
  const ledger = serverState?.ledger;
  const polyCap = serverState?.polyCap;
  const { data: identity, refetch: refetchIdentity } = useWalletIdentity(valid ? safe : undefined, fromBlock);
  const { data: approvals, refetch: refetchApprovals } = useApprovals(valid ? safe : undefined);
  const { setFrozen, revokeAgentKey, rotateAgentKey, setCaps, execViaSafe } = useSafeOwnerCall();
  const { setFrozen: setFrozenV2, revokeAgentKey: revokeAgentKeyV2, rotateAgentKey: rotateAgentKeyV2, setCaps: setCapsV2, linkIdentity, stakePolydash } = useSafeOwnerCallV2();
  const { revokeKey: revokeVaultKey } = useSpendingKeys();
  const { sendTransactionAsync } = useSendTransaction();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Key rotation state — new key in page state only, same shown-once gate.
  const [newKey, setNewKey] = useState<`0x${string}` | null>(null);
  const [newKeyAddress, setNewKeyAddress] = useState<Addr | null>(null);
  const [newKeySaved, setNewKeySaved] = useState(false);

  // Stake POLYDASH state — amount the owner wants to stake from the wallet.
  const [stakeAmount, setStakeAmount] = useState('');

  // Caps editor state.
  const [capPer, setCapPer] = useState('');
  const [capDaily, setCapDaily] = useState('');
  const [capWeekly, setCapWeekly] = useState('');
  const [capStart, setCapStart] = useState('');
  const [capEnd, setCapEnd] = useState('');

  // Gas state.
  const [gasBudget, setGasBudgetState] = useState(() => getGasBudget(safe));
  const [topUpAmount, setTopUpAmount] = useState('0.005');

  // Approval queue form state.
  const [apprTitle, setApprTitle] = useState('');
  const [apprTo, setApprTo] = useState('');
  const [apprValue, setApprValue] = useState('0');
  const [apprDesc, setApprDesc] = useState('');

  useEffect(() => {
    if (policy) {
      if (isV1Policy(policy)) {
        setCapPer(formatUnits(policy.perPaymentCapUsdg, 6));
        setCapWeekly(formatUnits(policy.weeklyCapUsdg, 6));
      }
      setCapDaily(formatUnits(policy.dailyCapUsdg, 6));
      setCapStart(String(policy.startHour));
      setCapEnd(String(policy.endHour));
    }
  }, [policy?.dailyCapUsdg, isV2]);

  if (!valid) {
    return (
      <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
        <p className="text-[13px] text-red-300">That wallet address is not valid.</p>
        <Button asChild variant="outline"><Link href="/agents/wallets">Back to your fleet</Link></Button>
      </div>
    );
  }

  const frozen = walletState?.frozen === true || policy?.revoked === true;
  const gasLow = walletState ? isGasLow(walletState.eth, gasBudget.warnBelowEth) : false;
  // Narrowed v1 policy (has per-payment + weekly caps); v2 has neither.
  const v1Policy = isV1Policy(policy) ? policy : null;
  // v2 has no per-payment or weekly cap and no approval queue — the daily
  // limit is the only bound (Jon's decision 5). The receipt text says so.
  const policyText = policy
    ? isV2
      ? `Key policy at the time: up to $${usdg(policy.dailyCapUsdg)} a day — the daily limit is the only bound, no per-payment cap and no approval step; key expires ${new Date(policy.expiry * 1000).toLocaleDateString()}.`
      : v1Policy
        ? `Key policy at the time: up to $${usdg(v1Policy.perPaymentCapUsdg)} per payment, $${usdg(policy.dailyCapUsdg)} a day, $${usdg(v1Policy.weeklyCapUsdg)} a week, key expires ${new Date(policy.expiry * 1000).toLocaleDateString()}.`
        : 'No key policy found on-chain for this wallet yet.'
    : 'No key policy found on-chain for this wallet yet.';
  const pendingApprovals = (approvals ?? []).filter((a) => a.status === 'pending');

  async function guard<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setError('');
    setBusy(key);
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      const friendly = msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg;
      setError(friendly);
      toast.error(friendly);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function freezeToggle() {
    await guard('freeze', async () => {
      if (isV2) await setFrozenV2(safe as Addr, !frozen);
      else await setFrozen(safe as Addr, !frozen);
      if (!frozen) {
        try { if (agentKey) await revokeVaultKey(agentKey); } catch { /* vault key may not exist */ }
      }
      toast.success(frozen ? 'Wallet unfrozen.' : 'Wallet frozen — and the vault key revoked. Your agent cannot spend.');
    });
  }

  function generateRotationKey() {
    const pk = generatePrivateKey();
    setNewKey(pk);
    setNewKeyAddress(privateKeyToAccount(pk).address);
    setNewKeySaved(false);
  }

  async function rotate() {
    if (!newKeyAddress || !agentKey) return;
    await guard('rotate', async () => {
      if (isV2) await rotateAgentKeyV2(safe as Addr, agentKey as Addr, newKeyAddress);
      else await rotateAgentKey(safe as Addr, agentKey as Addr, newKeyAddress);
      toast.success('Agent key replaced. The old key stops working immediately — the wallet, its address, and its score are unchanged.');
      setNewKey(null); setNewKeyAddress(null); setNewKeySaved(false);
    });
  }

  async function saveCaps() {
    if (!agentKey) return;
    let day: bigint;
    try {
      day = parseUnits(capDaily.trim(), 6);
    } catch {
      setError('Enter a valid daily cap amount.');
      return;
    }
    if (day <= 0n) { setError('The daily cap must be above zero.'); return; }
    if (isV2) {
      // v2: daily cap only — no per-payment or weekly cap exists on-chain.
      if (day > parseUnits('5000', 6)) { setError('The daily cap is at most $5,000.'); return; }
      const next: { expiry: number; startHour: number; endHour: number; dailyCapUsdg: bigint } = {
        dailyCapUsdg: day,
        expiry: policy?.expiry ?? Math.floor(Date.now() / 1000) + 90 * 86400,
        startHour: Math.min(23, Math.max(0, Number(capStart) || 0)),
        endHour: Math.min(23, Math.max(0, Number(capEnd) || 0)),
      };
      await guard('caps', async () => {
        await setCapsV2(safe as Addr, agentKey as Addr, next);
        toast.success('Daily limit updated on-chain. It applies to the next action the agent takes.');
      });
      return;
    }
    let per: bigint; let week: bigint;
    try {
      per = parseUnits(capPer.trim(), 6);
      week = parseUnits(capWeekly.trim(), 6);
    } catch {
      setError('Enter valid cap amounts.');
      return;
    }
    if (per <= 0n || week <= 0n) { setError('Caps must be above zero.'); return; }
    if (per > day) { setError('The per-payment cap cannot be larger than the daily cap.'); return; }
    // Two owner-signed Safe transactions on-chain: setKeyPolicy for
    // expiry/hours, then setTokenCaps for the USDG caps.
    const next: WalletPolicy = {
      perPaymentCapUsdg: per, dailyCapUsdg: day, weeklyCapUsdg: week,
      expiry: policy?.expiry ?? Math.floor(Date.now() / 1000) + 90 * 86400,
      startHour: Math.min(23, Math.max(0, Number(capStart) || 0)),
      endHour: Math.min(23, Math.max(0, Number(capEnd) || 0)),
      allowedTargets: v1Policy?.allowedTargets ?? [],
    };
    await guard('caps', async () => {
      await setCaps(safe as Addr, agentKey as Addr, next);
      toast.success('Limits updated on-chain. They apply to the next action the agent takes.');
    });
  }

  async function linkIdentityNow() {
    await guard('link-identity', async () => {
      await linkIdentity(safe as Addr);
      toast.success('Identity linked — the wallet now owns an on-chain ERC-8004 identity. It appears here in a moment.');
      void refetchIdentity();
    });
  }

  async function stakeNow() {
    let amount: bigint;
    try {
      amount = parseUnits(stakeAmount.trim(), 18);
    } catch {
      setError('Enter a valid POLYDASH amount.');
      return;
    }
    if (amount <= 0n) { setError('Enter an amount above zero.'); return; }
    if ((polydash?.held ?? 0n) < amount) { setError('The wallet holds less POLYDASH than that.'); return; }
    // Two owner-signed Safe transactions: approve the pool, then stake.
    await guard('stake', async () => {
      await stakePolydash(safe as Addr, amount);
      toast.success(`Staked ${stakeAmount} POLYDASH into the flagship pool. Rewards accrue to the wallet.`);
      setStakeAmount('');
    });
  }

  async function saveGasBudget() {
    setGasBudget(safe, gasBudget.budgetEth, gasBudget.warnBelowEth);
    toast.success('Gas budget saved. Automatic top-ups are not built yet — top up by hand below when the warning shows.');
  }

  async function topUp() {
    await guard('topup', async () => {
      const hash = await sendTransactionAsync({ to: safe as Addr, value: parseUnits(topUpAmount, 18), chainId: robinhoodChain.id });
      toast.success(`Sent ${topUpAmount} ETH to the wallet for gas.`);
      void hash;
    });
  }

  async function submitApproval() {
    setError('');
    if (!isAddress(apprTo, { strict: false })) { setError('That destination address is not valid.'); return; }
    if (!apprTitle.trim()) { setError('Give the move a title.'); return; }
    setBusy('appr-new');
    try {
      const r = await fetch('/api/agents/wallets/approvals', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wallet: safe, owner: address, title: apprTitle.trim(), description: apprDesc.trim(),
          to: apprTo.trim(), value: apprValue.trim() || '0', data: '0x', requestedBy: address,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setError(String(j?.message ?? 'Could not queue the move.')); return; }
      toast.success('Queued — it waits here until you approve or deny it.');
      setApprTitle(''); setApprTo(''); setApprValue('0'); setApprDesc('');
      void refetchApprovals();
    } catch {
      setError('The server did not answer. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }

  async function decideApproval(row: ApprovalRow, action: 'approve' | 'deny') {
    setBusy(`appr-${row.id}`);
    try {
      let txHash: string | undefined;
      if (action === 'approve') {
        // Approving executes the move with the owner's Safe signature.
        txHash = await execViaSafe(safe as Addr, row.to as Addr, (row.data || '0x') as `0x${string}`, BigInt(row.value || '0'));
      }
      const r = await fetch(`/api/agents/wallets/approvals/${row.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, txHash }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setError(String(j?.message ?? 'Could not record the decision.')); return; }
      toast.success(action === 'approve' ? 'Approved and executed on-chain.' : 'Denied. The move will not happen.');
      void refetchApprovals();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      setError(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(null);
    }
  }

  // "Needs you" (the real Visacli Home pattern): the single thing that needs the
  // owner, in priority order — frozen first, then low gas, then an unlinked
  // identity. Each action reuses the handler the section below already has.
  const needsYou: { title: string; text: string; button: ReactNode } | null = frozen
    ? {
        title: 'Unfreeze your wallet',
        text: 'Your wallet is frozen — your agent cannot spend until you unfreeze it.',
        button: (
          <Button onClick={freezeToggle} disabled={busy !== null}>
            Unfreeze wallet
          </Button>
        ),
      }
    : gasLow
      ? {
          title: 'Top up gas',
          text: `The wallet holds ${walletState ? formatEthShort(walletState.eth) : '…'} ETH, below your warning level of ${gasBudget.warnBelowEth} ETH. Top it up so your agent never stalls.`,
          button: (
            <Button onClick={topUp} disabled={busy !== null}>
              {busy === 'topup' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send ETH to the wallet
            </Button>
          ),
        }
      : !identity
        ? {
            title: 'Link an on-chain identity',
            text: 'No identity linked yet. Linking takes one owner transaction.',
            button: (
              <Button variant="outline" onClick={linkIdentityNow} disabled={busy !== null || !isFactoryV2Live}>
                {busy === 'link-identity' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Link an on-chain identity
              </Button>
            ),
          }
        : null;

  return (
    <div className="mx-auto max-w-container space-y-6 px-5 py-6 sm:px-8 sm:py-10">
      <PageHero
        crumb={<><Link href="/agents/wallets" className="text-polydash-green hover:underline">Agent Wallets</Link> <span className="font-normal text-white/40">· wallet</span></>}
        title={
          <a className="font-mono text-polydash-green hover:underline" href={explorerAddress(safe)} target="_blank" rel="noopener noreferrer">{shortenAddress(safe)}</a>
        }
        lede="Everything about this wallet, on one page. You are the owner — the agent works inside the limits below, and you can stop it any time."
      />

      <div className="pt-4">
        <StepsRow
          steps={[
            {
              title: 'Connect your wallet',
              text: 'That\u2019s how Polypad knows the agent is yours. Connecting is free, and no money moves.',
            },
            {
              title: 'Set a daily limit',
              text: 'The most your agent can ever spend in one day. It can never spend more than that, no matter what.',
            },
            {
              title: 'Give the agent its key',
              text: 'The agent gets a session key that only works inside your limits. You keep the owner key.',
            },
          ]}
        />
      </div>

      {needsYou && (
        <NeedsYou title={needsYou.title} text={needsYou.text}>
          {needsYou.button}
        </NeedsYou>
      )}

      {error && <p className="rounded-[20px] border border-red-400/20 bg-red-400/[0.05] p-6 text-[14px] text-red-300" role="alert">{error}</p>}

      <CheckingAccount
        isV2={isV2}
        walletState={walletState}
        stateLoading={walletStateLoading}
        stateError={walletStateError}
        onRetryState={retryWalletState}
        polydash={polydash}
        policy={policy}
        agentKey={agentKey}
        ledger={ledger}
        polyCap={polyCap}
        score={score}
        frozen={frozen}
        onFreeze={freezeToggle}
        freezeBusy={busy === 'freeze'}
      />

      <OwnerAgentSplit
        ownerItems={[
          { title: 'Freeze the wallet any time', note: 'One transaction, no agent help needed.', ok: true },
          { title: 'Replace the agent key', note: 'The wallet, its address and its score stay the same — only the key changes.', ok: true },
          { title: 'Change the limits', note: 'One owner transaction, applies to the next action the agent takes.', ok: true },
        ]}
        agentItems={[
          { title: 'Small payments, to approved places', note: 'Only to the apps and contracts you allow.', ok: true },
          { title: 'Inside a daily cap, before the key expires', note: 'Up to the daily limit a day, and no more.', ok: true },
          { title: 'It can never raise its own limits', note: 'The agent key can\u2019t change the caps. Only you can.', ok: false },
        ]}
      />

      <AgentCard label="On-chain identity">
        <AgentCardTitle>On-chain identity (ERC-8004)</AgentCardTitle>
        <AgentCardSub>
          This wallet can own its own identity on-chain — a numbered agent identity that other
          agents and apps can look up and leave feedback on. The wallet itself owns it: the
          agent&apos;s identity IS its wallet address.
        </AgentCardSub>
        {identity ? (
          <div className="mt-3 rounded-xl bg-polydash-green/[0.07] p-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-white">
              <Check className="h-4 w-4 text-polydash-green" />Identity #{identity.agentId.toString()}
            </p>
            <p className="mt-1 break-all font-mono text-[12px] text-white/70">{identity.agentURI}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-white/50">
              Registered on the ERC-8004 Identity registry — anyone can verify it on the explorer.
              Feedback left on this identity feeds into the agent&apos;s Polypad credit score.
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-[13px] leading-relaxed text-white/60">
              No identity linked yet. {isV2
                ? 'This wallet was created before the identity step, or its registration at creation did not go through — linking takes one owner transaction.'
                : 'This wallet was created before identities existed — linking takes one owner transaction.'}
            </p>
            <Button variant="outline" className="mt-3" onClick={linkIdentityNow} disabled={busy !== null || !isFactoryV2Live}>
              {busy === 'link-identity' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Link an on-chain identity
            </Button>
            {!isFactoryV2Live && <p className="mt-2 text-[12px] text-amber-200/90">Linking opens once the v2 contracts are live.</p>}
          </div>
        )}
      </AgentCard>

      <AgentCard label="Activity">
        <AgentCardTitle>Activity — everything the wallet did</AgentCardTitle>
        <AgentCardSub>
          Newest first. Every row links to the block explorer, and every action has a verifiable
          receipt: who acted, what allowed it, how it was approved, and the on-chain settlement.
        </AgentCardSub>
        {activityLoading && <p className="mt-3 text-[13px] text-white/50">Reading the wallet&apos;s history from Robinhood Chain…</p>}
        {!activityLoading && !activity?.length && (
          <p className="mt-3 text-[13px] leading-relaxed text-white/50">
            No activity yet. {isFactoryLive ? 'Actions the agent takes and limits you change will show here.' : 'The wallet contracts are not live yet, so there is no on-chain activity to show.'}
          </p>
        )}
        <div className="mt-5 space-y-2">
          {activity?.map((item) => (
            <ActivityRow key={`${item.txHash}-${item.logIndex}`} item={item} policyText={policyText} />
          ))}
        </div>
      </AgentCard>

      <AgentCard label="Replace the agent key">
        <AgentCardTitle>Replace the agent key</AgentCardTitle>
        <AgentCardSub>
          Give the agent a new key without redeploying anything. The wallet, its address, its
          registration, and its score stay exactly the same — only the key changes, and the old key
          stops working the moment you confirm. The new key is made in your browser and shown once,
          exactly like in the wizard.
        </AgentCardSub>
        {!newKey ? (
          <Button variant="outline" className="mt-3" onClick={generateRotationKey} disabled={!agentKey || !isFactoryLive}>
            Generate a new agent key
          </Button>
        ) : (
          <div className="mt-3 rounded-xl bg-black/40 p-3">
            <p className="text-[12px] text-white/50">New agent key address</p>
            <p className="mt-1 font-mono text-[14px] text-white">{newKeyAddress}</p>
            <p className="mt-3 text-[12px] text-white/50">New private key — shown once. Save it now.</p>
            <pre className="mt-1 max-h-24 overflow-auto break-all rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-amber-200">{newKey}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                if (!newKey) return;
                const blob = new Blob([`POLYPAD AGENT WALLET — NEW AGENT KEY\nWallet: ${safe}\nAgent key address: ${newKeyAddress}\n\nPrivate key: ${newKey}\n\nPolypad never sees this key and cannot recover it.`], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'polypad-agent-key-rotated.txt'; a.click();
                URL.revokeObjectURL(url);
              }}>
                <Download className="mr-2 h-3.5 w-3.5" />Download backup
              </Button>
              <Button variant="outline" size="sm" onClick={async () => {
                try { await navigator.clipboard.writeText(newKey); toast.success('Copied.'); } catch { toast.error('Could not copy — select the text manually.'); }
              }}>
                <Copy className="mr-2 h-3.5 w-3.5" />Copy the key
              </Button>
            </div>
            <label className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-white/80">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-white" checked={newKeySaved} onChange={(e) => setNewKeySaved(e.target.checked)} />
              <span>I&apos;ve saved the new key.</span>
            </label>
            <Button className="mt-3" onClick={rotate} disabled={busy !== null || !newKeySaved}>
              {busy === 'rotate' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Replace the agent key
            </Button>
          </div>
        )}
      </AgentCard>

      <AgentCard label="Limits">
        <AgentCardTitle>Limits — what the agent may spend</AgentCardTitle>
        <AgentCardSub>
          {isV2 ? (
            <>Change the daily limit any time. One owner transaction, applies to the next action the
            agent takes. The agent key can never change it itself — and there is no per-payment or
            weekly cap in this version: the daily limit is the only bound.</>
          ) : (
            <>Change the caps any time. One owner transaction, applies to the next action the agent takes.
            The agent key can never change these itself.</>
          )}
        </AgentCardSub>
        <div className={cn('mt-6 grid gap-4', isV2 ? 'sm:grid-cols-1' : 'sm:grid-cols-3')}>
          {!isV2 && (
            <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] p-4">
              <label className="block text-[13px] text-white/60">
                Per-payment cap (USDG)
                <Input value={capPer} onChange={(e) => setCapPer(e.target.value)} inputMode="decimal" className="mt-2 bg-secondary/50 font-mono" />
              </label>
            </div>
          )}
          <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] p-4">
            <label className="block text-[13px] text-white/60">
              Daily cap (USDG){isV2 ? ' — $1–$5,000' : ''}
              <Input value={capDaily} onChange={(e) => setCapDaily(e.target.value)} inputMode="decimal" className="mt-2 bg-secondary/50 font-mono" />
            </label>
          </div>
          {!isV2 && (
            <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] p-4">
              <label className="block text-[13px] text-white/60">
                Weekly cap (USDG)
                <Input value={capWeekly} onChange={(e) => setCapWeekly(e.target.value)} inputMode="decimal" className="mt-2 bg-secondary/50 font-mono" />
              </label>
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] p-4">
            <label className="block text-[13px] text-white/60">
              Works from (hour, UTC, 0–23 — 0 means no window)
              <Input value={capStart} onChange={(e) => setCapStart(e.target.value)} inputMode="numeric" className="mt-2 bg-secondary/50 font-mono" />
            </label>
          </div>
          <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] p-4">
            <label className="block text-[13px] text-white/60">
              Works until (hour, UTC, 0–23)
              <Input value={capEnd} onChange={(e) => setCapEnd(e.target.value)} inputMode="numeric" className="mt-2 bg-secondary/50 font-mono" />
            </label>
          </div>
        </div>
        <Button className="mt-5" onClick={saveCaps} disabled={busy !== null || !agentKey || (!isFactoryLive && !isFactoryV2Live)}>
          {busy === 'caps' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save limits on-chain
        </Button>
      </AgentCard>

      <AgentCard label="Stake POLYDASH">
        <AgentCardTitle>Stake POLYDASH</AgentCardTitle>
        <AgentCardSub>
          Put the wallet&apos;s POLYDASH to work in the flagship POLYDASH staking pool. Staking
          earns rewards that land in the wallet. You sign — two wallet pop-ups, first Approve
          (lets the pool move that POLYDASH once), then Stake.
        </AgentCardSub>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <AgentStat label="POLYDASH in wallet" value={polydash ? formatUnits(polydash.held, 18) : '…'} />
          <AgentStat label="Already staked" value={polydash ? formatUnits(polydash.staked, 18) : '…'} />
          <AgentStat label="Rewards earned" value={polydash ? formatUnits(polydash.earned, 18) : '…'} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block text-xs text-muted-foreground">
            Amount to stake (POLYDASH)
            <Input value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} placeholder="1000" inputMode="decimal" className="mt-1 w-44 bg-secondary/50 font-mono" />
          </label>
          {polydash && polydash.held > 0n && (
            <div className="flex gap-2">
              {[25, 50, 100].map((pct) => (
                <Button key={pct} variant="outline" size="sm" onClick={() => setStakeAmount(formatUnits((polydash.held * BigInt(pct)) / 100n, 18))}>
                  {pct === 100 ? 'All' : `${pct}%`}
                </Button>
              ))}
            </div>
          )}
          <Button onClick={stakeNow} disabled={busy !== null || !stakeAmount.trim()}>
            {busy === 'stake' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Stake POLYDASH
          </Button>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-white/50">
          Your agent cannot stake on its own — that stays off unless you explicitly allowlist the
          staking pool and set a POLYDASH daily cap for its key. The button above is your move, as
          the owner.
        </p>
      </AgentCard>

      <AgentCard label="Approval queue">
        <AgentCardTitle>Approval queue — big moves wait for you {!isV2 && pendingApprovals.length > 0 && `(${pendingApprovals.length})`}</AgentCardTitle>
        {isV2 ? (
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-white/60">
            This wallet has no approval queue. It uses the limits-only model: the daily limit is
            the only bound. One payment can be up to the full daily limit, and anything over it
            fails on-chain — nothing waits for your approval, because there is nothing to approve.
            You can still freeze the wallet any time from the Overview above.
          </p>
        ) : (
          <>
            <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-white/60">
              Anything above the caps, or to an address outside the allowlist, waits here. Nothing
              executes until you approve it — approving signs the Safe transaction yourself. Denying
              kills the move.
            </p>
            {!approvals?.length && (
              <p className="mt-3 text-[13px] text-white/50">Nothing waiting. Big moves your agent proposes will appear here.</p>
            )}
        <div className="mt-3 space-y-2">
          {approvals?.map((row) => (
            <div key={row.id} className="rounded-xl bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-white">{row.title}</p>
                <span className={cn(
                  'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                  row.status === 'pending' ? 'bg-amber-400/10 text-amber-200'
                    : row.status === 'approved' ? 'bg-polydash-green/15 text-polydash-green'
                    : row.status === 'denied' ? 'bg-red-400/10 text-red-300'
                    : 'bg-white/10 text-white/60',
                )}>
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-white/60">{row.description || 'No description.'}</p>
              <p className="mt-1 font-mono text-[12px] text-white/55">
                To {shortenAddress(row.to)} · {formatUnits(BigInt(row.value || '0'), 18)} ETH · asked by {shortenAddress(row.requestedBy)}
              </p>
              {row.decisionTxHash && (
                <p className="mt-1 text-[12px]">
                  <a className="font-mono text-polydash-green hover:underline" href={explorerTx(row.decisionTxHash)} target="_blank" rel="noopener noreferrer">{shortenAddress(row.decisionTxHash)} ↗</a>
                </p>
              )}
              {row.status === 'pending' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => decideApproval(row, 'approve')} disabled={busy !== null}>
                    {busy === `appr-${row.id}` && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Approve & execute
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => decideApproval(row, 'deny')} disabled={busy !== null}>Deny</Button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-white/10 pt-4">
          <h3 className="text-[13px] font-semibold">Queue a big move for yourself</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              Title
              <Input value={apprTitle} onChange={(e) => setApprTitle(e.target.value)} placeholder="e.g. Move 0.05 ETH to the trading wallet" className="mt-1 bg-secondary/50" />
            </label>
            <label className="block text-xs text-muted-foreground">
              To (address)
              <Input value={apprTo} onChange={(e) => setApprTo(e.target.value)} placeholder="0x…" className="mt-1 bg-secondary/50 font-mono" />
            </label>
            <label className="block text-xs text-muted-foreground">
              Amount (ETH)
              <Input value={apprValue} onChange={(e) => setApprValue(e.target.value)} placeholder="0" inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
            </label>
            <label className="block text-xs text-muted-foreground">
              Why (optional)
              <Input value={apprDesc} onChange={(e) => setApprDesc(e.target.value)} placeholder="What is this for?" className="mt-1 bg-secondary/50" />
            </label>
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={submitApproval} disabled={busy !== null}>Queue this move</Button>
        </div>
          </>
        )}
      </AgentCard>

      <AgentCard label="Gas">
        <div id="wallet-gas" className="scroll-mt-24" />
        <AgentCardTitle>Gas — keep the wallet moving</AgentCardTitle>
        <AgentCardSub>
          Every action your agent takes costs a little ETH for gas, paid from this wallet. If the
          wallet runs dry, the agent stalls — it cannot spend its way out. Set a budget and a
          warning level; when the balance drops below the warning, top it up by hand.
        </AgentCardSub>
        {gasLow && (
          <p className="mt-3 rounded-xl bg-amber-400/[0.08] p-3 text-[13px] leading-relaxed text-amber-200">
            Low gas: the wallet holds {walletState ? formatEthShort(walletState.eth) : '…'} ETH, below your warning level of {gasBudget.warnBelowEth} ETH. Top it up below.
          </p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            Gas budget (ETH) — how much you are willing to keep in the wallet for gas
            <Input value={gasBudget.budgetEth} onChange={(e) => setGasBudgetState((g) => ({ ...g, budgetEth: e.target.value }))} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
          </label>
          <label className="block text-xs text-muted-foreground">
            Warn me below (ETH)
            <Input value={gasBudget.warnBelowEth} onChange={(e) => setGasBudgetState((g) => ({ ...g, warnBelowEth: e.target.value }))} inputMode="decimal" className="mt-1 bg-secondary/50 font-mono" />
          </label>
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={saveGasBudget}>Save gas budget</Button>
        <p className="mt-2 text-[12px] leading-relaxed text-white/50">
          Automatic top-ups are not built yet — that is a follow-up. For now, top up by hand.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block text-xs text-muted-foreground">
            Top up by (ETH)
            <Input value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} inputMode="decimal" className="mt-1 w-32 bg-secondary/50 font-mono" />
          </label>
          <Button onClick={topUp} disabled={busy !== null}>
            {busy === 'topup' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send ETH to the wallet
          </Button>
        </div>
      </AgentCard>

      <HonestLimitsBox />
    </div>
  );
}
