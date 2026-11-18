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
import { TREASURY_FACTORY_ABI, TREASURY_FACTORY_ARGS, TREASURY_FACTORY_BYTECODE } from '@/lib/treasuryArtifacts';
import { GAS_FLOOR, TREASURY_FACTORY_ADDRESS, treasuryGas, type Addr } from '@/lib/treasury';
import { CopyRow } from '@/components/vesting/notes';
import { TreasuryNote } from '@/components/treasury/notes';

const ARG_LABELS = ['Current Polydash launch factory', 'Earlier Polydash launch factory', 'Polydash staking factory V2', 'Uniswap V4 PoolManager'];

export function DeployTreasury() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [deployed, setDeployed] = useState<Addr | null>(null);
  const [impl, setImpl] = useState<Addr | null>(null);
  const [gasUsed, setGasUsed] = useState<bigint | null>(null);
  const args = TREASURY_FACTORY_ARGS as unknown as readonly `0x${string}`[];
  const abi = TREASURY_FACTORY_ABI as unknown as Abi;
  const bytecode = TREASURY_FACTORY_BYTECODE as `0x${string}`;

  const deploy = async () => {
    if (!walletClient || !client || !address) return;
    setBusy(true);
    setHash(null);
    setDeployed(null);
    setImpl(null);
    const tid = toast.loading('Preparing deployment…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateGas({ account: address, data: encodeDeployData({ abi, bytecode, args: args as any }) });
      } catch (e) {
        console.error('treasury factory deploy gas estimate failed, using floor', e);
      }
      toast.loading('Confirm the deployment in your wallet…', { id: tid });
      const h = await walletClient.deployContract({ abi, bytecode, args: args as any, chain: robinhoodChain, account: address, gas: treasuryGas(estimate) } as any);
      setHash(h);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash: h });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deployment reverted');
      setDeployed(r.contractAddress);
      setGasUsed(r.gasUsed);
      try {
        setImpl((await client.readContract({ address: r.contractAddress, abi, functionName: 'implementation' })) as Addr);
      } catch (e) {
        console.error('implementation() read failed', e);
      }
      toast.success('Treasury rules factory deployed', { id: tid });
    } catch (e: any) {
      console.error('treasury factory deploy failed', e);
      const msg = e?.shortMessage || e?.message || 'Deployment failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Deployment cancelled' : msg, { id: tid });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Admin</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">Deploy treasury rules factory</h1>
      <p className="mt-2 text-[13px] text-white/65">
        Deploys the treasury rules factory on Robinhood Chain ({robinhoodChain.id}) from your connected wallet. Your wallet signs; no keys are stored.
        The factory has no owner and no admin functions.
      </p>
      <TreasuryNote className="mt-4" />

      <div className="glass-card mt-6 space-y-2 p-4 text-[12px] sm:p-5">
        {ARG_LABELS.map((label, i) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <span className="text-white/55">{label}</span>
            <span className="break-all font-mono text-white">{args[i] ?? '—'}</span>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-white/55">Gas limit</span>
          <span className="font-mono text-white">max({GAS_FLOOR.toLocaleString('en-US')}, 1.5 × estimate) · expect about 8.1M</span>
        </div>
        {TREASURY_FACTORY_ADDRESS && <p className="pt-2 text-amber-300">A treasury rules factory address is already set in code: {TREASURY_FACTORY_ADDRESS}. Deploying again creates a separate factory.</p>}
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
          {deployed && <CopyRow label="Treasury rules factory address" value={deployed} href={getExplorerAddressUrl(deployed)} />}
          {impl && <CopyRow label="implementation()" value={impl} href={getExplorerAddressUrl(impl)} />}
          {gasUsed != null && <p className="text-[12px] text-white/55">Gas used: {gasUsed.toLocaleString('en-US')}</p>}
          {deployed && <p className="text-[12px] text-white/65">Set TREASURY_FACTORY_ADDRESS in lib/treasury.ts to this address to turn on treasury rules.</p>}
        </div>
      )}
    </div>
  );
}
