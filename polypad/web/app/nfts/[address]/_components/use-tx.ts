'use client';

import { useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { type Abi } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { NftCollectionABI } from '@/lib/contracts/nft-abis';

const ERRORS: Record<string, string> = {
  WindowClosed: 'The commitment window has ended.',
  WindowOpen: 'The commitment window is still open.',
  WalletLimit: 'That is over the per-wallet limit.',
  SoldOut: 'Not enough NFTs left.',
  BadValue: 'Wrong ETH amount.',
  AlreadyClaimed: 'Already claimed.',
  NothingCommitted: 'Nothing committed from this wallet.',
  NotOwner: 'You do not own one of the selected NFTs.',
  NothingToWithdraw: 'Nothing to withdraw.',
  NotApproved: 'The marketplace is not approved for this NFT.',
  BadPrice: 'Price is out of range.',
  BadExpiry: 'Expiry is out of range.',
  NotActive: 'This listing or offer is no longer active.',
  Expired: 'This listing or offer has expired.',
  NotSeller: 'Only the seller can do that.',
  NotBuyer: 'Only the buyer can do that.',
  WrongToken: 'That NFT does not match the offer.',
  CurveClosed: 'The curve has graduated. Trading on the curve is closed.',
  NotGraduated: 'Burning opens after graduation.',
  BadQuantity: 'Invalid quantity.',
  Slippage: 'The price moved. Try again.',
  NotCreator: 'Only the creator can do that.',
  Locked: 'This can no longer be changed.',
  BadParam: 'Invalid parameters.',
  Closed: 'These rewards are closed.',
  TooEarly: 'The claim window has not ended yet.',
  DepositMismatch: 'This token takes a fee on transfer and cannot be used.',
};

/** Sends a contract call, waits for the receipt and refreshes NFT queries. */
export function useContractTx() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const call = async (o: { key: string; address: `0x${string}`; abi: Abi; functionName: string; args?: any[]; value?: bigint; success?: string; quiet?: boolean }) => {
    if (!client) return false;
    setPending(o.key);
    const tid = toast.loading('Confirm the transaction in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({ address: o.address, abi: o.abi, functionName: o.functionName, args: (o.args ?? []) as any, value: o.value, chainId: robinhoodChain.id } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      if (o.quiet) toast.dismiss(tid);
      else toast.success(o.success ?? 'Done', { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['nft-collection'] }),
        qc.invalidateQueries({ queryKey: ['nft-user'] }),
        qc.invalidateQueries({ queryKey: ['nft-collections'] }),
        qc.invalidateQueries({ queryKey: ['nft-market'] }),
        qc.invalidateQueries({ queryKey: ['nft-curve'] }),
        qc.invalidateQueries({ queryKey: ['nft-links'] }),
      ]);
      return true;
    } catch (e: any) {
      console.error(`${o.functionName} failed`, e);
      const name = e?.cause?.data?.errorName ?? e?.data?.errorName;
      const msg = (name && ERRORS[name]) || e?.shortMessage || e?.message || 'Transaction failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg, { id: tid });
      return false;
    } finally {
      setPending(null);
    }
  };

  return { call, pending };
}

/** Shorthand for calls to a phase 1 collection contract. */
export function useCollectionTx(collection: `0x${string}`) {
  const { call, pending } = useContractTx();
  const send = (key: string, functionName: any, args: any[] = [], value?: bigint, success = 'Done') =>
    call({ key, address: collection, abi: NftCollectionABI as Abi, functionName, args, value, success });
  return { send, pending };
}
