'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Check, Loader2, Upload, X } from 'lucide-react';
import { useWriteContract, useSwitchChain, usePublicClient } from 'wagmi';
import { parseEther, decodeEventLog, zeroAddress } from 'viem';
import { PolydashFactoryABI } from '@/lib/contracts/abis';
import { getFactoryAddress, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ContractsBanner } from '@/components/contracts-banner';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FormData {
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  website: string;
  twitter: string;
  telegram: string;
  creatorFeeBps: number;
  devBuyEth: string;
  launchDelay: number; // seconds of pre-launch commitment window; 0 = live immediately
}

const COMMIT_WINDOWS = [
  { value: 0, label: 'Launch now', hint: 'Trading opens immediately. No commitment phase.' },
  { value: 86400, label: '24 hours', hint: 'People can commit ETH for 24 hours before trading opens.' },
  { value: 3 * 86400, label: '3 days', hint: 'People can commit ETH for 3 days before trading opens.' },
  { value: 7 * 86400, label: '7 days', hint: 'People can commit ETH for 7 days before trading opens.' },
];

const STEPS = [
  { label: 'Token info' },
  { label: 'Parameters' },
  { label: 'Review' },
];

export function CreateWizard() {
  const { isConnected, chainId } = useAccount();
  const router = useRouter();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const [deploying, setDeploying] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>({
    name: '', symbol: '', description: '', imageUri: '',
    website: '', twitter: '', telegram: '',
    creatorFeeBps: 100, devBuyEth: '', launchDelay: 86400,
  });
  const windowOpt = COMMIT_WINDOWS.find((w) => w.value === form.launchDelay) ?? COMMIT_WINDOWS[0];

  const updateField = (field: keyof FormData, value: any) => {
    setForm((prev) => ({ ...(prev ?? {}), [field]: value }));
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
      // Presigned POST: policy fields first, file last. The browser sets the multipart boundary.
      const formData = new FormData();
      const fields = data?.fields;
      if (!data?.uploadUrl || !fields || typeof fields !== 'object') throw new Error('Upload failed');
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, String(value));
      }
      formData.append('file', file);
      const upload = await fetch(data.uploadUrl, { method: 'POST', body: formData });
      if (!upload.ok) throw new Error(`Upload failed (${upload.status})`);
      updateField('imageUri', data.publicUrl);
      toast.success('Logo uploaded');
    } catch (e: any) {
      console.error('logo upload failed', e);
      toast.error(e?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const canProceedStep0 = (form?.name?.trim()?.length ?? 0) > 0 && (form?.symbol?.trim()?.length ?? 0) > 0;
  const canProceedStep1 = true;

  const handleDeploy = async () => {
    const factory = getFactoryAddress();
    if (!factory || !publicClient) {
      toast.error('Factory contract address is not configured.');
      return;
    }
    let devBuy: bigint;
    try {
      devBuy = parseEther((form.devBuyEth || '0').trim());
    } catch {
      toast.error('Dev buy amount is not a valid ETH number.');
      return;
    }
    setDeploying(true);
    const tid = toast.loading('Confirm the transaction in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) {
        await switchChainAsync({ chainId: robinhoodChain.id });
      }
      const socialLinks = [form.website, form.twitter, form.telegram].map((s) => s.trim()).filter(Boolean);
      const hash = await writeContractAsync({
        address: factory,
        abi: PolydashFactoryABI,
        functionName: 'createLaunch',
        chainId: robinhoodChain.id,
        value: devBuy,
        args: [{
          name: form.name.trim(),
          symbol: form.symbol.trim().toUpperCase(),
          imageUri: form.imageUri.trim(),
          description: form.description.trim(),
          socialLinks,
          creatorFeeBps: BigInt(form.creatorFeeBps),
          creatorPayoutWallet: zeroAddress,
          devBuyEth: devBuy,
          totalSupply: BigInt(0),
          virtualEthReserve: BigInt(0),
          launchDelay: BigInt(form.launchDelay),
        }],
      });
      toast.loading('Deploying your token on Robinhood Chain…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      let launch: string | undefined;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: PolydashFactoryABI, data: log.data, topics: log.topics });
          if (ev.eventName === 'LaunchCreated') { launch = ev.args.launch; break; }
        } catch { /* not a factory event */ }
      }
      toast.success('Token deployed!', {
        id: tid,
        action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') },
      });
      if (launch) router.push(`/token/${launch}`);
    } catch (e: any) {
      console.error('createLaunch failed', e);
      const msg = e?.shortMessage ?? e?.message ?? 'Transaction failed';
      toast.error(msg.includes('User rejected') || msg.includes('denied') ? 'Transaction cancelled' : msg, { id: tid });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="mx-auto max-w-[700px] px-5 py-8 sm:py-12 space-y-5 sm:space-y-6">
      <ContractsBanner />

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-1.5 sm:gap-2">
        {STEPS.map((s, i) => {
          return (
            <div key={i} className="flex items-center gap-1.5 sm:gap-2">
              <div className={cn(
                'flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap',
                i === step ? 'bg-primary/10 text-primary' :
                i < step ? 'bg-primary/5 text-primary/60' : 'bg-secondary text-muted-foreground'
              )}>
                {i < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{i + 1}</span>}
                <span>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className="w-3 sm:w-8 h-px bg-border" />}
            </div>
          );
        })}
      </div>

      <div className="glass-card rounded-xl p-4 sm:p-6">
        {/* Step 0: Token Info */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-[15px]">Token information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Token Name *</label>
                <Input value={form?.name ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('name', e?.target?.value ?? '')} placeholder="e.g. Moon Token" className="bg-secondary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Symbol *</label>
                <Input value={form?.symbol ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('symbol', e?.target?.value ?? '')} placeholder="e.g. MOON" className="bg-secondary/50" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <textarea
                value={form?.description ?? ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateField('description', e?.target?.value ?? '')}
                placeholder="What the token is and who it's for"
                className="w-full rounded-lg bg-secondary/50 border border-input px-3 py-2 text-sm min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Token logo (optional)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => handleLogoFile(e.target.files?.[0])}
              />
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/15 bg-secondary/30 p-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-white/5 flex items-center justify-center">
                  {form.imageUri ? (
                    <img src={form.imageUri} alt="Token logo preview" className="h-full w-full object-cover" />
                  ) : uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{form.imageUri ? 'Logo uploaded' : 'Upload a logo'}</p>
                  <p className="text-[11px] text-muted-foreground">PNG, JPG, WEBP or GIF, up to 5 MB. A square image fits the preview.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? 'Uploading…' : form.imageUri ? 'Change' : 'Choose'}
                  </Button>
                  {form.imageUri && !uploading && (
                    <button type="button" aria-label="Remove logo" onClick={() => updateField('imageUri', '')} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Website</label>
                <Input value={form?.website ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('website', e?.target?.value ?? '')} placeholder="https://" className="bg-secondary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Twitter</label>
                <Input value={form?.twitter ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('twitter', e?.target?.value ?? '')} placeholder="https://twitter.com/..." className="bg-secondary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Telegram</label>
                <Input value={form?.telegram ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('telegram', e?.target?.value ?? '')} placeholder="https://t.me/..." className="bg-secondary/50" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!canProceedStep0 || uploading} className="gap-2">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Parameters */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="font-semibold text-[15px]">Launch parameters</h2>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Commitment window</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {COMMIT_WINDOWS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => updateField('launchDelay', w.value)}
                    className={cn(
                      'h-9 rounded-full border text-[12px] sm:text-[13px] font-medium transition-colors',
                      form.launchDelay === w.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-white/10 bg-secondary/40 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">{windowOpt.hint}</p>
              {form.launchDelay > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Committers can withdraw any time before launch. When the window ends, anyone can start the launch from the token page: your dev buy runs first, then every commitment is bought in order, and tokens go straight to committers' wallets.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Creator Fee: {((form?.creatorFeeBps ?? 100) / 100).toFixed(2)}%</label>
              <Slider
                value={[form?.creatorFeeBps ?? 100]}
                onValueChange={(v: number[]) => updateField('creatorFeeBps', v?.[0] ?? 100)}
                min={0} max={500} step={10}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0%</span>
                <span>5% (max on the current factory)</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">The earlier factory accepts at most 2%. The default here is 1%.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Dev Buy (optional ETH to buy at launch)</label>
              <Input
                type="number"
                value={form?.devBuyEth ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('devBuyEth', e?.target?.value ?? '')}
                placeholder="0.0"
                className="bg-secondary/50 font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                This amount will be used to buy tokens at launch and is visible on-chain.
                {form.launchDelay > 0 && ' With a commitment window, it is held by the launch contract and executed first when trading opens.'}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <p><span className="text-foreground font-medium">Total supply:</span> 1,000,000,000 tokens</p>
              <p><span className="text-foreground font-medium">Graduation:</span> Automatic when bonding curve fills. Liquidity moves to Uniswap V4.</p>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(0)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(2)} className="gap-2">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="font-semibold text-[15px]">Review & deploy</h2>
            <div className="space-y-2 text-sm">
              {[
                ['Name', form?.name],
                ['Symbol', `$${form?.symbol}`],
                ['Description', form?.description || 'None'],
                ['Commitment window', windowOpt.label],
                ['Creator Fee', `${((form?.creatorFeeBps ?? 100) / 100).toFixed(2)}%`],
                ['Dev Buy', form?.devBuyEth ? `${form.devBuyEth} ETH` : 'None'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-1.5 border-b border-border/20 last:border-0">
                  <span className="text-muted-foreground shrink-0">{label}</span>
                  <span className="font-mono text-xs max-w-[60%] truncate text-right">{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-muted-foreground shrink-0">Logo</span>
                {form.imageUri ? (
                  <img src={form.imageUri} alt="Token logo" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <span className="font-mono text-xs">None</span>
                )}
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-200">
              Deploying a token is an on-chain transaction. Make sure your wallet is connected and funded with ETH on Robinhood Chain.
            </div>

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {!isConnected ? (
                <ConnectButton.Custom>
                  {({ openConnectModal }: any) => (
                    <Button onClick={openConnectModal}>Connect wallet</Button>
                  )}
                </ConnectButton.Custom>
              ) : (
                <Button onClick={handleDeploy} disabled={deploying} className="gap-2">
                  {deploying && <Loader2 className="h-4 w-4 animate-spin" />}
                  {deploying ? 'Deploying…' : 'Deploy token'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
