'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { encodeDeployData, type Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { GATED_FACTORY_ABI, GATED_FACTORY_ARGS, GATED_FACTORY_BYTECODE } from '@/lib/gatedArtifacts';
import { GATED_FACTORY_ADDRESS, GAS_FLOOR, artifactsMissing, gatedGas, type Addr } from '@/lib/gatedMint';
import { CopyRow } from '@/components/vesting/notes';

const ARG_LABELS = ['Current Polydash launch factory', 'Earlier Polydash launch factory', 'Polypad NFT factory (platform fee wallet)'];

export function DeployGated() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [deployed, setDeployed] = useState<Addr | null>(null);
  const configured = GATED_FACTORY_ADDRESS as Addr | null;
  const missing = artifactsMissing();
  const args = GATED_FACTORY_ARGS as unknown as readonly unknown[];
  const abi = GATED_FACTORY_ABI as unknown as Abi;
  const bytecode = GATED_FACTORY_BYTECODE as `0x${string}`;

  const deploy = async () => {
    if (!walletClient || !client || !address || missing) return;
    setBusy(true);
    setHash(null);
    setDeployed(null);
    const tid = toast.loading('Preparing deployment…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      let estimate: bigint | null = null;
      try {
        const data = encodeDeployData({ abi, bytecode, args: args as any });
        estimate = await client.estimateGas({ account: address, data });
      } catch (e) {
        console.error('holder mint factory deploy gas estimate failed, using floor', e);
      }
      toast.loading('Confirm the deployment in your wallet…', { id: tid });
      const h = await walletClient.deployContract({
        abi, bytecode, args: args as any, chain: robinhoodChain, account: address, gas: gatedGas(estimate),
      } as any);
      setHash(h);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash: h });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deployment reverted');
      setDeployed(r.contractAddress);
      toast.success('Holder mint factory deployed', { id: tid });
    } catch (e: any) {
      console.error('holder mint factory deploy failed', e);
      const msg = e?.shortMessage || e?.message || 'Deployment failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Deployment cancelled' : msg, { id: tid });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Admin</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">Deploy holder mint factory</h1>
      <p className="mt-2 text-[13px] text-white/65">
        Deploys the token-gated NFT factory on Robinhood Chain ({robinhoodChain.id}) from your connected wallet. Your wallet signs; no keys are stored.
        The factory has no owner and no admin functions.
      </p>

      <div className="glass-card mt-6 space-y-2 p-4 text-[12px] sm:p-5">
        {ARG_LABELS.map((label, i) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <span className="text-white/55">{label}</span>
            <span className="break-all font-mono text-white">{args[i] != null ? String(args[i]) : '—'}</span>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-white/55">Gas floor</span>
          <span className="font-mono text-white">{GAS_FLOOR.toLocaleString('en-US')}</span>
        </div>
        {missing && (
          <p className="pt-2 text-amber-300">Contract artifacts are not loaded yet (lib/gatedArtifacts.ts is a placeholder). Deploy stays disabled until the real file is added.</p>
        )}
        {configured && <p className="pt-2 text-amber-300">A holder mint factory address is already set in code: {configured}. Deploying again creates a separate factory.</p>}
      </div>

      <div className="mt-5">
        {!isConnected ? (
          <ConnectButton.Custom>{({ openConnectModal }) => <Button className="rounded-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
        ) : (
          <Button className="rounded-full" onClick={deploy} disabled={busy || !walletClient || missing}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Deploy factory
          </Button>
        )}
      </div>

      {(hash || deployed) && (
        <div className="mt-6 space-y-3">
          {hash && <CopyRow label="Transaction hash" value={hash} href={getExplorerTxUrl(hash)} />}
          {deployed && <CopyRow label="Holder mint factory address" value={deployed} href={getExplorerAddressUrl(deployed)} />}
          {deployed && <p className="text-[12px] text-white/65">Set GATED_FACTORY_ADDRESS in lib/gatedMint.ts to this address to turn on holder mint.</p>}
        </div>
      )}
    </div>
  );
}
