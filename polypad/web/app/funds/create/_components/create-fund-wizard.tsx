'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Upload, X } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useQueryClient } from '@tanstack/react-query';
import { decodeEventLog } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { FundFactoryInvestABI } from '@/lib/contracts/fund-abi';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { getFundInvestFactoryAddress } from '@/lib/fund/address';
import {
  DEFAULT_FUND_DRAFT,
  DEFAULT_RAISE_DURATION_DAYS,
  MAX_RAISE_DURATION_DAYS,
  MIN_RAISE_DURATION_DAYS,
  bpsLabel,
  formatFundEth,
  fundTxError,
  issueFor,
  mandateHashFor,
  previewDraft,
  type FundDraft,
  type FundField,
} from '@/lib/fund/model';
import { cn } from '@/lib/utils';
import { FundNotice } from '../../_components/fund-notice';

const STEPS = [
  { label: 'Basics' },
  { label: 'Raise' },
  { label: 'Rules' },
  { label: 'Fees' },
  { label: 'Review' },
];

const STEP_FIELDS: FundField[][] = [
  ['name', 'symbol', 'imageUri'],
  ['mintPriceEth', 'raiseCapEth'],
  ['mandateText', 'mandateUri', 'raiseDurationDays', 'assetsText', 'maxPositionBps', 'maxTradeBps', 'maxDeviationBps'],
  ['entryFeeBps', 'skinBps', 'baseUri'],
  ['name', 'symbol', 'imageUri', 'baseUri', 'mintPriceEth', 'raiseCapEth', 'entryFeeBps', 'skinBps', 'mandateText', 'mandateUri', 'raiseDurationDays', 'assetsText'],
];

export function CreateFundWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const [step, setStep] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState<FundDraft>(DEFAULT_FUND_DRAFT);
  const [advanced, setAdvanced] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [created, setCreated] = useState<{ fund?: string; vault?: string; hash: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const result = previewDraft(draft);
  const investFactory = getFundInvestFactoryAddress();
  const steps = STEPS;
  const stepFields = STEP_FIELDS;
  const stepIssues = result.issues.filter((issue) => stepFields[step]?.includes(issue.field));
  const preview = result.preview;

  const update = <K extends keyof FundDraft>(field: K, value: FundDraft[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const goNext = () => {
    if (stepIssues.length) {
      setReveal(true);
      return;
    }
    setReveal(false);
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const goBack = () => {
    setReveal(false);
    setStep((current) => Math.max(current - 1, 0));
  };

  const shown = (field: FundField) => (reveal ? issueFor(stepIssues, field) : undefined);

  const handleLogoFile = async (file?: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('Use a PNG, JPG, WEBP or GIF image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const res = await fetch('/api/upload/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Upload failed');
      const formData = new FormData();
      const fields = data?.fields;
      if (!data?.uploadUrl || !fields || typeof fields !== 'object') throw new Error('Upload failed');
      for (const [key, value] of Object.entries(fields)) formData.append(key, String(value));
      formData.append('file', file);
      const upload = await fetch(data.uploadUrl, { method: 'POST', body: formData });
      if (!upload.ok) throw new Error(`Upload failed (${upload.status})`);
      update('imageUri', data.publicUrl);
      toast.success('Image uploaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      toast.error(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreate = async () => {
    const checked = previewDraft(draft);
    if (!checked.params || !publicClient) {
      setReveal(true);
      toast.error(checked.issues[0]?.message ?? 'Check the fund settings.');
      return;
    }
    setDeploying(true);
    const tid = toast.loading('Confirm the transaction in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) {
        await switchChainAsync({ chainId: robinhoodChain.id });
      }
      const params = checked.params;
      if (!investFactory) {
        toast.dismiss(tid);
        toast.error('The investing factory is not configured yet.');
        return;
      }
      const hash = await writeContractAsync({
        address: investFactory as `0x${string}`,
        abi: FundFactoryInvestABI,
        functionName: 'createFund',
        chainId: robinhoodChain.id,
        args: [{
          name: params.name,
          symbol: params.symbol,
          imageUri: params.imageUri,
          baseURI: params.baseURI,
          mintPrice: params.mintPrice,
          raiseCap: params.raiseCap,
          entryFeeBps: params.entryFeeBps,
          minSkinBps: params.minSkinBps,
          raiseDuration: params.raiseDuration,
          mandateHash: params.mandateHash,
          assets: params.assets,
          mandateUri: params.mandateUri,
          maxPositionBps: params.maxPositionBps,
          maxTradeBps: params.maxTradeBps,
          maxDeviationBps: params.maxDeviationBps,
        }],
      });
      toast.loading('Creating the fund on Robinhood Chain…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      let fund: string | undefined;
      let vault: string | undefined;
      for (const log of receipt.logs) {
        try {
          const event = decodeEventLog({ abi: FundFactoryInvestABI, data: log.data, topics: log.topics });
          if (event.eventName === 'FundCreated') {
            fund = event.args.fund;
            vault = event.args.vault;
            break;
          }
        } catch {
          /* not a factory event */
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['funds'] });
      setCreated({ fund, vault, hash });
      toast.success('Fund created', {
        id: tid,
        action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') },
      });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setDeploying(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-[700px] px-5 py-8 sm:py-12">
        <div className="glass-card space-y-4 rounded-xl p-4 sm:p-6">
          <h1 className="text-[18px] font-semibold">Fund created</h1>
          <p className="text-[13px] leading-relaxed text-white/60">
            The NFT contract is the fund. The vault holds the ETH. Other wallets cannot mint until you mint the manager share.
          </p>
          {created.fund && created.vault ? (
            <dl className="space-y-2 text-[13px]">
              <AddressRow label="Fund NFT" address={created.fund} />
              <AddressRow label="Vault" address={created.vault} />
            </dl>
          ) : (
            <p className="text-[13px] text-white/60">
              The transaction succeeded. Open it on the explorer if the fund address is not shown here, or find it in the fund list.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            {created.fund && (
              <Button onClick={() => router.push(`/funds/${created.fund}?mint=skin`)}>
                Mint your manager share
              </Button>
            )}
            <Button variant="secondary" onClick={() => router.push(created.fund ? `/funds/${created.fund}` : '/funds')}>
              {created.fund ? 'View fund' : 'Back to funds'}
            </Button>
          </div>
          <a className="inline-block text-[12px] text-polydash-green" href={getExplorerTxUrl(created.hash)} target="_blank" rel="noopener noreferrer">
            View transaction
          </a>
          <FundNotice />
        </div>
      </div>
    );
  }

  const feesStep = 3;
  const reviewStep = 4;
  const mandateHash = draft.mandateText.trim()
    ? mandateHashFor(draft.mandateText.trim())
    : null;

  return (
    <div className="mx-auto max-w-[700px] space-y-5 px-5 py-8 sm:space-y-6 sm:py-12">
      <div className="space-y-2">
        <Link href="/funds" className="text-[12px] text-white/50 hover:text-white">Funds</Link>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">Create a fund</h1>
        <p className="text-[13px] leading-relaxed text-white/60">
          Five short steps: name your fund, set the price and goal, write its rules, choose fees, then review. Investors buy shares of the fund with ETH, and the money is held by the fund’s own contract (the vault). You sign one transaction at the end. No ETH is sent when you create the fund.
        </p>
        <p className="text-[12px] leading-relaxed text-white/50">
          Type of fund: Invest fund. A manager buys tokens within the rules you set.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        {steps.map((item, index) => (
          <div key={item.label} className="flex items-center gap-1.5 sm:gap-2">
            <div className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs',
              index === step ? 'bg-primary/10 text-primary' : index < step ? 'bg-primary/5 text-primary/60' : 'bg-secondary text-muted-foreground',
            )}>
              {index < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{index + 1}</span>}
              <span>{item.label}</span>
            </div>
            {index < steps.length - 1 && <div className="hidden h-px w-3 bg-border sm:block sm:w-6" />}
          </div>
        ))}
      </div>

      <div className="glass-card space-y-4 rounded-xl p-4 sm:p-6">
        {step === 0 && (
          <>
            <h2 className="text-[15px] font-semibold">Basics</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" error={shown('name')}>
                <Input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Example Fund" className="bg-secondary/50" />
              </Field>
              <Field label="Ticker" error={shown('symbol')}>
                <Input value={draft.symbol} onChange={(event) => update('symbol', event.target.value)} placeholder="EX" className="bg-secondary/50" />
              </Field>
            </div>
            <Field label="Image, optional" error={shown('imageUri')}>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => handleLogoFile(event.target.files?.[0])} />
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/15 bg-secondary/30 p-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5">
                  {draft.imageUri ? (
                    <img src={draft.imageUri} alt="" className="h-full w-full object-cover" />
                  ) : uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{draft.imageUri ? 'Image added' : 'Add an image'}</p>
                  <p className="text-[11px] text-muted-foreground">PNG, JPG, WEBP, or GIF, up to 5 MB. Or paste a link.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? 'Uploading…' : draft.imageUri ? 'Change' : 'Choose'}
                  </Button>
                  {draft.imageUri && !uploading && (
                    <button type="button" aria-label="Remove image" onClick={() => update('imageUri', '')} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <Input
                value={draft.imageUri}
                onChange={(event) => update('imageUri', event.target.value)}
                placeholder="https://"
                className="mt-2 bg-secondary/50 font-mono text-[12px]"
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-[15px] font-semibold">Raise</h2>
            <p className="text-[12px] leading-relaxed text-white/55">
              NFT count is the raise goal divided by the mint price, rounded down. Leftover ETH cannot mint part of an NFT.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Mint price (ETH)" error={shown('mintPriceEth') ?? issueFor(result.issues, 'mintPriceEth')}>
                <Input value={draft.mintPriceEth} onChange={(event) => update('mintPriceEth', event.target.value)} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Raise goal (ETH)" error={shown('raiseCapEth') ?? issueFor(result.issues, 'raiseCapEth')}>
                <Input value={draft.raiseCapEth} onChange={(event) => update('raiseCapEth', event.target.value)} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
            </div>
            <PreviewCard draft={draft} />
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-[15px] font-semibold">Rules</h2>
            <p className="text-[12px] leading-relaxed text-white/55">
              The mandate is the lock on what this fund may do. Investors read the text at the link below; the fingerprint of that text is stored on the vault and cannot be changed after creation.
            </p>
            <Field label="Mandate text" error={shown('mandateText')}>
              <textarea
                value={draft.mandateText}
                onChange={(event) => update('mandateText', event.target.value)}
                placeholder="Example: hold WETH plus up to 60% in USDC. No leverage. Rebalance at most once a day."
                rows={4}
                className="w-full rounded-lg border border-white/10 bg-secondary/50 p-3 text-[13px] leading-relaxed text-white placeholder:text-white/30"
              />
              {mandateHash && (
                <p className="mt-1 break-all font-mono text-[11px] text-white/40">Fingerprint of the fund&apos;s rules (mandate hash) {mandateHash}</p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">A short code made from the exact text above. It is saved on-chain so anyone can check the rules were not changed later.</p>
            </Field>
            <Field label="Mandate link (ipfs:// or https://)" error={shown('mandateUri')}>
              <Input value={draft.mandateUri} onChange={(event) => update('mandateUri', event.target.value)} placeholder="ipfs://…" className="bg-secondary/50 font-mono text-[12px]" />
              <p className="mt-1 text-[11px] text-muted-foreground">Put the same text you wrote above at this link. The vault saves the link next to the fingerprint.</p>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={`Raise length (days, ${MIN_RAISE_DURATION_DAYS}–${MAX_RAISE_DURATION_DAYS})`} error={shown('raiseDurationDays')}>
                <Input value={draft.raiseDurationDays} onChange={(event) => update('raiseDurationDays', event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="bg-secondary/50 font-mono" />
              </Field>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Swap caps (BPS of NAV)</label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-[11px] text-muted-foreground">
                    Position
                    <Input value={String(draft.maxPositionBps)} onChange={(event) => update('maxPositionBps', Number(event.target.value.replace(/[^\d]/g, '')) || 0)} inputMode="numeric" className="mt-1 bg-secondary/50 font-mono text-[12px]" />
                  </label>
                  <label className="block text-[11px] text-muted-foreground">
                    Trade
                    <Input value={String(draft.maxTradeBps)} onChange={(event) => update('maxTradeBps', Number(event.target.value.replace(/[^\d]/g, '')) || 0)} inputMode="numeric" className="mt-1 bg-secondary/50 font-mono text-[12px]" />
                  </label>
                  <label className="block text-[11px] text-muted-foreground">
                    Deviation
                    <Input value={String(draft.maxDeviationBps)} onChange={(event) => update('maxDeviationBps', Number(event.target.value.replace(/[^\d]/g, '')) || 0)} inputMode="numeric" className="mt-1 bg-secondary/50 font-mono text-[12px]" />
                  </label>
                </div>
                {(shown('maxPositionBps') ?? shown('maxTradeBps') ?? shown('maxDeviationBps')) && (
                  <p className="mt-1 text-[12px] text-red-300">{shown('maxPositionBps') ?? shown('maxTradeBps') ?? shown('maxDeviationBps')}</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">Defaults 7500 / 7500 / 5000. Caps are set at creation and cannot be loosened later.</p>
              </div>
            </div>
            <Field label="Extra assets, one address per line (optional — empty means WETH only)" error={shown('assetsText')}>
              <textarea
                value={draft.assetsText}
                onChange={(event) => update('assetsText', event.target.value)}
                placeholder={'0x…\n0x…'}
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-secondary/50 p-3 font-mono text-[12px] text-white placeholder:text-white/30"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Each asset must already be on the allowlist with a price feed. WETH is the quote and is not listed here.</p>
            </Field>
            <p className="text-[12px] leading-relaxed text-white/55">
              If the raise does not fill before the deadline, anyone can mark it failed and holders can claim a refund of the spendable ETH. Fees are not refunded.
            </p>
          </>
        )}

        {step === feesStep && preview && (
          <>
            <h2 className="text-[15px] font-semibold">Fees and your share</h2>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Entry fee: {bpsLabel(draft.entryFeeBps)}</label>
              <Slider value={[draft.entryFeeBps]} min={0} max={500} step={50} onValueChange={(value) => update('entryFeeBps', value[0] ?? 0)} />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>0%</span>
                <span>5% maximum</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-white/55">
                Optional. Taken from the ETH paid on each mint, up to 5%. The default is 0%. It is not taken from NFTs that were already minted.
              </p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3 text-[12px] leading-relaxed text-white/70">
              <p>
                You mint {preview.skinRequired.toString()} of {preview.maxSupply.toString()} NFTs yourself before anyone else can. That is {bpsLabel(Number(preview.skinBps))} of the supply, at the same price.
              </p>
              <p className="mt-2">
                You pay {formatFundEth(preview.managerEth)} ETH. The 0.2% protocol fee on that payment is {formatFundEth(preview.protocolFeeOnManagerMint)} ETH. That fee is not returned.
                {preview.entryFeeOnManagerMint > 0n ? ` Your entry fee on it is ${formatFundEth(preview.entryFeeOnManagerMint)} ETH.` : ' You are not taking an entry fee.'}
                {' '}The rest stays in the vault. You do not have to keep the NFTs afterward. Minting them is what opens the raise.
              </p>
            </div>
            <button type="button" className="text-[12px] text-white/60 underline-offset-2 hover:text-white hover:underline" onClick={() => setAdvanced((open) => !open)} aria-expanded={advanced}>
              {advanced ? 'Hide extra options' : 'Change the manager share or metadata link'}
            </button>
            {advanced && (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Manager share: {bpsLabel(draft.skinBps)}</label>
                  <Slider value={[draft.skinBps]} min={500} max={10000} step={100} onValueChange={(value) => update('skinBps', value[0] ?? 500)} />
                  <p className="mt-2 text-[12px] text-white/55">5% is the minimum. A higher share means you mint more NFTs before other wallets can.</p>
                  {shown('skinBps') && <p className="mt-1 text-[12px] text-red-300">{shown('skinBps')}</p>}
                </div>
                <Field label="Metadata link, optional" error={shown('baseUri')}>
                  <Input value={draft.baseUri} onChange={(event) => update('baseUri', event.target.value)} placeholder="https://" className="bg-secondary/50 font-mono text-[12px]" />
                  <p className="mt-1 text-[11px] text-muted-foreground">Leave this blank to use the image for every NFT. It can be changed until an NFT is minted.</p>
                </Field>
              </div>
            )}
          </>
        )}

        {step === reviewStep && result.params && (
          <>
            <h2 className="text-[15px] font-semibold">Review and create</h2>
            <dl className="space-y-1 text-sm">
              <ReviewRow label="Type of fund" value="Invest fund" />
              <ReviewRow label="Name" value={result.params.name} />
              <ReviewRow label="Ticker" value={result.params.symbol} />
              <ReviewRow label="Price per share" value={`${formatFundEth(result.params.mintPrice)} ETH`} />
              <ReviewRow label="Raise goal" value={`${formatFundEth(result.params.raiseCap)} ETH`} />
              <ReviewRow label="Shares" value={result.params.maxSupply.toString()} />
              <ReviewRow label="Leftover" value={result.params.dust === 0n ? 'None' : `${formatFundEth(result.params.dust)} ETH`} />
              <ReviewRow label="Entry fee" value={bpsLabel(Number(result.params.entryFeeBps))} />
              <ReviewRow label="Your shares before others" value={`${result.params.skinRequired.toString()} · ${formatFundEth(result.params.managerEth)} ETH`} />
              <ReviewRow label="Protocol fee on your shares (0.2%)" value={`${formatFundEth(result.params.protocolFeeOnManagerMint)} ETH`} />
              <ReviewRow label="Protocol fee if the raise fills" value={`${formatFundEth(result.params.protocolFeeOnFullRaise)} ETH`} />
              {result.params.mandateHash && (
                <>
                  <ReviewRow label="Fingerprint of the fund's rules (mandate hash)" value={`${result.params.mandateHash.slice(0, 10)}…${result.params.mandateHash.slice(-6)}`} />
                  <ReviewRow label="Where to read the rules (mandate link)" value={result.params.mandateUri} />
                  <ReviewRow label="Raise open for" value={`${Number(result.params.raiseDuration / 86_400n)} days`} />
                  <ReviewRow label="Tokens it may buy" value={result.params.assets.length ? `${result.params.assets.length} asset(s)` : 'WETH only'} />
                  <ReviewRow label="Limits (one token / per trade / price gap)" value={`${bpsLabel(Number(result.params.maxPositionBps))} / ${bpsLabel(Number(result.params.maxTradeBps))} / ${bpsLabel(Number(result.params.maxDeviationBps))}`} />
                </>
              )}
            </dl>
            {result.params.imageUri && (
              <img src={result.params.imageUri} alt="" className="h-12 w-12 rounded-full object-cover" />
            )}
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-[12px] leading-relaxed text-yellow-200">
              What happens next: you sign one transaction to create the fund. No ETH is sent. Buying your manager shares is a second step on the fund page. After the raise closes, the manager can trade only within the rules, the approved tokens and the limits above, which cannot be changed later. The 0.2% protocol fee and any entry fee are not part of a refund. Unaudited. Not financial advice.
            </div>
          </>
        )}

        <div className="flex justify-between gap-3">
          {step === 0 ? (
            <Button variant="secondary" onClick={() => router.push('/funds')}>Cancel</Button>
          ) : (
            <Button variant="secondary" onClick={goBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {step < reviewStep ? (
            <Button onClick={goNext} disabled={uploading} className="gap-2">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : !isConnected ? (
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <Button onClick={openConnectModal}>Connect wallet</Button>
              )}
            </ConnectButton.Custom>
          ) : (
            <Button onClick={handleCreate} disabled={deploying || !result.params} className="gap-2">
              {deploying && <Loader2 className="h-4 w-4 animate-spin" />}
              {deploying ? 'Creating…' : 'Create fund'}
            </Button>
          )}
        </div>
      </div>
      <FundNotice mode="invest" />
    </div>
  );
}

function PreviewCard({ draft }: { draft: FundDraft }) {
  const { preview, issues } = previewDraft(draft);
  if (!preview) {
    const message = issues.find((issue) => issue.field === 'mintPriceEth' || issue.field === 'raiseCapEth')?.message;
    return <p className="rounded-lg bg-secondary/30 p-3 text-[12px] text-white/60">{message ?? 'Enter a mint price and a raise goal.'}</p>;
  }
  const supplyIssue = issues.find((issue) => issue.field === 'raiseCapEth' && issue.message.includes('10,000'));
  return (
    <div className="space-y-1 rounded-lg bg-secondary/30 p-3 text-[12px] leading-relaxed text-white/70">
      <p><span className="text-white">{preview.maxSupply.toString()} NFTs</span> at {formatFundEth(preview.mintPrice)} ETH.</p>
      <p>
        {preview.dust === 0n
          ? 'No leftover. The goal divides into whole NFTs.'
          : `${formatFundEth(preview.dust)} ETH of the goal is left over and cannot mint another NFT. The raise can collect ${formatFundEth(preview.effectiveRaise)} ETH.`}
      </p>
      <p>You mint {preview.skinRequired.toString()} before anyone else, which costs {formatFundEth(preview.managerEth)} ETH. The 0.2% protocol fee on that is {formatFundEth(preview.protocolFeeOnManagerMint)} ETH.</p>
      {supplyIssue && <p className="text-red-300">{supplyIssue.message}</p>}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-red-300">{error}</span>}
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/20 py-1.5 last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="max-w-[60%] truncate text-right font-mono text-xs">{value}</dd>
    </div>
  );
}

function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/50">{label}</dt>
      <dd>
        <a className="font-mono text-[12px] text-polydash-green" href={getExplorerAddressUrl(address)} target="_blank" rel="noopener noreferrer">
          {address.slice(0, 6)}…{address.slice(-4)}
        </a>
      </dd>
    </div>
  );
}
