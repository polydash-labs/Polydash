'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { encodeDeployData, type Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { TOKEN_FLOOR_FACTORY_ABI, TOKEN_FLOOR_FACTORY_ARGS, TOKEN_FLOOR_FACTORY_BYTECODE } from '@/lib/floorVaultArtifacts';
import { ARG_LABELS, EXPECTED_FACTORY_ADDRESS, GAS_FLOOR, TOKEN_FLOOR_FACTORY_ADDRESS, floorGas, sameAddr, type Addr } from '@/lib/floorVault';
import { CopyRow } from '@/components/vesting/notes';
import { FloorContractLinks } from '@/components/floor-vault/notes';

export function DeployTokenFloor() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [deployed, setDeployed] = useState<Addr | null>(null);
  const [impl, setImpl] = useState<Addr | null>(null);
  const [gasUsedLimit, setGasUsedLimit] = useState<bigint | null>(null);
  const configured = TOKEN_FLOOR_FACTORY_ADDRESS as Addr | null;
  const args = TOKEN_FLOOR_FACTORY_ARGS as unknown as readonly unknown[];
  const abi = TOKEN_FLOOR_FACTORY_ABI as unknown as Abi;
  const bytecode = TOKEN_FLOOR_FACTORY_BYTECODE as `0x${string}`;

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
        const data = encodeDeployData({ abi, bytecode, args: args as any });
        estimate = await client.estimateGas({ account: address, data });
      } catch (e) {
        console.error('token floor factory deploy gas estimate failed, using floor', e);
      }
      const gas = floorGas(estimate);
      setGasUsedLimit(gas);
      toast.loading('Confirm the deployment in your wallet…', { id: tid });
      const h = await walletClient.deployContract({ abi, bytecode, args: args as any, chain: robinhoodChain, account: address, gas } as any);
      setHash(h);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash: h });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deployment reverted');
      setDeployed(r.contractAddress);
      toast.success('Token-backed floor factory deployed', { id: tid });
      try {
        const i = (await client.readContract({ address: r.contractAddress, abi, functionName: 'implementation' })) as Addr;
        setImpl(i);
      } catch (e) {
        console.error('implementation() read failed', e);
      }
    } catch (e: any) {
      console.error('token floor factory deploy failed', e);
      const msg = e?.shortMessage || e?.message || 'Deployment failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Deployment cancelled' : msg, { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const differs = deployed && !sameAddr(deployed, EXPECTED_FACTORY_ADDRESS);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Admin</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">Deploy token-backed floor factory</h1>
      <p className="mt-2 text-[13px] text-white/65">
        Deploys the token-backed floor vault factory on Robinhood Chain ({robinhoodChain.id}) from your connected wallet. Your wallet signs; no keys are stored.
        The factory has no owner and no admin functions.
      </p>

      <div className="glass-card mt-6 space-y-2 p-4 text-[12px] sm:p-5">
        {ARG_LABELS.map((label, i) => (
          <div key={label} className="flex flex-wrap justify-between gap-2" data-testid="deploy-arg">
            <span className="text-white/55">{label}</span>
            <span className="break-all font-mono text-white">{args[i] != null ? String(args[i]) : '—'}</span>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-white/55">Gas limit</span>
          <span className="font-mono text-white">max({GAS_FLOOR.toLocaleString('en-US')}, 1.5 × estimate)</span>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-white/55">Expected address (from 0x89df…53F1, nonce 48)</span>
          <span className="break-all font-mono text-white">{EXPECTED_FACTORY_ADDRESS}</span>
        </div>
        {configured && <p className="pt-2 text-amber-300">A token floor factory address is already set in code: {configured}. Deploying again creates a separate factory.</p>}
        <FloorContractLinks className="pt-2" />
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
          {gasUsedLimit && <p className="text-[12px] text-white/55">Gas limit sent: <span className="font-mono text-white">{gasUsedLimit.toLocaleString('en-US')}</span></p>}
          {hash && <CopyRow label="Transaction hash" value={hash} href={getExplorerTxUrl(hash)} />}
          {deployed && <CopyRow label="Token floor factory address" value={deployed} href={getExplorerAddressUrl(deployed)} />}
          {impl && <CopyRow label="implementation()" value={impl} href={getExplorerAddressUrl(impl)} />}
          {differs && (
            <div className="flex gap-2 rounded-xl border border-amber-300/25 bg-amber-400/[0.06] p-3 text-[12px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> The deployed address differs from the expected {EXPECTED_FACTORY_ADDRESS}. This happens when a different wallet or nonce was used. Use the address above.
            </div>
          )}
          {deployed && <p className="text-[12px] text-white/65">Set TOKEN_FLOOR_FACTORY_ADDRESS in lib/floorVault.ts to this address to turn on token-backed floor vaults.</p>}
        </div>
      )}
    </div>
  );
}
