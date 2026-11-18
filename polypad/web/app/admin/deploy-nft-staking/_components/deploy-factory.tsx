'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { NftStakingFactoryABI, NFT_STAKING_FACTORY_BYTECODE, NFT_STAKING_FACTORY_ARGS } from '@/lib/contracts/nft-staking-factory-abi';
import { DEPLOY_GAS_FLOOR, NFT_STAKING_FACTORY_ADDRESS, gasLimit, type Addr } from '@/lib/nftStaking';

function CopyRow({ label, value, href }: { label: string; value: string; href: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <p className="text-[11px] text-white/55">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-white">{value}</code>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch((e) => console.error('copy failed', e)); }}
          className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-4 w-4 text-polydash-green" strokeWidth={1.75} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
        </button>
        <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Open in explorer">
          <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
        </a>
      </div>
    </div>
  );
}

export function DeployFactory() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [deployed, setDeployed] = useState<Addr | null>(null);
  const configured = NFT_STAKING_FACTORY_ADDRESS as Addr | null;

  const deploy = async () => {
    if (!walletClient || !client || !address) return;
    setBusy(true);
    setHash(null);
    setDeployed(null);
    const tid = toast.loading('Preparing deployment…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const bytecode = NFT_STAKING_FACTORY_BYTECODE as `0x${string}`;
      let estimate: bigint | null = null;
      try {
        const { encodeDeployData } = await import('viem');
        const data = encodeDeployData({ abi: NftStakingFactoryABI, bytecode, args: NFT_STAKING_FACTORY_ARGS });
        estimate = await client.estimateGas({ account: address, data });
      } catch (e) {
        console.error('deploy gas estimate failed, using floor', e);
      }
      toast.loading('Confirm the deployment in your wallet…', { id: tid });
      const h = await walletClient.deployContract({
        abi: NftStakingFactoryABI,
        bytecode,
        args: NFT_STAKING_FACTORY_ARGS,
        chain: robinhoodChain,
        account: address,
        gas: gasLimit(estimate, DEPLOY_GAS_FLOOR),
      });
      setHash(h);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash: h });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deployment reverted');
      setDeployed(r.contractAddress);
      toast.success('Factory deployed', { id: tid });
    } catch (e: any) {
      console.error('factory deploy failed', e);
      const msg = e?.shortMessage || e?.message || 'Deployment failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Deployment cancelled' : msg, { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const [fixed, curve, restricted] = NFT_STAKING_FACTORY_ARGS;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Admin</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">Deploy NFT staking factory</h1>
      <p className="mt-2 text-[13px] text-white/65">Deploys NftStakingFactory on Robinhood Chain ({robinhoodChain.id}) from your connected wallet. Your wallet signs; no keys are stored.</p>

      <div className="glass-card mt-6 space-y-2 p-4 sm:p-5 text-[12px]">
        {[
          ['Fixed-price NFT factory', fixed],
          ['Curve NFT factory', curve],
          ['Restricted', restricted ? 'true (Polypad collections only)' : 'false (any ERC-721 collection)'],
          ['Gas floor', DEPLOY_GAS_FLOOR.toLocaleString('en-US')],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex flex-wrap justify-between gap-2"><span className="text-white/55">{k}</span><span className="break-all font-mono text-white">{String(v)}</span></div>
        ))}
        {configured && <p className="pt-2 text-amber-300">A factory address is already set in code: {configured}. Deploying again creates a separate factory.</p>}
      </div>

      <div className="mt-5">
        {!isConnected ? (
          <ConnectButton.Custom>{({ openConnectModal }) => <Button className="rounded-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
        ) : (
          <Button className="rounded-full" onClick={deploy} disabled={busy || !walletClient}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Deploy factory
          </Button>
        )}
      </div>

      {(hash || deployed) && (
        <div className="mt-6 space-y-3">
          {hash && <CopyRow label="Transaction hash" value={hash} href={getExplorerTxUrl(hash)} />}
          {deployed && <CopyRow label="Factory address" value={deployed} href={getExplorerAddressUrl(deployed)} />}
          {deployed && <p className="text-[12px] text-white/65">Set NFT_STAKING_FACTORY_ADDRESS in lib/nftStaking.ts to this address to turn on NFT staking.</p>}
        </div>
      )}
    </div>
  );
}
