'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { bandForScore } from '@/lib/agents/credit-score';
import {
  explorerAddress, formatEthShort, isFactoryLive, isGasLow, getGasBudget,
  useAgentWallets, useSafeOwnerCall, useWalletPolicy, useWalletScore, useWalletState,
  usdg, type AgentWalletRow, type Addr,
} from '@/lib/agent-wallet/client';
import { HonestLimitsBox } from './honest-limits';
import { AgentCard, AgentCardSub, AgentCardTitle, AgentStat, NeedsYou, PageHero, ProofChip, StepsRow } from '../../_components/agent-cards';

function WalletCard({ row }: { row: AgentWalletRow }) {
  const { data: state } = useWalletState(row.safe);
  const { data: score } = useWalletScore(row.safe);
  const { data: policy } = useWalletPolicy(row.safe, row.agentKey);
  const { setFrozen } = useSafeOwnerCall();
  const [busy, setBusy] = useState(false);
  const budget = getGasBudget(row.safe);
  const gasLow = state ? isGasLow(state.eth, budget.warnBelowEth) : false;
  const band = score?.score != null ? bandForScore(score.score) : null;
  const frozen = state?.frozen === true || policy?.revoked === true;

  async function freeze() {
    setBusy(true);
    try {
      await setFrozen(row.safe, true);
      toast.success('Wallet frozen. Your agent cannot spend until you unfreeze it.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      toast.error(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(false);
    }
  }

  async function unfreeze() {
    setBusy(true);
    try {
      await setFrozen(row.safe, false);
      toast.success('Wallet unfrozen. Your agent can spend inside its limits again.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      toast.error(msg.includes('rejected') ? 'You rejected the transaction in your wallet.' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative rounded-[20px] border border-white/10 bg-[#141414] p-6 sm:p-8">
      {policy && (
        <ProofChip big={`$${usdg(policy.dailyCapUsdg)}`} small="daily cap — the most it can ever spend" />
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[14px] font-semibold text-white">
            <a className="text-polydash-green hover:underline" href={explorerAddress(row.safe)} target="_blank" rel="noopener noreferrer">
              {shortenAddress(row.safe)}
            </a>
          </p>
          <p className="mt-1 text-[12px] text-white/50">
            Agent key <span className="font-mono">{shortenAddress(row.agentKey)}</span>
            {' · '}created in block {row.createdBlock.toString()}
          </p>
        </div>
        {frozen ? (
          <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-[11px] font-medium text-red-300">Frozen</span>
        ) : (
          <span className="rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green">Active</span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <AgentStat
          label="ETH in wallet"
          value={state ? formatEthShort(state.eth) : '…'}
          note={gasLow ? <span className="text-amber-300">Low gas — top up so your agent never stalls.</span> : undefined}
        />
        <AgentStat label="USDG in wallet" value={state ? usdg(state.usdg) : '…'} />
        <AgentStat
          label="Credit score"
          value={
            score?.registered ? (
              score.score != null && band ? (
                <span>
                  {score.score}{' '}
                  <span className={cn('ml-1 rounded-full px-2 py-0.5 align-middle text-[10px] font-medium', band.chip)}>{band.label}</span>
                </span>
              ) : (
                <span className="text-[15px] font-semibold text-white/60">Registered · score coming soon</span>
              )
            ) : (
              <span className="text-[15px] font-semibold text-white/60">Not registered</span>
            )
          }
        />
        <AgentStat
          label="Spent today"
          value={
            policy ? (
              <span>
                ${usdg(policy.spentTodayUsdg)}{' '}
                <span className="text-[14px] font-medium text-white/50">/ ${usdg(policy.dailyCapUsdg)}</span>
              </span>
            ) : (
              '…'
            )
          }
        />
      </div>

      {policy && (
        <p className="mt-4 text-[13px] leading-relaxed text-white/55">
          Limits: up to ${usdg(policy.perPaymentCapUsdg)} per payment · ${usdg(policy.dailyCapUsdg)} a day · ${usdg(policy.weeklyCapUsdg)} a week
          {policy.expiry > 0 && <> · key expires {new Date(policy.expiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</>}
          {policy.startHour !== 0 || policy.endHour !== 0 ? <> · works {policy.startHour}:00–{policy.endHour}:00 UTC</> : null}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/agents/wallets/${row.safe}`}>Open wallet</Link>
        </Button>
        {frozen ? (
          <Button variant="outline" size="sm" onClick={unfreeze} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Unfreeze
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={freeze} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Freeze this wallet
          </Button>
        )}
      </div>
    </div>
  );
}

export function WalletsContent() {
  const { address } = useAccount();
  const { data: wallets, isLoading, isError } = useAgentWallets(address);
  const { setFrozen } = useSafeOwnerCall();
  const [freezingAll, setFreezingAll] = useState(false);

  async function freezeAll() {
    if (!wallets?.length) return;
    setFreezingAll(true);
    try {
      for (const w of wallets) {
        await setFrozen(w.safe as Addr, true);
      }
      toast.success(`Froze ${wallets.length} wallet${wallets.length === 1 ? '' : 's'}. Nothing can move until you unfreeze them.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      toast.error(msg.includes('rejected') ? 'You rejected a transaction — some wallets may still be active. Check each one.' : msg);
    } finally {
      setFreezingAll(false);
    }
  }

  return (
    <div className="mx-auto max-w-container space-y-6 px-5 py-6 sm:px-8 sm:py-10">
      <PageHero
        crumb={<>Agents <span className="font-normal text-white/40">· Agent Wallets</span></>}
        title="Agent Wallets"
        lede="A safe wallet for your AI agent. Your agent gets its own wallet on Robinhood Chain and can spend inside limits you set — launch tokens, create a tokenized fund, create staking, mint NFTs, and do normal wallet things. Anything big needs you. You can stop it in one tap."
      />

      <div className="pt-4">
        <StepsRow
          steps={[
            {
              title: 'You own it',
              text: 'The wallet is a Safe — the same audited smart-account system used across crypto. You are the owner. Your agent only gets a session key.',
            },
            {
              title: 'Your agent works inside limits',
              text: 'Small payments, to approved places, inside a daily cap, before the key expires. The agent key can never raise its own limits.',
            },
            {
              title: 'You can stop it instantly',
              text: 'Freeze the wallet or revoke the key in one transaction, any time, without the agent\u2019s help. A backup key you keep offline can recover the wallet if you lose yours.',
            },
          ]}
        />
      </div>

      <AgentCard label="Create a wallet">
        <ProofChip big="3 steps" small="about two minutes · a few cents of gas" />
        <AgentCardTitle>Create a wallet</AgentCardTitle>
        <AgentCardSub>Give your agent its own wallet, with a daily limit you set. You pick the cap — the most it can ever spend in one day.</AgentCardSub>
        <div className="mt-5">
          <Button asChild>
            <Link href="/agents/wallets/new">Create a wallet</Link>
          </Button>
        </div>
      </AgentCard>

      <AgentCard label="Base wallet — for paying in USDC">
        <ProofChip big="Base · USDC" small="a parallel wallet, for Polypad’s pay-per-call reports" />
        <AgentCardTitle>Need a wallet that pays for things on Base?</AgentCardTitle>
        <AgentCardSub>
          Your Safe wallet lives on Robinhood Chain. For the things priced in USDC on Base — Polypad’s reports — your
          agent needs a second wallet. It is powered by Coinbase CDP, spends only on Polypad reports, inside caps you
          set, and you can freeze it in one tap.
        </AgentCardSub>
        <div className="mt-5">
          <Button asChild variant="outline">
            <Link href="/agents/wallets/base">Create a Base wallet</Link>
          </Button>
        </div>
      </AgentCard>

      {!isFactoryLive && (
        <p className="rounded-[20px] border border-amber-400/20 bg-amber-400/[0.05] p-6 text-[14px] leading-relaxed text-amber-100/90">
          The wallet contracts are being deployed — the wizard below is fully ready, and wallet
          creation opens the moment the factory is live. Nothing here is a demo of a deployment:
          no wallet exists until the factory is on-chain.
        </p>
      )}

      {!address ? (
        <NeedsYou
          title="Connect your wallet"
          text="Connect your wallet from the top of the page to see your fleet — the wallets you created."
        />
      ) : isLoading ? (
        <p className="text-[14px] text-white/50">Loading your wallets from Robinhood Chain…</p>
      ) : isError ? (
        <AgentCard label="Could not load your wallets">
          <AgentCardTitle>Could not load your wallets</AgentCardTitle>
          <AgentCardSub>Could not read your wallets from the chain. Check your connection and reload.</AgentCardSub>
        </AgentCard>
      ) : !wallets?.length ? (
        <NeedsYou
          title="Create your first wallet"
          text="You haven\u2019t created an agent wallet yet. The wizard names it, makes its key, deploys it, adds money, and plugs it into your agent — one thing per screen."
        >
          <Button asChild>
            <Link href="/agents/wallets/new">Create your first wallet</Link>
          </Button>
        </NeedsYou>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <h2 className="text-[20px] font-bold tracking-tight sm:text-[22px]">Your fleet ({wallets.length})</h2>
            <Button variant="outline" size="sm" onClick={freezeAll} disabled={freezingAll}>
              {freezingAll && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Freeze all wallets
            </Button>
          </div>
          <div className="space-y-6">
            {wallets.map((w) => (
              <WalletCard key={w.safe} row={w} />
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-white/40">
            Wallets found from the factory&apos;s on-chain records. Balances are read live from
            Robinhood Chain. <a className="text-polydash-green hover:underline" href={getExplorerAddressUrl(wallets[0].safe)} target="_blank" rel="noopener noreferrer">View on the explorer</a>
          </p>
        </>
      )}

      <HonestLimitsBox />

      <p className="text-[12px] leading-relaxed text-white/40">
        Already have an agent with its own wallet? The advanced view lives at{' '}
        <Link href="/agents/accounts" className="text-polydash-green hover:underline">Agent Accounts</Link> — identity,
        vault money, spending keys, and Pro keys.
      </p>
    </div>
  );
}
