'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Upload, X } from 'lucide-react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { decodeEventLog, formatEther, parseEther, zeroAddress, type Abi } from 'viem';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { NftFactoryABI, getNftFactoryAddress } from '@/lib/contracts/nft-abis';
import { CurveFactoryABI, getCurveFactoryAddress } from '@/lib/contracts/nft-market-abis';
import { GATED_FACTORY_ABI } from '@/lib/gatedArtifacts';
import { NOT_ELIGIBLE, gatedFactory, gatedLive, isAddr, isPolydashToken } from '@/lib/gatedMint';
import { useGatedTx } from '@/lib/hooks/use-gated-mint';
import { GatedNote } from '@/components/gated/notes';
import { parseTraits, sortFiles, uploadCollectionArt, uploadCover, type TraitRow } from './art-upload';
import { HolderSettingsFields, HolderSplit, useHolderSettings } from './holder-settings';
import { FloorSettingsFields, FloorSplit, FloorTokenField, useFloorSettings } from './floor-settings';
import { TOKEN_FLOOR_FACTORY_ABI } from '@/lib/floorVaultArtifacts';
import { NOT_ELIGIBLE as FLOOR_NOT_ELIGIBLE, floorFactory, floorLive } from '@/lib/floorVault';
import { useFloorTx } from '@/lib/hooks/use-floor-vault';
import { FloorRiskNote } from '@/components/floor-vault/notes';

const WINDOWS = [
  { value: 86400, label: '24 hours' },
  { value: 3 * 86400, label: '3 days' },
  { value: 7 * 86400, label: '7 days' },
];
const STEPS = ['Details', 'Mint settings', 'Art', 'Review'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const label = 'text-xs text-muted-foreground mb-1 block';

function parsePrice(s: string): bigint | null {
  try {
    const v = parseEther(s.trim() || '0');
    return v >= parseEther('0.00001') && v <= parseEther('100') ? v : null;
  } catch { return null; }
}

function parseEth(s: string, min: bigint, max: bigint): bigint | null {
  try {
    const v = parseEther(s.trim() || '0');
    return v >= min && v <= max ? v : null;
  } catch { return null; }
}

const ZERO = BigInt(0);
const BPS = BigInt(10000);

export function NftCreateWizard() {
  const router = useRouter();
  const { isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);

  const [supply, setSupply] = useState('1000');
  const [price, setPrice] = useState('0.001');
  const [floorBps, setFloorBps] = useState(5000);
  const [royaltyBps, setRoyaltyBps] = useState(500);
  const [maxPerWallet, setMaxPerWallet] = useState('10');
  const [window, setWindow] = useState(86400);
  const curveFactory = getCurveFactoryAddress();
  const [saleType, setSaleType] = useState<'commit' | 'curve' | 'holder' | 'floor'>('commit');
  const isCurve = saleType === 'curve' && !!curveFactory;
  const [startPrice, setStartPrice] = useState('0.001');
  const [priceStep, setPriceStep] = useState('0.0001');
  const [creatorFeeBps, setCreatorFeeBps] = useState(250);

  const [artMode, setArtMode] = useState<'upload' | 'uri'>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [traits, setTraits] = useState<(TraitRow | undefined)[] | null>(null);
  const [traitsName, setTraitsName] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(null);
  const [baseURI, setBaseURI] = useState('');
  const [manualURI, setManualURI] = useState('');
  const filesRef = useRef<HTMLInputElement>(null);
  const traitsRef = useRef<HTMLInputElement>(null);
  const [deploying, setDeploying] = useState(false);

  const holderLive = gatedLive();
  const gatedTx = useGatedTx();
  const h = useHolderSettings({ supplyN: Number(supply), supplyOk: Number.isInteger(Number(supply)) && Number(supply) >= 1 && Number(supply) <= 10000, floorBps });
  const isHolder = saleType === 'holder' && holderLive && h.eligible;
  const showHolderType = holderLive && (h.eligible || saleType === 'holder');
  const { setTokenInput } = h;
  useEffect(() => {
    if (!holderLive) return;
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    if (q.get('type') !== 'holder') return;
    setSaleType('holder');
    const t = q.get('token');
    if (t && isAddr(t) && !isPolydashToken(t)) setTokenInput(t);
  }, [holderLive, setTokenInput]);

  const supplyN = Number(supply);
  const supplyOk = Number.isInteger(supplyN) && supplyN >= 1 && supplyN <= 10000;
  const priceWei = parsePrice(price);
  const mpwN = Number(maxPerWallet);
  const mpwOk = Number.isInteger(mpwN) && mpwN >= 1 && mpwN <= 100 && (!supplyOk || mpwN <= supplyN);

  const vaultLive = floorLive();
  const floorTx = useFloorTx();
  const fv = useFloorSettings({ supplyN, supplyOk, priceWei, mpwN, mpwOk, floorBps });
  const isFloor = saleType === 'floor' && vaultLive && fv.eligible;
  const showFloorType = vaultLive && (fv.eligible || saleType === 'floor');
  const { setTokenInput: setFloorToken } = fv;
  useEffect(() => {
    if (!vaultLive) return;
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    if (q.get('type') !== 'floor') return;
    setSaleType('floor');
    const t = q.get('token');
    if (t && isAddr(t) && !isPolydashToken(t)) setFloorToken(t);
  }, [vaultLive, setFloorToken]);
  const saleOptions: [typeof saleType, string][] = [
    ['commit', 'Commitment window'], ['curve', 'Bonding curve'],
    ...(showHolderType ? [['holder', 'Holder mint'] as [typeof saleType, string]] : []),
    ...(showFloorType ? [['floor', 'Token-backed floor vault'] as [typeof saleType, string]] : []),
  ];
  const floorWei = priceWei ? (priceWei * BigInt(floorBps)) / BigInt(10000) : BigInt(0);
  const finalURI = artMode === 'upload' ? baseURI : manualURI.trim();
  const uriOk = artMode === 'upload' ? !!baseURI : /^(https:\/\/|ipfs:\/\/|ar:\/\/).+\/$/.test(manualURI.trim()) && manualURI.trim().length <= 512;

  const step0Ok = name.trim().length > 0 && name.trim().length <= 64 && symbol.trim().length > 0 && symbol.trim().length <= 16 && description.length <= 1000 && !!cover && !coverBusy;
  const startWei = parseEth(startPrice, parseEther('0.00001'), parseEther('10'));
  const stepWei = parseEth(priceStep, ZERO, parseEther('1'));
  const curveSupplyOk = supplyOk && supplyN >= 2;
  const curveN = BigInt(curveSupplyOk ? supplyN : 0);
  const lastPriceWei = startWei != null && stepWei != null && curveN > ZERO ? startWei + stepWei * (curveN - BigInt(1)) : ZERO;
  const gradReserveWei = startWei != null && stepWei != null && curveN > ZERO ? startWei * curveN + (stepWei * curveN * (curveN - BigInt(1))) / BigInt(2) : ZERO;
  const gradFloorWei = curveN > ZERO ? (gradReserveWei * BigInt(floorBps)) / BPS / curveN : ZERO;
  const curveOk = curveSupplyOk && startWei != null && stepWei != null;
  const step1Ok = saleType === 'floor' ? isFloor && fv.valid : saleType === 'holder' ? isHolder && h.valid : saleType === 'curve' ? isCurve && curveOk : supplyOk && !!priceWei && mpwOk;

  const onCover = async (f?: File | null) => {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return toast.error('Use a PNG, JPG, WEBP or GIF image.');
    if (f.size > 10 * 1024 * 1024) return toast.error('Image must be 10 MB or smaller.');
    setCoverBusy(true);
    try { setCover(await uploadCover(f)); }
    catch (e: any) { console.error('cover upload failed', e); toast.error(e?.message ?? 'Upload failed'); }
    finally { setCoverBusy(false); if (coverRef.current) coverRef.current.value = ''; }
  };

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list);
    const bad = arr.find((f) => !IMAGE_TYPES.includes(f.type) || f.size > 10 * 1024 * 1024);
    if (bad) { toast.error(`${bad.name}: use PNG, JPG, WEBP or GIF up to 10 MB.`); return; }
    if (arr.length > 10000) { toast.error('Up to 10,000 images.'); return; }
    setFiles(sortFiles(arr));
    setTraits(null); setTraitsName(''); setBaseURI('');
    if (filesRef.current) filesRef.current.value = '';
  };

  const onTraits = async (f?: File | null) => {
    if (!f) return;
    try { setTraits(parseTraits(await f.text(), files)); setTraitsName(f.name); setBaseURI(''); }
    catch (e: any) { toast.error(e?.message ?? 'Could not read traits file'); }
    finally { if (traitsRef.current) traitsRef.current.value = ''; }
  };

  const runUpload = async () => {
    if (files.length !== supplyN) return toast.error(`Select exactly ${supplyN} images (one per NFT).`);
    try {
      const uri = await uploadCollectionArt({
        files, traits: traits ?? [], collectionName: name.trim(), description: description.trim(),
        onProgress: (done, total, stage) => setProgress({ done, total, stage }),
      });
      setBaseURI(uri);
      toast.success('Art and metadata uploaded');
    } catch (e: any) {
      console.error('art upload failed', e);
      toast.error(e?.message ?? 'Upload failed. Try again.');
    } finally { setProgress(null); }
  };

  const deploy = async () => {
    if (!publicClient) return;
    if (isFloor) {
      const factory = floorFactory();
      if (!factory || !fv.valid) return;
      setDeploying(true);
      try {
        const receipt = await floorTx.send({
          key: 'create', address: factory, abi: 'factory', functionName: 'createCollection', success: 'Token-backed collection created',
          args: [fv.buildArgs({ name: name.trim(), symbol: symbol.trim().toUpperCase(), imageUri: cover, description: description.trim(), baseURI: finalURI, royaltyBps })],
        });
        if (!receipt) return;
        let collection: string | undefined;
        for (const log of receipt.logs) {
          try {
            const ev = decodeEventLog({ abi: TOKEN_FLOOR_FACTORY_ABI as unknown as Abi, data: log.data, topics: log.topics }) as { eventName?: string; args?: any };
            if (ev.eventName === 'TokenFloorCollectionCreated') { collection = ev.args?.collection; break; }
          } catch { /* other event */ }
        }
        if (collection) router.push(`/nfts/floor/${collection}`);
      } finally { setDeploying(false); }
      return;
    }
    if (isHolder) {
      const factory = gatedFactory();
      if (!factory || !h.valid) return;
      setDeploying(true);
      try {
        const receipt = await gatedTx.send({
          key: 'create', address: factory, abi: 'factory', functionName: 'createCollection', success: 'Holder mint created',
          args: [h.buildArgs({ name: name.trim(), symbol: symbol.trim().toUpperCase(), imageUri: cover, description: description.trim(), baseURI: finalURI, royaltyBps })],
        });
        if (!receipt) return;
        let collection: string | undefined;
        for (const log of receipt.logs) {
          try {
            const ev = decodeEventLog({ abi: GATED_FACTORY_ABI as unknown as Abi, data: log.data, topics: log.topics }) as { eventName?: string; args?: any };
            if (ev.eventName === 'GatedCollectionCreated') { collection = ev.args?.collection; break; }
          } catch { /* other event */ }
        }
        if (collection) router.push(`/nfts/holder/${collection}`);
      } finally { setDeploying(false); }
      return;
    }
    if (isCurve ? !curveOk : !priceWei) return;
    setDeploying(true);
    const tid = toast.loading('Confirm the transaction in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      if (isCurve && curveFactory && startWei != null && stepWei != null) {
        const hash = await writeContractAsync({
          address: curveFactory,
          abi: CurveFactoryABI,
          functionName: 'createCollection',
          chainId: robinhoodChain.id,
          args: [{
            name: name.trim(), symbol: symbol.trim().toUpperCase(), imageUri: cover, description: description.trim(), baseURI: finalURI,
            maxSupply: BigInt(supplyN), startPrice: startWei, priceStep: stepWei, creatorFeeBps: BigInt(creatorFeeBps),
            floorBps: BigInt(floorBps), royaltyBps: BigInt(royaltyBps), payoutWallet: zeroAddress,
          }],
        });
        toast.loading('Creating your collection on Robinhood Chain…', { id: tid });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error('Transaction reverted');
        let collection: string | undefined;
        for (const log of receipt.logs) {
          try {
            const ev = decodeEventLog({ abi: CurveFactoryABI, data: log.data, topics: log.topics });
            if (ev.eventName === 'CurveCollectionCreated') { collection = ev.args.collection; break; }
          } catch { /* other event */ }
        }
        toast.success('Collection created', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
        if (collection) router.push(`/nfts/${collection}`);
        return;
      }
      if (!priceWei) return;
      const hash = await writeContractAsync({
        address: getNftFactoryAddress(),
        abi: NftFactoryABI,
        functionName: 'createCollection',
        chainId: robinhoodChain.id,
        args: [{
          name: name.trim(), symbol: symbol.trim().toUpperCase(), imageUri: cover, description: description.trim(), baseURI: finalURI,
          maxSupply: BigInt(supplyN), mintPrice: priceWei, floorBps: BigInt(floorBps), royaltyBps: BigInt(royaltyBps),
          maxPerWallet: BigInt(mpwN), commitWindow: BigInt(window), payoutWallet: zeroAddress,
        }],
      });
      toast.loading('Creating your collection on Robinhood Chain…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      let collection: string | undefined;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: NftFactoryABI, data: log.data, topics: log.topics });
          if (ev.eventName === 'CollectionCreated') { collection = ev.args.collection; break; }
        } catch { /* other event */ }
      }
      toast.success('Collection created', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      if (collection) router.push(`/nfts/${collection}`);
    } catch (e: any) {
      console.error('createCollection failed', e);
      const msg = e?.shortMessage ?? e?.message ?? 'Transaction failed';
      toast.error(msg.includes('User rejected') || msg.includes('denied') ? 'Transaction cancelled' : msg, { id: tid });
    } finally { setDeploying(false); }
  };

  const windowLabel = WINDOWS.find((w) => w.value === window)?.label ?? '';

  return (
    <div className="mx-auto max-w-[700px] space-y-5 px-5 py-8 sm:space-y-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5 sm:gap-2">
            <div className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs',
              i === step ? 'bg-primary/10 text-primary' : i < step ? 'bg-primary/5 text-primary/60' : 'bg-secondary text-muted-foreground')}>
              {i < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{i + 1}</span>}
              <span>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px w-3 bg-border sm:w-6" />}
          </div>
        ))}
      </div>

      <div className="glass-card rounded-xl p-4 sm:p-6">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold">Collection details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Name *</label>
                <Input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night Owls" className="bg-secondary/50" />
              </div>
              <div>
                <label className={label}>Symbol *</label>
                <Input value={symbol} maxLength={16} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. OWL" className="bg-secondary/50" />
              </div>
            </div>
            <div>
              <label className={label}>Description</label>
              <textarea value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="What the collection is"
                className="min-h-[80px] w-full resize-y rounded-lg border border-input bg-secondary/50 px-3 py-2 text-[16px] focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm" />
            </div>
            <div>
              <label className={label}>Cover image *</label>
              <input ref={coverRef} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => onCover(e.target.files?.[0])} />
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/15 bg-secondary/30 p-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
                  {cover ? <img src={cover} alt="Cover preview" className="h-full w-full object-cover" /> : coverBusy ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{cover ? 'Cover uploaded' : 'Upload a cover'}</p>
                  <p className="text-[11px] text-muted-foreground">Shown on collection cards. Square, up to 10 MB.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="sm" variant="secondary" disabled={coverBusy} onClick={() => coverRef.current?.click()}>{coverBusy ? 'Uploading…' : cover ? 'Change' : 'Choose'}</Button>
                  {cover && !coverBusy && (
                    <button type="button" aria-label="Remove cover" onClick={() => setCover('')} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"><X className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!step0Ok} className="gap-2">Next <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-[15px] font-semibold">Mint settings</h2>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Sale type</label>
              <div className={cn('grid gap-2', saleOptions.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : saleOptions.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
                {saleOptions.map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setSaleType(k)}
                    className={cn('h-9 rounded-full border px-1 text-[12px] font-medium transition-colors sm:text-[13px]',
                      saleType === k ? 'border-primary bg-primary/10 text-primary' : 'border-white/10 bg-secondary/40 text-muted-foreground hover:text-foreground')}>
                    {l}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {saleType === 'commit'
                  ? 'Fixed price. Buyers commit during a window, then supply is allocated pro-rata.'
                  : saleType === 'floor'
                  ? 'Fixed price, linked to a token you launched. Part of each mint goes to a vault held as ETH plus the token; burning an NFT pays your share of both.'
                  : saleType === 'holder'
                  ? 'Linked to a token you launched. Holders of a minimum balance can mint first at the holder price, then the public mint opens.'
                  : 'Price rises with every NFT bought and falls with every NFT sold back. Holders can sell back to the pool at any time until every NFT is in circulation, then the collection graduates.'}
              </p>
              {saleType === 'curve' && !curveFactory && (
                <p className="mt-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-2.5 text-[11px] text-yellow-200">Bonding-curve collections are not deployed yet. Choose Commitment window for now.</p>
              )}
            </div>

            {saleType === 'floor' ? (isFloor ? (
              <>
                <FloorTokenField f={fv} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className={label}>Supply (1–10,000)</label>
                    <Input type="number" inputMode="numeric" value={supply} onChange={(e) => { setSupply(e.target.value); setBaseURI(''); }} className="bg-secondary/50 font-mono" />
                  </div>
                  <div>
                    <label className={label}>Mint price (ETH)</label>
                    <Input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="bg-secondary/50 font-mono" />
                  </div>
                  <div>
                    <label className={label}>Max per wallet (1–100)</label>
                    <Input type="number" inputMode="numeric" value={maxPerWallet} onChange={(e) => setMaxPerWallet(e.target.value)} className="bg-secondary/50 font-mono" />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Floor vault: {(floorBps / 100).toFixed(0)}% of mint price</label>
                  <Slider value={[floorBps]} onValueChange={(v) => setFloorBps(v?.[0] ?? 5000)} min={2000} max={8000} step={500} />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>20%</span><span>50% (default)</span><span>80%</span></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">This part of every mint goes to the collection vault, split between ETH and the linked token below. Nobody, including you, can withdraw it; holders receive their share by burning.</p>
                </div>
                <FloorSettingsFields f={fv} />
                {fv.error && <p className="text-[11px] text-red-300">{fv.error}</p>}
              </>
            ) : fv.creatorTokens.isLoading ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your launches…</p>
            ) : (
              <p className="rounded-lg bg-secondary/30 p-3 text-[12px] text-muted-foreground">{isConnected ? FLOOR_NOT_ELIGIBLE : `Connect the wallet that launched your token. ${FLOOR_NOT_ELIGIBLE}`}</p>
            )) : saleType === 'holder' ? (isHolder ? (
              <>
                <div className="max-w-[220px]">
                  <label className={label}>Supply (1–10,000)</label>
                  <Input type="number" inputMode="numeric" value={supply} onChange={(e) => { setSupply(e.target.value); setBaseURI(''); }} className="bg-secondary/50 font-mono" />
                </div>
                <HolderSettingsFields h={h} />
                {h.error && <p className="text-[11px] text-red-300">{h.error}</p>}
                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Floor vault: {(floorBps / 100).toFixed(0)}% of the lower price</label>
                  <Slider value={[floorBps]} onValueChange={(v) => setFloorBps(v?.[0] ?? 5000)} min={2000} max={8000} step={500} />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>20%</span><span>50% (default)</span><span>80%</span></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {h.floorWei > ZERO ? `${formatEther(h.floorWei)} ETH of every mint stays locked in the collection contract. Any holder can burn an NFT to receive exactly that amount. Nobody, including you, can withdraw it.` : 'Set valid prices to see the floor amount.'}
                  </p>
                </div>
              </>
            ) : h.creatorTokens.isLoading ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your launches…</p>
            ) : (
              <p className="rounded-lg bg-secondary/30 p-3 text-[12px] text-muted-foreground">{isConnected ? NOT_ELIGIBLE : `Connect the wallet that launched your token. ${NOT_ELIGIBLE}`}</p>
            )) : saleType === 'curve' && !curveFactory ? null : isCurve ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className={label}>Supply (2–10,000)</label>
                    <Input type="number" inputMode="numeric" value={supply} onChange={(e) => { setSupply(e.target.value); setBaseURI(''); }} className="bg-secondary/50 font-mono" />
                  </div>
                  <div>
                    <label className={label}>Start price (ETH)</label>
                    <Input type="number" inputMode="decimal" value={startPrice} onChange={(e) => setStartPrice(e.target.value)} className="bg-secondary/50 font-mono" />
                  </div>
                  <div>
                    <label className={label}>Price step per NFT (ETH)</label>
                    <Input type="number" inputMode="decimal" value={priceStep} onChange={(e) => setPriceStep(e.target.value)} className="bg-secondary/50 font-mono" />
                  </div>
                </div>
                {!curveOk ? (
                  <p className="text-[11px] text-red-300">
                    {!curveSupplyOk ? 'Supply must be a whole number from 2 to 10,000.' : startWei == null ? 'Start price must be between 0.00001 and 10 ETH.' : 'Price step must be between 0 and 1 ETH.'}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    NFT #1 costs {formatEther(startWei ?? ZERO)} ETH and the last one costs {formatEther(lastPriceWei)} ETH. When all {supplyN.toLocaleString('en-US')} are in circulation the pool holds {formatEther(gradReserveWei)} ETH and the collection graduates.
                  </p>
                )}
                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Creator fee on curve trades: {(creatorFeeBps / 100).toFixed(1)}%</label>
                  <Slider value={[creatorFeeBps]} onValueChange={(v) => setCreatorFeeBps(v?.[0] ?? 250)} min={0} max={500} step={25} />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0%</span><span>5% (max)</span></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Charged on every buy and sell against the pool. You can withdraw it at any time.</p>
                </div>
                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Floor vault at graduation: {(floorBps / 100).toFixed(0)}% of the pool</label>
                  <Slider value={[floorBps]} onValueChange={(v) => setFloorBps(v?.[0] ?? 5000)} min={2000} max={8000} step={500} />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>20%</span><span>50% (default)</span><span>80%</span></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {curveOk ? `At graduation ${floorBps / 100}% of the pool stays locked: ${formatEther(gradFloorWei)} ETH per NFT that any holder can claim by burning. The rest of the pool is paid to you. Nobody can withdraw the floor vault.` : 'Set valid curve values to see the floor amount.'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className={label}>Supply (1–10,000)</label>
                    <Input type="number" inputMode="numeric" value={supply} onChange={(e) => { setSupply(e.target.value); setBaseURI(''); }} className="bg-secondary/50 font-mono" />
                  </div>
                  <div>
                    <label className={label}>Mint price (ETH)</label>
                    <Input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="bg-secondary/50 font-mono" />
                  </div>
                  <div>
                    <label className={label}>Max per wallet (1–100)</label>
                    <Input type="number" inputMode="numeric" value={maxPerWallet} onChange={(e) => setMaxPerWallet(e.target.value)} className="bg-secondary/50 font-mono" />
                  </div>
                </div>
                {!step1Ok && (
                  <p className="text-[11px] text-red-300">
                    {!supplyOk ? 'Supply must be a whole number from 1 to 10,000.' : !priceWei ? 'Price must be between 0.00001 and 100 ETH.' : 'Max per wallet must be 1–100 and not above supply.'}
                  </p>
                )}
                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Floor vault: {(floorBps / 100).toFixed(0)}% of mint price</label>
                  <Slider value={[floorBps]} onValueChange={(v) => setFloorBps(v?.[0] ?? 5000)} min={2000} max={8000} step={500} />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>20%</span><span>50% (default)</span><span>80%</span></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {priceWei ? `${formatEther(floorWei)} ETH of every mint stays locked in the collection contract. Any holder can burn an NFT at any time to receive exactly that amount. Nobody, including you, can withdraw it. The rest of the mint price is paid to you.` : 'Set a valid price to see the floor amount.'}
                  </p>
                </div>
              </>
            )}
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Creator royalty on resales: {(royaltyBps / 100).toFixed(1)}%</label>
              <Slider value={[royaltyBps]} onValueChange={(v) => setRoyaltyBps(v?.[0] ?? 500)} min={0} max={1000} step={50} />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0%</span><span>10% (max)</span></div>
              <p className="mt-2 text-[11px] text-muted-foreground">Enforced on every sale through the Polypad marketplace (ERC-2981). Other marketplaces choose whether to honor it.</p>
            </div>
            {!isCurve && saleType !== 'holder' && saleType !== 'floor' && (
              <div>
                <label className="mb-2 block text-xs text-muted-foreground">Commitment window</label>
                <div className="grid grid-cols-3 gap-2">
                  {WINDOWS.map((w) => (
                    <button key={w.value} type="button" onClick={() => setWindow(w.value)}
                      className={cn('h-9 rounded-full border text-[12px] font-medium transition-colors sm:text-[13px]',
                        window === w.value ? 'border-primary bg-primary/10 text-primary' : 'border-white/10 bg-secondary/40 text-muted-foreground hover:text-foreground')}>
                      {w.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  During the window anyone can commit ETH for up to {mpwOk ? mpwN : 'the max'} NFTs and withdraw before it ends. If more are committed than the supply, everyone gets the same share, rounded down, and the rest of their ETH is refunded when they claim. Unclaimed supply can be minted after the window at the same price.
                </p>
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(0)} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>
              <Button onClick={() => setStep(2)} disabled={!step1Ok} className="gap-2">Next <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-[15px] font-semibold">Art and metadata</h2>
            <div className="grid grid-cols-2 gap-2">
              {(['upload', 'uri'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setArtMode(m)}
                  className={cn('h-9 rounded-full border text-[12px] font-medium transition-colors sm:text-[13px]',
                    artMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-white/10 bg-secondary/40 text-muted-foreground hover:text-foreground')}>
                  {m === 'upload' ? 'Upload images' : 'I have a base URI'}
                </button>
              ))}
            </div>

            {artMode === 'upload' ? (
              <div className="space-y-4">
                <p className="text-[12px] text-muted-foreground">
                  Select {supplyOk ? supplyN.toLocaleString('en-US') : 'one'} image{supplyN === 1 ? '' : 's'}, one per NFT. Files are numbered 1 to {supplyOk ? supplyN : 'N'} in file-name order (1.png, 2.png … works best). Each NFT gets a metadata file with its image, a name and optional traits.
                </p>
                <input ref={filesRef} type="file" multiple accept={IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => onFiles(e.target.files)} />
                <input ref={traitsRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onTraits(e.target.files?.[0])} />
                <div className="rounded-lg border border-dashed border-white/15 bg-secondary/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{files.length ? `${files.length.toLocaleString('en-US')} images selected` : 'No images selected'}</p>
                      {files.length > 0 && files.length !== supplyN && (
                        <p className="text-[11px] text-red-300">Supply is {supply}. Select exactly that many, or change the supply.</p>
                      )}
                    </div>
                    <Button type="button" size="sm" variant="secondary" disabled={!!progress} onClick={() => filesRef.current?.click()}>Choose images</Button>
                  </div>
                  {files.length > 0 && (
                    <div className="mt-3 flex gap-1.5 overflow-hidden">
                      {files.slice(0, 8).map((f) => <Thumb key={f.name} file={f} />)}
                    </div>
                  )}
                  {files.length > 0 && files.length !== supplyN && files.length <= 10000 && (
                    <Button type="button" size="sm" variant="ghost" className="mt-2 h-7 px-2 text-[12px]" onClick={() => { setSupply(String(files.length)); if (mpwN > files.length) setMaxPerWallet(String(Math.min(files.length, 100))); }}>
                      Set supply to {files.length}
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/30 p-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">Traits (optional)</p>
                    <p className="text-[11px] text-muted-foreground">
                      {traitsName ? `Loaded ${traitsName}` : 'JSON array in image order, or an object keyed by file name: { "1": { "name": "…", "attributes": [{ "trait_type": "Eyes", "value": "Blue" }] } }'}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" disabled={!files.length || !!progress} onClick={() => traitsRef.current?.click()}>{traitsName ? 'Replace' : 'Add JSON'}</Button>
                </div>
                {progress ? (
                  <div>
                    <div className="flex justify-between text-[12px] text-muted-foreground"><span>{progress.stage}</span><span className="font-mono">{progress.done} / {progress.total}</span></div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-polydash-green transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
                  </div>
                ) : baseURI ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-polydash-green"><Check className="h-3.5 w-3.5" /> Uploaded. Metadata base URI is ready.</p>
                ) : (
                  <Button type="button" onClick={runUpload} disabled={files.length !== supplyN || !supplyOk || !name.trim()} className="w-full">Upload art and metadata</Button>
                )}
                <p className="text-[11px] text-muted-foreground">Files are stored on Polypad&apos;s public cloud storage, not on IPFS. Uploaded files cannot be overwritten.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className={label}>Base URI (must end with /)</label>
                <Input value={manualURI} onChange={(e) => setManualURI(e.target.value)} placeholder="ipfs://bafy.../" className="bg-secondary/50 font-mono" />
                <p className="text-[11px] text-muted-foreground">Token metadata is read from base URI + number + .json, for numbers 1 to {supplyOk ? supplyN : 'N'}. Numbers are assigned with a random offset at the first mint.</p>
                {manualURI && !uriOk && <p className="text-[11px] text-red-300">Use an https://, ipfs:// or ar:// address ending with /.</p>}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)} disabled={!!progress} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>
              <Button onClick={() => setStep(3)} disabled={!uriOk || !!progress} className="gap-2">Next <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-[15px] font-semibold">Review and create</h2>
            <div className="flex items-center gap-3">
              {cover && <img src={cover} alt="Collection cover" className="h-14 w-14 rounded-lg object-cover" />}
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{name}</p>
                <p className="font-mono text-[12px] text-muted-foreground">{symbol.toUpperCase()}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {(isFloor ? [
                ['Supply', supplyN.toLocaleString('en-US')],
                ...fv.reviewRows,
                ['Creator royalty', `${(royaltyBps / 100).toFixed(1)}%`],
                ['Metadata', finalURI],
              ] : isHolder ? [
                ['Supply', supplyN.toLocaleString('en-US')],
                ...h.reviewRows,
                ['Creator royalty', `${(royaltyBps / 100).toFixed(1)}%`],
                ['Metadata', finalURI],
              ] : isCurve ? [
                ['Sale type', 'Bonding curve'],
                ['Supply', supplyN.toLocaleString('en-US')],
                ['Start price', `${formatEther(startWei ?? ZERO)} ETH`],
                ['Price step', `${formatEther(stepWei ?? ZERO)} ETH`],
                ['Last NFT price', `${formatEther(lastPriceWei)} ETH`],
                ['Creator fee', `${(creatorFeeBps / 100).toFixed(1)}%`],
                ['Floor vault', `${floorBps / 100}% of pool (${formatEther(gradFloorWei)} ETH per NFT at graduation)`],
                ['Creator royalty', `${(royaltyBps / 100).toFixed(1)}%`],
                ['Metadata', finalURI],
              ] : [
                ['Sale type', 'Commitment window'],
                ['Supply', supplyN.toLocaleString('en-US')],
                ['Mint price', `${price} ETH`],
                ['Floor vault', `${floorBps / 100}% (${formatEther(floorWei)} ETH per NFT)`],
                ['Creator royalty', `${(royaltyBps / 100).toFixed(1)}%`],
                ['Max per wallet', String(mpwN)],
                ['Commitment window', windowLabel],
                ['Metadata', finalURI],
              ]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-border/20 py-1.5 last:border-0">
                  <span className="shrink-0 text-muted-foreground">{k}</span>
                  <span className="max-w-[60%] truncate text-right font-mono text-xs">{v}</span>
                </div>
              ))}
            </div>
            {isFloor && <FloorSplit f={fv} priceWei={priceWei ?? ZERO} />}
            {isFloor && <FloorRiskNote symbol={fv.info?.symbol} />}
            {isFloor && floorTx.lastError?.key === 'create' && <p className="text-[12px] text-red-300" role="alert">{floorTx.lastError.text}</p>}
            {isHolder && <HolderSplit h={h} floorBps={floorBps} />}
            {isHolder && <GatedNote />}
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">
              {isFloor
                ? 'Price, supply, floor share, token share, slippage, buy cap and linked token cannot be changed after creation. You can update the metadata base URI until the first mint.'
                : isHolder
                ? 'Prices, supply, floor share, linked token and phase timing cannot be changed after creation. You can update the metadata base URI until the first mint.'
                : isCurve
                ? 'Supply, curve prices, fees and floor share cannot be changed after creation. You can update the metadata base URI until the first NFT is bought.'
                : 'Price, supply, floor share and window cannot be changed after creation. You can update the metadata base URI until the window ends.'}
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>
              {!isConnected ? (
                <ConnectButton.Custom>{({ openConnectModal }) => <Button onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
              ) : (
                <Button onClick={deploy} disabled={deploying} className="gap-2">
                  {deploying && <Loader2 className="h-4 w-4 animate-spin" />}
                  {deploying ? 'Creating…' : 'Create collection'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Thumb({ file }: { file: File }) {
  const [url] = useState(() => URL.createObjectURL(file));
  return <img src={url} alt={file.name} title={file.name} className="h-10 w-10 shrink-0 rounded-md object-cover" onLoad={() => URL.revokeObjectURL(url)} />;
}
