'use client';

import { useState } from 'react';
import Link from 'next/link';
import { parseEther, type Abi } from 'viem';
import { Input } from '@/components/ui/input';
import { FundPhase4ABI } from '@/lib/contracts/fund-phase4-abi';
import { FundNFTPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { formatEther } from 'viem';
import { formatFundEth } from '@/lib/fund/model';
import { P3_DEFAULT_MIN_SKIN_BPS, checkPhase3Draft, utcDate, type Phase3Field } from '@/lib/fund/phase3';
import { FUND_PHASE4, P4_COPY, endTimeFromDays, offerAmountIssue } from '@/lib/fund/phase4';
import type { Phase3Detail } from '@/lib/fund/use-phase3';
import { useOffers, useShareWallet, type Offer } from '@/lib/fund/use-phase4';
import { shortenAddress } from '@/lib/format';
import { Card } from './phase3-panels';
import { ConnectHint, Hint, Nfa, P4Button, type P4Tx } from './phase4-section';

const P4 = FundPhase4ABI as Abi;
const NFT = FundNFTPhase3ABI as Abi;
type Addr = `0x${string}`;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ethText = (wei: bigint) => formatEther(wei).replace(/\.0$/, '');

function Field({ label, hint, value, onChange, error, placeholder, inputMode }: {
  label: string; hint: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string; inputMode?: 'decimal' | 'numeric' | 'text';
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-white/55">{label}</span>
      <Input value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
      {error ? <p className="text-[12px] text-white/80">{error}</p> : <Hint>{hint}</Hint>}
    </label>
  );
}

export function CopyMandate({ fund, tx }: { fund: Phase3Detail; tx: P4Tx }) {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [image, setImage] = useState('');
  const [price, setPrice] = useState(ethText(fund.mintPrice));
  const [cap, setCap] = useState(ethText(fund.raiseCap));
  const [fee, setFee] = useState(String(fund.entryFeeBps / 100));
  const [skin, setSkin] = useState(String(Math.max(fund.minSkinBps, P3_DEFAULT_MIN_SKIN_BPS) / 100));
  const [days, setDays] = useState('7');
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<Addr | null | undefined>(undefined);

  const toBps = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s.trim()) * 100) : NaN);
  const check = checkPhase3Draft({
    name, symbol, imageUri: image, mintPriceEth: price, raiseCapEth: cap, raiseDays: days,
    templateId: fund.templateId, entryFeeBps: toBps(fee), skinBps: toBps(skin),
  });
  const err = (f: Phase3Field) => (touched || f !== 'name' && f !== 'symbol' ? check.issues.find((i) => i.field === f)?.message : undefined);

  const submit = async () => {
    setTouched(true);
    const p = check.params;
    if (!p) return;
    const fundAddr = await tx.clone(fund.address, {
      name: p.name, symbol: p.symbol, imageUri: p.imageUri, baseURI: p.baseURI, mintPrice: p.mintPrice,
      raiseCap: p.raiseCap, entryFeeBps: p.entryFeeBps, minSkinBps: p.minSkinBps, raiseDuration: p.raiseDuration,
    });
    if (fundAddr !== undefined) setCreated(fundAddr);
  };

  return (
    <Card title="Copy this mandate">
      <Hint>{P4_COPY.cloneTip}</Hint>
      {created !== undefined ? (
        <div className="mt-3 space-y-2 rounded-lg bg-white/[0.06] p-3 text-[13px] text-white/80">
          <p>The transaction confirmed on Robinhood Chain.</p>
          {created ? (
            <Link href={`/funds/${created}`} className="underline hover:text-white">Open the new tokenized fund</Link>
          ) : (
            <Link href="/funds" className="underline hover:text-white">Find the new tokenized fund in the list</Link>
          )}
          <Hint>Next, mint your manager shares on the new tokenized fund page.</Hint>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Field label="Name" hint="Up to 64 characters." value={name} onChange={setName} error={err('name')} placeholder="My tokenized fund" />
          <Field label="Ticker" hint="Up to 16 characters, like FUND." value={symbol} onChange={setSymbol} error={err('symbol')} placeholder="FUND" />
          <Field label="Image link (optional)" hint="A link to a square image." value={image} onChange={setImage} error={err('imageUri')} placeholder="Or paste an image link" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Share price (ETH)" hint="Between 0.00001 and 100 ETH." value={price} onChange={setPrice} error={err('mintPriceEth')} inputMode="decimal" />
            <Field label="Raise goal (ETH)" hint="At most 10,000 shares in total." value={cap} onChange={setCap} error={err('raiseCapEth')} inputMode="decimal" />
            <Field label="Entry fee (%)" hint="0% to 5%. Taken from each purchase." value={fee} onChange={setFee} error={err('entryFeeBps')} inputMode="decimal" />
            <Field label="Manager share (%)" hint="5% to 100% of shares. You buy these yourself." value={skin} onChange={setSkin} error={err('skinBps')} inputMode="decimal" />
          </div>
          <Field label="Raise length (days)" hint="1 to 30 days." value={days} onChange={setDays} error={err('raiseDays')} inputMode="numeric" />
          {!tx.account ? <ConnectHint /> : (
            <>
              <P4Button tx={tx} id="clone" primary label="Copy this mandate (sign 1 transaction)" disabled={touched && !check.params} onClick={submit} />
              <Hint>Your wallet sends the call straight to the tokenized fund factory. The strategy stays the same as this tokenized fund.</Hint>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function ShareWallet({ fund, tx }: { fund: Phase3Detail; tx: P4Tx }) {
  const [idText, setIdText] = useState(fund.myIds[0]?.toString() ?? '');
  const tokenId = /^\d+$/.test(idText.trim()) ? BigInt(idText.trim()) : null;
  const { data, isLoading, isError } = useShareWallet(fund.address, tokenId);
  const mine = tokenId !== null && fund.myIds.includes(tokenId);
  return (
    <Card title="Per-share wallet">
      <Hint>{P4_COPY.walletTip1}</Hint>
      <div className="mt-1"><Hint>{P4_COPY.walletTip2}</Hint></div>
      <div className="mt-3 space-y-3">
        {fund.myIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fund.myIds.slice(0, 20).map((id) => (
              <button key={id.toString()} type="button" onClick={() => setIdText(id.toString())}
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${tokenId === id ? 'border-white bg-white text-black' : 'border-white/20 text-white/70 hover:text-white'}`}>
                #{id.toString()}
              </button>
            ))}
          </div>
        )}
        <Field label="Share number" hint="Pick one of your shares above, or type any share number to look it up." value={idText} onChange={setIdText} inputMode="numeric" placeholder="1" />
        {tokenId === null ? null : isLoading ? <Hint>Reading…</Hint> : isError || !data ? (
          <Hint>Could not read the wallet right now. Try again later.</Hint>
        ) : !data.enabled ? (
          <p className="text-[13px] text-white/75">{P4_COPY.walletOff}</p>
        ) : (
          <div className="space-y-2">
            <p className="break-all font-mono text-[13px] text-white">{data.wallet}</p>
            <Hint>{data.created ? 'This wallet exists on Robinhood Chain.' : 'This address is reserved for the share. The wallet is not created yet.'}</Hint>
            {!data.created && (!tx.account ? <ConnectHint /> : (
              <>
                <P4Button tx={tx} id="wallet" primary label="Create the wallet (sign 1 transaction)" disabled={!mine}
                  onClick={() => tx.send({ key: 'wallet', address: FUND_PHASE4 as Addr, abi: P4, functionName: 'createShareAccount', args: [fund.address, tokenId], working: 'Creating the wallet', success: 'Wallet created' })} />
                <Hint>{mine ? 'Only the wallet holding the share can create it.' : 'Only the wallet holding this share can create it.'}</Hint>
              </>
            ))}
          </div>
        )}
        <Nfa />
      </div>
    </Card>
  );
}

export function OfferToBuy({ fund, tx, now }: { fund: Phase3Detail; tx: P4Tx; now: number }) {
  const { data: offers, isLoading, isError } = useOffers(fund.address);
  const [idText, setIdText] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('7');
  const tokenId = /^\d+$/.test(idText.trim()) ? BigInt(idText.trim()) : null;
  let wei: bigint | null = null;
  try { wei = /^\d+(\.\d{1,18})?$/.test(amount.trim()) ? parseEther(amount.trim()) : null; } catch { wei = null; }
  const end = endTimeFromDays(days, now);
  const amountError = amount.trim() ? offerAmountIssue(wei, fund.navPerNft) : undefined;
  const idError = idText.trim() && tokenId === null ? 'Enter a share number.' : tokenId !== null && fund.myIds.includes(tokenId) ? 'You hold this share.' : undefined;
  const ready = tokenId !== null && !idError && wei !== null && !offerAmountIssue(wei, fund.navPerNft) && end.end !== null;
  const lockActive = now > 0 && fund.skinUnlockTime > now;
  const p4 = FUND_PHASE4 as Addr;

  return (
    <Card title="Offer to buy one share">
      <Hint>{P4_COPY.offerTip}</Hint>
      <div className="mt-3 space-y-3">
        <Field label="Share number" hint="The share you want to buy." value={idText} onChange={setIdText} error={idError} inputMode="numeric" placeholder="1" />
        <Field label="Your offer (ETH)" hint={fund.navPerNft !== null ? `At most ${formatFundEth(fund.navPerNft)} ETH, the net value per share now. At least 0.00001 ETH.` : 'At or below the net value per share. At least 0.00001 ETH.'}
          value={amount} onChange={setAmount} error={amountError} inputMode="decimal" placeholder={fund.navPerNft !== null ? formatFundEth(fund.navPerNft) : ''} />
        <Field label="Offer ends after (days from now)" hint={end.end ? `Ends ${utcDate(end.end)}. At most 30 days.` : 'At most 30 days.'} value={days} onChange={setDays} error={end.error} inputMode="decimal" />
        {lockActive && <Hint>Manager shares are locked until {utcDate(fund.skinUnlockTime)}. An offer on a locked share can be placed but cannot complete until the lock ends.</Hint>}
        {!tx.account ? <ConnectHint /> : (
          <>
            <P4Button tx={tx} id="bid" primary label={wei && ready ? `Lock ${formatFundEth(wei)} ETH and place the offer (sign 1 transaction)` : 'Place the offer'} disabled={!ready}
              onClick={() => wei && tokenId !== null && end.end && tx.send({ key: 'bid', address: p4, abi: P4, functionName: 'placeBid', args: [fund.address, tokenId, BigInt(end.end)], value: wei, working: 'Placing the offer', success: 'Offer placed' }).then((r) => { if (r) setAmount(''); })} />
            <Hint>Your ETH stays locked in the Phase 4 contract until the holder accepts or the offer is cancelled.</Hint>
          </>
        )}
      </div>
      <div className="mt-4 border-t border-white/5 pt-3">
        <h3 className="text-[13px] font-medium text-white">Offers on this tokenized fund</h3>
        {isLoading ? <Hint>Reading…</Hint> : isError ? <Hint>Could not read offers right now. Try again later.</Hint> : !offers?.length ? <Hint>No offers yet.</Hint> : (
          <ul className="mt-2 space-y-3">
            {offers.slice(0, 30).map((o) => <OfferRow key={o.id.toString()} o={o} fund={fund} tx={tx} now={now} />)}
          </ul>
        )}
      </div>
      <div className="mt-3"><Nfa /></div>
    </Card>
  );
}

function OfferRow({ o, fund, tx, now }: { o: Offer; fund: Phase3Detail; tx: P4Tx; now: number }) {
  const p4 = FUND_PHASE4 as Addr;
  const isHolder = same(o.holder, tx.account);
  const isBidder = same(o.bidder, tx.account);
  const locked = same(o.holder, fund.manager) && now > 0 && fund.skinUnlockTime > now;
  const state = !o.open ? 'Closed' : o.expired ? 'Expired' : 'Open';
  return (
    <li className="rounded-lg border border-white/10 p-3 text-[12px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-white">Offer #{o.id.toString()} for share #{o.tokenId.toString()}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/75">{state}</span>
      </div>
      <p className="mt-1 font-mono text-white/70">{formatFundEth(o.amount)} ETH from {shortenAddress(o.bidder)}{isBidder ? ' (you)' : ''}</p>
      <p className="text-white/50">Ends {utcDate(o.expiry)}</p>
      {o.open && <p className="text-white/50">{o.withinNav ? 'Within the net value per share now.' : 'Above the net value per share now. It cannot be accepted unless the value rises.'}</p>}
      {o.open && locked && <p className="text-white/50">This share is in the manager lock until {utcDate(fund.skinUnlockTime)}. The offer cannot complete before then.</p>}
      {o.open && o.expired && <p className="text-white/50">The end time passed. Anyone can cancel it so the bidder gets the ETH back.</p>}
      {o.open && (
        <div className="mt-2 space-y-2">
          {isHolder && !o.expired && (
            o.approved ? (
              <>
                <P4Button tx={tx} id={`settle-${o.id}`} primary label={`Accept offer: send share #${o.tokenId} for ${formatFundEth(o.amount)} ETH (sign 1 transaction)`} disabled={!o.withinNav || locked}
                  onClick={() => tx.send({ key: `settle-${o.id}`, address: p4, abi: P4, functionName: 'settleBid', args: [o.id], working: 'Accepting the offer', success: 'Offer accepted' })} />
                <Hint>The share goes to the bidder and the ETH comes to you in the same transaction. The tokenized fund does not pay anyone.</Hint>
              </>
            ) : (
              <>
                <P4Button tx={tx} id={`approve-${o.id}`} label={`Approve the Phase 4 contract for share #${o.tokenId} (sign 1 transaction)`}
                  onClick={() => tx.send({ key: `approve-${o.id}`, address: fund.address, abi: NFT, functionName: 'approve', args: [p4, o.tokenId], working: 'Approving', success: 'Approved. You can accept now.' })} />
                <Hint>Step 1 of 2. This lets the contract move this one share only when you accept.</Hint>
              </>
            )
          )}
          {(isBidder || o.expired) && tx.account && (
            <>
              <P4Button tx={tx} id={`cancel-${o.id}`} label="Cancel offer (sign 1 transaction)"
                onClick={() => tx.send({ key: `cancel-${o.id}`, address: p4, abi: P4, functionName: 'cancelBid', args: [o.id], working: 'Cancelling the offer', success: 'Offer cancelled' })} />
              <Hint>The locked ETH goes back to the bidder.</Hint>
            </>
          )}
        </div>
      )}
    </li>
  );
}
