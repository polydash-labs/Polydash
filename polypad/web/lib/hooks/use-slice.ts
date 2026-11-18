'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { erc20Abi, type Abi } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { SLICE_DISTRIBUTOR_ABI, SLICE_ESCROW_ABI } from '@/lib/sliceArtifacts';
import { errorName, errorText, sliceLive, writeGas, type Addr } from '@/lib/slice';

const CHAIN = robinhoodChain.id;
export const SABIS = { distributor: SLICE_DISTRIBUTOR_ABI as unknown as Abi, escrow: SLICE_ESCROW_ABI as unknown as Abi, erc20: erc20Abi as unknown as Abi };

export const useSliceStatus = () => useQuery({
  queryKey: ['slice', 'status'], enabled: sliceLive(), refetchInterval: 60_000,
  queryFn: async () => (await fetch('/api/slice/status')).json(),
});

/** gas = max(estimate x 1.5, SLICE_GAS.writeMin). The connected wallet signs; nothing is stored. */
export function useSliceTx() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const send = async (o: { key: string; address: Addr; abi: keyof typeof SABIS; functionName: string; args?: readonly unknown[]; success?: string }) => {
    if (!client || !address) return null;
    const abi = SABIS[o.abi];
    setPending(o.key);
    const tid = toast.loading('Preparing transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      let est: bigint | null = null;
      try { est = await client.estimateContractGas({ address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, account: address } as any); }
      catch (e) { if (errorName(e)) throw e; console.error(`${o.functionName} gas estimate failed, using floor`, e); }
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({ address: o.address, abi, functionName: o.functionName, args: (o.args ?? []) as any, chainId: CHAIN, gas: writeGas(est) } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', { id: tid });
      await qc.invalidateQueries({ queryKey: ['slice'] });
      return r;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const msg = errorText(e);
      toast.error(/User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg, { id: tid });
      return null;
    } finally { setPending(null); }
  };
  return { send, pending, client, address };
}
