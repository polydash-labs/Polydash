'use client';

// Agent-earn transaction helper — one pattern for every board write
// (approve, lock, claim, deliver, release, refund): switch to Robinhood
// Chain, send from the connected wallet, wait for the receipt, toast the
// result. Returns the tx hash so the caller can record the event with the
// API (which verifies it on-chain before storing anything).
// Modeled on app/nfts/[address]/_components/use-tx.ts.

import { useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import type { Abi, Hex } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';

const ERRORS: Record<string, string> = {
  ZeroAmount: 'The amount is zero.',
  ZeroReceived: 'Nothing arrived in the escrow.',
  LockExists: 'This job already has a lock — a job locks exactly once.',
  NotLocked: 'This job has no lock on-chain.',
  AlreadyClaimed: 'Another agent claimed this job first.',
  AlreadyDelivered: 'This job was already delivered.',
  ZeroDeliverableHash: 'The deliverable hash is empty.',
  NotPoster: 'Only the poster can do that.',
  NotPanelExecutor: 'Only the panel multisig can do that.',
  NotAuthorized: 'Your wallet is not allowed to do that for this job.',
  NoAgentClaimed: 'No agent has claimed this job yet.',
  BadSplit: 'That split does not match the outcome.',
  BadVoters: 'A panel needs exactly 3 different evaluators.',
  BadFeeBps: 'That fee is over the 10% cap.',
};

export function useEarnTx() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [pending, setPending] = useState<string | null>(null);

  /** Sends the call and waits for the receipt. Returns the hash, or null. */
  const call = async (o: {
    key: string;
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args?: unknown[];
    value?: bigint;
    confirmLabel?: string;
    success?: string;
  }): Promise<Hex | null> => {
    if (!client) return null;
    setPending(o.key);
    const tid = toast.loading(o.confirmLabel ?? 'Confirm the transaction in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({
        address: o.address,
        abi: o.abi,
        functionName: o.functionName,
        args: (o.args ?? []) as never,
        value: o.value,
        chainId: robinhoodChain.id,
      } as never);
      toast.loading('Waiting for confirmation…', { id: tid });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      toast.success(o.success ?? 'Done', {
        id: tid,
        action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') },
      });
      return hash;
    } catch (e: unknown) {
      const err = e as { cause?: { data?: { errorName?: string } }; data?: { errorName?: string }; shortMessage?: string; message?: string };
      const name = err?.cause?.data?.errorName ?? err?.data?.errorName;
      const msg = (name && ERRORS[name]) || err?.shortMessage || err?.message || 'Transaction failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg, { id: tid });
      return null;
    } finally {
      setPending(null);
    }
  };

  return { call, pending };
}
