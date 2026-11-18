'use client';

import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { formatEther, type Address } from 'viem';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { PolydashLaunchABI } from '@/lib/contracts/abis';
import { getExplorerTxUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

const CHAIN = robinhoodChain.id;
const EXPLORER = 'https://robinhoodchain.blockscout.com/address/';

export type FeeRoutingDestination = 'creator_wallet' | 'treasury_vault' | 'other';
export type FeeRoutingProps = {
  symbol: string;
  vault: string | null;
  pendingPayoutWallet: { address: string; executeAt: number; isVault: boolean } | null;
  feeRouting: { destination: FeeRoutingDestination; claimableWei: string; launch: string; creator: string; payoutWallet: string } | null;
  /** Called after a confirmed payout tx; the parent refetches with ?fresh=1. */
  onChanged: () => void | Promise<void>;
  showNote?: boolean;
  className?: string;
};

const DEST_LABEL: Record<FeeRoutingDestination, string> = {
  creator_wallet: 'creator wallet',
  treasury_vault: 'treasury vault',
  other: 'other wallet',
};

const ERRORS: Record<string, string> = {
  OnlyCreator: 'Only the token creator can start this change.',
  TooEarly: 'The 48-hour timelock has not ended yet.',
  NoPendingChange: 'There is no pending payout change.',
  NothingToClaim: 'There are no creator fees to claim right now.',
};

const ROUTE_NOTE =
  'This starts a public 48-hour timelock. After it ends anyone can complete the change. Fees accrued before the change is completed are paid to the current wallet. Fees after that go to the vault, where they can only be used under the vault\'s published rules.';
const BACK_NOTE =
  'This starts a public 48-hour timelock. After it ends anyone can complete the change. Fees accrued before the change is completed are paid to the current wallet. Fees after that go to the creator wallet.';
const CLAIM_HELP = 'Anyone can send accrued creator fees to the treasury vault. The caller pays gas and receives nothing.';
const VAULT_NOTE =
  'ETH in the vault can be used for buybacks within the rules. Reward pools and airdrops use tokens held by the vault, including tokens bought back when burn is off.';

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function errorMessage(e: any): string {
  let x = e;
  for (let i = 0; i < 6 && x; i++) {
    const name = x?.data?.errorName;
    if (name) return ERRORS[name] ?? `Transaction would fail: ${name}`;
    x = x.cause;
  }
  const msg = e?.shortMessage || e?.message || 'Transaction failed';
  return /User rejected|denied/i.test(msg) ? 'Transaction cancelled' : msg;
}

function countdown(s: number) {
  if (s <= 0) return 'now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function AddrLink({ a }: { a: string }) {
  return (
    <a href={`${EXPLORER}${a}`} target="_blank" rel="noopener noreferrer" className="font-mono text-polydash-green hover:underline">
      {shortenAddress(a)}
    </a>
  );
}

/** Status row only: "Fees go to: ..." with the payout wallet link. */
export function FeeDestinationRow({ destination, payoutWallet }: { destination: FeeRoutingDestination; payoutWallet: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <span className="text-white/45">Fees go to: <span className="text-white/85">{DEST_LABEL[destination]}</span></span>
      <AddrLink a={payoutWallet} />
    </div>
  );
}

export function FeeRouting({ symbol, vault, pendingPayoutWallet: pending, feeRouting: fr, onChanged, showNote, className }: FeeRoutingProps) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: CHAIN });
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { to: string; back: boolean }>(null);
  const [error, setError] = useState<string | null>(null);

  if (!fr) return null;
  const launch = fr.launch as Address;
  const isCreator = same(address, fr.creator);
  const isPayout = same(address, fr.payoutWallet);
  const routed = fr.destination === 'treasury_vault';
  const claimable = BigInt(fr.claimableWei || '0');
  const canCreatorAct = isCreator && !!vault;
  const ready = !!pending && now != null && now >= pending.executeAt;

  const run = async (key: string, functionName: 'initiatePayoutWalletChange' | 'cancelPayoutWalletChange' | 'executePayoutWalletChange' | 'claimCreatorFees', args: readonly unknown[], success: string) => {
    if (!client || !address) return false;
    setBusy(key);
    setError(null);
    const tid = toast.loading('Checking transaction…');
    try {
      if (chainId !== CHAIN) await switchChainAsync({ chainId: CHAIN });
      const { request } = await client.simulateContract({ address: launch, abi: PolydashLaunchABI, functionName, args, account: address } as any);
      toast.loading('Confirm the transaction in your wallet…', { id: tid });
      const hash = await writeContractAsync({ ...(request as any), chainId: CHAIN });
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('Transaction reverted');
      toast.success(success, { id: tid, action: { label: 'View tx', onClick: () => globalThis.open(getExplorerTxUrl(hash), '_blank') } });
      await onChanged();
      return true;
    } catch (e) {
      console.error(`${functionName} failed`, e);
      const msg = errorMessage(e);
      setError(msg);
      toast.error(msg, { id: tid });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const spin = (k: string) => busy === k && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />;
  const onChain4663 = chainId === CHAIN;

  return (
    <div className={cn('text-[13px]', className)}>
      <FeeDestinationRow destination={fr.destination} payoutWallet={fr.payoutWallet} />

      {pending && (
        <div className="mt-1 rounded-lg border border-white/[0.06] p-3">
          <p className="text-white/75">
            Change pending to <AddrLink a={pending.address} />
            {now != null && (
              <>, can be completed in <span className="font-mono">{countdown(pending.executeAt - now)}</span> ({new Date(pending.executeAt * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})</>
            )}
          </p>
          {!pending.isVault && <p className="mt-1 text-[12px] text-white/45">Pending destination is not this token&apos;s treasury vault.</p>}
          {address && (ready || isCreator || isPayout) && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {ready && (
                <Button size="sm" disabled={!!busy} onClick={() => run('execute', 'executePayoutWalletChange', [], 'Payout change completed')}>
                  {spin('execute')}Complete change
                </Button>
              )}
              {(isCreator || isPayout) && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('cancel', 'cancelPayoutWalletChange', [], 'Payout change cancelled')}>
                  {spin('cancel')}Cancel change
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {canCreatorAct && !pending && (
        <div className="mt-2 flex flex-wrap gap-2">
          {!routed && (
            <Button size="sm" disabled={!!busy} onClick={() => { setError(null); setConfirm({ to: vault!, back: false }); }}>Route fees to treasury</Button>
          )}
          {routed && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setError(null); setConfirm({ to: fr.creator, back: true }); }}>Route fees back to creator wallet</Button>
          )}
          {!onChain4663 && <p className="w-full text-[12px] text-white/45">Your wallet will be asked to switch to Robinhood Chain.</p>}
        </div>
      )}

      {routed && claimable > BigInt(0) && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-white/45">Claimable to vault</span>
            <span className="font-mono text-white/85">{Number(formatEther(claimable)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH</span>
          </div>
          {address && (
            <Button size="sm" className="mt-2" disabled={!!busy} onClick={() => run('claim', 'claimCreatorFees', [], 'Fees sent to the treasury vault')}>
              {spin('claim')}Claim fees to treasury
            </Button>
          )}
          <p className="mt-1.5 text-[12px] text-white/45">{CLAIM_HELP}</p>
        </div>
      )}

      {error && !confirm && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
      {showNote && <p className="mt-3 text-[12px] leading-relaxed text-white/45">{VAULT_NOTE} Not financial advice.</p>}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="fee-route-title"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setConfirm(null); }}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0d10] p-5 shadow-2xl">
            <h3 id="fee-route-title" className="text-[15px] font-semibold">{confirm.back ? 'Route fees back to creator wallet' : 'Route fees to treasury'}</h3>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div>
                <dt className="text-white/45">Current destination:</dt>
                <dd className="break-all font-mono text-white/85">{fr.payoutWallet}</dd>
              </div>
              <div>
                <dt className="text-white/45">New destination:</dt>
                <dd className="break-all font-mono text-white/85">
                  {confirm.to}{' '}
                  <span className="font-sans text-white/55">{confirm.back ? '(creator wallet)' : `(Treasury rules vault for ${symbol})`}</span>
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[13px] leading-relaxed text-white/65">{confirm.back ? BACK_NOTE : ROUTE_NOTE}</p>
            {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setConfirm(null)}>Cancel</Button>
              <Button size="sm" disabled={!!busy}
                onClick={async () => { if (await run('initiate', 'initiatePayoutWalletChange', [confirm.to], 'Payout change started')) setConfirm(null); }}>
                {spin('initiate')}Start 48h change
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
