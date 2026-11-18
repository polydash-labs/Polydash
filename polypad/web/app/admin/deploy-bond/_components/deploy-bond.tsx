'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { encodeDeployData } from 'viem';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { BOND_FACTORY_ABI, BOND_FACTORY_ARGS, BOND_FACTORY_BYTECODE } from '@/lib/bondArtifacts';
import { BOND_FACTORY_ADDRESS, GAS_FLOORS, gasLimit, type Addr } from '@/lib/bond';
import { BondNote, ContractLink, CopyRow } from '@/components/bond/notes';

export function DeployBond() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [deployed, setDeployed] = useState<Addr | null>(null);
  const configured = BOND_FACTORY_ADDRESS as Addr | null;

  const deploy = async () => {
    if (!walletClient || !client || !address) return;
    setBusy(true);
    setHash(null);
    setDeployed(null);
    const tid = toast.loading('Preparing deployment…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const bytecode = BOND_FACTORY_BYTECODE as `0x${string}`;
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateGas({ account: address, data: encodeDeployData({ abi: BOND_FACTORY_ABI, bytecode, args: BOND_FACTORY_ARGS }) });
      } catch (e) {
        console.error('bond deploy gas estimate failed, using floor', e);
      }
      toast.loading('Confirm the deployment in your wallet…', { id: tid });
      const h = await walletClient.deployContract({
        abi: BOND_FACTORY_ABI, bytecode, args: BOND_FACTORY_ARGS, chain: robinhoodChain, account: address,
        gas: gasLimit(estimate, GAS_FLOORS.deploy),
      });
      setHash(h);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash: h });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deployment reverted');
      setDeployed(r.contractAddress);
      toast.success('Bond factory deployed', { id: tid });
    } catch (e: any) {
      console.error('bond factory deploy failed', e);
      const msg = e?.shortMessage || e?.message || 'Deployment failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Deployment cancelled' : msg, { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const [launchA, launchB] = BOND_FACTORY_ARGS;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Admin</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">Deploy bond factory</h1>
      <p className="mt-2 text-[13px] text-white/65">
        Deploys the creator bond factory on Robinhood Chain ({robinhoodChain.id}) from your connected wallet. Your wallet signs; no keys are stored.
        The factory is ownerless, so there are no other admin functions.
      </p>

      <BondNote className="mt-6" />

      {configured && (
        <div className="glass-card mt-4 space-y-3 p-4 sm:p-5">
          <p className="text-[14px] font-semibold text-polydash-green">Bond factory already deployed</p>
          <CopyRow label="Bond factory address" value={configured} href={getExplorerAddressUrl(configured)} />
          <ContractLink />
        </div>
      )}

      <div className="glass-card mt-6 space-y-2 p-4 sm:p-5 text-[12px]">
        {[
          ['Current Polydash launch factory', launchA],
          ['Earlier Polydash launch factory', launchB],
          ['Gas floor', GAS_FLOORS.deploy.toLocaleString('en-US')],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex flex-wrap justify-between gap-2"><span className="text-white/55">{k}</span><span className="break-all font-mono text-white">{String(v)}</span></div>
        ))}
        {configured && <p className="pt-2 text-amber-300">A bond factory address is already set in code: {configured}. Deploying again creates a separate factory.</p>}
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
          {deployed && <CopyRow label="Bond factory address" value={deployed} href={getExplorerAddressUrl(deployed)} />}
          {deployed && <p className="text-[12px] text-white/65">Set BOND_FACTORY_ADDRESS in lib/bond.ts to this address to turn on creator bonds.</p>}
        </div>
      )}
    </div>
  );
}
