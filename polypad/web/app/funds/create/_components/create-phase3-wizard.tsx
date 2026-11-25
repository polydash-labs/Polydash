'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Upload, X } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { decodeEventLog } from 'viem';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { BuyEthButton } from '@/components/onramp/buy-eth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { FundFactoryPhase3ABI } from '@/lib/contracts/fund-phase3-abi';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { formatFundEth } from '@/lib/fund/model';
import {
  DEFAULT_PHASE3_DRAFT,
  FUND_FACTORY_PHASE3,
  STRATEGY_TEMPLATE,
  P3_MAX_DAYS,
  P3_MIN_DAYS,
  checkPhase3Draft,
  daysLabel,
  hwmExample,
  pct,
  templateLine,
  templateName,
  type Phase3Draft,
  type Phase3Field,
  type StrategyTemplateView,
} from '@/lib/fund/phase3';
import { usePhase3Templates, usePhase3Tx } from '@/lib/fund/use-phase3';
import { ALLOWLIST_NOTE, FUND_FACTORY_V2, GROWTH_DEFAULT_TEMPLATE_ID, GROWTH_FEE_COPY, GROWTH_FEE_OPTIONS, MOMENTUM_SUMMARY, TEMPLATE2, THESIS_LINES, YIELD_SUMMARY, checkThesisUri, clampThesis, factoryForTemplate, growthLabel, growthLines, ipfsToHttp, isGrowthTemplate, isMomentumTemplate, matchesGrowthStrategy, momentumLines, phase6TxError, templateTitle, yieldLines } from '@/lib/fund/phase6';
import { FUND_FACTORY_V3, LP_DEFAULT_TEMPLATE_ID, LP_FEE_OPTIONS, LP_SUMMARY, OPTIN_COPY, isLpTemplate, isYieldTemplate, lpLines } from '@/lib/fund/phase7';
import { DERIVED_MANDATE_NOTE, bundledMandate, isDerivedMandate } from '@/lib/fund/mandates';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ContractLink, P3Label, P3Note } from '../../_components/phase3-ui';
import { AllowlistMenu } from '../../_components/allowlist-menu';

const STEPS: { label: string; fields: Phase3Field[] }[] = [
  { label: 'Basics', fields: ['name', 'symbol', 'imageUri', 'mintPriceEth', 'raiseCapEth', 'raiseDays'] },
  { label: 'Strategy', fields: ['templateId'] },
  { label: 'Fees', fields: ['entryFeeBps'] },
  { label: 'Manager stake', fields: ['skinBps'] },
  { label: 'Review', fields: [] },
];

const primary = 'bg-white text-black hover:bg-white/90';

export function CreatePhase3Wizard() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const templates = usePhase3Templates();
  const { send, pending } = usePhase3Tx();
  const [step, setStep] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState<Phase3Draft>(DEFAULT_PHASE3_DRAFT);
  const [uploading, setUploading] = useState(false);
  const [thesis, setThesis] = useState('');
  const [thesisUri, setThesisUri] = useState('');
  const [thesisCopied, setThesisCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const copyThesis = async () => {
    const text = [thesis.trim(), thesisUri.trim()].filter(Boolean).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setThesisCopied(true);
    setTimeout(() => setThesisCopied(false), 3000);
  };

  const checked = checkPhase3Draft(draft);
  const stepIssues = checked.issues.filter((i) => STEPS[step].fields.includes(i.field));
  const err = (f: Phase3Field) => (reveal ? stepIssues.find((i) => i.field === f)?.message : undefined);
  const list = templates.data ?? [];
  const chosen: StrategyTemplateView | undefined = list.find((t) => t.id === draft.templateId);
  const set = <K extends keyof Phase3Draft>(k: K, v: Phase3Draft[K]) => setDraft((p) => ({ ...p, [k]: v }));
  const noTemplates = templates.isSuccess && list.length === 0;
  const factory = factoryForTemplate(draft.templateId ?? 1);
  const isV2 = factory === FUND_FACTORY_V2;
  const isV3 = factory === FUND_FACTORY_V3;
  const isLp = isLpTemplate(draft.templateId);
  const thesisUriError = thesisUri.trim() ? checkThesisUri(thesisUri) : null;
  const thesisLines = thesis.split('\n').map((l) => l.trim()).filter(Boolean);
  // Performance-fee choice for the Polydash Growth card: only fees whose template exists on-chain with the Growth strategy.
  const growthOpts = GROWTH_FEE_OPTIONS.filter((o) => { const t = list.find((x) => x.id === o.templateId); return !!t && matchesGrowthStrategy(t); });
  const [growthPick, setGrowthPick] = useState<number>(GROWTH_DEFAULT_TEMPLATE_ID);
  const growthFeeBps = GROWTH_FEE_OPTIONS.find((o) => o.templateId === growthPick)?.feeBps ?? 500;
  const [lpPick, setLpPick] = useState<number>(LP_DEFAULT_TEMPLATE_ID);
  const lpOpts = LP_FEE_OPTIONS.filter((o) => list.some((x) => x.id === o.templateId));
  const lpFeeBps = LP_FEE_OPTIONS.find((o) => o.templateId === lpPick)?.feeBps ?? 500;
  const [optLp, setOptLp] = useState(true);
  const [optStake, setOptStake] = useState(true);
  const cards = list.filter((t) => (!isGrowthTemplate(t.id) || t.id === TEMPLATE2.id) && (!isLpTemplate(t.id) || t.id === LP_DEFAULT_TEMPLATE_ID));
  const pickGrowthFee = (id: number) => { setGrowthPick(id); set('templateId', id); };

  const next = () => {
    if (stepIssues.length || (step === 1 && thesisUriError)) { setReveal(true); return; }
    setReveal(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { setReveal(false); setStep((s) => Math.max(s - 1, 0)); };

  const upload = async (file?: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { toast.error('Use a PNG, JPG, WEBP or GIF image.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be 5 MB or smaller.'); return; }
    setUploading(true);
    try {
      const res = await fetch('/api/upload/logo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: file.type }) });
      const data = await res.json();
      if (!res.ok || !data?.uploadUrl || !data?.fields) throw new Error(data?.error ?? 'Upload failed');
      const form = new FormData();
      for (const [k, v] of Object.entries(data.fields)) form.append(k, String(v));
      form.append('file', file);
      const up = await fetch(data.uploadUrl, { method: 'POST', body: form });
      if (!up.ok) throw new Error(`Upload failed (${up.status})`);
      set('imageUri', data.publicUrl);
      toast.success('Image uploaded');
    } catch (e) {
      console.error('Fund image upload failed', e);
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const create = async () => {
    const p = checked.params;
    if (!p) { setReveal(true); toast.error(checked.issues[0]?.message ?? 'Check the tokenized fund settings.'); return; }
    const receipt = await send({
      key: 'create',
      address: factory,
      abi: FundFactoryPhase3ABI,
      functionName: 'createFund',
      args: [p],
      working: 'Creating the tokenized fund',
      success: 'Tokenized fund created',
      ...(isV2 || isV3 ? { mapError: phase6TxError } : {}),
    });
    if (!receipt) return;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: FundFactoryPhase3ABI, data: log.data, topics: log.topics });
        if (ev.eventName === 'FundCreated') { router.push(`/funds/${ev.args.fund}?mint=skin`); return; }
      } catch { /* not a factory event */ }
    }
    toast.message('Tokenized fund created. Open the transaction to find the tokenized fund address.', { action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(receipt.transactionHash), '_blank') } });
    router.push('/funds');
  };

  const preview = checked.preview;
  const hwm = chosen ? hwmExample(chosen.hwmFeeBps) : null;

  return (
    <div className="mx-auto max-w-[720px] space-y-5 px-5 py-8 sm:space-y-6 sm:py-12">
      <div className="space-y-2">
        <Link href="/funds" className="text-[12px] text-white/50 hover:text-white">Tokenized Funds</Link>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">Create your tokenized fund</h1>
        <p className="mt-1 text-[12px] text-white/50">About 2 minutes: 5 short steps, then 1 wallet signature (network gas only, no ETH sent). Your page goes live as soon as the transaction confirms.</p>
        <p className="text-[13px] leading-relaxed text-white/60">
          Five short steps. Your tokenized fund follows a locked strategy, charges a performance fee only on new gains, and you put your own ETH in alongside investors. You sign 1 transaction at the end. No ETH is sent when you create the tokenized fund.
        </p>
        <BuyEthButton className="pt-1" />
      </div>

      <ol className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.label} className={cn(
            'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs',
            i === step ? 'bg-white text-black' : i < step ? 'bg-white/10 text-white/80' : 'border border-white/10 text-white/45',
          )}>
            {i < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{i + 1}</span>}
            {s.label}
          </li>
        ))}
      </ol>

      <div className="glass-card space-y-4 rounded-xl p-4 sm:p-6">
        {step === 0 && (
          <>
            <h2 className="text-[15px] font-semibold">Step 1: Basics</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field required label="Tokenized fund name" tip="The name investors see on Polypad and in their wallet. Up to 64 characters." error={err('name')}>
                <Input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Type a name, e.g. My Growth Tokenized Fund" aria-required="true" className="bg-secondary/50 placeholder:italic placeholder:text-white/30" />
              </Field>
              <Field required label="Ticker" tip="A short code for the tokenized fund's shares, like MGTF. Up to 16 characters." error={err('symbol')}>
                <Input value={draft.symbol} onChange={(e) => set('symbol', e.target.value)} placeholder="Type a ticker, e.g. MGTF" aria-required="true" className="bg-secondary/50 placeholder:italic placeholder:text-white/30" />
              </Field>
            </div>
            <Field label="Image (optional)" tip="Shown on the tokenized fund page and on each share. Upload a picture or paste a link." error={err('imageUri')}>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/15 bg-secondary/30 p-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5">
                  {draft.imageUri ? <img src={draft.imageUri} alt="Tokenized fund image preview" className="h-full w-full object-cover" /> : uploading ? <Loader2 className="h-5 w-5 animate-spin text-white/50" /> : <Upload className="h-5 w-5 text-white/50" />}
                </div>
                <Input value={draft.imageUri} onChange={(e) => set('imageUri', e.target.value)} placeholder="Or paste an image link" className="min-w-0 flex-1 bg-secondary/50 text-[12px]" />
                <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'Uploading…' : 'Upload'}</Button>
                {draft.imageUri && !uploading && (
                  <button type="button" aria-label="Remove image" onClick={() => set('imageUri', '')} className="text-white/50 hover:text-white"><X className="h-4 w-4" /></button>
                )}
              </div>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Price per share (ETH)" tip="What one share costs. Everyone, including you, pays the same price. Between 0.00001 and 100 ETH." error={err('mintPriceEth')}>
                <Input value={draft.mintPriceEth} onChange={(e) => set('mintPriceEth', e.target.value)} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Raise goal (ETH)" tip="The most the tokenized fund can collect (the cap). Number of shares = goal divided by price, up to 10,000 shares." error={err('raiseCapEth')}>
                <Input value={draft.raiseCapEth} onChange={(e) => set('raiseCapEth', e.target.value)} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label={`Raise open for (days, ${P3_MIN_DAYS}–${P3_MAX_DAYS})`} tip="How long people can buy shares. If the goal is not reached by then, anyone can mark the raise failed and holders get their ETH back (fees are not refunded)." error={err('raiseDays')}>
                <Input value={draft.raiseDays} onChange={(e) => set('raiseDays', e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="bg-secondary/50 font-mono" />
              </Field>
            </div>
            {preview && (
              <p className="rounded-lg bg-secondary/30 p-3 text-[12px] leading-relaxed text-white/70">
                {preview.maxSupply.toString()} shares at {draft.mintPriceEth.trim()} ETH each.
                {preview.dust > 0n ? ` ${formatFundEth(preview.dust)} ETH of the goal cannot buy a whole share and will not be raised.` : ''}
              </p>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-[15px] font-semibold">Step 2: Choose your strategy</h2>
            <p className="text-[12px] leading-relaxed text-white/55">
              A strategy is a published set of rules (the mandate): which tokens the tokenized fund may buy, trade size limits, the performance fee, the drawdown brake and how long your stake stays locked. Once the tokenized fund is created, its strategy is locked and cannot be changed.
            </p>
            <p className="text-[12px] leading-relaxed text-white/55" data-testid="fee-strategy-note">
              The performance fee you choose picks the Strategy number. For LP-Dividend: 0% is Strategy #7, 5% is Strategy #6, 10% is Strategy #8 and 20% is Strategy #9. For Growth: 0% is Strategy #3, 5% is Strategy #2, 10% is Strategy #4 and 20% is Strategy #5. Apart from the fee, the rules are the same within each family.
            </p>
            {templates.isLoading ? (
              <div className="flex items-center gap-2 py-8 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading strategies…</div>
            ) : templates.isError ? (
              <div className="rounded-lg border border-white/10 p-4 text-[13px] text-white/60">
                Could not load strategies from Robinhood Chain. <button type="button" className="text-white underline" onClick={() => templates.refetch()}>Try again</button>
              </div>
            ) : noTemplates ? (
              <div className="rounded-lg border border-white/10 p-4 text-[13px] leading-relaxed text-white/60">
                <p className="text-white">No strategies are published yet</p>
                <p className="mt-1">Tokenized funds can be created once the strategy contract has at least one strategy. Check back later, or <Link href="/funds/create?phase=2" className="text-white underline">create a tokenized fund with your own rules</Link>.</p>
                <div className="mt-3"><ContractLink label="Strategies" address={STRATEGY_TEMPLATE} /></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Strategies">
                {cards.map((t) => {
                  const growth = t.id === TEMPLATE2.id;
                  const lp = t.id === LP_DEFAULT_TEMPLATE_ID;
                  const yld = isYieldTemplate(t.id);
                  const mom = isMomentumTemplate(t.id);
                  const v3 = factoryForTemplate(t.id) === FUND_FACTORY_V3;
                  const on = growth ? isGrowthTemplate(draft.templateId) : lp ? isLp : draft.templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-testid={growth ? 'growth-card' : lp ? 'lp-card' : yld ? 'yield-card' : mom ? 'momentum-card' : undefined}
                      onClick={() => { set('templateId', growth ? growthPick : lp ? lpPick : t.id); }}
                      className={cn('flex h-full flex-col items-stretch justify-start rounded-xl border p-4 text-left transition-colors', on ? 'border-white bg-white/[0.06]' : 'border-white/10 hover:border-white/30')}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-semibold text-white">{growth || lp || yld || mom ? templateTitle(t.id) : templateName(t.id)}</span>
                        <span className="flex items-center gap-1.5">
                          {on && <Check className="h-4 w-4 text-white" />}
                        </span>
                      </span>
                      {growth ? (
                        <span className="mt-1 block space-y-0.5 text-[12px] leading-relaxed text-white/60">
                          {growthLines(growthFeeBps).map((l) => <span key={l} className="block">{l}</span>)}
                          <span className="mt-1 block text-amber-200/80">{ALLOWLIST_NOTE}</span>
                        </span>
                      ) : lp ? (
                        <span className="mt-1 block space-y-0.5 text-[12px] leading-relaxed text-white/60">
                          <span className="block text-white/80">{LP_SUMMARY}</span>
                          {lpLines(lpFeeBps).map((l) => <span key={l} className="block">{l}</span>)}
                        </span>
                      ) : yld ? (
                        <span className="mt-1 block space-y-0.5 text-[12px] leading-relaxed text-white/60">
                          <span className="block text-white/80">{YIELD_SUMMARY}</span>
                          {yieldLines().map((l) => <span key={l} className="block">{l}</span>)}
                        </span>
                      ) : mom ? (
                        <span className="mt-1 block space-y-0.5 text-[12px] leading-relaxed text-white/60">
                          <span className="block text-white/80">{MOMENTUM_SUMMARY}</span>
                          {momentumLines().map((l) => <span key={l} className="block">{l}</span>)}
                        </span>
                      ) : (
                        <span className="mt-1 block space-y-0.5 text-[12px] leading-relaxed text-white/60">
                          {templateLine(t).replace(/\.$/, '').split(', ').map((l) => <span key={l} className="block">{l.charAt(0).toUpperCase() + l.slice(1)}.</span>)}
                        </span>
                      )}
                      <span className="mt-auto block pt-3">
                        <span className="block border-t border-white/10 pt-3 text-[11px] text-white/45">
                          {v3 ? 'Includes liquidity and staking tools. ' : ''}Locked once the tokenized fund is created.
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {growthOpts.length > 0 && (
              <div className={cn('space-y-2 rounded-xl border p-4', isGrowthTemplate(draft.templateId) ? 'border-white/30' : 'border-white/10')} data-testid="growth-fee-choice">
                <p className="text-[13px] font-semibold text-white">Polydash Growth Tokenized Fund: performance fee</p>
                <p className="text-[12px] leading-relaxed text-white/60">{GROWTH_FEE_COPY}</p>
                <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Performance fee">
                  {growthOpts.map((o) => {
                    const on = isGrowthTemplate(draft.templateId) && growthPick === o.templateId;
                    return (
                      <button
                        key={o.templateId}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-template-id={o.templateId}
                        onClick={() => pickGrowthFee(o.templateId)}
                        className={cn('rounded-lg border px-2 py-2 text-center transition-colors', on ? 'border-white bg-white text-black' : 'border-white/15 text-white hover:border-white/40')}
                      >
                        <span className="block font-mono text-[15px] font-semibold">{o.feeBps / 100}%</span>
                        <span className={cn('block text-[10px]', on ? 'text-black/60' : 'text-white/45')}>Strategy #{o.templateId}{o.templateId === GROWTH_DEFAULT_TEMPLATE_ID ? ' · default' : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {lpOpts.length > 0 && (
              <div className={cn('space-y-2 rounded-xl border p-4', isLp ? 'border-white/30' : 'border-white/10')} data-testid="lp-fee-choice">
                <p className="text-[13px] font-semibold text-white">Polydash LP-Dividend Tokenized Fund: performance fee</p>
                <p className="text-[12px] leading-relaxed text-white/60">{GROWTH_FEE_COPY}</p>
                <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="LP-Dividend performance fee">
                  {lpOpts.map((o) => {
                    const on = isLp && lpPick === o.templateId;
                    return (
                      <button key={o.templateId} type="button" role="radio" aria-checked={on} data-template-id={o.templateId}
                        onClick={() => { setLpPick(o.templateId); set('templateId', o.templateId); }}
                        className={cn('rounded-lg border px-2 py-2 text-center transition-colors', on ? 'border-white bg-white text-black' : 'border-white/15 text-white hover:border-white/40')}>
                        <span className="block font-mono text-[15px] font-semibold">{o.feeBps / 100}%</span>
                        <span className={cn('block text-[10px]', on ? 'text-black/60' : 'text-white/45')}>Strategy #{o.templateId}{o.templateId === LP_DEFAULT_TEMPLATE_ID ? ' · default' : ''}</span>
                      </button>
                    );
                  })}
                </div>
                {isLp && (
                  <div className="space-y-2 border-t border-white/10 pt-3" data-testid="lp-optins">
                    <p className="text-[12px] font-medium text-white">Your plans (optional choices)</p>
                    <label className="flex items-start gap-2 text-[12px] text-white/75"><input type="checkbox" className="mt-0.5" checked={optLp} onChange={(e) => setOptLp(e.target.checked)} />{OPTIN_COPY.lp}</label>
                    <label className="flex items-start gap-2 text-[12px] text-white/75"><input type="checkbox" className="mt-0.5" checked={optStake} onChange={(e) => setOptStake(e.target.checked)} />{OPTIN_COPY.stake}</label>
                    <p className="text-[11px] text-white/45">{OPTIN_COPY.note}</p>
                  </div>
                )}
              </div>
            )}
            {err('templateId') && <p className="text-[12px] text-red-300">{err('templateId')}</p>}
            <div data-testid="wizard-allowlist">
              <AllowlistMenu compact title="Tokens a Tokenized Fund manager can invest in (approved list, read live)" />
            </div>
            {chosen?.id === TEMPLATE2.id && !chosen.mandateUri && (
              <p className="text-[12px] text-white/55">Read the full rules: <a className="break-all text-white underline" href={TEMPLATE2.mandateUri} target="_blank" rel="noopener noreferrer">{TEMPLATE2.mandateUri}</a></p>
            )}
            {chosen?.mandateUri && (
              <p className="text-[12px] text-white/55">Read the full rules: <a className="break-all text-white underline" href={chosen.mandateUri} target="_blank" rel="noopener noreferrer">{chosen.mandateUri}</a></p>
            )}
            {chosen && <WizardMandate uri={chosen.mandateUri} testId="wizard-mandate" />}
            <div className="space-y-3 border-t border-white/10 pt-4" data-testid="wizard-thesis">
              <h3 className="text-[14px] font-semibold text-white">Your thesis (optional)</h3>
              <p className="text-[12px] leading-relaxed text-white/55">A short pitch in your own words: why this tokenized fund, what you plan to buy, and when you would sell. Up to {THESIS_LINES} lines. It is shown on the tokenized fund card in the page preview at the Review step.</p>
              <Field label={`Short thesis (up to ${THESIS_LINES} lines)`} tip="Plain words work best. Each new line is one line on the card. Extra lines are cut off.">
                <Textarea value={thesis} onChange={(e) => setThesis(clampThesis(e.target.value))} rows={3} placeholder={'Example: Buy early Robinhood Chain tokens with real pools.\nSize each one small and stay inside the caps.\nTake profits after big runs.'} className="bg-secondary/50 text-[13px]" />
                <span className="mt-1 block text-right text-[11px] text-white/40">{thesisLines.length} of {THESIS_LINES} lines</span>
              </Field>
              <Field label="Full write-up link (IPFS link, optional)" tip="Where investors can read your full plan. Use ipfs:// or https://. ipfs:// links are opened through a public gateway." error={reveal ? thesisUriError ?? undefined : undefined}>
                <Input value={thesisUri} onChange={(e) => setThesisUri(e.target.value)} placeholder="ipfs://… or https://…" className="bg-secondary/50 font-mono text-[12px]" />
              </Field>
              <p className="text-[11px] text-white/45">The creation transaction does not store the thesis on-chain. Use the same text and link as the reason and write-up of your first asset proposal, so investors see it on the live page.</p>
              <p className="rounded-lg border border-amber-300/30 bg-amber-400/[0.06] p-3 text-[12px] leading-relaxed text-amber-100">
                Your thesis won&apos;t appear on the tokenized fund page unless you also add it to your first asset proposal — copy it there after creating.
              </p>
              <div>
                <Button type="button" variant="secondary" size="sm" disabled={!thesis.trim() && !thesisUri.trim()} onClick={copyThesis}>
                  {thesisCopied ? 'Copied — paste it into your first proposal' : 'Copy thesis'}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-[15px] font-semibold">Step 3: Fees</h2>
            <div>
              <P3Label label={`Entry fee: ${pct(draft.entryFeeBps)}`} tip="Optional. Taken from the ETH paid each time someone buys shares, up to 5%. Goes to you, the manager. Default is 0%." />
              <Slider value={[draft.entryFeeBps]} min={0} max={500} step={25} onValueChange={(v) => set('entryFeeBps', v[0] ?? 0)} />
              <div className="mt-1 flex justify-between text-[10px] text-white/40"><span>0%</span><span>5% maximum</span></div>
            </div>
            <div className="rounded-lg border border-white/10 p-3 text-[12px] leading-relaxed text-white/70">
              <p className="flex items-center gap-1.5 text-white">
                Performance fee (high-water mark): <span data-testid="step3-fee">{chosen ? pct(chosen.hwmFeeBps) : '—'}</span>
                {chosen && <span className="text-white/50" data-testid="step3-template">· Strategy #{chosen.id}</span>}
              </p>
              {hwm ? (
                chosen && chosen.hwmFeeBps > 0 ? (
                  <>
                    <p className="mt-1">{hwm.rule}</p>
                    <p className="mt-1 text-white/50">{hwm.example}</p>
                  </>
                ) : <p className="mt-1">This strategy has no performance fee.</p>
              ) : <p className="mt-1">Pick a strategy in step 2 to see its performance fee.</p>}
              <p className="mt-2 text-white/45">Set by the strategy, so it cannot be changed here or later.</p>
            </div>
            <p className="text-[12px] text-white/50">A 0.2% protocol fee is taken from every share purchase. It is not refunded.</p>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-[15px] font-semibold">Step 4: Your stake (skin in the game)</h2>
            <p className="text-[12px] leading-relaxed text-white/55">
              You buy part of the shares yourself before anyone else can join. Those shares stay locked in your wallet until the unlock date, so you share the tokenized fund&apos;s ups and downs with investors.
            </p>
            <div>
              <P3Label label={`Your stake: ${pct(draft.skinBps)} of all shares`} tip="The part of the shares you must buy before the raise opens to everyone. 5% is the minimum. You pay the same price as everyone else." />
              <Slider value={[draft.skinBps]} min={500} max={5000} step={100} onValueChange={(v) => set('skinBps', v[0] ?? 500)} />
              <div className="mt-1 flex justify-between text-[10px] text-white/40"><span>5% minimum</span><span>50%</span></div>
              {err('skinBps') && <p className="mt-1 text-[12px] text-red-300">{err('skinBps')}</p>}
            </div>
            {preview && (
              <div className="rounded-lg bg-secondary/30 p-3 text-[12px] leading-relaxed text-white/70">
                <p>You buy <span className="text-white">{preview.skinRequired.toString()} of {preview.maxSupply.toString()} shares</span> for <span className="text-white">{formatFundEth(preview.managerEth)} ETH</span> (0.2% protocol fee: {formatFundEth(preview.protocolFeeOnManager)} ETH).</p>
                <p className="mt-1">Locked for {chosen ? daysLabel(chosen.skinLock) : 'the period set by the strategy'} from the moment the tokenized fund is created. Buying them is a separate step on the tokenized fund page and opens the raise to everyone.</p>
              </div>
            )}
          </>
        )}

        {step === 4 && checked.params && preview && (
          <>
            <h2 className="text-[15px] font-semibold">Step 5: Review and create</h2>
            <dl className="space-y-1 text-sm">
              <Row k="Name" v={`${checked.params.name} (${checked.params.symbol})`} />
              <Row k="Price per share" v={`${formatFundEth(checked.params.mintPrice)} ETH`} />
              <Row k="Raise goal" v={`${formatFundEth(checked.params.raiseCap)} ETH · ${preview.maxSupply.toString()} shares`} />
              <Row k="Raise open for" v={`${Number(checked.params.raiseDuration / 86_400n)} days`} />
              <Row k="Strategy (locked)" v={chosen ? (isGrowthTemplate(chosen.id) ? growthLabel(chosen.id, chosen.hwmFeeBps) : isLpTemplate(chosen.id) ? `${templateTitle(chosen.id)} · ${pct(chosen.hwmFeeBps)} fee (Strategy #${chosen.id})` : templateTitle(chosen.id)) : '—'} wrap />
              {chosen && <Row k="What it allows" v={isGrowthTemplate(chosen.id) ? growthLines(chosen.hwmFeeBps).join('. ') : isLpTemplate(chosen.id) ? lpLines(chosen.hwmFeeBps).join('. ') : isYieldTemplate(chosen.id) ? yieldLines().join('. ') : isMomentumTemplate(chosen.id) ? momentumLines().join('. ') : templateLine(chosen)} wrap />}
              <Row k="Tokenized fund factory" v={isV3 ? 'Tokenized Fund factory V3' : isV2 ? 'Tokenized Fund factory V2' : 'Tokenized Fund factory (Phase 3)'} wrap />
              {isV2 && <Row k="Note" v={ALLOWLIST_NOTE} wrap />}
              {isLp && <Row k="Liquidity (LP yield)" v={optLp ? 'Planned (optional)' : 'Not planned'} />}
              {isLp && <Row k="Staking" v={optStake ? 'Planned (optional)' : 'Not planned'} />}
              <Row k="Entry fee" v={pct(draft.entryFeeBps)} />
              <Row k="Performance fee (high-water mark)" v={chosen ? pct(chosen.hwmFeeBps) : '—'} />
              <Row k="Drawdown brake on new buys" v={chosen?.maxDrawdownBps ? `after a ${pct(chosen.maxDrawdownBps)} drop` : 'none'} />
              <Row k="Your stake" v={`${preview.skinRequired.toString()} shares · ${formatFundEth(preview.managerEth)} ETH`} />
              <Row k="Stake locked for" v={chosen ? daysLabel(chosen.skinLock) : '—'} />
              <Row k="Protocol fee" v="0.2% of every share purchase" />
              <Row k="Thesis" v={thesisLines.length ? `${thesisLines.length} of ${THESIS_LINES} lines` : 'none'} />
            </dl>
            {thesisLines.length > 0 && (
              <div className="rounded-lg border border-amber-300/30 bg-amber-400/[0.06] p-3 text-[12px] leading-relaxed text-amber-100">
                Your thesis won&apos;t appear on the tokenized fund page unless you also add it to your first asset proposal — copy it there after creating.{' '}
                <button type="button" className="font-medium text-white underline underline-offset-2" onClick={copyThesis}>
                  {thesisCopied ? 'Copied' : 'Copy thesis'}
                </button>
              </div>
            )}
            <PagePreview
              name={checked.params.name}
              symbol={checked.params.symbol}
              imageUri={draft.imageUri}
              template={chosen}
              thesisLines={thesisLines}
              thesisUrl={ipfsToHttp(thesisUri)}
              entryFeeBps={draft.entryFeeBps}
              priceEth={formatFundEth(checked.params.mintPrice)}
              goalEth={formatFundEth(checked.params.raiseCap)}
              maxSupply={preview.maxSupply.toString()}
              skin={preview.skinRequired.toString()}
            />
            <div className="rounded-lg border border-white/15 p-3 text-[12px] leading-relaxed text-white/70">
              What happens next: you sign 1 transaction to create the tokenized fund (no ETH sent). Then, on the tokenized fund page, you buy your stake. After that anyone can join until the goal or deadline is reached. {' '}
              New contract, not audited. Not financial advice.
            </div>
          </>
        )}

        <div className="flex justify-between gap-3">
          {step === 0
            ? <Button variant="secondary" onClick={() => router.push('/funds')}>Cancel</Button>
            : <Button variant="secondary" onClick={back} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>}
          {step < 4 ? (
            <Button onClick={next} disabled={uploading || (step === 1 && (noTemplates || templates.isLoading))} className={cn('gap-2', primary)}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : !isConnected ? (
            <ConnectButton.Custom>{({ openConnectModal }) => <Button onClick={openConnectModal} className={primary}>Connect wallet</Button>}</ConnectButton.Custom>
          ) : (
            <div className="flex flex-col items-end gap-1.5">
              <Button onClick={create} disabled={pending === 'create' || !checked.params} className={cn('gap-2', primary)}>
                {pending === 'create' && <Loader2 className="h-4 w-4 animate-spin" />}
                {pending === 'create' ? 'Creating…' : 'Create your tokenized fund (sign 1 transaction, no ETH sent)'}
              </Button>
              <p className="max-w-[320px] text-right text-[11px] leading-relaxed text-white/50">Signing just approves this action in your wallet. It doesn&apos;t give Polypad access to your funds.</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ContractLink label="Tokenized fund factory" address={FUND_FACTORY_PHASE3} />
        <ContractLink label="Tokenized Fund factory V2" address={FUND_FACTORY_V2} />
        <ContractLink label="Tokenized Fund factory V3" address={FUND_FACTORY_V3} />
        <ContractLink label="Strategies" address={STRATEGY_TEMPLATE} />
      </div>
      <P3Note />
    </div>
  );
}

function Field({ label, tip, error, required, children }: { label: string; tip: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      {required ? (
        <div className="flex items-start justify-between gap-2">
          <P3Label label={label} tip={tip} />
          <span className="text-[11px] font-medium text-red-300">* required</span>
        </div>
      ) : (
        <P3Label label={label} tip={tip} />
      )}
      {children}
      {error && <span className="mt-1 block text-[12px] text-red-300">{error}</span>}
    </div>
  );
}

function Row({ k, v, wrap }: { k: string; v: string; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <dt className="shrink-0 text-white/50">{k}</dt>
      <dd className={cn('text-right text-xs text-white', wrap ? 'max-w-[65%]' : 'max-w-[60%] truncate font-mono')}>{v}</dd>
    </div>
  );
}

/** What the tokenized fund page will look like right after creation. Display only, nothing is sent. */
function PagePreview(p: {
  name: string; symbol: string; imageUri: string; template?: StrategyTemplateView; thesisLines: string[]; thesisUrl: string;
  entryFeeBps: number; priceEth: string; goalEth: string; maxSupply: string; skin: string;
}) {
  const t = p.template;
  const isT2 = isGrowthTemplate(t?.id);
  const isLpT = isLpTemplate(t?.id);
  const isYldT = isYieldTemplate(t?.id);
  const isMomT = isMomentumTemplate(t?.id);
  const rules = t ? (isT2 ? growthLines(t.hwmFeeBps) : isLpT ? lpLines(t.hwmFeeBps) : isYldT ? yieldLines() : isMomT ? momentumLines() : templateLine(t).replace(/\.$/, '').split(', ').map((l) => `${l.charAt(0).toUpperCase()}${l.slice(1)}.`)) : [];
  const caps: [string, string][] = [
    ['Most in one asset (per-asset cap)', t?.maxPositionBps ? pct(t.maxPositionBps) : '30% default'],
    ['Most per trade (per-trade cap)', t?.maxTradeBps ? pct(t.maxTradeBps) : '—'],
    ['Max gap from the average price (TWAP deviation)', t?.maxDeviationBps ? pct(t.maxDeviationBps) : '—'],
    ['Drawdown brake on new buys', t?.maxDrawdownBps ? `after a ${pct(t.maxDrawdownBps)} drop` : 'none'],
  ];
  if (isT2) caps.splice(1, 0, ['POLYDASH cap (strategy asset)', '80%']);
  const fees: [string, string][] = [
    ['Entry fee', pct(p.entryFeeBps)],
    ['Performance fee (only above the high-water mark)', t ? pct(t.hwmFeeBps) : '—'],
    ['Protocol fee', '0.2% of every share purchase'],
  ];
  return (
    <section data-testid="fund-page-preview" className="space-y-3 rounded-xl border border-white/20 bg-black/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-white">Preview of your tokenized fund page</h3>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">Preview — nothing is created yet</span>
      </div>
      <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-[13px] font-semibold text-white/80">
            {p.imageUri ? <img src={p.imageUri} alt={`${p.name} image`} className="h-full w-full object-cover" /> : p.symbol.slice(0, 3)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold text-white">{p.name}</p>
            <p className="text-[12px] text-white/55"><span className="font-mono">{p.symbol}</span> · {t ? (isT2 || isLpT || isYldT || isMomT ? templateTitle(t.id) : templateName(t.id)) : 'No strategy'} · Tokenized Fund</p>
          </div>
          <span className="ml-auto shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-100">Waiting for the manager to join</span>
        </div>
        <div className="mt-3 rounded-lg bg-white/[0.04] p-3">
          <p className="text-[11px] uppercase tracking-wide text-white/40">Manager thesis</p>
          {p.thesisLines.length ? p.thesisLines.map((l, i) => <p key={i} className="text-[13px] text-white/85">{l}</p>) : <p className="text-[12px] text-white/45">No thesis written yet.</p>}
          {p.thesisUrl && <a href={p.thesisUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[12px] text-white/70 underline underline-offset-2">Read the full write-up</a>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
          {[['Price per share', `${p.priceEth} ETH`], ['Raise goal', `${p.goalEth} ETH`], ['Shares', `0 of ${p.maxSupply}`], ['Your stake', `${p.skin} shares`]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/[0.03] p-2"><p className="text-white/45">{k}</p><p className="font-mono text-white">{v}</p></div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Strategy rules (locked)</p>
            <ul className="space-y-0.5 text-[12px] text-white/70">{rules.length ? rules.map((l) => <li key={l}>{l}</li>) : <li>Pick a strategy in step 2.</li>}</ul>
          </div>
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Caps</p>
              {caps.map(([k, v]) => <p key={k} className="flex justify-between gap-2 text-[12px]"><span className="text-white/55">{k}</span><span className="text-white">{v}</span></p>)}
            </div>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Fees</p>
              {fees.map(([k, v]) => <p key={k} className="flex justify-between gap-2 text-[12px]"><span className="text-white/55">{k}</span><span className="text-white">{v}</span></p>)}
            </div>
          </div>
        </div>
      </div>
      {t && <WizardMandate uri={t.mandateUri} testId="preview-mandate" />}
    </section>
  );
}

/** Full strategy write-up for the picked template, from the site's bundled copy (no network). Renders nothing when no copy is bundled. */
function WizardMandate({ uri, testId }: { uri: string; testId: string }) {
  const text = bundledMandate(uri);
  if (!text) return null;
  return (
    <details className="rounded-lg border border-white/10 p-3" data-testid={testId} data-mandate-uri={uri}>
      <summary className="cursor-pointer text-[12px] font-medium text-white">Full strategy rules (mandate) for this strategy</summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/[0.04] p-3 font-sans text-[12px] leading-relaxed text-white/75">{text}</pre>
      <p className="mt-2 text-[11px] text-white/45">{isDerivedMandate(uri) ? DERIVED_MANDATE_NOTE : 'Site copy of the published file.'}</p>
    </details>
  );
}
