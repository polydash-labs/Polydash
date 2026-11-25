'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { parseEther, type Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FundNFTPhase3ABI, FundVaultPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { formatFundEth } from '@/lib/fund/model';
import { P3_STATUS, pct, utcDate } from '@/lib/fund/phase3';
import type { Phase3Detail, usePhase3Tx } from '@/lib/fund/use-phase3';
import { cn } from '@/lib/utils';
import { P3Label, Tip } from '../../_components/phase3-ui';

type Tx = ReturnType<typeof usePhase3Tx>;
const VAULT = FundVaultPhase3ABI as Abi;
const NFT = FundNFTPhase3ABI as Abi;

export function Card({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5', className)}>
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[12px] text-white/45">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Row({ label, tip, value, sub, strong }: { label: string; tip: string; value: string; sub?: ReactNode; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-t border-white/5 py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
      <span className="flex items-center gap-1.5 text-[13px] text-white/60">{label} <Tip text={tip} label={`About: ${label}`} /></span>
      <div className="sm:text-right">
        <p className={cn('text-[14px] text-white', strong && 'font-semibold underline decoration-white/40 underline-offset-4')}>{value}</p>
        {sub && <p className="text-[12px] text-white/45">{sub}</p>}
      </div>
    </div>
  );
}

function TxButton({ tx, id, label, disabled, onClick, primary }: { tx: Tx; id: string; label: string; disabled?: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <Button
      variant={primary ? 'default' : 'outline'}
      className={cn('w-full', primary && 'bg-white text-black hover:bg-white/90')}
      disabled={disabled || tx.pending !== null}
      onClick={onClick}
    >
      {tx.pending === id ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}

export function DistributionsCard({ fund, tx }: { fund: Phase3Detail; tx: Tx }) {
  const paidRounds = fund.rounds.filter((r) => r.perUnit > 0n);
  return (
    <Card title="Distributions" subtitle="ETH the manager sends back to holders. You collect it when you want.">
      <p className="-mt-1 mb-3 text-[13px] leading-relaxed text-white/60">The manager decides when to pay out; fees are collected weekly at most and you claim them here. Nothing is automatic, and payouts may be zero.</p>
      {!tx.account ? (
        <div className="space-y-2"><p className="text-[13px] text-white/55">Connect your wallet to see what you can collect.</p><ConnectButton /></div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-[13px] text-white/60">Ready to collect <Tip text="Each share you hold gets its part of every distribution. Nothing is sent automatically; press Claim to collect it." /></span>
            <span className="font-mono text-[16px] text-white">{formatFundEth(fund.myClaimable)} ETH</span>
          </div>
          <p className="text-[12px] text-white/45">You hold {fund.myIds.length} share{fund.myIds.length === 1 ? '' : 's'}.</p>
          <TxButton
            tx={tx}
            id="claim"
            primary
            label={fund.myClaimable > 0n ? `Claim ${formatFundEth(fund.myClaimable)} ETH (sign 1 transaction)` : 'Nothing to claim yet'}
            disabled={fund.myClaimable === 0n || fund.myUnclaimedIds.length === 0}
            onClick={() => tx.send({ key: 'claim', address: fund.vault, abi: VAULT, functionName: 'claim', args: [fund.myUnclaimedIds], working: 'Claiming', success: 'Distribution claimed' })}
          />
        </div>
      )}
      <div className="mt-4 border-t border-white/5 pt-3">
        {paidRounds.length === 0 ? (
          <p className="text-[12px] text-white/45">First distribution coming after the first buy</p>
        ) : (
          <ul className="space-y-1 text-[12px] text-white/60">
            {paidRounds.slice(-6).reverse().map((r) => (
              <li key={r.id} className="flex justify-between"><span>Round {r.id}</span><span className="font-mono">{formatFundEth(r.perUnit)} ETH per share</span></li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function HolderActions({ fund, tx, now }: { fund: Phase3Detail; tx: Tx; now: number }) {
  const canExit = fund.status === P3_STATUS.RaisingClosed || fund.status === P3_STATUS.Investing;
  const canRefund = fund.status === P3_STATUS.Failed;
  const canFail = fund.status === P3_STATUS.Raising && now > 0 && now > fund.raiseDeadline;
  if (!canFail && (!tx.account || fund.myIds.length === 0 || (!canExit && !canRefund))) return null;
  const ids = fund.myIds.slice(0, 100);
  return (
    <Card title={canRefund ? 'Get your money back' : canFail ? 'Raise deadline passed' : 'Leave the tokenized fund'}>
      {canFail ? (
        <div className="space-y-2">
          <p className="text-[12px] text-white/55">The goal was not reached in time. Anyone can mark the raise as missed so holders can get a refund.</p>
          <TxButton tx={tx} id="fail" label="Mark the raise as missed (sign 1 transaction)" disabled={!tx.account}
            onClick={() => tx.send({ key: 'fail', address: fund.vault, abi: VAULT, functionName: 'failRaise', working: 'Closing the raise', success: 'Refunds are now open' })} />
        </div>
      ) : canRefund ? (
        <div className="space-y-2">
          <p className="text-[12px] text-white/55">Return your {ids.length} share{ids.length === 1 ? '' : 's'} and get your ETH back. Fees are not refunded.</p>
          <TxButton tx={tx} id="refund" primary label="Refund my shares (sign 1 transaction)"
            onClick={() => tx.send({ key: 'refund', address: fund.address, abi: NFT, functionName: 'refund', args: [ids], working: 'Refunding', success: 'Refund sent' })} />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-white/55">Return your {ids.length} share{ids.length === 1 ? '' : 's'} for your part of the tokenized fund. Any unclaimed distributions are paid at the same time. Tokens the tokenized fund holds may be owed to you separately.</p>
          <TxButton tx={tx} id="exit" label="Exit with all my shares (sign 1 transaction)"
            onClick={() => tx.send({ key: 'exit', address: fund.address, abi: NFT, functionName: 'exit', args: [ids], working: 'Exiting', success: 'You left the tokenized fund' })} />
        </div>
      )}
    </Card>
  );
}

export function ManagerView({ fund, tx, now }: { fund: Phase3Detail; tx: Tx; now: number }) {
  const [amount, setAmount] = useState('');
  const skinLeft = fund.skinRequired > fund.managerMinted ? fund.skinRequired - fund.managerMinted : 0n;
  const raising = fund.status === P3_STATUS.Raising;
  let wei: bigint | null = null;
  try { wei = /^\d+(\.\d{1,18})?$/.test(amount.trim()) ? parseEther(amount.trim()) : null; } catch { wei = null; }
  const distError = !amount.trim() ? undefined : wei === null || wei === 0n ? 'Enter an ETH amount above zero.' : wei > fund.spendableEth ? `The tokenized fund can send at most ${formatFundEth(fund.spendableEth)} ETH.` : fund.outstanding > 0n && wei / fund.outstanding === 0n ? 'Amount too small to split across all shares.' : undefined;
  const canDistribute = fund.status === P3_STATUS.Investing || fund.status === P3_STATUS.RaisingClosed;
  const canEnable = fund.status === P3_STATUS.RaisingClosed && fund.publicOpen && fund.managerMinted >= fund.skinRequired;
  const nextCheckpoint = fund.lastNavCheckpoint ? fund.lastNavCheckpoint + fund.checkpointInterval : 0;
  const canCheckpoint = fund.status === P3_STATUS.Investing && (!fund.lastNavCheckpoint || (now > 0 && now >= nextCheckpoint));

  return (
    <Card title="Stake, distributions and fees" subtitle="Only you see this, because your wallet manages this tokenized fund." className="border-white/25">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-white">Your stake</h3>
          <Row label="Required shares" tip="The shares you must buy with your own ETH before others can join. They cannot be transferred until the unlock date." value={`${fund.managerMinted.toString()} of ${fund.skinRequired.toString()} bought`} sub={fund.skinUnlockTime ? (now > 0 && fund.skinUnlockTime <= now ? `Unlocked ${utcDate(fund.skinUnlockTime)}` : `Unlocks ${utcDate(fund.skinUnlockTime)}`) : undefined} />
          {skinLeft > 0n && raising ? (
            <TxButton tx={tx} id="skin" primary label={`Lock stake: buy ${skinLeft.toString()} share${skinLeft === 1n ? '' : 's'} for ${formatFundEth(skinLeft * fund.mintPrice)} ETH`}
              onClick={() => tx.send({ key: 'skin', address: fund.address, abi: NFT, functionName: 'mint', args: [skinLeft], value: skinLeft * fund.mintPrice, working: 'Locking your stake', success: 'Stake locked. The tokenized fund is open to everyone.' })} />
          ) : (
            <p className="text-[12px] text-white/45">{skinLeft === 0n ? 'Your stake is locked.' : 'The raise is no longer open.'}</p>
          )}
          {canEnable && (
            <TxButton tx={tx} id="enable" label="Start investing (sign 1 transaction)"
              onClick={() => tx.send({ key: 'enable', address: fund.vault, abi: VAULT, functionName: 'enableInvesting', working: 'Starting investing', success: 'Investing started' })} />
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-white">Post a distribution</h3>
          {canDistribute ? (
            <>
              <label className="block">
                <P3Label label="ETH to send to holders" tip="This ETH is set aside and split equally across every share. Holders collect their part with Claim." />
                <Input inputMode="decimal" placeholder="0.1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <p className="text-[12px] text-white/45">{distError ?? `Up to ${formatFundEth(fund.spendableEth)} ETH free to send.`}</p>
              <TxButton tx={tx} id="distribute" primary label="Post distribution (sign 1 transaction)" disabled={!wei || !!distError}
                onClick={() => wei && tx.send({ key: 'distribute', address: fund.vault, abi: VAULT, functionName: 'distribute', args: [wei], working: 'Posting the distribution', success: 'Distribution posted' }).then((r) => { if (r) setAmount(''); })} />
            </>
          ) : (
            <p className="text-[12px] text-white/45">Distributions open once the raise is closed.</p>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-[13px] font-medium text-white">Fee and high-water mark</h3>
          <Row label="Performance fee" tip="Your share of gains above the high-water mark." value={pct(fund.hwmFeeBps)} />
          <Row label="High-water mark" tip="The highest value per share so far. Fees are only counted on gains above it." value={fund.hwmPerNft > 0n ? `${formatFundEth(fund.hwmPerNft)} ETH` : 'Not set yet'} />
          <Row label="Fee ready to withdraw" tip="Performance fee already counted and waiting for you. It is paid to your payout wallet." value={`${formatFundEth(fund.claimablePerformanceFee)} ETH`} sub={`Total counted so far: ${formatFundEth(fund.performanceFeeAccrued)} ETH`} />
          <div className="grid grid-cols-2 gap-2">
            <TxButton tx={tx} id="harvest" label="Count fee" disabled={fund.status !== P3_STATUS.Investing}
              onClick={() => tx.send({ key: 'harvest', address: fund.vault, abi: VAULT, functionName: 'harvest', working: 'Counting the fee', success: 'Fee counted' })} />
            <TxButton tx={tx} id="withdrawFee" label="Withdraw fee" disabled={fund.claimablePerformanceFee === 0n}
              onClick={() => tx.send({ key: 'withdrawFee', address: fund.vault, abi: VAULT, functionName: 'withdrawPerformanceFee', working: 'Withdrawing the fee', success: 'Fee withdrawn' })} />
          </div>
          <TxButton tx={tx} id="checkpoint" label="Record tokenized fund value now" disabled={!canCheckpoint}
            onClick={() => tx.send({ key: 'checkpoint', address: fund.vault, abi: VAULT, functionName: 'checkpointNav', working: 'Recording the value', success: 'Value recorded' })} />
          {fund.status === P3_STATUS.Investing && !canCheckpoint && nextCheckpoint > 0 && <p className="text-[11px] text-white/40">Next record allowed {utcDate(nextCheckpoint)}.</p>}
        </div>
      </div>
    </Card>
  );
}
