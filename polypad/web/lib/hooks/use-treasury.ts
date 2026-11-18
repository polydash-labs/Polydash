'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { erc20Abi, parseAbi, type Abi, type TransactionReceipt } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { TREASURY_FACTORY_ABI, TREASURY_RULES_ABI } from '@/lib/treasuryArtifacts';
import { TREASURY_ERRORS, isAddr, isPolydashToken, isZero, sameAddr, treasuryFactory, treasuryGas, treasuryLive, type Addr } from '@/lib/treasury';
import type { TreasuryData } from '@/lib/treasury-server';

const CHAIN = robinhoodChain.id;
export const FACTORY_ABI = TREASURY_FACTORY_ABI as unknown as Abi;
export const VAULT_ABI = TREASURY_RULES_ABI as unknown as Abi;
const LAUNCH_CREATOR_ABI = parseAbi(['function creator() view returns (address)']);

export type { TreasuryData };

/** Public treasury state from /api/treasury/[token]. Disabled while the feature flag is off. */
export function useTreasury(token?: string | null) {
  return useQuery({
    queryKey: ['treasury', 'data', token?.toLowerCase()],
    enabled: treasuryLive() && !!token && isAddr(token),
    refetchInterval: 30_000,
    queryFn: async (): Promise<TreasuryData | null> => {
      const r = await fetch(`/api/treasury/${token}`);
      if (!r.ok) throw new Error(`treasury api ${r.status}`);
      const j = await r.json();
      return j?.live ? (j as TreasuryData) : null;
    },
  });
}

export interface SetupInfo {
  launch: Addr | null; creator: Addr | null; existing: Addr | null; isCreator: boolean;
  symbol: string; name: string; decimals: number;
}

/** Eligibility for /treasury/setup: factory.launchOf(token) != 0 and launch.creator() == connected wallet. */
export function useTreasurySetupInfo(token?: string | null) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: CHAIN });
  const factory = treasuryFactory();
  return useQuery({
    queryKey: ['treasury', 'setup', token?.toLowerCase(), address?.toLowerCase()],
    enabled: !!client && !!factory && !!token && isAddr(token) && !isPolydashToken(token),
    queryFn: async (): Promise<SetupInfo> => {
      const t = token!.toLowerCase() as Addr;
      const [launch, existing, symbol, name, decimals] = await Promise.all([
        client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'launchOf', args: [t] }) as Promise<Addr>,
        client!.readContract({ address: factory!, abi: FACTORY_ABI, functionName: 'rulesOf', args: [t] }) as Promise<Addr>,
        client!.readContract({ address: t, abi: erc20Abi, functionName: 'symbol' }).catch(() => ''),
        client!.readContract({ address: t, abi: erc20Abi, functionName: 'name' }).catch(() => ''),
        client!.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
      ]);
      const creator = isZero(launch) ? null : ((await client!.readContract({ address: launch, abi: LAUNCH_CREATOR_ABI, functionName: 'creator' })) as Addr);
      return {
        launch: isZero(launch) ? null : launch, creator, existing: isZero(existing) ? null : existing,
        isCreator: !!creator && sameAddr(creator, address), symbol, name, decimals: Number(decimals),
      };
    },
  });
}

function errorInfo(e: any): { name?: string; arg?: string } {
  let x = e;
  for (let i = 0; i < 6 && x; i++) {
    if (x?.data?.errorName) return { name: x.data.errorName, arg: x.data.args?.[0] != null ? String(x.data.args[0]) : undefined };
    x = x.cause;
  }
  return {};
}

export function treasuryErrorMessage(e: any): string {
  const { name, arg } = errorInfo(e);
  if (name === 'InvalidRules' && arg) return `Rule value not allowed: ${arg}. Check that field and try again.`;
  const msg = (name && TREASURY_ERRORS[name]) || (name ? `Transaction would fail: ${name}` : '') || e?.shortMessage || e?.message || 'Transaction failed';
  return /User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg;
}

/** Sends a treasury tx with gas = max(estimate x 1.5, 4,000,000). The connected wallet signs. Returns the receipt or null. */
export function useTreasuryTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const send = async (o: {
    key: string; address: Addr; abi: 'factory' | 'vault' | Abi; functionName: string; args?: readonly unknown[]; value?: bigint; success?: string;
  }): Promise<TransactionReceipt | null> => {
    if (!client || !address) return null;
    const abi = o.abi === 'factory' ? FACTORY_ABI : o.abi === 'vault' ? VAULT_ABI : o.abi;
    setPending(o.key);
    setLastError(null);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateContractGas({ address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, account: address } as any);
      } catch (e) {
        if (errorInfo(e).name) throw e;
        console.error(`${o.functionName} gas estimate failed, using floor`, e);
      }
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({
        address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, chainId: CHAIN, gas: treasuryGas(estimate),
      } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await qc.invalidateQueries({ queryKey: ['treasury'] });
      return r;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const msg = treasuryErrorMessage(e);
      setLastError(msg);
      toast.error(msg, { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  return { send, pending, lastError, setLastError };
}
