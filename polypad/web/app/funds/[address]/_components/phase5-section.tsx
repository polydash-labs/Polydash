'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { parseEther } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatFundEth } from '@/lib/fund/model';
import { utcDate } from '@/lib/fund/phase3';
import {
  FUND_CARRY, FUND_LOCKS, FUND_MARKET, FUND_NAV_FLOOR, FUND_PHASE5, FUND_RENDERER, P5_COPY, P5_TIERS, defaultShareId, phase5Live, quoteStatusLabel,
} from '@/lib/fund/phase5';
import type { Phase3Detail } from '@/lib/fund/use-phase3';
import { P5ABI, useCarry, useListings, usePhase5Tx, useRegistryMatch, useShare5 } from '@/lib/fund/use-phase5';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ContractLink } from '../../_components/phase3-ui';
import { Card, Row as P3Row } from './phase3-panels';
import { ConnectHint, Hint } from './phase4-section';

type Tx = ReturnType<typeof usePhase5Tx>;
type Addr = `0x${string}`;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function Row({ label, value, sub, tip }: { label: string; value: string; sub?: string; tip?: string }) {
  return <P3Row label={label} value={value} sub={sub} tip={tip ?? 'A live reading from Robinhood Chain.'} />;
}

function Nfa() {
  return <p className="text-[11px] text-white/40">{P5_COPY.nfa}</p>;
}

function B({ tx, id, label, disabled, onClick, primary }: { tx: Tx; id: string; label: string; disabled?: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <Button
      variant={primary ? 'default' : 'outline'}
      className={cn('w-full whitespace-normal', primary && 'bg-white text-black hover:bg-white/90')}
      disabled={disabled || tx.pending !== null || !phase5Live()}
      onClick={onClick}
    >
      {tx.pending === id ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}

export function Phase5Section({ fund, isManager, now }: { fund: Phase3Detail; isManager: boolean; now: number }) {
  const live = phase5Live();
  const reg = useRegistryMatch();
  const tx = usePhase5Tx(reg.data === true);
  const [idText, setIdText] = useState(fund.myIds[0]?.toString() ?? '');
  const tokenId = /^\d+$/.test(idText.trim()) ? BigInt(idText.trim()) : null;
  const viewId = defaultShareId(idText, fund.myIds);
  return (
    <section id="phase5" className="space-y-4 border-t border-white/10 pt-5">
      <div>
        <h2 className="flex items-center gap-2 text-[18px] font-semibold text-white">
          Phase 5 add-ons
          <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">Phase 5</span>
        </h2>
        <p className="mt-1 text-[13px] text-white/55">More tools for shares of this tokenized fund. The share stays the ownership claim. The share&apos;s own exit still works.</p>
      </div>
      {!live ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-5 text-[13px] text-white/60">{P5_COPY.notLive}</div>
      ) : reg.data === false ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-5 text-[13px] text-white/60">{P5_COPY.mismatch}</div>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-[12px] text-white/60">Share number (any share in this tokenized fund)</label>
            <Input value={idText} onChange={(e) => setIdText(e.target.value)} placeholder={`#${viewId.toString()}`} className="max-w-[200px]" />
            {fund.myIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fund.myIds.map((id) => (
                  <button key={id.toString()} type="button" onClick={() => setIdText(id.toString())} className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/10">#{id.toString()}</button>
                ))}
              </div>
            )}
            <Hint>Pick one of your shares. The panels below use this share number.</Hint>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <ListPanel fund={fund} tx={tx} tokenId={tokenId} />
            <BuyPanel fund={fund} tx={tx} />
            <ArtPanel fund={fund} tokenId={viewId} />
            <LockPanel fund={fund} tx={tx} tokenId={tokenId} now={now} />
            <ExitPanel fund={fund} tx={tx} tokenId={viewId} now={now} />
            <CarryPanel fund={fund} tx={tx} isManager={isManager} />
          </div>
        </>
      )}
      <p className="text-[11px] text-white/40">{P5_COPY.note}</p>
      <div className="flex flex-wrap gap-2">
        {FUND_PHASE5 && <ContractLink label="FundPhase5" address={FUND_PHASE5} />}
        {FUND_MARKET && <ContractLink label="FundSecondaryMarket" address={FUND_MARKET} />}
        {FUND_RENDERER && <ContractLink label="FundShareRenderer" address={FUND_RENDERER} />}
        {FUND_LOCKS && <ContractLink label="FundConvictionLock" address={FUND_LOCKS} />}
        {FUND_CARRY && <ContractLink label="FundCarryRights" address={FUND_CARRY} />}
        {FUND_NAV_FLOOR && <ContractLink label="FundNavFloor" address={FUND_NAV_FLOOR} />}
      </div>
    </section>
  );
}

function approve(tx: Tx, nft: Addr, to: Addr, tokenId: bigint, key: string) {
  return tx.send({ key, address: nft, abi: P5ABI.nft, functionName: 'approve', args: [to, tokenId], working: 'Approving', success: 'Approved' });
}

function ListPanel({ fund, tx, tokenId }: { fund: Phase3Detail; tx: Tx; tokenId: bigint | null }) {
  const s = useShare5(fund.address, tokenId).data;
  const [price, setPrice] = useState('');
  let wei: bigint | null = null;
  try { wei = price ? parseEther(price) : null; } catch { wei = null; }
  const mine = same(s?.owner, tx.account);
  const can = !!tokenId && !!wei && wei > 0n && mine && !s?.isLocked;
  return (
    <Card title="List share for sale">
      <div className="space-y-3">
        {!tx.account ? <ConnectHint /> : (
          <>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price in ETH" />
            <Hint>The fixed ETH price a buyer pays for this share.</Hint>
            {s?.isLocked && <Hint>This share is in a conviction lock, so it cannot be listed.</Hint>}
            {tokenId && s && !mine && <Hint>Your wallet does not hold this share.</Hint>}
            {!s?.approved.market && (
              <B tx={tx} id="p5-approve-market" label="Approve the market for this share (sign 1 transaction)" disabled={!tokenId || !mine} onClick={() => approve(tx, fund.address, FUND_MARKET!, tokenId!, 'p5-approve-market')} />
            )}
            <B tx={tx} id="p5-list" primary label="List from my wallet (sign 1 transaction)" disabled={!can} onClick={() => tx.send({ key: 'p5-list', address: FUND_MARKET!, abi: P5ABI.market, functionName: 'list', args: [fund.address, tokenId, wei], working: 'Listing', success: 'Share listed' })} />
            <Hint>The share stays in your wallet. A buyer can only buy once the market is approved for this share.</Hint>
            <B tx={tx} id="p5-list-escrow" label="List in escrow (sign 1 transaction)" disabled={!can || !s?.approved.market} onClick={() => tx.send({ key: 'p5-list-escrow', address: FUND_MARKET!, abi: P5ABI.market, functionName: 'listEscrow', args: [fund.address, tokenId, wei], working: 'Listing', success: 'Share listed in escrow' })} />
            <Hint>The share moves into the market until it sells or you cancel. Approve the market first.</Hint>
          </>
        )}
        <Hint>{P5_COPY.listTip}</Hint>
      </div>
    </Card>
  );
}

function BuyPanel({ fund, tx }: { fund: Phase3Detail; tx: Tx }) {
  const q = useListings(fund.address);
  const listings = q.data?.listings ?? [];
  return (
    <Card title="Buy listed shares">
      <div className="space-y-3">
        {q.isLoading ? <Hint>Loading listings...</Hint> : listings.length === 0 ? <Hint>No open listings for this tokenized fund.</Hint> : (
          listings.map((l) => {
            const mineL = same(l.seller, tx.account);
            return (
              <div key={l.id.toString()} className="space-y-2 rounded-xl border border-white/10 p-3">
                <Row label={`Share #${l.tokenId.toString()}`} value={`${formatFundEth(l.price)} ETH`} sub={`${l.mode === 2 ? 'In escrow' : 'In seller wallet'} · seller ${shortenAddress(l.seller)}`} />
                {mineL ? (
                  <B tx={tx} id={`p5-cancel-${l.id}`} label="Cancel listing (sign 1 transaction)" onClick={() => tx.send({ key: `p5-cancel-${l.id}`, address: FUND_MARKET!, abi: P5ABI.market, functionName: 'cancel', args: [l.id], working: 'Cancelling', success: 'Listing cancelled' })} />
                ) : (
                  <B tx={tx} id={`p5-fill-${l.id}`} primary label={`Buy for ${formatFundEth(l.price)} ETH (sign 1 transaction)`} disabled={!tx.account} onClick={() => tx.send({ key: `p5-fill-${l.id}`, address: FUND_MARKET!, abi: P5ABI.market, functionName: 'fill', args: [l.id], value: l.price, working: 'Buying', success: 'Share bought' })} />
                )}
              </div>
            );
          })
        )}
        <Hint>{P5_COPY.buyTip}</Hint>
        {tx.account && (
          <>
            <Row label="Your sale proceeds" value={`${formatFundEth(q.data?.proceeds ?? 0n)} ETH`} />
            <B tx={tx} id="p5-withdraw" label="Withdraw proceeds (sign 1 transaction)" disabled={!q.data?.proceeds} onClick={() => tx.send({ key: 'p5-withdraw', address: FUND_MARKET!, abi: P5ABI.market, functionName: 'withdraw', working: 'Withdrawing', success: 'Proceeds withdrawn' })} />
            <Hint>ETH from your sales waits here until you withdraw it.</Hint>
          </>
        )}
        <Nfa />
      </div>
    </Card>
  );
}

function ArtPanel({ fund, tokenId }: { fund: Phase3Detail; tokenId: bigint }) {
  const s = useShare5(fund.address, tokenId);
  return (
    <Card title={`Share art · #${tokenId.toString()}`}>
      <div className="space-y-3">
        {s.isLoading ? <Hint>Loading...</Hint> : s.data?.svg ? (
          <div className="overflow-hidden rounded-xl border border-white/15 bg-black grayscale">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(s.data.svg)}`} alt={`Onchain art for share #${tokenId.toString()}`} className="w-full" />
          </div>
        ) : <Hint>The art could not be read for this share.</Hint>}
        <Hint>{P5_COPY.artTip}</Hint>
      </div>
    </Card>
  );
}

function LockPanel({ fund, tx, tokenId, now }: { fund: Phase3Detail; tx: Tx; tokenId: bigint | null; now: number }) {
  const s = useShare5(fund.address, tokenId).data;
  const [tier, setTier] = useState<number>(30);
  const mine = same(s?.owner, tx.account);
  const isHolder = same(s?.lockHolder, tx.account);
  return (
    <Card title="Lock for conviction">
      <div className="space-y-3">
        <Row label="Lock badge" value={s?.tier ? `${s.tier} days` : 'None'} />
        <Row label="Locked now" value={s?.isLocked ? 'Yes' : 'No'} sub={s?.lockExpiry ? `Unlocks ${utcDate(s.lockExpiry)}` : undefined} />
        {!tx.account ? <ConnectHint /> : (
          <>
            {s?.inEscrow && <Hint>This share is in market escrow. Cancel the listing before you lock it.</Hint>}
            <div className="flex gap-2">
              {P5_TIERS.map((t) => (
                <button key={t} type="button" onClick={() => setTier(t)} className={cn('rounded-full border px-3 py-1 text-[12px]', tier === t ? 'border-white bg-white text-black' : 'border-white/20 text-white/80')}>{t} days</button>
              ))}
            </div>
            <Hint>How long the share stays locked.</Hint>
            {!s?.approved.locks && <B tx={tx} id="p5-approve-lock" label="Approve the lock contract (sign 1 transaction)" disabled={!tokenId || !mine || s?.inEscrow} onClick={() => approve(tx, fund.address, FUND_LOCKS!, tokenId!, 'p5-approve-lock')} />}
            <B tx={tx} id="p5-lock" primary label={`Lock for ${tier} days (sign 1 transaction)`} disabled={!tokenId || !mine || !s?.approved.locks || s?.inEscrow} onClick={() => tx.send({ key: 'p5-lock', address: FUND_LOCKS!, abi: P5ABI.locks, functionName: 'lock', args: [fund.address, tokenId, tier], working: 'Locking', success: 'Share locked' })} />
            <Hint>Send the share only with this button, never with a plain transfer. Opening a lock clears any listing that relied on your approval.</Hint>
            {s?.isLocked && <B tx={tx} id="p5-unlock" label="Unlock (sign 1 transaction)" disabled={!isHolder || now < (s?.lockExpiry ?? 0)} onClick={() => tx.send({ key: 'p5-unlock', address: FUND_LOCKS!, abi: P5ABI.locks, functionName: 'unlock', args: [fund.address, tokenId], working: 'Unlocking', success: 'Share returned' })} />}
            {s?.isLocked && <Hint>Only the wallet that locked the share can unlock it, after the time is up.</Hint>}
          </>
        )}
        <Hint>{P5_COPY.lockTip}</Hint>
      </div>
    </Card>
  );
}

function ExitPanel({ fund, tx, tokenId, now }: { fund: Phase3Detail; tx: Tx; tokenId: bigint; now: number }) {
  const s = useShare5(fund.address, tokenId).data;
  const mine = same(s?.owner, tx.account);
  const isHolder = same(s?.queueHolder, tx.account);
  const skin = Number(fund.skinUnlockTime ?? 0) > now;
  return (
    <Card title={`Queue a nav-floor exit · #${tokenId.toString()}`}>
      <div className="space-y-3">
        <Row label="ETH per share (vault reading)" value={s?.ethShare != null ? `${formatFundEth(s.ethShare)} ETH` : '—'} sub={`Tokenized fund status: ${quoteStatusLabel(s?.quoteStatus, fund.status, fund.publicOpen)}. A vault reading, not a payout to count on.`} />
        <Row label="Queued by" value={s?.queueHolder ? shortenAddress(s.queueHolder) : 'Not queued'} sub={s?.readyAt ? `Ready ${utcDate(s.readyAt)}` : undefined} />
        {!tx.account ? <ConnectHint /> : (
          <>
            {skin && <Hint>This tokenized fund is still in the manager lock. A manager share cannot move into the queue until that lock allows it. The holder can still call exit on the share.</Hint>}
            {!s?.queueHolder && !s?.approved.floor && <B tx={tx} id="p5-approve-floor" label="Approve the exit queue (sign 1 transaction)" disabled={!tokenId || !mine} onClick={() => approve(tx, fund.address, FUND_NAV_FLOOR!, tokenId!, 'p5-approve-floor')} />}
            {!s?.queueHolder && <B tx={tx} id="p5-queue" primary label="Queue exit (sign 1 transaction)" disabled={!tokenId || !mine || !s?.approved.floor} onClick={() => tx.send({ key: 'p5-queue', address: FUND_NAV_FLOOR!, abi: P5ABI.floor, functionName: 'queue', args: [fund.address, tokenId], working: 'Queuing', success: 'Share queued' })} />}
            {s?.queueHolder && (
              <>
                <B tx={tx} id="p5-redeem" primary label="Redeem (sign 1 transaction)" disabled={!isHolder || now < s.readyAt} onClick={() => tx.send({ key: 'p5-redeem', address: FUND_NAV_FLOOR!, abi: P5ABI.floor, functionName: 'redeem', args: [fund.address, tokenId], working: 'Redeeming', success: 'Redeemed' })} />
                <B tx={tx} id="p5-qcancel" label="Cancel and take the share back (sign 1 transaction)" disabled={!isHolder} onClick={() => tx.send({ key: 'p5-qcancel', address: FUND_NAV_FLOOR!, abi: P5ABI.floor, functionName: 'cancel', args: [fund.address, tokenId], working: 'Cancelling', success: 'Share returned' })} />
                <Hint>Only the wallet that queued the share can redeem or cancel. Redeem opens after the one-day wait. If a tokenized fund token does not arrive in full, redeem fails and the share stays queued. You can cancel and call exit on the share.</Hint>
              </>
            )}
          </>
        )}
        <Hint>{P5_COPY.exitTip}</Hint>
      </div>
    </Card>
  );
}

function CarryPanel({ fund, tx, isManager }: { fund: Phase3Detail; tx: Tx; isManager: boolean }) {
  const c = useCarry(fund.address, fund.vault).data;
  const isHolder = same(c?.holder, tx.account);
  const pointed = same(c?.payoutWallet, FUND_CARRY);
  return (
    <Card title="Carry NFT">
      <div className="space-y-3">
        <p className="rounded-xl border border-white/20 p-3 text-[12px] leading-relaxed text-white/80">{P5_COPY.carryWarning}</p>
        <Row label="Carry NFT" value={c?.armed ? `#${c.id.toString()}` : 'Not created'} sub={c?.holder ? `Held by ${shortenAddress(c.holder)}` : undefined} />
        <Row label="Payout wallet points here" value={c ? (c.routed ? 'Yes' : 'No') : '—'} />
        {c?.armed && !c.routed && <Hint>The payout wallet has been pointed somewhere else. New fees will not arrive here. Amounts already received stay with the current holder.</Hint>}
        <Row label="Ready to claim" value={`${formatFundEth(c?.claimable ?? 0n)} ETH`} />
        {isManager && !c?.armed && (
          <>
            <B tx={tx} id="p5-payout" label="Step 1: Set payout wallet to the Carry contract (sign 1 transaction)" disabled={pointed} onClick={() => tx.send({ key: 'p5-payout', address: fund.vault, abi: P5ABI.vault, functionName: 'setPayoutWallet', args: [FUND_CARRY], working: 'Setting the payout wallet', success: 'Payout wallet set' })} />
            <Hint>Your fees will go to the Carry contract instead of your wallet.</Hint>
            <B tx={tx} id="p5-arm" primary label="Step 2: Create the Carry NFT (sign 1 transaction)" disabled={!pointed} onClick={() => tx.send({ key: 'p5-arm', address: FUND_CARRY!, abi: P5ABI.carry, functionName: 'arm', args: [fund.address], working: 'Creating the Carry NFT', success: 'Carry NFT created' })} />
            <Hint>This mints one Carry NFT for this tokenized fund to your wallet.</Hint>
          </>
        )}
        {isHolder && (
          <>
            <B tx={tx} id="p5-claim" primary label="Claim (sign 1 transaction)" disabled={!c?.claimable} onClick={() => tx.send({ key: 'p5-claim', address: FUND_CARRY!, abi: P5ABI.carry, functionName: 'claim', args: [fund.address], working: 'Claiming', success: 'Claimed' })} />
            <Hint>Sends the ETH that already reached this Carry NFT to the holder.</Hint>
          </>
        )}
        {!isManager && !isHolder && <Hint>Only the manager or the Carry NFT holder can act here.</Hint>}
        <Hint>A transfer of the Carry NFT can fail while the tokenized fund is still raising, while the drawdown brake is on, or while a set brake cannot be read.</Hint>
      </div>
    </Card>
  );
}
